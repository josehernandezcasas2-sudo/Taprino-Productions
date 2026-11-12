#!/usr/bin/env node
// The rig's one entry point; start.sh / stop.sh / reset.sh / status.sh call it.
//   node dev/test-rig/bin/rig.mjs start [app-checkout]   (default: this repo)
//   node dev/test-rig/bin/rig.mjs stop
//   node dev/test-rig/bin/rig.mjs reset [--rebuild]
//   node dev/test-rig/bin/rig.mjs status
//   node dev/test-rig/bin/rig.mjs env          the app's environment, as shell exports
//   node dev/test-rig/bin/rig.mjs migrate      apply migrations the database lacks
//   node dev/test-rig/bin/rig.mjs restart-next [app-checkout]
//                                              only `next dev` again, with this shell's
//                                              RIG_APP_ENV_* (e.g. a GOOGLE_VIDEO_AD_TAG)
import fs from 'node:fs';
import path from 'node:path';
import { RIG_DIR, REPO_DIR, DATA_DIR, PATHS, PORTS, HOST, urls, PG_BIN, POSTGREST_BIN, ensureDirs, IS_ROOT } from '../lib/config.mjs';
import { ensureKeys } from '../lib/keys.mjs';
import { initCluster, startPg, stopPg, pgRunning, clusterExists, psqlExec, psqlRows, dumpBaseline, psqlScript, truncatePublic, recreateDatabase, databaseReady } from '../lib/pg.mjs';
import { applyChain, chainApplied, chainDrift, databaseEmpty, migrationFiles, migrateTo, bootstrapSql, runRecorded } from '../lib/chain.mjs';
import { seed } from '../lib/seed.mjs';
import { wipeStorage } from '../lib/storage.mjs';
import { appEnv } from '../lib/appenv.mjs';
import { startProcess, stopProcess, running, waitFor, portOpen, tail, logFile } from '../lib/procs.mjs';

const BASELINE = path.join(PATHS.state, 'baseline.sql');
const BUILD = path.join(PATHS.state, 'build.json');
const SERVICES = [
  { name: 'supabase', file: 'supabase.mjs', port: PORTS.supabase, health: `${urls().supabase}/__health` },
  { name: 'clerk', file: 'clerk.mjs', port: PORTS.clerk, health: `${urls().clerk}/__health` },
  { name: 'stripe', file: 'stripe.mjs', port: PORTS.stripe, health: `${urls().stripe}/__health` },
  { name: 'cloudflare', file: 'cloudflare.mjs', port: PORTS.cloudflare, health: `${urls().cloudflare}/__health` }
];

const say = (line) => console.log(`[rig] ${line}`);

function appDirFrom(arg) {
  const dir = path.resolve(arg || process.env.RIG_APP_DIR || REPO_DIR);
  if (!fs.existsSync(path.join(dir, 'supabase', 'migrations')) || !fs.existsSync(path.join(dir, 'next.config.js'))) {
    throw new Error(`${dir} doesn't look like a Studio Tapa TV checkout (no supabase/migrations or next.config.js)`);
  }
  return dir;
}

function readBuild() {
  try {
    return JSON.parse(fs.readFileSync(BUILD, 'utf8'));
  } catch (err) {
    return null;
  }
}

function checkTools() {
  if (!fs.existsSync(path.join(PG_BIN, 'initdb'))) throw new Error(`Postgres binaries not found in ${PG_BIN} (set RIG_PG_BIN)`);
  if (!fs.existsSync(POSTGREST_BIN)) {
    throw new Error(`PostgREST not found at ${POSTGREST_BIN}.\nFetch the release binary with: bash ${path.relative(process.cwd(), path.join(RIG_DIR, 'fetch-postgrest.sh'))}\n(or set RIG_POSTGREST_BIN to one you have)`);
  }
}

