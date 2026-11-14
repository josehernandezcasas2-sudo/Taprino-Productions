// Migration 123 (downloads in the app) on a real Postgres: builds the
// database from schema.sql and every migration through 122, checks none of
// 123's columns or tables are there (a read naming one fails with 42703 /
// 42P01, what the site's reads fall back on), runs 123, then checks every
// column's type, default and comment, that the switch and its lock start
// off and every existing title allows downloads, the phones table (one row
// per account and phone, the id's shape, the platform), the copies table
// (basis and status values, the defaults), that the partial unique index
// really refuses a second active copy of a title on a phone while a
// removed one and another phone's are fine, the writes the site makes (the
// phone's upsert on its conflict target, a copy renewed, ended, revoked; a
// title asked for and still waiting for its file — a row without a date —
// then given its date, or taken back at a limit; the newest-rows read the
// new-copy limits count from, and its index), that both tables are locked
// (row level security on, nothing granted to anon or authenticated), the
// closing report's row, that a second run changes nothing and keeps a
// switch that was turned on — and supabase/delete_account_downloads.sql,
// the by-hand step of an account's deletion: it takes that account's
// phones and copies and nobody else's, and deletes nothing with its
// placeholder left in.
// Needs PGlite (see scripts/pg-chain.mjs): node scripts/check-migration-123.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildDb, migrationFiles, SUPABASE_DIR } from './pg-chain.mjs';

let n = 0;
const ok = (name) => { n += 1; console.log('ok', name); };

const FILE = migrationFiles().find((f) => f.startsWith('123_'));
assert.ok(FILE, 'supabase/migrations/123_*.sql exists');
const SQL = fs.readFileSync(path.join(SUPABASE_DIR, 'migrations', FILE), 'utf8');
assert.doesNotMatch(SQL, /create extension/i);
assert.match(SQL, /alter table public\.download_devices enable row level security/, 'the phones table ends with migration 112’s line');
assert.match(SQL, /alter table public\.downloads enable row level security/, 'the copies table ends with migration 112’s line');

const col = async (db, table, column) => (await db.query(`select data_type, is_nullable, column_default,
    col_description(('public.' || table_name)::regclass, ordinal_position) as note
  from information_schema.columns where table_schema = 'public' and table_name = $1 and column_name = $2`, [table, column])).rows[0] || null;
const refused = async (db, sql, params, code, why) => {
  try {
    await db.query(sql, params);
  } catch (err) {
    assert.equal(err.code, code, `${why}: ${err.message}`);
    return;
  }
  throw new Error(`${why}: the database took it`);
};

const db = await buildDb(122);
ok('schema.sql + migrations 002–122 run on a fresh Postgres');

for (const [t, c] of [['site_settings', 'downloads_enabled'], ['site_settings', 'downloads_locked'], ['episodes', 'downloads_allowed']]) {
  assert.equal(await col(db, t, c), null, `${t}.${c} absent before 123`);
  await refused(db, `select ${c} from ${t} limit 1`, [], '42703', `${t}.${c} before 123`);
}
for (const t of ['download_devices', 'downloads']) await refused(db, `select id from ${t} limit 1`, [], '42P01', `${t} before 123`);
const before = (await db.query('select * from site_settings where id = 1')).rows[0];
assert.ok(before, 'site_settings has its row');
assert.ok(!Object.prototype.hasOwnProperty.call(before, 'downloads_enabled'), 'select * carries no downloads_enabled before 123 (how the site tells)');
ok('before 123 none of its columns exist (42703) and both tables are missing (42P01)');

const FILM = 'the-long-quiet-lx3k9a';
const SHORT = 'kitchen-hours-m1q8zt';
await db.query(`insert into episodes (id, title, content_type, status, submitted_by, runtime) values
  ($1, 'The Long Quiet', 'movie', 'approved', 'user_mara', '24:00'), ($2, 'Kitchen Hours', 'short', 'approved', 'user_dee', '9:30')`, [FILM, SHORT]);

const results = await db.exec(SQL);
const report = results[results.length - 1].rows[0];
ok('123 runs');

