// Builds the schema the way scripts/pg-chain.mjs buildDb(n) does on PGlite
// (supabase/schema.sql, then every supabase/migrations/NNN_*.sql in order,
// each file sent as one script), but on a real Postgres 16 cluster and
// with the roles, grants and extensions a Supabase project starts with.
// The migrations come from the app checkout under test, so a branch's new
// migration is picked up; RIG_MIGRATE_TO=<n> stops after migration n.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { psqlExec, psqlRows } from './pg.mjs';
import { PATHS } from './config.mjs';

export function migrationFiles(appDir) {
  const dir = path.join(appDir, 'supabase', 'migrations');
  return fs.readdirSync(dir).filter((f) => /^\d{3}_.*\.sql$/.test(f)).sort();
}

export function migrateTo() {
  const raw = process.env.RIG_MIGRATE_TO;
  if (raw == null || raw === '') return Infinity;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) throw new Error(`RIG_MIGRATE_TO must be a migration number, got "${raw}"`);
  return n;
}

const quote = (s) => `'${String(s).replace(/'/g, "''")}'`;

// What a fresh Supabase project has before anyone runs a line of SQL:
// the API roles (service_role bypasses row level security; the
// authenticator logs in and switches to them), table/sequence/function
// grants to all three through default privileges (migration 112 takes
// them back from anon/authenticated), pgcrypto and uuid-ossp in the
// `extensions` schema on the search path.
export function bootstrapSql(authenticatorPassword) {
  return `
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin noinherit bypassrls; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then create role authenticator login noinherit; end if;
end $$;
alter role service_role bypassrls;
alter role authenticator with login noinherit password ${quote(authenticatorPassword)};
grant anon, authenticated, service_role to authenticator;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
create schema if not exists extensions;
grant usage on schema extensions to anon, authenticated, service_role;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists "uuid-ossp" with schema extensions;
alter database postgres set search_path to "$user", public, extensions;
create schema if not exists rig;
revoke all on schema rig from public;
create table if not exists rig.applied (
  file text primary key,
  ok boolean not null,
  error text,
  ms integer,
  at timestamptz not null default now()
);
alter table rig.applied add column if not exists sha256 text;
`;
}

export function chainApplied() {
  try {
    return psqlRows('select file, ok, error, sha256 from rig.applied order by file');
  } catch (err) {
    return [];
  }
}

export function databaseEmpty() {
  const rows = psqlRows("select count(*)::int as n from pg_tables where schemaname = 'public'");
  return rows[0].n === 0;
}

const sha = (text) => crypto.createHash('sha256').update(text).digest('hex');

function record(file, ok, error, ms, hash) {
  psqlExec(`insert into rig.applied (file, ok, error, ms, sha256) values (${quote(file)}, ${ok}, ${error == null ? 'null' : quote(error)}, ${ms}, ${quote(hash)})
    on conflict (file) do update set ok = excluded.ok, error = excluded.error, ms = excluded.ms, sha256 = excluded.sha256, at = now()`);
}

// One file, run and recorded the way the chain runs them.
export function runRecorded(label, file) {
  const text = fs.readFileSync(file, 'utf8');
  const t0 = Date.now();
  const res = psqlExec(text);
  const ms = Date.now() - t0;
  const error = res.ok ? null : (res.stderr.split('\n').filter((l) => /ERROR|DETAIL|HINT|CONTEXT|LINE/.test(l)).join(' | ') || res.stderr.trim());
  record(label, res.ok, error, ms, sha(text));
  return { file: label, ok: res.ok, error, ms };
}

// What differs between the database and a checkout: files it ran that the
// checkout doesn't have, and files whose text changed since they ran.
export function chainDrift(appDir) {
  const applied = chainApplied().filter((r) => r.ok && /^\d{3}_/.test(r.file));
  const files = new Set(migrationFiles(appDir));
  const missing = applied.filter((r) => !files.has(r.file)).map((r) => r.file);
  const changed = applied.filter((r) => files.has(r.file) && r.sha256 && r.sha256 !== sha(fs.readFileSync(path.join(appDir, 'supabase', 'migrations', r.file), 'utf8'))).map((r) => r.file);
  return { missing, changed };
}

// Runs the chain. A file that fails is rolled back (it was one implicit
// transaction) and recorded, and the chain carries on with the next one,
// so one broken migration doesn't leave the rest of the rig unbuilt; the
// summary says which failed and why. Never edits a migration.
export function applyChain(appDir, { log = console.log, authenticatorPassword } = {}) {
  const upTo = migrateTo();
  const boot = psqlExec(bootstrapSql(authenticatorPassword));
  if (!boot.ok) throw new Error(`bootstrap failed: ${boot.stderr}`);
  const results = [];
  const runOne = (label, file) => {
    const r = runRecorded(label, file);
    results.push(r);
    log(`${r.ok ? 'ran   ' : 'FAILED'} ${label}${r.ok ? '' : `: ${r.error}`}`);
  };
  runOne('schema.sql', path.join(appDir, 'supabase', 'schema.sql'));
  for (const f of migrationFiles(appDir)) {
    if (Number(f.slice(0, 3)) > upTo) break;
    runOne(f, path.join(appDir, 'supabase', 'migrations', f));
  }
  psqlExec("notify pgrst, 'reload schema'");
  fs.mkdirSync(PATHS.state, { recursive: true });
  fs.writeFileSync(path.join(PATHS.state, 'migrations.json'), JSON.stringify({ appDir, upTo: Number.isFinite(upTo) ? upTo : null, at: new Date().toISOString(), results }, null, 2));
  return results;
}
