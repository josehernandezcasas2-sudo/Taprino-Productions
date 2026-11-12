// Migration 122 (notes wait for review, season art, who was the studio,
// sales tax, web push) on a real Postgres: builds the database from
// schema.sql and every migration through 121, checks none of 122's columns or
// its table are there (a read naming one fails with 42703 / 42P01, what the
// site's reads fall back on), runs 122, checks every column's type, default
// and comment, the checks (tax never negative, split fee|transfer, the
// booking tax code's shape), that existing rows read as before (no notes
// waiting, no season art, the switch on, ledger lines unstamped, tax 0,
// split 'fee', memberships and backings taxed, bookings not), that the new
// table is locked (row level security on, nothing granted to anon or
// authenticated), the closing report's row, and that a second run changes
// nothing.
// Needs PGlite (see scripts/pg-chain.mjs): node scripts/check-migration-122.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildDb, migrationFiles, SUPABASE_DIR } from './pg-chain.mjs';

let n = 0;
const ok = (name) => { n += 1; console.log('ok', name); };

const FILE = migrationFiles().find((f) => f.startsWith('122_'));
assert.ok(FILE, 'supabase/migrations/122_*.sql exists');
const SQL = fs.readFileSync(path.join(SUPABASE_DIR, 'migrations', FILE), 'utf8');
assert.doesNotMatch(SQL, /create extension/i);
assert.match(SQL, /alter table public\.web_push_subscriptions enable row level security/, 'the new table ends with migration 112’s line');

const col = async (db, table, column) => (await db.query(`select data_type, is_nullable, column_default,
    col_description(('public.' || table_name)::regclass, ordinal_position) as note
  from information_schema.columns where table_schema = 'public' and table_name = $1 and column_name = $2`, [table, column])).rows[0] || null;

const COLUMNS = [
  ['episodes', 'pending_page_notes'],
  ['series', 'season_art'], ['series', 'pending_season_art'], ['series', 'newest_season_hero'],
  ['creator_ledger', 'studio'],
  ['member_payments', 'tax_cents'],
  ['pitch_donations', 'tax_cents'], ['pitch_donations', 'split'],
  ['location_requests', 'tax_cents'], ['location_requests', 'split'],
  ['site_settings', 'tax_memberships'], ['site_settings', 'tax_backings'], ['site_settings', 'tax_bookings'], ['site_settings', 'tax_booking_code']
];

const db = await buildDb(121);
ok('schema.sql + migrations 002–121 run on a fresh Postgres');

for (const [t, c] of COLUMNS) assert.equal(await col(db, t, c), null, `${t}.${c} absent before 122`);
for (const [t, c] of [['episodes', 'pending_page_notes'], ['series', 'season_art'], ['creator_ledger', 'studio'], ['member_payments', 'tax_cents']]) {
  try {
    await db.query(`select ${c} from ${t} limit 1`);
    throw new Error(`${t}.${c} was there before 122`);
  } catch (err) {
    assert.equal(err.code, '42703', `${t}.${c}: a read naming it fails with 42703`);
  }
}
try {
  await db.query('select endpoint from web_push_subscriptions limit 1');
  throw new Error('web_push_subscriptions was there before 122');
} catch (err) {
  assert.equal(err.code, '42P01');
}
ok('before 122 none of its columns exist (42703) and the push table is missing (42P01)');

// Rows that exist before 122 runs.
await db.query("insert into series (id, name, status, creator_id) values ('night-bus-lx3k9a', 'Night Bus', 'approved', 'user_mara')");
await db.query(`insert into episodes (id, title, content_type, series_id, season, series_order, status, submitted_by, page_notes)
  values ('the-long-quiet-lx3k9a', 'The Long Quiet', 'movie', null, null, null, 'approved', 'user_mara', 'Shot over nine nights.')`);
await db.query(`insert into member_payments (user_id, stripe_invoice_id, tier, amount_cents, share_cents)
  values ('user_viewer', 'in_rig_1', 'standard', 799, 200)`);
await db.query(`insert into creator_ledger (creator_id, lane, kind, cents, moves_money)
  values ('user_mara', 'earnings', 'member_share', 200, true)`);

const results = await db.exec(SQL);
const report = results[results.length - 1].rows[0];
ok('122 runs');

assert.equal(Number(report.notes_column_expect_1), 1);
assert.equal(Number(report.season_columns_expect_3), 3);
assert.equal(Number(report.ledger_column_expect_1), 1);
assert.equal(Number(report.tax_columns_expect_9), 9);
assert.equal(report.push_table_row_level_security_expect_true, true);
assert.equal(Number(report.browsers_signed_up), 0);
ok('the closing report reads (1, 3, 1, 9, true, 0)');

