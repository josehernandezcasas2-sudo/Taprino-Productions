// Migration 128 (private screening links) on a real Postgres: builds the
// database through 127, seeds a production screener the way migration 109
// made them (and one view), runs 128, then checks that the older screener
// now names its episode, its production's owner and its start (and keeps
// working without a password: anyone, every open told, any screen), that a
// link can now name a show and no production, that the checks refuse a
// bad scope, access, notify, per-person limit and an end before the start,
// that the view and refusal columns are there with row level security on
// the new table, that discarding a link takes its views and refusals with
// it, and that a second run changes nothing.
// Needs PGlite (see scripts/pg-chain.mjs): node scripts/check-migration-128.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildDb, migrationFiles, SUPABASE_DIR } from './pg-chain.mjs';

let n = 0;
const ok = (name) => { n += 1; console.log('ok', name); };

const FILE = migrationFiles().find((f) => f.startsWith('128_'));
assert.ok(FILE, 'supabase/migrations/128_*.sql exists');
const SQL = fs.readFileSync(path.join(SUPABASE_DIR, 'migrations', FILE), 'utf8');
assert.match(SQL, /alter table public\.screener_refusals enable row level security/, 'the new table gets row level security');

const col = async (db, table, column) => (await db.query(`select data_type, is_nullable, column_default
  from information_schema.columns where table_schema = 'public' and table_name = $1 and column_name = $2`, [table, column])).rows[0] || null;
const refused = async (db, sql, params, code, why) => {
  let err = null;
  try { await db.query(sql, params); } catch (e) { err = e; }
  assert.ok(err, `${why}: expected an error`);
  assert.equal(err.code, code, `${why}: ${err.message}`);
};

const db = await buildDb(127);
for (const c of ['target_type', 'password_hash', 'access', 'countries']) assert.equal(await col(db, 'screeners', c), null, `${c} isn't there before 128`);
ok('none of 128’s columns exist before it runs');

const prod = (await db.query(`insert into public.productions (owner_id, title) values ('user_m128', 'Salt Flats') returning id`)).rows[0].id;
const old = (await db.query(`insert into public.screeners (production_id, episode_id, token, label, expires_at, max_views, created_by, created_at)
  values ($1, 'salt-flats-a1', 'tok_m128_old_xxxxxxxx', 'Sundance', now() + interval '10 days', 10, 'user_m128', now() - interval '4 days') returning id`, [prod])).rows[0].id;
await db.query(`insert into public.screener_views (screener_id, ip_hash) values ($1, 'abc')`, [old]);
ok('a production screener and a view, made the 109 way');

await db.exec(SQL);
ok('128 runs on a database through 127');

const row = (await db.query(`select owner_id, target_type, target_id, scope, starts_at, created_at, password_hash, access, one_screen, notify, per_person_max, countries from public.screeners where id = $1`, [old])).rows[0];
assert.equal(row.owner_id, 'user_m128');
assert.equal(row.target_type, 'episode');
assert.equal(row.target_id, 'salt-flats-a1');
assert.equal(row.scope, 'title');
assert.equal(new Date(row.starts_at).getTime(), new Date(row.created_at).getTime());
assert.equal(row.password_hash, null);
assert.equal(row.access, 'anyone');
assert.equal(row.one_screen, false);
assert.equal(row.notify, 'every');
assert.equal(row.per_person_max, null);
assert.deepEqual(row.countries, []);
ok('the older screener names its episode, its owner and its start, and opens as it always did');

assert.equal((await col(db, 'screeners', 'owner_id')).is_nullable, 'NO');
assert.equal((await col(db, 'screeners', 'target_id')).is_nullable, 'NO');
assert.equal((await col(db, 'screeners', 'starts_at')).is_nullable, 'NO');
assert.equal((await col(db, 'screeners', 'production_id')).is_nullable, 'YES');
assert.equal((await col(db, 'screeners', 'episode_id')).is_nullable, 'YES');
ok('owner, title and start are required; a production and an episode no longer are');

