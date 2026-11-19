// Migration 127 (yearly plans credited month by month; one production per
// pitch) on a real Postgres: builds the database through 126, checks the
// columns aren't there, seeds a monthly payment and two productions naming
// one pitch, runs 127, then checks the columns, their defaults, the checks,
// that the older payment reads as a monthly one already credited, that the
// newer duplicate lost its pitch link (and the production stayed), that a
// second production for the pitch is refused while a removed one isn't,
// and that a second run changes nothing.
// Needs PGlite (see scripts/pg-chain.mjs): node scripts/check-migration-127.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildDb, migrationFiles, SUPABASE_DIR } from './pg-chain.mjs';

let n = 0;
const ok = (name) => { n += 1; console.log('ok', name); };

const FILE = migrationFiles().find((f) => f.startsWith('127_'));
assert.ok(FILE, 'supabase/migrations/127_*.sql exists');
const SQL = fs.readFileSync(path.join(SUPABASE_DIR, 'migrations', FILE), 'utf8');
assert.doesNotMatch(SQL, /create table/i, 'columns and indexes only: no new table');

const col = async (db, table, column) => (await db.query(`select data_type, is_nullable, column_default
  from information_schema.columns where table_schema = 'public' and table_name = $1 and column_name = $2`, [table, column])).rows[0] || null;
const refused = async (db, sql, params, code, why) => {
  let err = null;
  try { await db.query(sql, params); } catch (e) { err = e; }
  assert.ok(err, `${why}: expected an error`);
  assert.equal(err.code, code, `${why}: ${err.message}`);
};

const db = await buildDb(126);
for (const c of ['months', 'months_credited', 'next_month_at', 'stopped_at']) assert.equal(await col(db, 'member_payments', c), null, `${c} isn't there before 127`);
ok('none of 127’s columns exist before it runs');

const pay = (await db.query(`insert into public.member_payments (user_id, stripe_invoice_id, tier, amount_cents, share_cents) values ('user_m127', 'in_m127_old', 'standard', 799, 200) returning id`)).rows[0].id;
const PITCH = '11111111-2222-4333-8444-555555555555';
const older = (await db.query(`insert into public.productions (owner_id, title, project_type, project_id, project_title, created_at) values ('user_m127', 'First', 'pitch', $1, 'Night Bus', now() - interval '2 days') returning id`, [PITCH])).rows[0].id;
const newer = (await db.query(`insert into public.productions (owner_id, title, project_type, project_id, project_title) values ('user_m127', 'Second', 'pitch', $1, 'Night Bus') returning id`, [PITCH])).rows[0].id;
ok('a monthly payment and two productions naming one pitch (before 127)');

await db.exec(SQL);
ok('127 runs on a database through 126');

assert.equal((await col(db, 'member_payments', 'months')).data_type, 'smallint');
assert.equal((await col(db, 'member_payments', 'months_credited')).is_nullable, 'NO');
assert.equal((await col(db, 'member_payments', 'next_month_at')).data_type, 'timestamp with time zone');
const old = (await db.query(`select months, months_credited, next_month_at, stopped_at from public.member_payments where id = $1`, [pay])).rows[0];
assert.deepEqual([old.months, old.months_credited, old.next_month_at, old.stopped_at], [1, 1, null, null]);
ok('an older payment reads as monthly, already credited, nothing due');

await db.query(`insert into public.member_payments (user_id, stripe_invoice_id, tier, amount_cents, share_cents, months, months_credited, next_month_at) values ('user_m127', 'in_m127_year', 'premium', 12900, 350, 12, 1, now() + interval '1 month')`);
await refused(db, `insert into public.member_payments (user_id, stripe_invoice_id, tier, amount_cents, months) values ('user_m127', 'in_m127_bad', 'standard', 1, 6)`, [], '23514', 'a payment of 6 months');
await refused(db, `update public.member_payments set months_credited = 13 where stripe_invoice_id = 'in_m127_year'`, [], '23514', 'more months credited than paid for');
ok('a yearly payment goes in; 6 months and 13 credited are refused');

const prods = (await db.query(`select id, project_id from public.productions where id in ($1, $2)`, [older, newer])).rows;
assert.equal(prods.find((p) => p.id === older).project_id, PITCH);
assert.equal(prods.find((p) => p.id === newer).project_id, null);
ok('the newer duplicate lost its pitch link; both productions stay');

await refused(db, `insert into public.productions (owner_id, title, project_type, project_id) values ('user_m127', 'Third', 'pitch', $1)`, [PITCH], '23505', 'a second live production for the pitch');
await db.query(`update public.productions set status = 'removed' where id = $1`, [older]);
await db.query(`insert into public.productions (owner_id, title, project_type, project_id) values ('user_m127', 'Fresh', 'pitch', $1)`, [PITCH]);
ok('a second production for the pitch is refused; once the first is removed a new one may take it');

await db.exec(SQL);
const idx = (await db.query(`select count(*)::int as n from pg_indexes where schemaname = 'public' and indexname in ('member_payments_next_month_idx', 'productions_one_per_pitch_uq')`)).rows[0].n;
assert.equal(idx, 2);
ok('a second run changes nothing');

console.log(`${n} checks passed`);
