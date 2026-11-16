// Migration 125 (a refund the poster asks for on secured crew pay waits
// three days and can be contested; a self refund can't race a download) on
// a real Postgres: builds the database from schema.sql and every migration
// through 124, checks none of 125's columns are there, seeds a call with a
// held payment and a completed purchase, runs 125, then checks every
// column's type and comment, the checks refuse what they should, the
// site's writes go in, the index exists, the closing report's row, and that
// a second run changes nothing.
// Needs PGlite (see scripts/pg-chain.mjs): node scripts/check-migration-125.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildDb, migrationFiles, SUPABASE_DIR } from './pg-chain.mjs';

let n = 0;
const ok = (name) => { n += 1; console.log('ok', name); };

const FILE = migrationFiles().find((f) => f.startsWith('125_'));
assert.ok(FILE, 'supabase/migrations/125_*.sql exists');
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

const db = await buildDb(124);
for (const [t, c] of [['crew_payments', 'refund_due_at'], ['crew_payments', 'contest_note'], ['purchases', 'refund_started_at'], ['push_tokens', 'clerk_session_id'], ['web_push_subscriptions', 'clerk_session_id']]) {
  assert.equal(await col(db, t, c), null, `${t}.${c} isn't there before 125`);
}
ok('none of 125’s columns exist before it runs');

// A secured-pay call, a booked response, a held payment and a bought title.
const POSTER = 'user_m125poster';
const WORKER = 'user_m125worker';
const call = (await db.query(`insert into public.crew_calls (poster_id, title, role, pay_type, pay_secured, pay_rate_cents)
  values ($1, 'Check shoot', 'gaffer', 'paid', true, 50000) returning id`, [POSTER])).rows[0].id;
const resp = (await db.query(`insert into public.crew_responses (call_id, user_id, message, status) values ($1, $2, 'I can do it', 'booked') returning id`, [call, WORKER])).rows[0].id;
const pay = (await db.query(`insert into public.crew_payments (call_id, response_id, poster_id, worker_id, amount_cents, platform_cut_cents, fee_cover_cents, total_charged_cents, status, stripe_payment_intent_id)
  values ($1, $2, $3, $4, 50000, 4000, 1600, 55600, 'held', 'pi_m125') returning id`, [call, resp, POSTER, WORKER])).rows[0].id;
const buy = (await db.query(`insert into public.purchases (buyer_id, target_type, target_id, creator_id, price_cents, paid_cents, creator_cents, platform_cents, status)
  values ('user_m125buyer', 'episode', 'check-125-episode-a1b2c3', 'user_m125maker', 299, 299, 239, 60, 'completed') returning id`)).rows[0].id;
ok('a held crew payment and a completed purchase (before 125)');

await db.exec(SQL);
ok('125 runs on a database through 124');

const types = {
  refund_due_at: 'timestamp with time zone', refund_kind: 'text', refund_asked_cents: 'integer', refund_asked_by: 'text',
  refund_asked_at: 'timestamp with time zone', contested_at: 'timestamp with time zone', contest_note: 'text',
  contest_decision: 'text', contest_decided_at: 'timestamp with time zone', contest_decided_by: 'text'
};
for (const [c, t] of Object.entries(types)) {
  const info = await col(db, 'crew_payments', c);
  assert.ok(info, `crew_payments.${c} exists`);
  assert.equal(info.data_type, t, `crew_payments.${c} is ${t}`);
  assert.equal(info.is_nullable, 'YES', `crew_payments.${c} may be null`);
}
assert.match((await col(db, 'crew_payments', 'refund_due_at')).note || '', /Migration 125/);
assert.match((await col(db, 'crew_payments', 'contested_at')).note || '', /full admin decides/);
const started = await col(db, 'purchases', 'refund_started_at');
assert.equal(started.data_type, 'timestamp with time zone');
assert.match(started.note || '', /Migration 125/);
for (const t of ['push_tokens', 'web_push_subscriptions']) {
  const info = await col(db, t, 'clerk_session_id');
  assert.ok(info, `${t}.clerk_session_id exists`);
  assert.equal(info.data_type, 'text');
  assert.match(info.note || '', /Migration 125/);
}
ok('the ten crew-pay columns, purchases.refund_started_at and the two push session columns, with their types and comments');

const before = (await db.query('select status, refund_due_at, contested_at from public.crew_payments where id = $1', [pay])).rows[0];
assert.deepEqual([before.status, before.refund_due_at, before.contested_at], ['held', null, null]);
ok('a payment held before 125 has no refund asked and nothing contested');

await db.query(`update public.crew_payments set refund_due_at = now() + interval '3 days', refund_kind = 'no_show', refund_asked_cents = 55600, refund_asked_by = $2, refund_asked_at = now() where id = $1`, [pay, POSTER]);
await db.query(`update public.crew_payments set contested_at = now(), contest_note = 'I was on set all day' where id = $1`, [pay]);
await db.query(`update public.crew_payments set contest_decision = 'release', contest_decided_at = now(), contest_decided_by = 'user_m125admin' where id = $1`, [pay]);
const after = (await db.query(`select refund_kind, refund_asked_cents, contest_decision, refund_due_at > now() as later from public.crew_payments where id = $1`, [pay])).rows[0];
assert.deepEqual([after.refund_kind, after.refund_asked_cents, after.contest_decision, after.later], ['no_show', 55600, 'release', true]);
await db.query('update public.purchases set refund_started_at = now() where id = $1 and refund_started_at is null', [buy]);
assert.equal((await db.query('select refund_started_at is not null as set from public.purchases where id = $1', [buy])).rows[0].set, true);
ok('the site’s writes: a refund asked, contested and decided; a self refund started');

await refused(db, `update public.crew_payments set refund_kind = 'changed_mind' where id = $1`, [pay], '23514', 'a refund kind that isn’t one');
await refused(db, `update public.crew_payments set refund_asked_cents = -1 where id = $1`, [pay], '23514', 'a negative refund');
await refused(db, `update public.crew_payments set contest_note = repeat('x', 1001) where id = $1`, [pay], '23514', 'a note over 1,000 characters');
await refused(db, `update public.crew_payments set contest_decision = 'split' where id = $1`, [pay], '23514', 'a decision that isn’t refund or release');
ok('the checks refuse a made-up kind, a negative amount, an over-long note and a made-up decision');

const idx = (await db.query(`select indexdef from pg_indexes where schemaname = 'public' and indexname = 'crew_payments_refund_due_idx'`)).rows[0];
assert.ok(idx, 'crew_payments_refund_due_idx exists');
assert.match(idx.indexdef, /refund_due_at/);
assert.match(idx.indexdef, /WHERE/i);
ok('the daily step’s index exists, partial on held rows with a refund asked');

const REPORT = SQL.slice(SQL.indexOf('-- What 125 changed'));
const row = (await db.query(REPORT)).rows[0];
assert.equal(Number(row.crew_payment_columns_expect_10), 10);
assert.equal(Number(row.purchase_column_expect_1), 1);
assert.equal(Number(row.push_columns_expect_2), 2);
ok('the closing report reads 10 / 1 / 2');

await db.exec(SQL);
const again = (await db.query('select refund_kind, contest_note, contest_decision from public.crew_payments where id = $1', [pay])).rows[0];
assert.deepEqual([again.refund_kind, again.contest_note, again.contest_decision], ['no_show', 'I was on set all day', 'release']);
assert.equal((await db.query('select refund_started_at is not null as set from public.purchases where id = $1', [buy])).rows[0].set, true);
ok('a second run changes nothing');

console.log(`\n${n} migration-125 checks passed`);
