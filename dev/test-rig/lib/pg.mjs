// The rig's Postgres cluster: init, start, stop, and psql calls. When the
// rig runs as root (the cloud container), the server runs as the
// `postgres` system user, since initdb and postgres refuse root.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { PATHS, PORTS, PG_BIN, PSQL, HOST, IS_ROOT } from './config.mjs';

const asPostgres = (cmd, args) => (IS_ROOT ? ['runuser', ['-u', 'postgres', '--', cmd, ...args]] : [cmd, args]);

function run(cmd, args, opts = {}) {
  const [c, a] = opts.asServer ? asPostgres(cmd, args) : [cmd, args];
  const res = spawnSync(c, a, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts.spawn });
  return { ok: res.status === 0, status: res.status, stdout: res.stdout || '', stderr: res.stderr || '', error: res.error };
}

function chownToPostgres(p) {
  if (!IS_ROOT) return;
  run('chown', ['-R', 'postgres:postgres', p]);
}

export function clusterExists() {
  return fs.existsSync(path.join(PATHS.pgdata, 'PG_VERSION'));
}

export function initCluster() {
  if (clusterExists()) return false;
  fs.mkdirSync(PATHS.pgdata, { recursive: true });
  fs.mkdirSync(PATHS.pgsock, { recursive: true });
  chownToPostgres(PATHS.pgdata);
  chownToPostgres(PATHS.pgsock);
  const res = run(path.join(PG_BIN, 'initdb'), ['-D', PATHS.pgdata, '-U', 'postgres', '--auth=trust', '-E', 'UTF8', '--locale=C.UTF-8'], { asServer: true });
  if (!res.ok) throw new Error(`initdb failed: ${res.stderr || res.stdout}`);
  return true;
}

export function pgRunning() {
  const res = run(path.join(PG_BIN, 'pg_ctl'), ['-D', PATHS.pgdata, 'status'], { asServer: true });
  return res.ok;
}

export function startPg() {
  if (pgRunning()) return false;
  const log = path.join(PATHS.logs, 'postgres.log');
  fs.mkdirSync(PATHS.logs, { recursive: true });
  if (!fs.existsSync(log)) fs.writeFileSync(log, '');
  chownToPostgres(log);
  fs.mkdirSync(PATHS.pgsock, { recursive: true });
  chownToPostgres(PATHS.pgsock);
  // Durability off: this is a throwaway test database.
  const opts = [
    `-p ${PORTS.postgres}`,
    `-k ${PATHS.pgsock}`,
    `-c listen_addresses=${HOST}`,
    '-c fsync=off',
    '-c synchronous_commit=off',
    '-c full_page_writes=off',
    '-c max_connections=100'
  ].join(' ');
  const res = run(path.join(PG_BIN, 'pg_ctl'), ['-D', PATHS.pgdata, '-l', log, '-w', '-t', '60', '-o', opts, 'start'], { asServer: true });
  if (!res.ok) throw new Error(`pg_ctl start failed: ${res.stderr || res.stdout}\n(see ${log})`);
  return true;
}

export function stopPg() {
  if (!clusterExists() || !pgRunning()) return false;
  const res = run(path.join(PG_BIN, 'pg_ctl'), ['-D', PATHS.pgdata, '-m', 'fast', '-w', 'stop'], { asServer: true });
  return res.ok;
}

const baseArgs = (db = 'postgres') => ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-h', HOST, '-p', String(PORTS.postgres), '-U', 'postgres', '-d', db];

// One string sent as one simple-query message: the way the Supabase SQL
// Editor (and PGlite's exec in scripts/pg-chain.mjs) runs a file, so the
// whole file is one implicit transaction unless it says BEGIN/COMMIT.
export function psqlExec(sql, { db } = {}) {
  return run(PSQL, [...baseArgs(db), '-c', sql]);
}

// Rows as JSON. `sql` is a SELECT; the result comes back as one json_agg.
export function psqlRows(sql, { db } = {}) {
  const res = run(PSQL, [...baseArgs(db), '-A', '-t', '-c', `select coalesce(json_agg(_rig_row), '[]'::json) from (${sql}) _rig_row`]);
  if (!res.ok) throw new Error(res.stderr.trim() || 'psql failed');
  return JSON.parse(res.stdout.trim() || '[]');
}

export function psqlFile(file, { db } = {}) {
  return psqlExec(fs.readFileSync(file, 'utf8'), { db });
}

// psql's own file runner (COPY … FROM stdin, meta-commands), one
// transaction: for pg_dump output.
export function psqlScript(file, { db } = {}) {
  return run(PSQL, [...baseArgs(db), '--single-transaction', '-f', file]);
}

// The data the chain itself leaves (site_settings row 1, the ratings, the
// first channel…), so a reset can put back exactly a freshly built
// database before seeding.
export function dumpBaseline(file) {
  const res = run(path.join(PG_BIN, 'pg_dump'), ['-h', HOST, '-p', String(PORTS.postgres), '-U', 'postgres', '--data-only', '--schema=public', '--disable-triggers', '-f', file, 'postgres']);
  if (!res.ok) throw new Error(`pg_dump failed: ${res.stderr}`);
}

export function truncatePublic() {
  return psqlExec(`do $$
declare list text;
begin
  select string_agg(format('public.%I', tablename), ', ') into list from pg_tables where schemaname = 'public';
  if list is not null then execute 'truncate table ' || list || ' restart identity cascade'; end if;
end $$;`);
}

// Drops and recreates the database (for RIG_MIGRATE_TO / a rebuild).
export function recreateDatabase() {
  const a = psqlExec('drop database if exists postgres with (force)', { db: 'template1' });
  if (!a.ok) throw new Error(`drop database failed: ${a.stderr}`);
  const b = psqlExec('create database postgres', { db: 'template1' });
  if (!b.ok) throw new Error(`create database failed: ${b.stderr}`);
}

export function databaseReady() {
  return psqlExec('select 1').ok;
}