const show = (await db.query(`insert into public.screeners (owner_id, target_type, target_id, scope, season, episode_ids, token, label, starts_at, expires_at, max_views, created_by,
    password_hash, password_enc, access, named_emails, per_person_max, one_screen, countries, notify)
  values ('user_m128', 'series', 'night-bus-x1', 'season', 1, '{nb-e1,nb-e2}', 'tok_m128_show_xxxxxxx', 'Cinetic', now(), now() + interval '14 days', 25, 'user_m128',
    'scrypt$x', 'v1:x', 'named', '{jo@example.com}', 3, true, '{US,CA}', 'first') returning id`)).rows[0].id;
ok('a link to one season of a show, with no production, a password, named people and two countries');

const bad = (set, why, code = '23514') => refused(db, `update public.screeners set ${set} where id = $1`, [show], code, why);
await bad(`scope = 'everything'`, 'an unknown scope');
await bad(`access = 'friends'`, 'an unknown access');
await bad(`notify = 'loud'`, 'an unknown notify');
await bad(`per_person_max = 21`, 'more than 20 opens each');
await bad(`target_type = 'pitch'`, 'a target that isn’t a title or a show');
await bad(`expires_at = starts_at - interval '1 minute'`, 'an end before the start');
await refused(db, `insert into public.screeners (owner_id, target_id, token, label, expires_at, created_by) values (null, 'x', 'tok_m128_noowner_xxx', 'X', now() + interval '1 day', 'u')`, [], '23502', 'a link without an owner');
ok('the checks refuse a bad scope, access, notify, per-person limit, target, window and a missing owner');

for (const c of ['user_id', 'device_key', 'session_key', 'city', 'region', 'country', 'device', 'episode_id', 'position', 'watched', 'watched_seconds', 'last_beat_at', 'last_play_at']) assert.ok(await col(db, 'screener_views', c), `screener_views.${c}`);
const oldView = (await db.query(`select watched, watched_seconds, position from public.screener_views where screener_id = $1`, [old])).rows[0];
assert.deepEqual([oldView.watched, oldView.watched_seconds, oldView.position], [{}, 0, 0]);
const v = (await db.query(`insert into public.screener_views (screener_id, user_id, session_key, city, region, country, device, watched) values ($1, 'user_dee', 'sess1', 'Los Angeles', 'CA', 'US', 'iPhone · Safari', '{"nb-e1":[120,1320]}') returning id`, [show])).rows[0].id;
await refused(db, `insert into public.screener_views (screener_id, session_key) values ($1, 'sess1')`, [show], '23505', 'two views with one visit key');
ok('views carry who, where, what device and how much; one visit key is one view');

await db.query(`insert into public.screener_refusals (screener_id, reason, ip_hash, city, country) values ($1, 'password', 'h1', 'Austin', 'US')`, [show]);
await refused(db, `insert into public.screener_refusals (screener_id, reason) values ($1, 'grumpy')`, [show], '23514', 'an unknown refusal');
const rls = (await db.query(`select rowsecurity from pg_tables where schemaname = 'public' and tablename = 'screener_refusals'`)).rows[0];
assert.equal(rls.rowsecurity, true);
ok('refusals go in with a known reason, under row level security');

await db.query(`delete from public.screeners where id = $1`, [show]);
const left = (await db.query(`select (select count(*)::int from public.screener_views where id = $1) as views, (select count(*)::int from public.screener_refusals where screener_id = $2) as refusals`, [v, show])).rows[0];
assert.deepEqual([left.views, left.refusals], [0, 0]);
ok('discarding a link takes its views and refusals with it');

await db.exec(SQL);
const idx = (await db.query(`select count(*)::int as n from pg_indexes where schemaname = 'public' and indexname in ('screeners_target_idx', 'screeners_owner_idx', 'screeners_due_idx', 'screener_views_session_uq', 'screener_views_playing_idx', 'screener_views_person_idx', 'screener_refusals_link_idx', 'screener_refusals_lock_idx')`)).rows[0].n;
assert.equal(idx, 8);
const again = (await db.query(`select owner_id, target_id from public.screeners where id = $1`, [old])).rows[0];
assert.deepEqual([again.owner_id, again.target_id], ['user_m128', 'salt-flats-a1']);
ok('a second run changes nothing');

console.log(`${n} checks passed`);