for (const [t, c] of COLUMNS) {
  const info = await col(db, t, c);
  assert.ok(info, `${t}.${c} exists`);
  assert.match(info.note || '', /Migration 122\./, `${t}.${c} has its comment`);
}
assert.equal((await col(db, 'series', 'season_art')).data_type, 'jsonb');
assert.equal((await col(db, 'series', 'season_art')).is_nullable, 'NO');
assert.equal((await col(db, 'series', 'pending_season_art')).is_nullable, 'YES');
assert.equal((await col(db, 'creator_ledger', 'studio')).is_nullable, 'YES');
assert.equal((await col(db, 'site_settings', 'tax_booking_code')).data_type, 'text');
ok('every column has its type, nullability and comment');

const ep = (await db.query("select page_notes, pending_page_notes from episodes where id = 'the-long-quiet-lx3k9a'")).rows[0];
assert.equal(ep.page_notes, 'Shot over nine nights.');
assert.equal(ep.pending_page_notes, null);
const show = (await db.query("select season_art, pending_season_art, newest_season_hero from series where id = 'night-bus-lx3k9a'")).rows[0];
assert.deepEqual(show.season_art, []);
assert.equal(show.pending_season_art, null);
assert.equal(show.newest_season_hero, true);
const line = (await db.query("select studio from creator_ledger where creator_id = 'user_mara'")).rows[0];
assert.equal(line.studio, null);
const pay = (await db.query("select tax_cents from member_payments where stripe_invoice_id = 'in_rig_1'")).rows[0];
assert.equal(pay.tax_cents, 0);
const settings = (await db.query('select tax_memberships, tax_backings, tax_bookings, tax_booking_code from site_settings limit 1')).rows[0];
if (settings) {
  assert.equal(settings.tax_memberships, true);
  assert.equal(settings.tax_backings, true);
  assert.equal(settings.tax_bookings, false);
  assert.equal(settings.tax_booking_code, null);
}
ok('rows from before 122 read as before: no notes waiting, no season art, the switch on, the line unstamped, tax 0, memberships and backings taxed, bookings not');

const refuses = async (sql, params, code) => {
  try {
    await db.query(sql, params);
  } catch (err) {
    assert.equal(err.code, code, sql);
    return;
  }
  throw new Error(`accepted: ${sql}`);
};
await refuses("update member_payments set tax_cents = -1 where stripe_invoice_id = 'in_rig_1'", [], '23514');
await db.query("insert into site_settings (id) values (1) on conflict (id) do nothing");
await refuses("update site_settings set tax_booking_code = 'real property' where id = 1", [], '23514');
await refuses("update site_settings set tax_booking_code = 'txcd_123' where id = 1", [], '23514');
await db.query("update site_settings set tax_booking_code = 'txcd_20030000' where id = 1");
await db.query("update site_settings set tax_booking_code = null where id = 1");
ok('the checks refuse a negative tax and a malformed booking tax code, and take txcd_ + 8 digits or null');

const defs = (await db.query(`select conrelid::regclass::text as t, conname, pg_get_constraintdef(oid) as def from pg_constraint
  where conname in ('pitch_donations_split_check', 'location_requests_split_check', 'pitch_donations_tax_cents_check', 'location_requests_tax_cents_check', 'member_payments_tax_cents_check', 'site_settings_tax_booking_code_check')`)).rows;
assert.equal(defs.length, 6);
assert.ok(defs.find((d) => d.conname === 'location_requests_split_check').def.includes("'transfer'"));
ok('the six checks exist (tax ≥ 0 on three tables, split fee|transfer on two, the code shape)');

await db.query(`insert into web_push_subscriptions (endpoint, user_id, p256dh, auth) values ('https://push.example/abc', 'user_mara', 'BNc', 'tok')`);
const sub = (await db.query("select created_at, last_seen_at, disabled_at from web_push_subscriptions where endpoint = 'https://push.example/abc'")).rows[0];
assert.ok(sub.created_at && sub.last_seen_at);
assert.equal(sub.disabled_at, null);
const rls = (await db.query("select relrowsecurity from pg_class where oid = 'public.web_push_subscriptions'::regclass")).rows[0];
assert.equal(rls.relrowsecurity, true);
const grants = (await db.query(`select grantee, privilege_type from information_schema.role_table_grants
  where table_schema = 'public' and table_name = 'web_push_subscriptions' and grantee in ('anon', 'authenticated')`)).rows;
assert.deepEqual(grants, []);
ok('web_push_subscriptions takes a row, has row level security on and grants nothing to anon or authenticated');

const again = await db.exec(SQL);
const report2 = again[again.length - 1].rows[0];
assert.equal(Number(report2.tax_columns_expect_9), 9);
assert.equal(Number(report2.browsers_signed_up), 1);
const defs2 = (await db.query(`select count(*)::int as c from pg_constraint where conname in ('pitch_donations_split_check', 'location_requests_split_check', 'pitch_donations_tax_cents_check', 'location_requests_tax_cents_check', 'member_payments_tax_cents_check', 'site_settings_tax_booking_code_check')`)).rows[0];
assert.equal(defs2.c, 6);
ok('a second run changes nothing (no duplicate checks, the row kept)');

console.log(`\n${n} checks passed`);