assert.equal(report.downloads_on_expect_false_on_first_run, false);
assert.equal(report.switch_locked_expect_false_on_first_run, false);
assert.equal(Number(report.title_switch_column_expect_1), 1);
assert.equal(Number(report.titles_switched_off), 0);
assert.equal(report.phones_row_level_security_expect_true, true);
assert.equal(report.copies_row_level_security_expect_true, true);
assert.equal(Number(report.one_copy_per_phone_index_expect_1), 1);
assert.equal(Number(report.newest_rows_index_expect_1), 1);
assert.equal(Number(report.phones), 0);
assert.equal(Number(report.copies_on_phones), 0);
ok('the closing report reads (off, unlocked, 1 column, 0 titles off, both tables locked, both indexes, 0 phones, 0 copies)');

for (const [t, c, def] of [['site_settings', 'downloads_enabled', 'false'], ['site_settings', 'downloads_locked', 'false'], ['episodes', 'downloads_allowed', 'true']]) {
  const x = await col(db, t, c);
  assert.equal(x.data_type, 'boolean', `${t}.${c}`);
  assert.equal(x.is_nullable, 'NO', `${t}.${c}`);
  assert.equal(x.column_default, def, `${t}.${c}`);
  assert.match(x.note || '', /Migration 123\./, `${t}.${c} has its comment`);
}
const settings = (await db.query('select * from site_settings where id = 1')).rows[0];
assert.equal(settings.downloads_enabled, false);
assert.equal(settings.downloads_locked, false);
const titles = (await db.query('select id, downloads_allowed from episodes order by id')).rows;
assert.deepEqual(titles.map((t) => t.downloads_allowed), [true, true]);
ok('three boolean columns, not null, with their defaults and comments: the switch off, unlocked, every existing title allowing downloads');

const TYPES = {
  download_devices: { id: 'uuid', user_id: 'text', device_id: 'text', name: 'text', platform: 'text', created_at: 'timestamp with time zone', last_seen_at: 'timestamp with time zone', removed_at: 'timestamp with time zone' },
  downloads: { id: 'uuid', user_id: 'text', device_id: 'text', episode_id: 'text', basis: 'text', status: 'text', licensed_until: 'timestamp with time zone', ended_at: 'timestamp with time zone', bytes: 'bigint', created_at: 'timestamp with time zone', renewed_at: 'timestamp with time zone', removed_at: 'timestamp with time zone', revoke_reason: 'text' }
};
for (const [t, cols] of Object.entries(TYPES)) {
  const have = Object.fromEntries((await db.query('select column_name, data_type from information_schema.columns where table_schema = $1 and table_name = $2', ['public', t])).rows.map((r) => [r.column_name, r.data_type]));
  assert.deepEqual(have, cols, t);
}
ok('both tables have exactly the columns the contract lists (title ids are text, never uuid)');

// The phones.
const PHONE_A = 'phoneA_0123456789abcdef';
const PHONE_B = 'phoneB_0123456789abcdef';
await db.query("insert into download_devices (user_id, device_id, name, platform) values ('user_mara', $1, 'Mara’s iPhone', 'ios')", [PHONE_A]);
const phone = (await db.query('select * from download_devices where device_id = $1', [PHONE_A])).rows[0];
assert.match(phone.id, /^[0-9a-f-]{36}$/);
assert.ok(phone.created_at && phone.last_seen_at);
assert.equal(phone.removed_at, null);
await refused(db, "insert into download_devices (user_id, device_id) values ('user_mara', $1)", [PHONE_A], '23505', 'the same phone twice for one account');
await db.query("insert into download_devices (user_id, device_id, platform) values ('user_dee', $1, 'android')", [PHONE_A]);
await refused(db, "insert into download_devices (user_id, device_id) values ('user_mara', 'short')", [], '23514', 'a device id under 16 characters');
await refused(db, "insert into download_devices (user_id, device_id) values ('user_mara', 'has spaces in it 0123456789')", [], '23514', 'a device id with spaces');
await refused(db, "insert into download_devices (user_id, device_id, platform) values ('user_mara', $1, 'windows')", [PHONE_B], '23514', 'a platform that is neither ios nor android');
await refused(db, 'insert into download_devices (device_id) values ($1)', [PHONE_B], '23502', 'a phone with no account');
ok('a phone: one row per account and phone (23505), another account may hold the same id, the id’s shape and the platform are checked, the account is required');