function writePostgrestConf(keys) {
  const conf = [
    `db-uri = "postgres://authenticator:${keys.authenticatorPassword}@${HOST}:${PORTS.postgres}/postgres"`,
    'db-schemas = "public"',
    'db-anon-role = "anon"',
    'db-extra-search-path = "public, extensions"',
    // Supabase's default API row cap (CLAUDE.md: reads that stop at 1,000).
    'db-max-rows = 1000',
    'db-pool = 20',
    'db-channel-enabled = true',
    'db-channel = "pgrst"',
    `jwt-secret = "${keys.jwtSecret}"`,
    `server-host = "${HOST}"`,
    `server-port = ${PORTS.postgrest}`,
    `admin-server-port = ${PORTS.postgrestAdmin}`,
    'log-level = "warn"',
    ''
  ].join('\n');
  fs.writeFileSync(PATHS.postgrestConf, conf, { mode: 0o600 });
}

async function health(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(1500) });
    if (!res.ok) return false;
    const body = await res.json().catch(() => ({}));
    return body.ok !== false;
  } catch (err) {
    return false;
  }
}

// Build (or extend) the database for this checkout.
function buildDatabase(appDir, keys, { rebuild = false } = {}) {
  const upTo = migrateTo();
  const prev = readBuild();
  const wantUpTo = Number.isFinite(upTo) ? upTo : null;
  if (!rebuild && prev && (prev.upTo ?? null) !== wantUpTo && !databaseEmpty()) {
    say(`RIG_MIGRATE_TO changed (${prev.upTo ?? 'all'} → ${wantUpTo ?? 'all'}): rebuilding the database`);
    rebuild = true;
  }
  if (rebuild && !databaseEmpty()) {
    say('dropping and recreating the database');
    recreateDatabase();
  }
  if (databaseEmpty()) {
    say(`applying schema.sql + migrations from ${appDir}${wantUpTo ? ` up to ${wantUpTo}` : ''}`);
    const results = applyChain(appDir, { authenticatorPassword: keys.authenticatorPassword, log: (l) => (l.startsWith('ran') ? null : say(l)) });
    const failed = results.filter((r) => !r.ok);
    say(`chain: ${results.length - failed.length} of ${results.length} files ran${failed.length ? `, ${failed.length} failed (see status)` : ''}`);
    dumpBaseline(BASELINE);
    fs.writeFileSync(BUILD, JSON.stringify({ appDir, upTo: wantUpTo, at: new Date().toISOString() }, null, 2));
    return { fresh: true, failed };
  }
  // An existing database: bring in migrations this checkout has that it lacks.
  const boot = psqlExec(bootstrapSql(keys.authenticatorPassword));
  if (!boot.ok) throw new Error(`bootstrap failed: ${boot.stderr}`);
  const done = new Set(chainApplied().filter((r) => r.ok).map((r) => r.file));
  const pending = migrationFiles(appDir).filter((f) => !done.has(f) && Number(f.slice(0, 3)) <= upTo);
  if (pending.length) {
    say(`this checkout has ${pending.length} migration(s) the database lacks: ${pending.join(', ')} — applying them`);
    for (const f of pending) {
      const r = runRecorded(f, path.join(appDir, 'supabase', 'migrations', f));
      say(`${r.ok ? 'ran   ' : 'FAILED'} ${f}${r.ok ? '' : `: ${r.error}`}`);
    }
    psqlExec("notify pgrst, 'reload schema'");
  }
  const drift = chainDrift(appDir);
  if (drift.missing.length) say(`warning: the database ran migration(s) this checkout doesn't have: ${drift.missing.join(', ')} — RIG_REBUILD=1 start.sh (or reset.sh --rebuild) builds it from this checkout`);
  if (drift.changed.length) say(`warning: migration(s) changed since the database ran them: ${drift.changed.join(', ')} — RIG_REBUILD=1 start.sh to run the new text`);
  return { fresh: false, failed: [] };
}

async function startServices(keys) {
  writePostgrestConf(keys);
  startProcess('postgrest', POSTGREST_BIN, [PATHS.postgrestConf]);
  await waitFor(() => fetch(`http://${HOST}:${PORTS.postgrestAdmin}/ready`, { signal: AbortSignal.timeout(1000) }).then((r) => r.status === 200), { timeoutMs: 30000, what: `PostgREST (log: ${logFile('postgrest')})` });
  for (const s of SERVICES) startProcess(s.name, process.execPath, [path.join(RIG_DIR, 'bin', s.file)], { cwd: RIG_DIR, env: { ...process.env, RIG_DATA_DIR: DATA_DIR } });
  for (const s of SERVICES) await waitFor(() => health(s.health), { timeoutMs: 20000, what: `${s.name} (log: ${logFile(s.name)})` });
}

