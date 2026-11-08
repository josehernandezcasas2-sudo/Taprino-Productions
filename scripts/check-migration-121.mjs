// Migration 121 (what kind of extra) on a real Postgres: builds the
// database from schema.sql and every migration through 120, checks the
// column is absent (a read naming it fails with 42703, what the site's
// tiered reads fall back on), runs 121, checks its type, comment and length
// check, that an extra stores a preset's id and an uploader's own words the
// way lib/extraKinds.js normalizes them, that the check refuses an empty,
// all-spaces or over-long kind, the closing report's row, that row level
// security is still on for episodes, and that a second run changes nothing.
// Needs PGlite (see scripts/pg-chain.mjs): node scripts/check-migration-121.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildDb, migrationFiles, SUPABASE_DIR, runFile } from './pg-chain.mjs';
import { EXTRA_KIND_MAX, extraKindLabel, normalizeExtraKind } from '../lib/extraKinds.js';

let n = 0;
const ok = (name) => { n += 1; console.log('ok', name); };

const FILE = migrationFiles().find((f) => f.startsWith('121_'));
assert.ok(FILE, 'supabase/migrations/121_*.sql exists');
const FULL = path.join(SUPABASE_DIR, 'migrations', FILE);
const SQL = fs.readFileSync(FULL, 'utf8');
assert.doesNotMatch(SQL, /create extension/i);
assert.doesNotMatch(SQL, /create table/i, '121 makes no table (so migration 112’s row level security line isn’t owed)');

const colNow = async (db) => (await db.query(`select column_name, data_type, is_nullable, column_default,
    col_description('public.episodes'::regclass, ordinal_position) as note
  from information_schema.columns where table_schema = 'public' and table_name = 'episodes'
    and column_name = 'extra_kind'`)).rows[0] || null;
const checkNow = async (db) => (await db.query(`select conname, pg_get_constraintdef(oid) as def from pg_constraint
  where conrelid = 'public.episodes'::regclass and conname = 'episodes_extra_kind_length'`)).rows;

const db = await buildDb(120);
ok('schema.sql + migrations 002–120 run on a fresh Postgres');

assert.equal(await colNow(db), null);
ok('before 121 episodes has no extra_kind');

const SHOW = 'night-bus-lx3k9a';
const EP = 'night-bus-transfer-lx3k9c';
const X1 = 'building-the-bus-lx3k9d';
const X2 = 'table-read-lx3k9e';
await db.query("insert into series (id, name, status, creator_id) values ($1, 'Night Bus', 'approved', 'user_mara')", [SHOW]);
await db.query(`insert into episodes (id, title, content_type, series_id, season, series_order, status, submitted_by)
  values ($1, 'Transfer', 'series', $2, 1, 3, 'approved', 'user_mara')`, [EP, SHOW]);
await db.query(`insert into episodes (id, title, content_type, bonus_parent_type, bonus_parent_id, status, submitted_by, runtime)
  values ($1, 'Building the bus', 'bonus', 'series', $2, 'approved', 'user_mara', '6:10'),
         ($3, 'The table read', 'bonus', 'episode', $4, 'pending', 'user_mara', '4:02')`, [X1, SHOW, X2, EP]);
try {
  await db.query('select extra_kind from episodes limit 1');
  throw new Error('the column was there before 121');
} catch (err) {
  assert.equal(err.code, '42703', 'a read naming the column fails with 42703 (what the tiered read falls back on)');
}
ok('before 121 a read naming extra_kind fails with undefined_column (42703)');

const results = await db.exec(SQL);
const report = results[results.length - 1].rows[0];
ok('121 runs');

assert.equal(Number(report.new_column_expect_1), 1);
assert.equal(Number(report.length_check_expect_1), 1);
assert.equal(Number(report.extras), 2);
assert.equal(Number(report.with_a_kind), 0);
assert.equal(report.row_level_security_expect_true, true);
ok('the closing report reads (1, 1, 2 extras, 0 with a kind, true)');

const col = await colNow(db);
assert.equal(col.data_type, 'text');
assert.equal(col.is_nullable, 'YES');
assert.equal(col.column_default, null);
assert.match(col.note || '', /Migration 121\./);
const checks = await checkNow(db);
assert.equal(checks.length, 1);
assert.match(checks[0].def, /char_length\(extra_kind\)/);
ok('a nullable text column with no default, its comment and its length check');

let row = (await db.query('select * from episodes where id = $1', [X1])).rows[0];
assert.equal(row.extra_kind, null);
assert.ok(Object.prototype.hasOwnProperty.call(row, 'extra_kind'), 'select * carries it (episodeRowHas121)');
assert.equal(extraKindLabel(row.extra_kind), 'Extra');
ok('an existing extra has no kind and reads “Extra”');

// The way lib/showPage.js updateEpisode writes it: normalized first.
await db.query('update episodes set extra_kind = $2 where id = $1', [X1, normalizeExtraKind('Making of')]);
await db.query('update episodes set extra_kind = $2 where id = $1', [X2, normalizeExtraKind('  Table   read ')]);
row = (await db.query('select id, extra_kind from episodes where id = $1', [X1])).rows[0];
assert.equal(row.extra_kind, 'making-of');
assert.equal(extraKindLabel(row.extra_kind), 'Making-of');
const row2 = (await db.query('select id, extra_kind from episodes where id = $1', [X2])).rows[0];
assert.equal(row2.extra_kind, 'Table read');
assert.equal(extraKindLabel(row2.extra_kind), 'Table read');
ok('a preset is stored as its id, an uploader’s own words as typed (cleaned); both read back as their words');

// The longest a normalized kind can be fits; the check refuses the rest.
const longest = normalizeExtraKind('x'.repeat(80));
assert.equal(Array.from(longest).length, EXTRA_KIND_MAX);
await db.query('update episodes set extra_kind = $2 where id = $1', [X2, longest]);
const emoji = normalizeExtraKind('\u{1F3AC}'.repeat(60));
await db.query('update episodes set extra_kind = $2 where id = $1', [X2, emoji]);
assert.equal(Number((await db.query('select char_length(extra_kind) as n from episodes where id = $1', [X2])).rows[0].n), EXTRA_KIND_MAX, '40 emoji are 40 characters to Postgres as to the site');
ok('40 characters fit (an emoji counts once, as char_length counts it)');

for (const [label, value] of [['41 characters', 'y'.repeat(41)], ['an empty string', ''], ['only spaces', '   ']]) {
  try {
    await db.query('update episodes set extra_kind = $2 where id = $1', [X2, value]);
    throw new Error(`${label} was accepted`);
  } catch (err) {
    assert.equal(err.code, '23514', `${label}: check_violation`);
  }
}
await db.query('update episodes set extra_kind = null where id = $1', [X2]);
ok('the check refuses 41 characters, an empty string and only spaces; null clears it');

const rls = (await db.query("select relrowsecurity from pg_class where oid = 'public.episodes'::regclass")).rows[0];
assert.equal(rls.relrowsecurity, true);
ok('episodes still has row level security on');

await runFile(db, FULL);
const after = (await db.query('select extra_kind from episodes where id = $1', [X1])).rows[0];
assert.equal(after.extra_kind, 'making-of');
assert.ok(await colNow(db));
assert.equal((await checkNow(db)).length, 1);
ok('a second run changes nothing (the kind stays, one check)');

console.log(`\n${n} passed`);