// The site's upsert of a phone (lib/downloads.js): every NOT NULL column
// without a default is sent, on the (user_id, device_id) target.
await db.query(`insert into download_devices (user_id, device_id, name, platform, last_seen_at, removed_at)
  values ('user_mara', $1, 'Mara’s phone', 'ios', now(), null)
  on conflict (user_id, device_id) do update set name = excluded.name, platform = excluded.platform, last_seen_at = excluded.last_seen_at, removed_at = excluded.removed_at`, [PHONE_A]);
const renamed = (await db.query("select name, created_at from download_devices where user_id = 'user_mara' and device_id = $1", [PHONE_A])).rows[0];
assert.equal(renamed.name, 'Mara’s phone');
assert.equal(String(renamed.created_at), String(phone.created_at), 'created_at stays through the upsert');
ok('the upsert on (user_id, device_id) updates the row it finds and keeps created_at');

// The copies.
const until = new Date(Date.now() + 12 * 86400000).toISOString();
await db.query("insert into downloads (user_id, device_id, episode_id, basis, licensed_until, renewed_at) values ('user_mara', $1, $2, 'member', $3, now())", [PHONE_A, FILM, until]);
const copy = (await db.query("select * from downloads where user_id = 'user_mara' and episode_id = $1", [FILM])).rows[0];
assert.equal(copy.status, 'active');
assert.equal(copy.ended_at, null);
assert.equal(copy.removed_at, null);
assert.equal(copy.revoke_reason, null);
assert.equal(copy.bytes, null);
assert.ok(copy.created_at);
await refused(db, "insert into downloads (user_id, device_id, episode_id, basis) values ('user_mara', $1, $2, 'owned')", [PHONE_A, FILM], '23505', 'a second active copy of the title on that phone');
ok('a copy starts active with nothing ended or revoked, and the partial unique index refuses a second active copy of the title on that phone (23505)');

await db.query("insert into downloads (user_id, device_id, episode_id, basis) values ('user_mara', $1, $2, 'owned')", [PHONE_B, FILM]);
await db.query("insert into downloads (user_id, device_id, episode_id, basis) values ('user_mara', $1, $2, 'member')", [PHONE_A, SHORT]);
await db.query("insert into downloads (user_id, device_id, episode_id, basis) values ('user_dee', $1, $2, 'member')", [PHONE_A, FILM]);
ok('the same title on another phone, another title on this phone and another account on this phone are all fine');

await db.query("update downloads set status = 'removed', removed_at = now() where user_id = 'user_mara' and device_id = $1 and episode_id = $2 and status = 'active'", [PHONE_A, FILM]);
await db.query("insert into downloads (user_id, device_id, episode_id, basis) values ('user_mara', $1, $2, 'member')", [PHONE_A, FILM]);
await db.query("update downloads set status = 'revoked', revoke_reason = 'title', removed_at = now() where user_id = 'user_mara' and device_id = $1 and episode_id = $2 and status = 'active'", [PHONE_A, FILM]);
await db.query("insert into downloads (user_id, device_id, episode_id, basis) values ('user_mara', $1, $2, 'member')", [PHONE_A, FILM]);
const history = (await db.query("select status from downloads where user_id = 'user_mara' and device_id = $1 and episode_id = $2 order by created_at, status", [PHONE_A, FILM])).rows.map((r) => r.status).sort();
assert.deepEqual(history, ['active', 'removed', 'revoked']);
ok('a removed or revoked copy frees the slot: the title can be downloaded again, and the old rows stay as history');

await db.query("update downloads set licensed_until = $1, basis = 'owned', renewed_at = now(), ended_at = null where user_id = 'user_mara' and device_id = $2 and episode_id = $3 and status = 'active'", [until, PHONE_A, FILM]);
await db.query("update downloads set ended_at = now() where user_id = 'user_mara' and device_id = $1 and episode_id = $2 and status = 'active' and ended_at is null", [PHONE_A, SHORT]);
const ended = (await db.query("select ended_at from downloads where user_id = 'user_mara' and device_id = $1 and episode_id = $2 and status = 'active'", [PHONE_A, SHORT])).rows[0];
assert.ok(ended.ended_at);
await db.query('update downloads set bytes = 3221225472 where episode_id = $1', [SHORT]);
ok('the check-in’s writes go in: a copy renewed with a new date and basis, one marked ended, a size over 2 GB (bigint)');