async function startNext(appDir, keys) {
  if (running('next')) return say(`Next is already running (pid ${running('next')})`);
  const nextBin = path.join(appDir, 'node_modules', 'next', 'dist', 'bin', 'next');
  if (!fs.existsSync(nextBin)) throw new Error(`${appDir}/node_modules has no next — install the app's dependencies there (or symlink node_modules from a checkout that has them)`);
  const env = { ...process.env, ...appEnv(appDir, keys) };
  delete env.NODE_ENV;
  startProcess('next', process.execPath, [nextBin, 'dev', '-p', String(PORTS.next), '-H', 'localhost'], { cwd: appDir, env });
  fs.writeFileSync(PATHS.appFile, appDir);
  await waitFor(() => portOpen(PORTS.next), { timeoutMs: 90000, what: `next dev on :${PORTS.next} (log: ${logFile('next')})` });
}

async function start(argApp) {
  ensureDirs();
  checkTools();
  const appDir = appDirFrom(argApp);
  const keys = ensureKeys();
  if (initCluster()) say(`created a Postgres cluster in ${PATHS.pgdata}`);
  if (startPg()) say(`Postgres started on ${HOST}:${PORTS.postgres}`);
  await waitFor(() => databaseReady(), { timeoutMs: 20000, what: 'Postgres' });
  const built = buildDatabase(appDir, keys, { rebuild: process.env.RIG_REBUILD === '1' });
  await startServices(keys);
  if (built.fresh || process.env.RIG_SEED === '1') await seed({ base: appEnv(appDir, keys).SUPABASE_URL, log: say });
  else say('database already built: seed not re-run (reset.sh to go back to the seed, RIG_SEED=1 to upsert it again)');
  await startNext(appDir, keys);
  say(`up: the app on ${urls().next} (${appDir}); logs in ${PATHS.logs}`);
  say(`sessions: node ${path.relative(process.cwd(), path.join(RIG_DIR, 'mint-session.mjs'))} user_rigMara`);
}

async function stop() {
  for (const name of ['next', 'cloudflare', 'stripe', 'clerk', 'supabase', 'postgrest']) if (await stopProcess(name)) say(`stopped ${name}`);
  if (clusterExists() && stopPg()) say('stopped Postgres');
}

async function reset({ rebuild = false } = {}) {
  ensureDirs();
  const keys = ensureKeys();
  const appDir = fs.existsSync(PATHS.appFile) ? fs.readFileSync(PATHS.appFile, 'utf8').trim() : REPO_DIR;
  if (!pgRunning()) throw new Error('Postgres is not running — start the rig first');
  if (rebuild || !fs.existsSync(BASELINE)) {
    buildDatabase(appDir, keys, { rebuild: true });
  } else {
    const t = truncatePublic();
    if (!t.ok) throw new Error(`truncate failed: ${t.stderr}`);
    const b = psqlScript(BASELINE);
    if (!b.ok) throw new Error(`restoring the baseline failed: ${b.stderr}`);
  }
  wipeStorage();
  await seed({ base: appEnv(appDir, keys).SUPABASE_URL, log: say });
  for (const s of SERVICES.filter((x) => x.name !== 'supabase')) {
    try {
      await fetch(`${s.health.replace('/__health', '/__reset')}`, { method: 'POST', signal: AbortSignal.timeout(3000) });
      say(`reset ${s.name}`);
    } catch (err) {
      say(`${s.name} is not running (nothing to reset)`);
    }
  }
  say('reset done. The app keeps its in-memory caches (membership plans 5 min, rate-limit counters): stop.sh + start.sh for a clean app process.');
}

