// Migration 124 (removals held a month, titles brought back, every change
// on a live title reviewed, a booking keeps the policy it was paid under)
// on a real Postgres: builds the database from schema.sql and every
// migration through 123, checks none of 124's columns are there, seeds a
// place with a paid, a done and a still-open booking, runs 124, then checks
// every column's type, default and comment, the length and object checks
// refuse what they should, the paid and done bookings carry the listing's
// policy while the open one waits for its payment, the policy check
// refuses a word that isn't a policy, the indexes exist, the closing
// report's row, and that a second run changes nothing (a booking's
// recorded policy survives the listing changing its own).
// Needs PGlite (see scripts/pg-chain.mjs): node scripts/check-migration-124.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildDb, migrationFiles, SUPABASE_DIR } from './pg-chain.mjs';

let n = 0;
const ok = (name) => { n += 1; console.log('ok', name); };

const FILE = migrationFiles().find((f) => f.startsWith('124_'));
assert.ok(FILE, 'supabase/migrations/124_*.sql exists');
const SQL = fs.readFileSync(path.join(SUPABASE_DIR, 'migrations', FILE), 'utf8');
assert.doesNotMatch(SQL, /create table/i, 'columns only: no new table (so no row level security line is owed)');

const col = async (db, table, column) => (await db.query(`select data_type, is_nullable, column_default,
    col_description(('public.' || table_name)::regclass, ordinal_position) as note
  from information_schema.columns where table_schema = 'public' and table_name = $1 and column_name = $2`, [table, column])).rows[0] || null;
const refused = async (db, sql, params, code, why) => {
  let err = null;
  try { await db.query(sql, params); } catch (e) { err = e; }
  assert.ok(err, `${why}: expected an error`);
  assert.equal(err.code, code, `${why}: ${err.message}`);
};

const db = await buildDb(123);
for (const [t, c] of [['episodes', 'purge_after'], ['episodes', 'pending_fields'], ['series', 'restore_requested_at'], ['location_requests', 'cancellation_policy']]) {
  assert.equal(await col(db, t, c), null, `${t}.${c} isn't there before 124`);
}
ok('none of 124’s columns exist before it runs');

// A host, a place and three bookings: paid, done, and accepted (not paid yet).
const HOST = 'user_m124host';
const PRODUCER = 'user_m124prod';
const loc = (await db.query(`insert into public.locations (host_id, title, kind, status, day_cents, city, place_label, cancellation, address)
  values ($1, 'Check studio', 'studio', 'listed', 50000, 'Los Angeles', 'Echo Park', 'strict', '1 Check St') returning id`, [HOST])).rows[0].id;
const booking = async (status) => (await db.query(`insert into public.location_requests (location_id, host_id, producer_id, status, starts_on, ends_on)
  values ($1, $2, $3, $4, current_date + 3, current_date + 4) returning id`, [loc, HOST, PRODUCER, status])).rows[0].id;
const paid = await booking('paid');
const done = await booking('done');
const open = await booking('accepted');
ok('a place with a paid, a done and an accepted booking (before 124)');

await db.exec(SQL);
ok('124 runs on a database through 123');

for (const t of ['episodes', 'series']) {
  const purge = await col(db, t, 'purge_after');
  assert.equal(purge.data_type, 'timestamp with time zone');
  assert.equal(purge.is_nullable, 'YES');
  assert.match(purge.note || '', /Migration 124/);
  const keep = await col(db, t, 'keep_after_removal');
  assert.equal(keep.data_type, 'boolean');
  assert.equal(keep.is_nullable, 'NO');
  assert.equal(keep.column_default, 'false');
  const asked = await col(db, t, 'restore_requested_at');
  assert.equal(asked.data_type, 'timestamp with time zone');
  const why = await col(db, t, 'restore_reason');
  assert.equal(why.data_type, 'text');
  const waiting = await col(db, t, 'pending_fields');
  assert.equal(waiting.data_type, 'jsonb');
  assert.equal(waiting.is_nullable, 'YES');
  assert.match(waiting.note || '', /Migration 124/);
}
ok('episodes and series: purge_after, keep_after_removal (false), restore_requested_at, restore_reason, pending_fields with their comments');