// A title asked for whose file isn't ready: the row the site writes at the
// first ask (lib/downloads.js startDownload) has no date yet. It holds the
// one live row for that phone and title; then it gets its date, or — when
// a limit was met — is taken back and marked as counting for nothing.
const PHONE_W = 'phoneW_0123456789abcdef';
const asked = (await db.query("insert into downloads (user_id, device_id, episode_id, basis, status, renewed_at) values ('user_wait', $1, $2, 'member', 'active', now()) returning id, licensed_until, created_at", [PHONE_W, FILM])).rows[0];
assert.match(asked.id, /^[0-9a-f-]{36}$/);
assert.equal(asked.licensed_until, null, 'no date until the link goes out');
assert.ok(asked.created_at);
await refused(db, "insert into downloads (user_id, device_id, episode_id, basis, status, renewed_at) values ('user_wait', $1, $2, 'member', 'active', now())", [PHONE_W, FILM], '23505', 'the same title asked for twice at once on one phone');
const dated = (await db.query("update downloads set basis = 'member', licensed_until = $1, renewed_at = now(), ended_at = null where id = $2 and status = 'active' returning id", [until, asked.id])).rows;
assert.equal(dated.length, 1, 'the waiting row takes its date');
const second = (await db.query("insert into downloads (user_id, device_id, episode_id, basis, status, renewed_at) values ('user_wait', $1, $2, 'member', 'active', now()) returning id", [PHONE_W, SHORT])).rows[0];
const undone = (await db.query("update downloads set status = 'revoked', revoke_reason = 'limit', removed_at = now() where id = $1 and status = 'active' returning id", [second.id])).rows;
assert.equal(undone.length, 1);
assert.equal((await db.query("update downloads set licensed_until = $1 where id = $2 and status = 'active' returning id", [until, second.id])).rows.length, 0, 'a row taken back can no longer be given a date');
await db.query("insert into downloads (user_id, device_id, episode_id, basis, status, renewed_at) values ('user_wait', $1, $2, 'member', 'active', now())", [PHONE_W, SHORT]);
// The newest rows of the account, whatever became of them (the new-copy limits' read).
const newest = (await db.query("select id, device_id, episode_id, status, revoke_reason, created_at from downloads where user_id = 'user_wait' order by created_at desc limit 1000")).rows;
assert.equal(newest.length, 3);
assert.deepEqual(newest.map((r) => `${r.status}:${r.revoke_reason || ''}`).sort(), ['active:', 'active:', 'revoked:limit']);
ok('a title asked for is a row without a date (one per phone and title), then takes its date; a row taken back at a limit is marked "limit" and its slot is free; the account’s newest rows read back');

await refused(db, "insert into downloads (user_id, device_id, episode_id, basis) values ('user_x', $1, $2, 'rented')", [PHONE_B, SHORT], '23514', 'a basis that is neither member nor owned');
await refused(db, "insert into downloads (user_id, device_id, episode_id, basis, status) values ('user_x', $1, $2, 'member', 'paused')", [PHONE_B, SHORT], '23514', 'a status outside active, removed, revoked');
await refused(db, "insert into downloads (user_id, device_id, basis) values ('user_x', $1, 'member')", [PHONE_B], '23502', 'a copy with no title');
ok('the checks refuse another basis, another status and a copy with no title');

