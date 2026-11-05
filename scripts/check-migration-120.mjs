// Migration 120 (a live episode's waiting title image and trailer) on a
// real Postgres: builds the database from schema.sql and every migration
// through 119, checks the three columns are absent, runs 120, checks their
// types, defaults and comments, that an episode stages a title image, a
// removal and a trailer, reads them back and clears them the way
// lib/showPage.js and lib/stagedChanges.js write them (an approve copies
// the waiting value into the live column and clears it in one guarded
// update), the closing report's row, that row level security is still on
// for episodes, and that a second run changes nothing.
// Needs PGlite (see scripts/pg-chain.mjs): node scripts/check-migration-120.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildDb, migrationFiles, SUPABASE_DIR, runFile } from './pg-chain.mjs';
import { showProblems } from '../lib/showRules.js';

let n = 0;
const ok = (name) => { n += 1; console.log('ok', name); };

const FILE = migrationFiles().find((f) => f.startsWith('120_'));
assert.ok(FILE, 'supabase/migrations/120_*.sql exists');
const FULL = path.join(SUPABASE_DIR, 'migrations', FILE);
assert.doesNotMatch(fs.readFileSync(FULL, 'utf8'), /create extension/i);

const COLS = ['pending_title_image_url', 'pending_title_image_removal', 'pending_trailer_src'];
const colsNow = async (db) => (await db.query(`select column_name, data_type, is_nullable, column_default,
    col_description('public.episodes'::regclass, ordinal_position) as note
  from information_schema.columns where table_schema = 'public' and table_name = 'episodes'
    and column_name = any($1) order by column_name`, [COLS])).rows;

const db = await buildDb(119);
ok('schema.sql + migrations 002–119 run on a fresh Postgres');

assert.equal((await colsNow(db)).length, 0);
ok('before 120 episodes has none of the three columns');

const SHOW = 'night-bus-lx3k9a';
const EP = 'night-bus-pilot-lx3k9b';
await db.query("insert into series (id, name, status, creator_id) values ($1, 'Night Bus', 'approved', 'user_mara')", [SHOW]);
await db.query(`insert into episodes (id, title, content_type, series_id, season, series_order, status, submitted_by, title_image_url, trailer_src)
  values ($1, 'Pilot', 'series', $2, 1, 1, 'approved', 'user_mara', 'https://x.supabase.co/storage/v1/object/public/episode-art/live.png', 'https://videodelivery.net/live-trailer/manifest/video.m3u8')`, [EP, SHOW]);
try {
  await db.query('select pending_trailer_src from episodes limit 1');
  throw new Error('the column was there before 120');
} catch (err) {
  assert.equal(err.code, '42703', 'a read naming the column fails with 42703 (what the three-tier read falls back on)');
}
ok('before 120 a read naming the columns fails with undefined_column (42703)');

const results = await db.exec(fs.readFileSync(FULL, 'utf8'));
const report = results[results.length - 1].rows[0];
ok('120 runs');

assert.equal(Number(report.new_columns_expect_3), 3);
assert.equal(Number(report.title_images_waiting), 0);
assert.equal(Number(report.title_image_removals_waiting), 0);
assert.equal(Number(report.trailers_waiting), 0);
assert.equal(report.row_level_security_expect_true, true);
ok('the closing report reads (3, 0, 0, 0, true)');

const cols = Object.fromEntries((await colsNow(db)).map((c) => [c.column_name, c]));
assert.equal(cols.pending_title_image_url.data_type, 'text');
assert.equal(cols.pending_title_image_url.is_nullable, 'YES');
assert.equal(cols.pending_trailer_src.data_type, 'text');
assert.equal(cols.pending_trailer_src.is_nullable, 'YES');
assert.equal(cols.pending_title_image_removal.data_type, 'boolean');
assert.equal(cols.pending_title_image_removal.is_nullable, 'NO');
assert.match(cols.pending_title_image_removal.column_default, /false/);
for (const c of COLS) assert.match(cols[c].note || '', /Migration 120\./, `${c} has its comment`);
ok('two text columns and a boolean not null default false, each with its comment');