const EP = 'check-124-episode-a1b2c3';
await db.query(`insert into public.episodes (id, title, content_type, src, status, submitted_by) values ($1, 'Check 124', 'movie', 'https://example.com/v.m3u8', 'approved', 'user_m124')`, [EP]);
const fresh = (await db.query('select keep_after_removal, pending_fields, purge_after from public.episodes where id = $1', [EP])).rows[0];
assert.deepEqual([fresh.keep_after_removal, fresh.pending_fields, fresh.purge_after], [false, null, null]);
ok('a new title starts with nothing held, nothing kept for later and nothing waiting');

await db.query(`update public.episodes set pending_fields = $2::jsonb, purge_after = now() + interval '30 days', restore_requested_at = now(), restore_reason = 'Back please' where id = $1`, [EP, JSON.stringify({ genre: 'Drama', captions: 'private:captions/x.vtt' })]);
const held = (await db.query(`select pending_fields->>'genre' as genre, purge_after > now() as later from public.episodes where id = $1`, [EP])).rows[0];
assert.deepEqual([held.genre, held.later], ['Drama', true]);
ok('the site’s writes: a waiting change as an object, a removal held 30 days, a request to bring it back');

await refused(db, `update public.episodes set pending_fields = '["genre"]'::jsonb where id = $1`, [EP], '23514', 'an array isn’t a set of waiting changes');
await refused(db, `update public.episodes set restore_reason = repeat('x', 1001) where id = $1`, [EP], '23514', 'a reason over 1,000 characters');
await refused(db, `insert into public.series (id, name, pending_fields) values ('check-124-show-a1', 'S', '"x"'::jsonb)`, [], '23514', 'a show’s waiting changes must be an object too');
ok('the checks refuse an array or a string as waiting changes and an over-long reason');

const policy = await col(db, 'location_requests', 'cancellation_policy');
assert.equal(policy.data_type, 'text');
assert.match(policy.note || '', /paid under/);
const pol = async (id) => (await db.query('select cancellation_policy from public.location_requests where id = $1', [id])).rows[0].cancellation_policy;
assert.equal(await pol(paid), 'strict');
assert.equal(await pol(done), 'strict');
assert.equal(await pol(open), null);
ok('the paid and done bookings carry the listing’s policy; the accepted one waits for its payment');

await refused(db, `update public.location_requests set cancellation_policy = 'whatever' where id = $1`, [open], '23514', 'a word that isn’t a policy');
await db.query(`update public.location_requests set cancellation_policy = 'flexible' where id = $1`, [open]);
assert.equal(await pol(open), 'flexible');
ok('a booking’s policy is one of flexible / moderate / strict');

const idx = (await db.query(`select indexname from pg_indexes where schemaname = 'public' and indexname in ('episodes_purge_after_idx', 'series_purge_after_idx', 'episodes_restore_requested_idx', 'series_restore_requested_idx') order by 1`)).rows.map((r) => r.indexname);
assert.deepEqual(idx, ['episodes_purge_after_idx', 'episodes_restore_requested_idx', 'series_purge_after_idx', 'series_restore_requested_idx']);
ok('the clean-up and review-queue indexes exist');

const REPORT = SQL.slice(SQL.indexOf('-- What 124 changed'));
const row = (await db.query(REPORT)).rows[0];
assert.equal(Number(row.episode_columns_expect_5), 5);
assert.equal(Number(row.series_columns_expect_5), 5);
assert.equal(Number(row.booking_column_expect_1), 1);
assert.equal(Number(row.paid_bookings_without_a_policy_expect_0), 0);
ok('the closing report reads 5 / 5 / 1 / 0');

// The listing changes its policy; a second run must not move a booking.
await db.query(`update public.locations set cancellation = 'flexible' where id = $1`, [loc]);
await db.exec(SQL);
assert.equal(await pol(paid), 'strict');
assert.equal(await pol(done), 'strict');
const again = (await db.query('select pending_fields->>\'genre\' as genre from public.episodes where id = $1', [EP])).rows[0];
assert.equal(again.genre, 'Drama');
ok('a second run changes nothing: the paid bookings keep the policy they were paid under, the waiting change stays');

console.log(`\n${n} migration-124 checks passed`);