for (const t of ['download_devices', 'downloads']) {
  const rls = (await db.query(`select relrowsecurity from pg_class where oid = 'public.${t}'::regclass`)).rows[0];
  assert.equal(rls.relrowsecurity, true, t);
  const grants = (await db.query(`select grantee, privilege_type from information_schema.role_table_grants
    where table_schema = 'public' and table_name = $1 and grantee in ('anon', 'authenticated')`, [t])).rows;
  assert.deepEqual(grants, [], t);
}
const idx = (await db.query("select indexname, indexdef from pg_indexes where schemaname = 'public' and tablename = 'downloads' order by indexname")).rows;
assert.ok(idx.find((i) => i.indexname === 'downloads_active_uq' && /UNIQUE/.test(i.indexdef) && /status = 'active'/.test(i.indexdef)));
assert.ok(idx.find((i) => i.indexname === 'downloads_episode_idx'));
assert.ok(idx.find((i) => i.indexname === 'downloads_user_created_idx' && /\(user_id, created_at DESC\)/.test(i.indexdef)), 'the newest-rows index, on (user_id, created_at desc)');
ok('both tables have row level security on and grant nothing to anon or authenticated; the partial unique index, the title index and the newest-rows index exist');

// A switch turned on, a title switched off: a second run keeps both.
await db.query('update site_settings set downloads_enabled = true, downloads_locked = true where id = 1');
await db.query('update episodes set downloads_allowed = false where id = $1', [SHORT]);
const again = await db.exec(SQL);
const report2 = again[again.length - 1].rows[0];
assert.equal(report2.downloads_on_expect_false_on_first_run, true, 'a switch that was on stays on');
assert.equal(report2.switch_locked_expect_false_on_first_run, true, 'a lock stays');
assert.equal(Number(report2.titles_switched_off), 1);
assert.equal(Number(report2.phones), 2);
assert.equal(Number(report2.copies_on_phones), 6);
assert.equal(Number(report2.one_copy_per_phone_index_expect_1), 1);
assert.equal(Number(report2.newest_rows_index_expect_1), 1);
const cons = (await db.query(`select count(*)::int as c from pg_constraint where conname in
  ('download_devices_user_device_uq', 'download_devices_device_id_check', 'download_devices_platform_check', 'downloads_basis_check', 'downloads_status_check')`)).rows[0];
assert.equal(cons.c, 5);
ok('a second run changes nothing: the switch, the lock, the title’s switch, the phones and the copies are kept, no constraint twice');

// An account's deletion, carried out by hand: its download records go.
const DELETE_SQL = fs.readFileSync(path.join(SUPABASE_DIR, 'delete_account_downloads.sql'), 'utf8');
assert.equal((DELETE_SQL.match(/'user_REPLACE_ME'/g) || []).length, 1, 'one place to put the account id');
const counts = async () => (await db.query(`select
  (select count(*)::int from downloads where user_id = 'user_mara') as mara_copies,
  (select count(*)::int from download_devices where user_id = 'user_mara') as mara_phones,
  (select count(*)::int from downloads where user_id <> 'user_mara') as other_copies,
  (select count(*)::int from download_devices where user_id <> 'user_mara') as other_phones`)).rows[0];
const had = await counts();
assert.ok(had.mara_copies >= 4 && had.mara_phones === 1 && had.other_copies >= 3 && had.other_phones === 1, JSON.stringify(had));
const untouched = (await db.exec(DELETE_SQL)).pop().rows[0];
assert.equal(untouched.account, 'user_REPLACE_ME');
assert.equal(Number(untouched.download_rows_deleted), 0);
assert.equal(Number(untouched.phone_rows_deleted), 0);
assert.deepEqual(await counts(), had, 'with the placeholder left in, nothing goes');
const gone = (await db.exec(DELETE_SQL.replace("'user_REPLACE_ME'", "'user_mara'"))).pop().rows[0];
assert.equal(gone.account, 'user_mara');
assert.equal(Number(gone.download_rows_deleted), had.mara_copies, 'every row of the account, active, removed and revoked alike');
assert.equal(Number(gone.phone_rows_deleted), 1);
assert.deepEqual(await counts(), { mara_copies: 0, mara_phones: 0, other_copies: had.other_copies, other_phones: had.other_phones }, 'and nobody else’s');
const twice = (await db.exec(DELETE_SQL.replace("'user_REPLACE_ME'", "'user_mara'"))).pop().rows[0];
assert.equal(Number(twice.download_rows_deleted) + Number(twice.phone_rows_deleted), 0);
ok('delete_account_downloads.sql takes one account’s phones and every copy on record, nobody else’s, nothing with its placeholder left in, and nothing more the second time');

console.log(`\n${n} checks passed`);