const row0 = (await db.query('select * from episodes where id = $1', [EP])).rows[0];
assert.equal(row0.pending_title_image_url, null);
assert.equal(row0.pending_title_image_removal, false);
assert.equal(row0.pending_trailer_src, null);
assert.ok(Object.prototype.hasOwnProperty.call(row0, 'pending_trailer_src'), 'select * carries it (episodeRowHas120)');
ok('an existing episode reads nothing waiting');

// Stage the way lib/showPage.js updateEpisode does (one update per change).
const NEW_IMG = 'https://x.supabase.co/storage/v1/object/public/episode-art/new.png';
const NEW_TRAILER = 'https://videodelivery.net/new-trailer/manifest/video.m3u8';
await db.query('update episodes set pending_title_image_url = $2, pending_title_image_removal = false where id = $1', [EP, NEW_IMG]);
await db.query('update episodes set pending_trailer_src = $2 where id = $1', [EP, NEW_TRAILER]);
let row = (await db.query('select * from episodes where id = $1', [EP])).rows[0];
assert.equal(row.pending_title_image_url, NEW_IMG);
assert.equal(row.pending_trailer_src, NEW_TRAILER);
assert.equal(row.title_image_url, 'https://x.supabase.co/storage/v1/object/public/episode-art/live.png', 'the live image stays');
const probs = showProblems({ id: SHOW, name: 'Night Bus', status: 'approved' }, [row], {});
assert.ok(probs.some((p) => p.code === 'staged-episodes'), 'showProblems counts a waiting title image / trailer');
ok('a title image and a trailer wait; the live ones stay; showProblems sees them');

// A removal replaces the waiting image.
await db.query('update episodes set pending_title_image_removal = true, pending_title_image_url = null where id = $1', [EP]);
row = (await db.query('select * from episodes where id = $1', [EP])).rows[0];
assert.equal(row.pending_title_image_removal, true);
assert.equal(row.pending_title_image_url, null);
ok('a removal waits in place of the image');

// Approve the trailer (guarded on the value read), deny the removal.
const up = await db.query(`update episodes set trailer_src = pending_trailer_src, pending_trailer_src = null
  where id = $1 and pending_trailer_src = $2 returning id`, [EP, NEW_TRAILER]);
assert.equal(up.rows.length, 1);
const again = await db.query(`update episodes set trailer_src = pending_trailer_src, pending_trailer_src = null
  where id = $1 and pending_trailer_src = $2 returning id`, [EP, NEW_TRAILER]);
assert.equal(again.rows.length, 0, 'the guard matches nothing the second time');
await db.query('update episodes set pending_title_image_removal = false where id = $1 and pending_title_image_removal = true', [EP]);
row = (await db.query('select * from episodes where id = $1', [EP])).rows[0];
assert.equal(row.trailer_src, NEW_TRAILER);
assert.equal(row.pending_trailer_src, null);
assert.equal(row.pending_title_image_removal, false);
ok('approve copies the waiting trailer across once (a guarded update); deny clears the removal');

try {
  await db.query('update episodes set pending_title_image_removal = null where id = $1', [EP]);
  throw new Error('a null removal flag was accepted');
} catch (err) {
  assert.match(err.message, /null value|violates not-null/i);
}
ok('the removal flag can’t be null');

const rls = (await db.query("select relrowsecurity from pg_class where oid = 'public.episodes'::regclass")).rows[0];
assert.equal(rls.relrowsecurity, true);
ok('episodes still has row level security on');

await db.query('update episodes set pending_trailer_src = $2 where id = $1', [EP, NEW_TRAILER]);
await runFile(db, FULL);
const after = (await db.query('select pending_trailer_src, pending_title_image_removal from episodes where id = $1', [EP])).rows[0];
assert.equal(after.pending_trailer_src, NEW_TRAILER);
assert.equal(after.pending_title_image_removal, false);
assert.equal((await colsNow(db)).length, 3);
ok('a second run changes nothing');

console.log(`\n${n} passed`);