async function status() {
  const rows = [];
  const pg = clusterExists() && pgRunning();
  rows.push(['postgres', pg ? 'up' : 'down', `${HOST}:${PORTS.postgres}`, PATHS.pgdata]);
  const pgr = running('postgrest');
  rows.push(['postgrest', pgr ? 'up' : 'down', `${HOST}:${PORTS.postgrest}`, pgr ? `pid ${pgr}` : '']);
  for (const s of SERVICES) {
    const pid = running(s.name);
    rows.push([s.name, pid && (await health(s.health)) ? 'up' : pid ? 'starting?' : 'down', `${HOST}:${s.port}${s.name === 'supabase' ? ` + https :${PORTS.supabaseTls}` : ''}`, pid ? `pid ${pid}` : '']);
  }
  const nx = running('next');
  const app = fs.existsSync(PATHS.appFile) ? fs.readFileSync(PATHS.appFile, 'utf8').trim() : '';
  rows.push(['next', nx && (await portOpen(PORTS.next)) ? 'up' : nx ? 'starting?' : 'down', `${HOST}:${PORTS.next}`, nx ? `pid ${nx} · ${app}` : '']);
  for (const r of rows) console.log(`${r[0].padEnd(11)} ${r[1].padEnd(10)} ${r[2].padEnd(26)} ${r[3]}`);
  if (pg) {
    try {
      const applied = chainApplied();
      const failed = applied.filter((r) => !r.ok);
      const build = readBuild();
      console.log(`\ndatabase: ${applied.filter((r) => r.ok).length} of ${applied.length} chain files ran${build && build.upTo ? ` (RIG_MIGRATE_TO=${build.upTo})` : ''}; latest: ${(applied.filter((r) => r.ok && /^\d{3}_/.test(r.file)).map((r) => r.file).sort().pop()) || 'none'}`);
      for (const f of failed) console.log(`  FAILED ${f.file}: ${f.error}`);
      const counts = psqlRows("select (select count(*) from public.episodes)::int as episodes, (select count(*) from public.series)::int as shows, (select count(*) from public.user_profiles)::int as profiles");
      console.log(`rows: ${counts[0].episodes} episodes, ${counts[0].shows} shows, ${counts[0].profiles} profiles`);
    } catch (err) {
      console.log(`database: ${err.message.split('\n')[0]}`);
    }
  }
  console.log(`\ndata: ${DATA_DIR}${IS_ROOT ? ' (Postgres runs as the postgres user)' : ''}\nlogs: ${PATHS.logs}`);
}

// Only the app again (the database and the fakes keep running): how a
// check switches one of the app's variables, RIG_APP_ENV_<NAME>=value
// (unset to blank it again). Without a checkout, the one Next ran last.
async function restartNext(argApp) {
  const keys = ensureKeys();
  const appDir = argApp ? appDirFrom(argApp) : fs.existsSync(PATHS.appFile) ? fs.readFileSync(PATHS.appFile, 'utf8').trim() : appDirFrom(null);
  if (await stopProcess('next')) say('stopped next');
  await waitFor(async () => !(await portOpen(PORTS.next)), { timeoutMs: 20000, what: `port ${PORTS.next} to free` });
  await startNext(appDir, keys);
  say(`up: the app on ${urls().next} (${appDir})`);
}

async function printEnv() {
  const keys = ensureKeys();
  const appDir = fs.existsSync(PATHS.appFile) ? fs.readFileSync(PATHS.appFile, 'utf8').trim() : REPO_DIR;
  const env = appEnv(appDir, keys);
  for (const [k, v] of Object.entries(env)) console.log(`export ${k}=${JSON.stringify(v)}`);
}

async function migrate() {
  const keys = ensureKeys();
  const appDir = fs.existsSync(PATHS.appFile) ? fs.readFileSync(PATHS.appFile, 'utf8').trim() : REPO_DIR;
  buildDatabase(appDir, keys);
}

const [cmd, arg] = process.argv.slice(2);
const commands = { start: () => start(arg), stop, reset: () => reset({ rebuild: arg === '--rebuild' || process.argv.includes('--rebuild') }), status, env: printEnv, migrate, 'restart-next': () => restartNext(arg) };
if (!commands[cmd]) {
  console.error('usage: rig.mjs start [app-checkout] | stop | reset [--rebuild] | status | env | migrate | restart-next [app-checkout]');
  process.exit(2);
}
commands[cmd]().catch((err) => {
  console.error(`[rig] ${err.message}`);
  const svc = /log: ([^)]+)\)/.exec(err.message);
  if (svc) console.error(tail(path.basename(svc[1], '.log'), 25));
  process.exit(1);
});
