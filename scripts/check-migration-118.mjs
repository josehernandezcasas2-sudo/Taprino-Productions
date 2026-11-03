// Migration 118 (shows) on a real Postgres: builds the database from
// schema.sql and every migration through 117, seeds shows the way the live
// site has them (slug ids, duplicate numbers, a missing season, an E0, a
// declined row on a number, empty and private shows, podcasts, a vertical
// series, unowned shows, a free pilot, a show with no status), runs 118
// and checks every backfill, notice and rule; the unique index; both
// renumbering functions, who may call them, and that move_episode writes
// exactly what planMove (lib/showRules.js) plans on the same rows; one
// pending invite and one open payee row per title; then runs 118 again and
// checks nothing moves, and a third time that it only fills public_at for
// a show approved since. A second database proves the guard: with the
// de-duplication cut out, 118 stops before the index, names the duplicates
// and keeps nothing. A third shows 118 runs before 116 and 117.
// Needs PGlite (see scripts/pg-chain.mjs): node scripts/check-migration-118.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildDb, migrationFiles, SUPABASE_DIR } from './pg-chain.mjs';
import { planMove } from '../lib/showRules.js';

let n = 0;
const ok = (name) => { n += 1; console.log('ok', name); };

const FILE = migrationFiles().find((f) => f.startsWith('118_'));
assert.ok(FILE, 'supabase/migrations/118_*.sql exists');
const SQL = fs.readFileSync(path.join(SUPABASE_DIR, 'migrations', FILE), 'utf8');
assert.doesNotMatch(SQL, /create extension/i, '118 needs no extension (pg-chain shims pgcrypto only)');

// Runs 118 as the SQL Editor does (the whole file as one script) and
// collects its own notices ("118 <topic>: <line>") and the closing report.
async function run118(db, sql = SQL) {
  const notes = [];
  const onNotice = (m) => {
    const hit = /^118 ([a-z]+): (.*)$/s.exec(m.message || '');
    if (hit) notes.push({ topic: hit[1], line: hit[2] });
  };
  const results = await db.exec(sql, { onNotice });
  const report = results[results.length - 1].rows.map((r) => ({ topic: r['What 118 changed'], line: r.Details }));
  return { notes, report };
}

async function expectError(db, sql, params, { code, re }, name) {
  try {
    await db.query(sql, params);
  } catch (err) {
    if (code) assert.equal(err.code, code, `${name}: SQLSTATE ${err.code} (${err.message})`);
    if (re) assert.match(err.message, re, `${name}: ${err.message}`);
    ok(name);
    return err;
  }
  throw new Error(`${name}: expected an error, the statement ran`);
}

const one = async (db, sql, params = []) => (await db.query(sql, params)).rows[0];
const all = async (db, sql, params = []) => (await db.query(sql, params)).rows;
const pos = async (db, id) => one(db, 'select series_id, season, series_order from episodes where id = $1', [id]);
const iso = (v) => (v == null ? null : new Date(v).toISOString());

// --- the seed ------------------------------------------------------------------
async function addShow(db, { id, name, status = 'approved', creatorId = null }) {
  await db.query('insert into series (id, name, status, creator_id) values ($1, $2, $3, $4)', [id, name, status, creatorId]);
}

async function addEpisode(db, e) {
  const row = {
    id: e.id,
    title: e.title,
    content_type: e.type || 'series',
    series_id: e.show ?? null,
    season: e.season === undefined ? 1 : e.season,
    series_order: e.order ?? null,
    status: e.status || 'approved',
    tier: e.tier || 'free',
    submitted_by: e.by === undefined ? 'user_mara' : e.by,
    created_at: e.created,
    released_at: Object.prototype.hasOwnProperty.call(e, 'released') ? e.released : (e.status && e.status !== 'approved' ? null : e.created),
    reviewed_at: e.reviewed ?? null,
    available_from: e.availableFrom ?? null,
    withdrawn_at: e.withdrawn ?? null,
    rating: e.rating ?? null,
    main_genre: e.mainGenre ?? null,
    genre: e.genre ?? null,
    artist: e.artist ?? null,
    ads_enabled: e.ads ?? true,
    bonus_parent_type: e.bonusParentType ?? null,
    bonus_parent_id: e.bonusParentId ?? null
  };
  const cols = Object.keys(row);
  await db.query(`insert into episodes (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')})`, cols.map((c) => row[c]));
}

const NB = 'night-bus-lx1';
const TH = 'two-hands-lx2';
const LL = 'last-light-lx4';
const NO = 'night-owl-lx5';
const QH = 'quiet-hours-lx6';
const SG = 'sea-glass-lx7';
const MD = 'the-mic-drop-lx8';
const SB = 'snack-break-lx9';
const FP = 'free-pilot-lxa';
const OR = 'old-reel-lxb';
const CS = 'cut-short-lxc';
const EO = 'extras-only-lxd';
const MX = 'mixed-signals-lxe';
const SD = 'seed-show-lxf';
const AD = 'all-declined-lxg';
const OP = 'orphan-lxy';

const NB_EP = {
  lastStop: 'night-bus-last-stop-lx3k9a',
  longWay: 'night-bus-the-long-way-lx3k9b',
  transfer: 'night-bus-transfer-lx3k9c',
  redLine: 'night-bus-red-line-lx3k9d',
  recut: 'night-bus-red-line-recut-lx3k9e',
  lastCall: 'night-bus-last-call-lx3k9f',
  oldCut: 'night-bus-old-cut-lx3k9g',
  pilot: 'night-bus-pilot-lx3k9h',
  overnight: 'night-bus-overnight-lx3k9i',
  terminus: 'night-bus-terminus-lx3k9j',
  newRoute: 'night-bus-new-route-lx3k9k'
};
const FP_EP = ['free-pilot-e1-lxs1', 'free-pilot-e2-lxs2', 'free-pilot-e3-lxs3', 'free-pilot-e4-lxs4'];
const MOVIE = 'the-long-night-lxz1';

async function seed(db) {
  // A show from before 053 has no status at all: the column is not null on a
  // database built from the migrations, so let this one hold a null.
  await db.query('alter table series alter column status drop not null');

  await addShow(db, { id: NB, name: 'Night Bus', creatorId: 'user_mara' });
  const nb = { show: NB, by: 'user_mara', rating: 'TV-14', mainGenre: 'Drama', genre: 'Neo-noir', artist: 'Mara Quinn' };
  await addEpisode(db, { ...nb, id: NB_EP.oldCut, title: 'Old Cut', order: 1, tier: 'free', created: '2026-08-25T10:00:00Z', withdrawn: '2026-09-30T10:00:00Z' });
  await addEpisode(db, { ...nb, id: NB_EP.lastStop, title: 'Last Stop', order: 1, tier: 'free', created: '2026-09-01T10:00:00Z', released: '2026-09-01T12:00:00Z' });
  await addEpisode(db, { ...nb, id: NB_EP.pilot, title: 'Pilot', order: 0, status: 'pending', created: '2026-09-02T10:00:00Z' });
  await addEpisode(db, { ...nb, id: NB_EP.longWay, title: 'The Long Way', order: 2, tier: 'premium', created: '2026-09-08T10:00:00Z' });
  await addEpisode(db, { ...nb, id: NB_EP.lastCall, title: 'Last Call', order: 2, tier: 'premium', status: 'rejected', created: '2026-09-10T10:00:00Z' });
  await addEpisode(db, { ...nb, id: NB_EP.redLine, title: 'Red Line', order: 3, tier: 'premium', created: '2026-09-15T10:00:00Z' });
  await addEpisode(db, { ...nb, id: NB_EP.recut, title: 'Red Line (recut)', order: 3, tier: 'premium', created: '2026-09-16T10:00:00Z' });
  await addEpisode(db, { ...nb, id: NB_EP.transfer, title: 'Transfer', order: 2, tier: 'premium', status: 'pending', created: '2026-09-20T10:00:00Z' });
  await addEpisode(db, { ...nb, id: NB_EP.terminus, title: 'Terminus', season: null, order: 5, tier: 'premium', created: '2026-09-22T10:00:00Z' });
  await addEpisode(db, { ...nb, id: NB_EP.overnight, title: 'Overnight', season: null, order: 1, tier: 'premium', status: 'pending', created: '2026-09-25T10:00:00Z' });
  await addEpisode(db, { ...nb, id: NB_EP.newRoute, title: 'New Route', season: 2, order: 1, tier: 'premium', created: '2026-10-01T10:00:00Z' });

  await addShow(db, { id: TH, name: 'Two Hands' });
  await addEpisode(db, { id: 'two-hands-left-lxm1', title: 'Left', show: TH, order: 1, by: 'user_ana', artist: 'Ana Bell', created: '2026-09-03T10:00:00Z', released: null, reviewed: '2026-09-04T09:00:00Z' });
  await addEpisode(db, { id: 'two-hands-right-lxm2', title: 'Right', show: TH, order: 2, by: 'user_ben', artist: 'Ben Ode', created: '2026-09-05T10:00:00Z', released: null, reviewed: '2026-09-06T09:00:00Z' });

  await addShow(db, { id: LL, name: 'Last Light' });
  await addEpisode(db, { id: 'last-light-dawn-lxn1', title: 'Dawn', show: LL, order: 1, by: 'user_cleo', artist: 'Cleo Moss', created: '2026-09-04T10:00:00Z' });
  await addEpisode(db, { id: 'last-light-noon-lxn3', title: 'Noon', show: LL, order: 3, by: 'user_cleo', artist: 'Cleo Moss', status: 'rejected', created: '2026-09-05T10:00:00Z' });
  await addEpisode(db, { id: 'last-light-dusk-lxn2', title: 'Dusk', show: LL, order: 2, by: 'user_cleo', artist: 'C. Moss', status: 'pending', created: '2026-09-06T10:00:00Z' });

  await addShow(db, { id: NO, name: 'Night Owl', creatorId: 'user_dan' });

  await addShow(db, { id: QH, name: 'Quiet Hours', creatorId: 'user_eve' });
  await addEpisode(db, { id: 'quiet-hours-first-lxo1', title: 'First', show: QH, order: 1, by: 'user_eve', status: 'pending', created: '2026-10-02T10:00:00Z' });

  await addShow(db, { id: SG, name: 'Sea Glass', status: 'pending', creatorId: 'user_fay' });
  await addEpisode(db, { id: 'sea-glass-tide-lxp1', title: 'Tide', show: SG, order: 1, by: 'user_fay', created: '2026-10-03T10:00:00Z' });
  await addEpisode(db, { id: 'sea-glass-foam-lxp2', title: 'Foam', show: SG, order: 2, by: 'user_fay', created: '2026-10-04T10:00:00Z' });
  await addEpisode(db, { id: 'sea-glass-salt-lxp3', title: 'Salt', show: SG, order: 3, by: 'user_fay', status: 'pending', created: '2026-10-05T10:00:00Z' });

  await addShow(db, { id: MD, name: 'The Mic Drop', creatorId: 'user_gus' });
  await addEpisode(db, { id: 'mic-drop-one-lxq1', title: 'One', type: 'podcast', show: MD, season: null, order: 1, by: 'user_gus', mainGenre: 'Comedy', artist: 'Gus Hale', created: '2026-09-10T10:00:00Z' });
  await addEpisode(db, { id: 'mic-drop-two-lxq2', title: 'Two', type: 'podcast', show: MD, season: null, order: 2, by: 'user_gus', mainGenre: 'Comedy', artist: 'Gus Hale', created: '2026-09-17T10:00:00Z' });

  await addShow(db, { id: SB, name: 'Snack Break', creatorId: 'user_hal' });
  await addEpisode(db, { id: 'snack-break-crumbs-lxr1', title: 'Crumbs', type: 'vertical', show: SB, season: null, order: 1, by: 'user_hal', created: '2026-09-11T10:00:00Z' });
  await addEpisode(db, { id: 'snack-break-chips-lxr2', title: 'Chips', type: 'vertical', show: SB, season: null, order: 2, by: 'user_hal', created: '2026-09-12T10:00:00Z' });
  await addEpisode(db, { id: 'snack-break-dip-lxr3', title: 'Dip', type: 'vertical', show: SB, season: null, order: 2, by: 'user_hal', created: '2026-09-13T10:00:00Z' });
  await addEpisode(db, { id: 'snack-break-zero-lxr4', title: 'Zero', type: 'vertical', show: SB, season: null, order: 0, by: 'user_hal', created: '2026-09-14T10:00:00Z' });

  await addShow(db, { id: FP, name: 'Free Pilot', creatorId: 'user_pia' });
  const fp = { show: FP, by: 'user_pia' };
  await addEpisode(db, { ...fp, id: FP_EP[0], title: 'Pilot', order: 1, tier: 'free', rating: 'TV-14', mainGenre: 'Drama', genre: 'Slow burn', artist: 'Pia Ray', ads: true, created: '2026-09-01T09:00:00Z' });
  await addEpisode(db, { ...fp, id: FP_EP[1], title: 'Second', order: 2, tier: 'premium', mainGenre: 'Drama', genre: 'Slow burn', artist: 'Pia Ray', ads: true, created: '2026-09-02T09:00:00Z' });
  await addEpisode(db, { ...fp, id: FP_EP[2], title: 'Third', order: 3, tier: 'premium', mainGenre: 'Comedy', artist: 'Pia Ray', ads: false, created: '2026-09-03T09:00:00Z' });
  await addEpisode(db, { ...fp, id: FP_EP[3], title: 'Fourth', order: 4, tier: 'premium', mainGenre: 'Comedy', genre: '', artist: 'P. Ray', ads: false, created: '2026-09-04T09:00:00Z' });

  await addShow(db, { id: OR, name: 'Old Reel', status: null, creatorId: 'user_ivy' });
  await addEpisode(db, { id: 'old-reel-reel-lxt1', title: 'Reel', show: OR, order: 1, by: 'user_ivy', created: '2026-06-30T10:00:00Z', released: '2026-07-01T10:00:00Z' });

  await addShow(db, { id: CS, name: 'Cut Short', status: 'rejected', creatorId: 'user_jo' });
  await addEpisode(db, { id: 'cut-short-only-lxu1', title: 'Only', show: CS, order: 1, by: 'user_jo', created: '2026-09-09T10:00:00Z' });

  await addShow(db, { id: EO, name: 'Extras Only', creatorId: 'user_kay' });
  await addEpisode(db, { id: 'extras-only-bts-lxv1', title: 'Behind the Scenes', type: 'bonus', show: null, season: null, by: 'user_kay', bonusParentType: 'series', bonusParentId: EO, created: '2026-08-14T10:00:00Z', released: '2026-08-15T10:00:00Z' });

  await addShow(db, { id: MX, name: 'Mixed Signals', creatorId: 'user_lu' });
  await addEpisode(db, { id: 'mixed-signals-talk-lxw1', title: 'Talk', type: 'podcast', show: MX, order: 1, by: 'user_lu', created: '2026-09-18T10:00:00Z' });
  await addEpisode(db, { id: 'mixed-signals-scene-lxw2', title: 'Scene', show: MX, order: 2, by: 'user_lu', created: '2026-09-19T10:00:00Z' });

  await addShow(db, { id: SD, name: 'Seed Show' });
  await addEpisode(db, { id: 'seed-show-one-lxx1', title: 'One', show: SD, order: 1, by: 'placeholder', created: '2026-09-21T10:00:00Z' });

  await addShow(db, { id: AD, name: 'All Declined', status: 'pending', creatorId: 'user_max' });
  await addEpisode(db, { id: 'all-declined-one-lxg1', title: 'One', show: AD, order: 1, by: 'user_max', tier: 'premium', artist: 'Max Rue', status: 'rejected', created: '2026-09-23T10:00:00Z' });

  await addShow(db, { id: OP, name: 'Orphan' });

  await addEpisode(db, { id: MOVIE, title: 'The Long Night', type: 'movie', show: null, season: null, by: 'user_mara', created: '2026-09-24T10:00:00Z' });
}

// =============================================================================
const db = await buildDb(117);
ok('schema.sql + migrations 002–117 run on a fresh Postgres');
await seed(db);
const seeded = await one(db, 'select (select count(*) from series)::int s, (select count(*) from episodes)::int e');
assert.deepEqual(seeded, { s: 16, e: 38 });
ok('seeded 16 shows and 38 titles with slug ids, the awkward cases included');

// What anyone can watch today: an approved title (withdrawn ones included,
// for their buyers) outside a show, or in a show the site treats as live.
const WATCHABLE = `select e.id from episodes e left join series s on s.id = e.series_id
  where e.status = 'approved' and (e.series_id is null or s.status = 'approved' or s.status is null) order by e.id`;
const watchableBefore = (await all(db, WATCHABLE)).map((r) => r.id);
assert.equal(watchableBefore.length, 26);

// --- run 118 --------------------------------------------------------------------
const first = await run118(db);
ok(`ran ${FILE}`);
const topics = (notes, t) => notes.filter((x) => x.topic === t);
assert.deepEqual(first.report, first.notes, 'the closing table lists exactly the notices, in order');
ok(`the SQL Editor's closing table repeats the ${first.notes.length} notices, in order`);
assert.equal(first.notes[first.notes.length - 1].topic, 'done');
assert.equal(first.notes[first.notes.length - 1].line, 'Migration 118 finished; the lines above say what it changed or still needs.');
ok('the last line says the run finished and points at the lines above');

// --- the new columns --------------------------------------------------------------
const cols = await all(db, `select table_name t, column_name c, data_type d, is_nullable nullable, column_default def
  from information_schema.columns where table_schema = 'public' and table_name in ('series', 'episodes') order by 1, 2`);
const col = (t, c) => cols.find((x) => x.t === t && x.c === c);
const expectCol = (t, c, d, nullable, defRe) => {
  const x = col(t, c);
  assert.ok(x, `${t}.${c} exists`);
  assert.equal(x.d, d, `${t}.${c} is ${x.d}`);
  assert.equal(x.nullable, nullable, `${t}.${c} nullable ${x.nullable}`);
  if (defRe) assert.match(String(x.def), defRe, `${t}.${c} default ${x.def}`);
};
expectCol('series', 'kind', 'text', 'NO', /'series'/);
expectCol('series', 'defaults', 'jsonb', 'NO', /'\{\}'/);
expectCol('series', 'seasons', 'jsonb', 'NO', /'\[\]'/);
expectCol('series', 'credits', 'jsonb', 'NO', /'\{\}'/);
expectCol('series', 'decision_note', 'text', 'YES');
expectCol('series', 'submitted_by_user_id', 'text', 'YES');
expectCol('series', 'reviewed_by_user_id', 'text', 'YES');
expectCol('series', 'paid_to', 'text', 'YES');
expectCol('series', 'public_at', 'timestamp with time zone', 'YES');
expectCol('episodes', 'has_page', 'boolean', 'YES');
expectCol('episodes', 'page_notes', 'text', 'YES');
expectCol('episodes', 'pending_src', 'text', 'YES');
expectCol('episodes', 'paid_to', 'text', 'YES');
expectCol('episodes', 'credits', 'jsonb', 'NO', /'\{\}'/);
expectCol('episodes', 'captions_stale_at', 'timestamp with time zone', 'YES');
assert.equal(col('episodes', 'owner_id'), undefined, 'episodes.owner_id is not added (paid_to replaces it)');
ok('series gains kind, defaults, seasons, credits, decision_note, the two Clerk-id columns, paid_to, public_at; episodes gain has_page, page_notes, pending_src, paid_to, credits, captions_stale_at (no owner_id)');

const blank = await one(db, `select has_page, page_notes, pending_src, paid_to, credits from episodes where id = $1`, [MOVIE]);
assert.deepEqual(blank, { has_page: null, page_notes: null, pending_src: null, paid_to: null, credits: {} });
const blankShow = await one(db, `select seasons, credits, paid_to, decision_note from series where id = $1`, [NB]);
assert.deepEqual(blankShow, { seasons: [], credits: {}, paid_to: null, decision_note: null });
ok('existing rows read as "by type", no notes, nobody picked, no credits, no season labels');

await expectError(db, `update series set credits = '[]' where id = $1`, [NB], { code: '23514' }, 'series.credits must be an object');
await expectError(db, `update series set seasons = '{}' where id = $1`, [NB], { code: '23514' }, 'series.seasons must be an array');
await expectError(db, `update series set defaults = '"premium"' where id = $1`, [NB], { code: '23514' }, 'series.defaults must be an object');
await expectError(db, `update episodes set credits = '"Mara"' where id = $1`, [MOVIE], { code: '23514' }, 'episodes.credits must be an object');
await expectError(db, `update series set kind = 'film' where id = $1`, [NB], { code: '23514' }, 'series.kind is series, podcast or vertical');

// --- 1. status ---------------------------------------------------------------------
assert.equal((await one(db, 'select status from series where id = $1', [OR])).status, 'approved');
assert.deepEqual(topics(first.notes, 'status').map((x) => x.line), ['Old Reel (old-reel-lxb) had no status; it is approved now, which is how the site already treated it.']);
ok('a show with no status is approved now (one notice naming it)');
const statusCol = await one(db, `select is_nullable, column_default from information_schema.columns where table_name = 'series' and column_name = 'status'`);
assert.equal(statusCol.is_nullable, 'NO');
assert.match(statusCol.column_default, /'approved'/);
ok('series.status is not null again, default approved as before');
assert.ok(await one(db, `select 1 from pg_constraint where conname = 'series_status_check'`));
assert.equal(topics(first.notes, 'check').length, 0);
await expectError(db, `update series set status = 'live' where id = $1`, [NB], { code: '23514', re: /series_status_check/ }, 'the status check is in: only pending, approved or rejected');

// --- 2. owners -------------------------------------------------------------------
assert.equal((await one(db, 'select creator_id from series where id = $1', [LL])).creator_id, 'user_cleo');
assert.deepEqual(topics(first.notes, 'owner').map((x) => x.line), ['Last Light (last-light-lx4) belongs to user_cleo now: they uploaded every episode in it.']);
ok('an unowned show whose every episode came from one account belongs to that account (one notice)');
for (const id of [TH, SD, OP]) assert.equal((await one(db, 'select creator_id from series where id = $1', [id])).creator_id, null, id);
const unowned = topics(first.notes, 'unowned').map((x) => x.line);
assert.deepEqual(unowned, [
  'Orphan (orphan-lxy) has no owner: it has no episodes. Set one on /admin/ownership.',
  'Seed Show (seed-show-lxf) has no owner: its uploader (placeholder) is not an account id. Set one on /admin/ownership.',
  'Two Hands (two-hands-lx2) has no owner: its 2 episodes come from 2 accounts (user_ana, user_ben). Set one on /admin/ownership.'
]);
ok('shows with two uploaders, a non-account uploader or no episodes keep no owner, each listed with the reason');
assert.equal((await one(db, 'select creator_id from series where id = $1', [NB])).creator_id, 'user_mara');
ok('a show that already had an owner keeps it');

// --- 3. kind ---------------------------------------------------------------------
const kinds = Object.fromEntries((await all(db, 'select id, kind from series')).map((r) => [r.id, r.kind]));
assert.equal(kinds[MD], 'podcast');
assert.equal(kinds[SB], 'vertical');
assert.equal(kinds[MX], 'series');
assert.equal(kinds[NB], 'series');
assert.equal(kinds[EO], 'series');
assert.equal(kinds[OP], 'series');
assert.deepEqual(topics(first.notes, 'kind').map((x) => x.line), ['Snack Break (snack-break-lx9) is a vertical show.', 'The Mic Drop (the-mic-drop-lx8) is a podcast show.']);
ok('kind: podcast-only → podcast, vertical-only → vertical, podcast + series → series, empty or extras-only → series (two notices)');

// --- 4. defaults -------------------------------------------------------------------
const defaults = Object.fromEntries((await all(db, 'select id, defaults from series')).map((r) => [r.id, r.defaults]));
assert.deepEqual(defaults[FP], { tier: 'premium', rating: 'TV-14', mainGenre: 'Comedy', genre: 'Slow burn', artist: 'Pia Ray', adsEnabled: false });
ok('Free Pilot (E1 free, E2–E4 Tapa +) defaults to Tapa +; rating from the one episode that has one; Drama 2 – Comedy 2 and ads on 2 – off 2 go to the newest episode; a blank genre does not vote');
assert.deepEqual(defaults[NB], { tier: 'premium', rating: 'TV-14', mainGenre: 'Drama', genre: 'Neo-noir', artist: 'Mara Quinn', adsEnabled: true });
ok('Night Bus defaults to what most of its episodes have (Tapa +, TV-14, Drama, Neo-noir, Mara Quinn, ads on)');
assert.equal(defaults[TH].artist, 'Ben Ode');
ok('a one–one tie on Made by goes to the newest episode');
assert.equal(defaults[LL].artist, 'C. Moss');
ok('a declined episode does not vote while the show has others (Cleo Moss 1 – C. Moss 1 → the newest, not Cleo Moss 2)');
assert.deepEqual(defaults[AD], { tier: 'premium', artist: 'Max Rue', adsEnabled: true });
ok('a show with only declined episodes still takes its defaults from them');
assert.deepEqual(defaults[MD], { tier: 'free', mainGenre: 'Comedy', artist: 'Gus Hale', adsEnabled: true });
ok('a value no episode has (rating, genre) is left out, not stored as null');
for (const id of [NO, EO, OP]) assert.deepEqual(defaults[id], {}, id);
ok('a show with no episodes (or only an extra) has no defaults');
assert.deepEqual(topics(first.notes, 'defaults').map((x) => x.line), ['13 shows took their defaults for new episodes (Who can watch, rating, genres, Made by, ads) from what most of their episodes have.']);
ok('one notice counts the shows given defaults (13)');

// --- 6. public_at and decision 2 ---------------------------------------------------
const shows = Object.fromEntries((await all(db, 'select id, status, public_at from series')).map((r) => [r.id, { status: r.status, publicAt: iso(r.public_at) }]));
assert.deepEqual(shows[NB], { status: 'approved', publicAt: '2026-08-25T10:00:00.000Z' });
ok('Night Bus stays public since its first release (a withdrawn episode buyers keep counts)');
assert.deepEqual(shows[TH], { status: 'approved', publicAt: '2026-09-04T09:00:00.000Z' });
ok('with no release stamp, the first approval counts as the release');
assert.deepEqual(shows[EO], { status: 'approved', publicAt: '2026-08-15T10:00:00.000Z' });
ok('a show whose only approved title is an extra filed under it stays public');
assert.deepEqual(shows[OR], { status: 'approved', publicAt: '2026-07-01T10:00:00.000Z' });
ok('the show that had no status is public since its episode\'s release');
for (const id of [LL, MD, SB, FP, MX, SD]) assert.equal(shows[id].status, 'approved', id);
for (const id of [LL, MD, SB, FP, MX, SD]) assert.ok(shows[id].publicAt, id);
ok('every other approved show with an approved episode stays approved with a public_at');
assert.deepEqual(shows[NO], { status: 'pending', publicAt: null });
assert.deepEqual(shows[QH], { status: 'pending', publicAt: null });
assert.deepEqual(shows[OP], { status: 'pending', publicAt: null });
assert.deepEqual(topics(first.notes, 'private').map((x) => x.line), [
  'Night Owl (night-owl-lx5) had no approved episode, so it is private now (pending): its owner makes it public once one is approved.',
  'Orphan (orphan-lxy) had no approved episode, so it is private now (pending): its owner makes it public once one is approved.',
  'Quiet Hours (quiet-hours-lx6) had no approved episode, so it is private now (pending): its owner makes it public once one is approved.'
]);
ok('approved shows with no approved episode (empty, or only one in review) are private now, one notice each');
assert.deepEqual(shows[SG], { status: 'pending', publicAt: null });
assert.deepEqual(topics(first.notes, 'ready').map((x) => x.line), ['Ready to go public: Sea Glass (sea-glass-lx7) has 2 approved episodes and waits for its owner (or a full admin) to make it public.']);
ok('a pending show with approved episodes stays private and is listed as ready to go public');
assert.deepEqual(shows[CS], { status: 'rejected', publicAt: null });
assert.deepEqual(shows[AD], { status: 'pending', publicAt: null });
ok('a declined show and a pending show with nothing approved are left as they were');
assert.deepEqual(topics(first.notes, 'public').map((x) => x.line), ['10 approved shows with an approved episode stay public; public_at is the first episode\'s release.']);
ok('one notice counts the shows that stay public (10)');
assert.deepEqual((await all(db, WATCHABLE)).map((r) => r.id), watchableBefore);
ok('nothing anyone could watch appears or disappears: the same 26 approved titles are outside a show or in a live one before and after');

// --- 8. seasons ---------------------------------------------------------------------
assert.equal((await pos(db, NB_EP.terminus)).season, 1);
assert.equal((await pos(db, 'mic-drop-one-lxq1')).season, 1);
assert.equal((await pos(db, 'mic-drop-two-lxq2')).season, 1);
assert.equal((await pos(db, 'snack-break-crumbs-lxr1')).season, null);
assert.equal((await pos(db, MOVIE)).season, null);
assert.deepEqual(topics(first.notes, 'season').map((x) => x.line), ['4 show episodes had no season; they are in season 1 now.']);
ok('series and podcast episodes with no season are in season 1 (one counted notice); vertical clips and films keep none');

// --- 9. numbers under 1 ----------------------------------------------------------------
assert.equal((await pos(db, NB_EP.pilot)).series_order, null);
assert.deepEqual(topics(first.notes, 'unnumbered').map((x) => x.line), ['Night Bus (night-bus-lx1) season 1: "Pilot" (night-bus-pilot-lx3k9h) was numbered E0; it has no number now, for its owner to give it one.']);
assert.equal((await pos(db, 'snack-break-zero-lxr4')).series_order, 0);
ok('an episode numbered E0 loses the number (one notice); a vertical clip at 0 is left alone');

// --- 10. the de-duplication shove --------------------------------------------------------
const nbNumbers = Object.fromEntries((await all(db, 'select id, season, series_order from episodes where series_id = $1', [NB])).map((r) => [r.id, `S${r.season}E${r.series_order}`]));
assert.deepEqual(nbNumbers, {
  [NB_EP.oldCut]: 'S1E1',
  [NB_EP.lastStop]: 'S1E1',
  [NB_EP.pilot]: 'S1Enull',
  [NB_EP.longWay]: 'S1E2',
  [NB_EP.lastCall]: 'S1E2',
  [NB_EP.redLine]: 'S1E3',
  [NB_EP.recut]: 'S1E1008',
  [NB_EP.transfer]: 'S1E1007',
  [NB_EP.terminus]: 'S1E5',
  [NB_EP.overnight]: 'S1E1006',
  [NB_EP.newRoute]: 'S2E1'
});
ok('Night Bus S1: the live episode keeps each number, the others move to 5 + 1000 + 1, 2, 3; the declined E2 and the withdrawn E1 hold no number and stay');
assert.deepEqual(topics(first.notes, 'renumbered').map((x) => x.line), [
  'Night Bus (night-bus-lx1) season 1: "Overnight" (night-bus-overnight-lx3k9i) moved from E1 to E1006; E1 stays with "Last Stop" (night-bus-last-stop-lx3k9a).',
  'Night Bus (night-bus-lx1) season 1: "Transfer" (night-bus-transfer-lx3k9c) moved from E2 to E1007; E2 stays with "The Long Way" (night-bus-the-long-way-lx3k9b).',
  'Night Bus (night-bus-lx1) season 1: "Red Line (recut)" (night-bus-red-line-recut-lx3k9e) moved from E3 to E1008; E3 stays with "Red Line" (night-bus-red-line-lx3k9d).'
]);
ok('one notice per moved episode, naming the show, the old and new number and who kept it');
const sb = Object.fromEntries((await all(db, 'select id, series_order from episodes where series_id = $1', [SB])).map((r) => [r.id, r.series_order]));
assert.deepEqual(sb, { 'snack-break-crumbs-lxr1': 1, 'snack-break-chips-lxr2': 2, 'snack-break-dip-lxr3': 2, 'snack-break-zero-lxr4': 0 });
ok('vertical series are left as they are (two clips on E2 stay)');

// --- 12. the unique index -------------------------------------------------------------
const uq = await one(db, `select indexdef from pg_indexes where indexname = 'episodes_show_position_uq'`);
assert.match(uq.indexdef, /^CREATE UNIQUE INDEX episodes_show_position_uq ON public\.episodes USING btree \(series_id, season, series_order\) WHERE/);
for (const part of ['series_id IS NOT NULL', 'season IS NOT NULL', 'series_order IS NOT NULL', "'series'::text", "'podcast'::text", "status <> 'rejected'::text", 'withdrawn_at IS NULL']) {
  assert.ok(uq.indexdef.includes(part), `the index predicate has ${part}: ${uq.indexdef}`);
}
ok('the unique index is on (series_id, season, series_order) for live and in-review series/podcast episodes only');
await expectError(db, `insert into episodes (id, title, content_type, series_id, season, series_order, status, submitted_by) values ('night-bus-again-lx3k9z', 'Again', 'series', $1, 1, 2, 'pending', 'user_mara')`, [NB], { code: '23505', re: /episodes_show_position_uq/ }, 'a second S1 E2 for Night Bus is refused by the database');
await db.query(`insert into episodes (id, title, content_type, series_id, season, series_order, status, submitted_by) values ('night-bus-declined-two-lx3k9y', 'Declined Two', 'series', $1, 1, 2, 'rejected', 'user_mara')`, [NB]);
await db.query(`insert into episodes (id, title, content_type, series_id, season, series_order, status, submitted_by, withdrawn_at) values ('night-bus-gone-two-lx3k9x', 'Gone Two', 'series', $1, 1, 2, 'approved', 'user_mara', now())`, [NB]);
await db.query(`insert into episodes (id, title, content_type, series_id, season, series_order, status, submitted_by) values ('snack-break-more-lxr5', 'More', 'vertical', $1, null, 2, 'approved', 'user_hal')`, [SB]);
ok('a declined or withdrawn episode on a taken number, and a third vertical clip on E2, are allowed (they hold no number)');
await db.query(`delete from episodes where id in ('night-bus-declined-two-lx3k9y', 'night-bus-gone-two-lx3k9x', 'snack-break-more-lxr5')`);
await expectError(db, `update episodes set season = 2, series_order = 1 where id = $1`, [NB_EP.terminus], { code: '23505' }, 'moving an episode onto a taken number by hand is refused too');

// --- 13. the extras index -----------------------------------------------------------------
const bonusIdx = await all(db, `select indexdef from pg_indexes where indexname = 'episodes_bonus_parent_idx'`);
assert.equal(bonusIdx.length, 1);
assert.match(bonusIdx[0].indexdef, /\(bonus_parent_type, bonus_parent_id\) WHERE \(bonus_parent_id IS NOT NULL\)/);
ok('024\'s extras index now covers any row with a parent (one index, not two)');

// --- 14. reorder_show_season ----------------------------------------------------------------
const reorder = (season, ids, numbers = null, show = FP) => all(db, 'select * from reorder_show_season($1, $2, $3, $4)', [show, season, ids, numbers]);
const move = (id, show, season, number, shift = false, from = null, closeGap = false) => all(db, 'select * from move_episode($1, $2, $3, $4, $5, $6, $7)', [id, show, season, number, shift, from, closeGap]);
const fpNumbers = async () => (await all(db, 'select id, series_order from episodes where series_id = $1 and season = 1 order by id', [FP])).map((r) => r.series_order);

let rows = await reorder(1, [FP_EP[3], FP_EP[0], FP_EP[1], FP_EP[2]]);
assert.deepEqual(rows.map((r) => [r.id, r.old_series_order, r.series_order]), [[FP_EP[3], 4, 1], [FP_EP[0], 1, 2], [FP_EP[1], 2, 3], [FP_EP[2], 3, 4]]);
assert.deepEqual(await fpNumbers(), [2, 3, 4, 1]);
ok('reorder with no numbers gives the episodes 1..n in the order sent, and answers each one\'s old and new number');
rows = await reorder(1, FP_EP, [1, 2, 3, 4]);
assert.deepEqual(await fpNumbers(), [1, 2, 3, 4]);
assert.deepEqual(rows.map((r) => r.series_id), [FP, FP, FP, FP]);
ok('reorder with explicit numbers puts every episode back');
await reorder(1, [FP_EP[0], FP_EP[1]], [2, 1]);
assert.deepEqual(await fpNumbers(), [2, 1, 3, 4]);
await reorder(1, [FP_EP[0], FP_EP[1]], [1, 2]);
ok('a straight swap of E1 and E2 (the case that collides without the negatives) goes through');
await reorder(1, [FP_EP[3]], [7]);
assert.deepEqual(await fpNumbers(), [1, 2, 3, 7]);
await reorder(1, [FP_EP[3]], [4]);
ok('a number past the end leaves the gap it makes (nothing else renumbers)');

const unchanged = async (name, fn) => {
  const before = JSON.stringify(await all(db, 'select id, series_id, season, series_order from episodes order by id'));
  await fn();
  assert.equal(JSON.stringify(await all(db, 'select id, series_id, season, series_order from episodes order by id')), before, `${name}: nothing changed`);
};
await unchanged('another show\'s episode', () => expectError(db, 'select * from reorder_show_season($1, 1, $2, null)', [FP, [FP_EP[0], NB_EP.lastStop]], { code: '22023', re: /not in free-pilot-lxa season 1: night-bus-last-stop-lx3k9a/ }, 'reorder refuses an episode from another show, and changes nothing'));
await unchanged('another season', () => expectError(db, 'select * from reorder_show_season($1, 2, $2, null)', [FP, [FP_EP[0]]], { code: '22023', re: /not in free-pilot-lxa season 2/ }, 'reorder refuses an episode from another season'));
await expectError(db, 'select * from reorder_show_season($1, 1, $2, null)', [FP, [FP_EP[0], FP_EP[0]]], { code: '22023', re: /listed twice/ }, 'reorder refuses an episode listed twice');
await expectError(db, 'select * from reorder_show_season($1, 1, $2, $3)', [FP, [FP_EP[0], FP_EP[1]], [1]], { code: '22023', re: /2 episodes but 1 numbers/ }, 'reorder refuses a number list of the wrong length');
await expectError(db, 'select * from reorder_show_season($1, 1, $2, $3)', [FP, [FP_EP[0], FP_EP[1]], [0, 1]], { code: '22023', re: /run from 1 to 9999/ }, 'reorder refuses a number under 1');
await expectError(db, 'select * from reorder_show_season($1, 1, $2, $3)', [FP, [FP_EP[0], FP_EP[1]], [1, 10000]], { code: '22023', re: /run from 1 to 9999/ }, 'reorder refuses a number past 9999 (MAX_EPISODE_NUMBER in lib/showRules.js)');
await expectError(db, 'select * from reorder_show_season($1, 1, $2, $3)', [FP, [FP_EP[0], FP_EP[1]], [3, 3]], { code: '22023', re: /same number/ }, 'reorder refuses two episodes on one number');
await expectError(db, 'select * from reorder_show_season($1, 1, $2, null)', [FP, []], { code: '22023' }, 'reorder refuses an empty list');
await unchanged('a held number', () => expectError(db, 'select * from reorder_show_season($1, 1, $2, $3)', [FP, [FP_EP[0]], [3]], { code: '23505', re: /taken in free-pilot-lxa season 1: E3 \(held by free-pilot-e3-lxs3\)/ }, 'reorder refuses a number held by an episode not in the list (23505), and changes nothing'));
await reorder(1, ['last-light-dusk-lxn2'], [3], LL);
assert.equal((await pos(db, 'last-light-dusk-lxn2')).series_order, 3);
await reorder(1, ['last-light-dusk-lxn2'], [2], LL);
ok('a declined episode\'s number is free to take');
rows = await reorder(null, ['snack-break-chips-lxr2', 'snack-break-crumbs-lxr1'], [1, 2], SB);
assert.deepEqual(rows.map((r) => [r.id, r.series_order]), [['snack-break-chips-lxr2', 1], ['snack-break-crumbs-lxr1', 2]]);
await reorder(null, ['snack-break-crumbs-lxr1', 'snack-break-chips-lxr2'], [1, 2], SB);
ok('a vertical series with no seasons can be renumbered by the studio (season null = no season)');

// --- 14. move_episode --------------------------------------------------------------------------
rows = await move(FP_EP[3], FP, 1, 2, true, FP);
assert.deepEqual(rows.map((r) => [r.id, r.old_series_order, r.series_order]), [[FP_EP[3], 4, 2], [FP_EP[1], 2, 3], [FP_EP[2], 3, 4]]);
assert.deepEqual(await fpNumbers(), [1, 3, 4, 2]);
ok('moving E4 to E2 with shift inside its season is a rotation: E2–E3 become E3–E4, E1 untouched; the answer lists the three that moved');
await reorder(1, FP_EP, [1, 2, 3, 4]);

rows = await move(FP_EP[3], NB, 2, 1, true, FP);
assert.deepEqual(rows.map((r) => [r.id, r.old_series_id, r.old_season, r.old_series_order, r.series_id, r.season, r.series_order]), [
  [FP_EP[3], FP, 1, 4, NB, 2, 1],
  [NB_EP.newRoute, NB, 2, 1, NB, 2, 2]
]);
assert.deepEqual(await fpNumbers(), [1, 2, 3]);
ok('moving into another show\'s S2 E1 with shift pushes its E1 to E2; the place it left stays empty');
const FAR = 'night-bus-far-end-lx3k9m';
await db.query(`insert into episodes (id, title, content_type, series_id, season, series_order, status, tier, submitted_by) values ($2, 'Far End', 'series', $1, 2, 4, 'approved', 'premium', 'user_mara')`, [NB, FAR]);
rows = await move(FP_EP[2], NB, 2, 1, true);
assert.deepEqual(rows.map((r) => [r.id, r.old_series_order, r.series_order]), [[FP_EP[2], 3, 1], [FP_EP[3], 1, 2], [NB_EP.newRoute, 2, 4], [FAR, 4, 5]]);
ok('an insert from elsewhere slides the holder and every row after it along the numbers they hold (E1, E2, E4 become E2, E4, E5): the gap at E3 stays a gap');
await unchanged('a taken number without shift', () => expectError(db, 'select * from move_episode($1, $2, 2, 4, false, null)', [FP_EP[0], NB], { code: '23505', re: /E4 of season 2 in night-bus-lx1 is taken by night-bus-new-route-lx3k9k/ }, 'move without shift onto a taken number is refused (23505), and changes nothing'));
await unchanged('the wrong show', () => expectError(db, 'select * from move_episode($1, $2, 1, 9, false, $3)', [FP_EP[0], FP, NB], { code: '22023', re: /free-pilot-e1-lxs1 is not in night-bus-lx1/ }, 'move refuses an episode that is not in the show the route names'));
await expectError(db, 'select * from move_episode($1, $2, 1, null, false, null)', ['mic-drop-one-lxq1', NB], { code: '22023', re: /is a podcast episode and night-bus-lx1 is a series show/ }, 'move refuses a podcast episode into a series show');
await expectError(db, 'select * from move_episode($1, $2, 1, null, false, null)', [FP_EP[0], SB], { code: '22023', re: /is a series episode and snack-break-lx9 is a vertical show/ }, 'move refuses anything into a vertical series');
await expectError(db, 'select * from move_episode($1, $2, 1, null, false, null)', [MOVIE, NB], { code: '22023', re: /is a movie title/ }, 'move refuses a film (it has no place in a show)');
await expectError(db, 'select * from move_episode($1, $2, 1, null, false, null)', [FP_EP[0], 'no-such-show-lx0'], { code: '22023', re: /there is no show/ }, 'move refuses a show that does not exist');
await expectError(db, 'select * from move_episode($1, $2, 1, null, false, null)', ['no-such-episode-lx0', NB], { code: '22023', re: /there is no episode/ }, 'move refuses an episode that does not exist');
await expectError(db, 'select * from move_episode($1, $2, 1, 0, false, null)', [FP_EP[0], FP], { code: '22023', re: /run from 1 to 9999/ }, 'move refuses a number under 1');
await expectError(db, 'select * from move_episode($1, $2, 1, 10000, false, null)', [FP_EP[0], FP], { code: '22023', re: /run from 1 to 9999/ }, 'move refuses a number past 9999');
await expectError(db, 'select * from move_episode($1, $2, 0, 1, false, null)', [FP_EP[0], FP], { code: '22023', re: /seasons are numbered from 1/ }, 'move refuses a season under 1');
await expectError(db, 'select * from move_episode($1, $2, 1, null, false, null)', [NB_EP.lastCall, NB], { code: '22023', re: /is declined and has no place to move/ }, 'move refuses a declined episode (it goes back to review first)');
await expectError(db, 'select * from move_episode($1, $2, 1, null, false, null)', [NB_EP.oldCut, NB], { code: '22023', re: /is withdrawn and has no place to move/ }, 'move refuses a withdrawn episode (kept for its buyers)');
rows = await move(FP_EP[0], FP, null, null);
assert.deepEqual(rows.map((r) => [r.id, r.season, r.old_series_order, r.series_order]), [[FP_EP[0], 1, 1, 3]]);
ok('no season = its own season; no number = the next free one (E3 after E2)');
rows = await move(FP_EP[0], FP, 1, 3);
assert.deepEqual(rows.map((r) => [r.id, r.old_series_order, r.series_order]), [[FP_EP[0], 3, 3]]);
ok('moving an episode to where it already is changes nothing and says so');
await move('last-light-dusk-lxn2', LL, 1, 3);
assert.equal((await pos(db, 'last-light-dusk-lxn2')).series_order, 3);
ok('move may land on a number only a declined episode holds');
rows = await move(NB_EP.terminus, NB, 2, null, false, NB);
assert.deepEqual(rows.map((r) => [r.id, r.season, r.series_order]), [[NB_EP.terminus, 2, 6]]);
ok('moving to another season of the same show takes one past that season\'s highest number (E6 after E5)');
rows = await move(FAR, NB, 1, null, false, NB);
assert.deepEqual(rows.map((r) => [r.id, r.season, r.series_order]), [[FAR, 1, 4]]);
ok('the numbers 118 parked at 1006–1008 are outside the running order: the next free one in Night Bus S1 is E4, not E1009');
await unchanged('a parked holder', () => expectError(db, 'select * from move_episode($1, $2, 1, 1007, true, null)', [NB_EP.newRoute, NB], { code: '22023', re: /E1007 of season 1 in night-bus-lx1 sits outside the running order/ }, 'an insert onto a parked number is refused (it needs its own number first), and changes nothing'));
rows = await move(NB_EP.newRoute, NB, 1, 2, true, NB);
assert.deepEqual(rows.map((r) => [r.id, r.old_season, r.old_series_order, r.season, r.series_order]), [
  [NB_EP.newRoute, 2, 4, 1, 2],
  [NB_EP.longWay, 1, 2, 1, 3],
  [NB_EP.redLine, 1, 3, 1, 4],
  [FAR, 1, 4, 1, 5]
]);
for (const [id, want] of [[NB_EP.overnight, 1006], [NB_EP.transfer, 1007], [NB_EP.recut, 1008], [NB_EP.lastStop, 1]]) assert.equal((await pos(db, id)).series_order, want, id);
ok('an insert slides the running order only: the parked 1006–1008 and E1 stay put');

// --- 14. both functions against planMove (lib/showRules.js) on the same rows ---------------------
// The page announces what planMove plans; the database must write exactly
// that. Each case reads the show's rows, plans with planMove, runs the
// function, and compares every place that changed.
const PAR = 'parity-lx1';
// Not public yet, so the second run below has nothing of it to fill in.
await addShow(db, { id: PAR, name: 'Parity', status: 'pending', creatorId: 'user_pat' });
const parEp = async (id, season, order, extra = {}) => addEpisode(db, { id, title: id, show: PAR, season, order, by: 'user_pat', created: extra.created, ...extra });
await parEp('parity-one-lxp1', 1, 1, { created: '2026-09-01T00:00:00Z' });
await parEp('parity-two-lxp2', 1, 2, { created: '2026-09-02T00:00:00Z' });
await parEp('parity-four-lxp4', 1, 4, { created: '2026-09-04T00:00:00Z' });
await parEp('parity-five-lxp5', 1, 5, { created: '2026-09-05T00:00:00Z' });
await parEp('parity-six-lxp6', 1, 6, { created: '2026-09-06T00:00:00Z' });
await parEp('parity-parked-lxpp', 1, 1100, { created: '2026-09-07T00:00:00Z' });
await parEp('parity-loose-lxpu', 1, null, { status: 'pending', created: '2026-09-08T00:00:00Z' });
await parEp('parity-s2-one-lxq1', 2, 1, { created: '2026-09-09T00:00:00Z' });
await parEp('parity-s2-two-lxq2', 2, 2, { created: '2026-09-10T00:00:00Z' });
const showRows = () => all(db, 'select id, title, season, series_order, status, content_type, withdrawn_at, created_at from episodes where series_id = $1', [PAR]);
const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
async function parity(name, { id, target, opts = {}, args }) {
  const plan = planMove(await showRows(), id, target, opts);
  assert.equal(plan.ok, true, `${name}: planMove refused: ${JSON.stringify(plan)}`);
  const got = await move(id, PAR, ...args);
  const wrote = got.filter((r) => r.series_order !== r.old_series_order || r.season !== r.old_season || r.series_id !== r.old_series_id)
    .map((r) => ({ id: r.id, season: r.season, number: r.series_order })).sort(byId);
  const planned = plan.writes.map((w) => ({ id: w.id, season: w.season, number: w.number })).sort(byId);
  assert.deepEqual(wrote, planned, `${name}: move_episode wrote ${JSON.stringify(wrote)}, planMove planned ${JSON.stringify(planned)}`);
  ok(`${name} (move_episode writes what planMove planned: ${plan.words})`);
  return plan;
}
const at = async (id) => (await pos(db, id)).series_order;
await parity('an insert inside its season rotates through the held numbers, the gap at E3 kept', { id: 'parity-six-lxp6', target: { season: 1, number: 2, mode: 'insert' }, args: [1, 2, true, PAR] });
assert.deepEqual([await at('parity-six-lxp6'), await at('parity-two-lxp2'), await at('parity-four-lxp4'), await at('parity-five-lxp5'), await at('parity-parked-lxpp')], [2, 4, 5, 6, 1100]);
await parity('an insert from another season slides the rest along', { id: 'parity-s2-one-lxq1', target: { season: 1, number: 2, mode: 'insert' }, args: [1, 2, true, PAR] });
assert.deepEqual([await at('parity-s2-one-lxq1'), await at('parity-six-lxp6'), await at('parity-two-lxp2'), await at('parity-four-lxp4'), await at('parity-five-lxp5')], [2, 4, 5, 6, 7]);
await parity('the end of a season is one past its running order (the parked E1100 aside)', { id: 'parity-s2-two-lxq2', target: { season: 1 }, args: [1, null, false, PAR] });
assert.equal(await at('parity-s2-two-lxq2'), 8);
await parity('a move out of a season with closeGap pulls the rows after it up', { id: 'parity-two-lxp2', target: { season: 2 }, opts: { closeGap: true }, args: [2, null, false, PAR, true] });
assert.deepEqual([(await pos(db, 'parity-two-lxp2')).season, await at('parity-two-lxp2'), await at('parity-four-lxp4'), await at('parity-five-lxp5'), await at('parity-s2-two-lxq2')], [2, 1, 5, 6, 7]);
await parity('the end of its own season', { id: 'parity-one-lxp1', target: { season: 1 }, args: [1, null, false, PAR] });
await parity('a free number in a new season', { id: 'parity-six-lxp6', target: { season: 3, number: 5 }, args: [3, 5, false, PAR] });
await parity('an insert moving down its own season', { id: 'parity-s2-one-lxq1', target: { season: 1, number: 6, mode: 'insert' }, args: [1, 6, true, PAR] });
const refusedPlan = planMove(await showRows(), 'parity-four-lxp4', { season: 1, number: 1100, mode: 'insert' });
assert.equal(refusedPlan.ok, false);
assert.equal(refusedPlan.code, 'parked');
await unchanged('parity: a parked holder', () => expectError(db, 'select * from move_episode($1, $2, 1, 1100, true, $2)', ['parity-four-lxp4', PAR], { code: '22023', re: /sits outside the running order/ }, 'both refuse an insert onto a parked number'));
const swapPlan = planMove(await showRows(), 'parity-four-lxp4', { season: 1, number: 6, mode: 'swap' });
assert.equal(swapPlan.ok, true);
rows = await reorder(swapPlan.season, swapPlan.ids, swapPlan.numbers, PAR);
assert.deepEqual(rows.map((r) => ({ id: r.id, season: r.season, number: r.series_order })).sort(byId), swapPlan.writes.map((w) => ({ id: w.id, season: w.season, number: w.number })).sort(byId));
ok(`a same-season plan (a swap) goes through reorder_show_season with planMove's own ids and numbers (${swapPlan.words})`);

// --- who may call them ---------------------------------------------------------------------------
const FNS = ['public.reorder_show_season(text, integer, text[], integer[])', 'public.move_episode(text, text, integer, integer, boolean, text, boolean)'];
async function checkPrivileges(label) {
  for (const fn of FNS) {
    for (const [role, want] of [['anon', false], ['authenticated', false], ['service_role', true], ['public', false]]) {
      const got = role === 'public'
        ? (await one(db, `select exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where p.oid = $1::regprocedure and a.grantee = 0) x`, [fn])).x
        : (await one(db, `select has_function_privilege($1, $2, 'execute') x`, [role, fn])).x;
      assert.equal(got, want, `${label}: ${role} execute ${fn}`);
    }
    const def = await one(db, `select prosecdef, proconfig from pg_proc where oid = $1::regprocedure`, [fn]);
    assert.equal(def.prosecdef, true, `${fn} is security definer`);
    assert.deepEqual(def.proconfig, ['search_path=""'], `${fn} pins an empty search_path`);
  }
}
await checkPrivileges('after the first run');
ok('both functions are security definer with an empty search_path; only service_role may execute them (not PUBLIC, anon or authenticated)');
for (const role of ['anon', 'authenticated']) {
  try {
    await db.exec(`set role ${role}`);
    await expectError(db, 'select * from reorder_show_season($1, 1, $2, null)', [FP, [FP_EP[1]]], { code: '42501', re: /permission denied for function reorder_show_season/ }, `${role} cannot run reorder_show_season`);
    await expectError(db, 'select * from move_episode($1, $2, 1, 2, false, null)', [FP_EP[1], FP], { code: '42501', re: /permission denied for function move_episode/ }, `${role} cannot run move_episode`);
  } finally {
    await db.exec('reset role');
  }
}
try {
  await db.exec('set role service_role');
  rows = await all(db, 'select * from move_episode($1, $2, 1, 2, false, $2)', [FP_EP[1], FP]);
  assert.equal(rows[0].series_order, 2);
  rows = await all(db, 'select * from reorder_show_season($1, 1, $2, $3)', [FP, [FP_EP[1]], [2]]);
  assert.equal(rows[0].series_order, 2);
} finally {
  await db.exec('reset role');
}
ok('service_role runs both (they act as their owner, so it needs no grant on episodes)');

// --- 15. payees ----------------------------------------------------------------------------------
await db.query(`insert into payee_invites (title_type, title_id, invitee_id, invited_by) values ('series', $1, 'user_zed', 'user_mara')`, [NB]);
await expectError(db, `insert into payee_invites (title_type, title_id, invitee_id, invited_by) values ('series', $1, 'user_yan', 'user_mara')`, [NB], { code: '23505', re: /payee_invites_one_pending_idx/ }, 'a second pending invite for the same show is refused');
await db.query(`insert into payee_invites (title_type, title_id, invitee_id, invited_by) values ('episode', $1, 'user_yan', 'user_mara')`, [NB_EP.lastStop]);
await db.query(`update payee_invites set status = 'declined', decided_at = now() where title_type = 'series' and title_id = $1 and status = 'pending'`, [NB]);
await db.query(`insert into payee_invites (title_type, title_id, invitee_id, invited_by) values ('series', $1, 'user_yan', 'user_mara')`, [NB]);
const invites = await all(db, `select title_type, invitee_id, status from payee_invites order by created_at, invitee_id`);
assert.equal(invites.length, 3);
assert.equal(invites.filter((i) => i.status === 'pending').length, 2);
ok('one pending invite per title: an episode of the same show can have its own, and a new one is allowed once the first is decided');
await expectError(db, `insert into payee_invites (title_type, title_id, invitee_id, invited_by, status) values ('series', $1, 'user_x', 'user_mara', 'maybe')`, [FP], { code: '23514' }, 'an invite is pending, accepted, declined or cancelled');
await expectError(db, `insert into payee_invites (title_type, title_id, invitee_id, invited_by) values ('movie', $1, 'user_x', 'user_mara')`, [MOVIE], { code: '23514' }, 'an invite is for a series or an episode');
const invite = await one(db, `select id, created_at, decided_at from payee_invites limit 1`);
assert.match(invite.id, /^[0-9a-f-]{36}$/);
ok('an invite gets a uuid and its created_at by itself');

await db.query(`insert into title_payees (title_type, title_id, payee_id, from_at, set_by) values ('episode', $1, 'user_mara', '2026-09-01T12:00:00Z', 'migration')`, [NB_EP.lastStop]);
await expectError(db, `insert into title_payees (title_type, title_id, payee_id, set_by) values ('episode', $1, 'user_zed', 'user_mara')`, [NB_EP.lastStop], { code: '23505', re: /title_payees_one_open_idx/ }, 'a second open payee row for a title is refused');
await db.query(`update title_payees set to_at = '2026-11-01T00:00:00Z' where title_type = 'episode' and title_id = $1 and to_at is null`, [NB_EP.lastStop]);
await db.query(`insert into title_payees (title_type, title_id, payee_id, from_at, set_by) values ('episode', $1, 'user_zed', '2026-11-01T00:00:00Z', 'user_mara')`, [NB_EP.lastStop]);
const periods = await all(db, `select payee_id, from_at, to_at from title_payees where title_id = $1 order by from_at`, [NB_EP.lastStop]);
assert.deepEqual(periods.map((p) => [p.payee_id, iso(p.from_at), iso(p.to_at)]), [['user_mara', '2026-09-01T12:00:00.000Z', '2026-11-01T00:00:00.000Z'], ['user_zed', '2026-11-01T00:00:00.000Z', null]]);
ok('one open payee row per title: closing it lets the next one open, and the record shows who was paid from when to when');
await expectError(db, `insert into title_payees (title_type, title_id, payee_id, from_at, to_at) values ('series', $1, 'user_x', '2026-11-02', '2026-11-01')`, [FP], { code: '23514', re: /title_payees_period/ }, 'a payee period cannot end before it starts');

await db.query(`insert into series_drop_runs (series_id, last_episode_seen, customer_cursor) values ($1, now(), 'cus_123'), ('*', null, 'cus_456')`, [NB]);
await expectError(db, `insert into series_drop_runs (series_id) values ($1)`, [NB], { code: '23505' }, 'series_drop_runs keeps one row per show (and can hold a shared cursor row)');

const rls = await all(db, `select relname, relrowsecurity from pg_class where relnamespace = 'public'::regnamespace and relname in ('series', 'episodes', 'payee_invites', 'title_payees', 'series_drop_runs') order by relname`);
assert.deepEqual(rls.map((r) => [r.relname, r.relrowsecurity]), [['episodes', true], ['payee_invites', true], ['series', true], ['series_drop_runs', true], ['title_payees', true]]);
ok('row level security is on for every table 118 creates or changes');
for (const t of ['payee_invites', 'title_payees', 'series_drop_runs']) {
  for (const priv of ['select', 'insert', 'update', 'delete']) {
    assert.equal((await one(db, `select has_table_privilege('anon', $1, $2) x`, [`public.${t}`, priv])).x, false, `anon ${priv} ${t}`);
    assert.equal((await one(db, `select has_table_privilege('authenticated', $1, $2) x`, [`public.${t}`, priv])).x, false, `authenticated ${priv} ${t}`);
    assert.equal((await one(db, `select has_table_privilege('service_role', $1, $2) x`, [`public.${t}`, priv])).x, true, `service_role ${priv} ${t}`);
  }
}
ok('the three new tables are closed to anon and authenticated and open to service_role');
assert.match(SQL, /notify pgrst, 'reload schema';/);
ok('118 asks PostgREST to reload its schema');

// --- run 118 a second time ---------------------------------------------------------------------
const SNAP = [
  'select * from series order by id',
  'select * from episodes order by id',
  'select * from payee_invites order by id',
  'select * from title_payees order by id',
  'select * from series_drop_runs order by series_id',
  `select indexname, indexdef from pg_indexes where schemaname = 'public' and tablename in ('series', 'episodes', 'payee_invites', 'title_payees', 'series_drop_runs') order by indexname`,
  `select conname, pg_get_constraintdef(oid) d from pg_constraint where conrelid in ('public.series'::regclass, 'public.episodes'::regclass) order by conname`,
  `select proname, pg_get_functiondef(oid) d from pg_proc where proname in ('reorder_show_season', 'move_episode') order by proname`
];
const snapshot = async () => JSON.stringify(await Promise.all(SNAP.map((q) => all(db, q))));
const before = await snapshot();
const second = await run118(db);
ok('118 runs a second time without an error');
assert.equal(await snapshot(), before);
ok('…and every show, episode, invite, payee row, index, constraint and function is exactly as it was');
const secondTopics = [...new Set(second.notes.map((x) => x.topic))].sort();
assert.deepEqual(secondTopics, ['done', 'unowned']);
assert.equal(topics(second.notes, 'unowned').length, 3);
assert.equal(second.notes[second.notes.length - 1].line, 'Migration 118 finished; the lines above say what it changed or still needs.');
assert.deepEqual(second.report, second.notes);
ok('the second run moves nothing (no renumbered, unnumbered, private, ready, owner, kind, defaults, season or public lines); it only lists the shows still without an owner');
await checkPrivileges('after the second run');
ok('the functions keep their grants after the second run');

// Shows approved after 118 by code that doesn't stamp public_at yet (the
// review queue's series card, Accept, a manual episode): a later run fills
// it in for one with an approved episode, and never makes a show private.
await addShow(db, { id: 'late-show-lxl1', name: 'Late Show', creatorId: 'user_lee' });
await addEpisode(db, { id: 'late-show-one-lxl1a', title: 'One', show: 'late-show-lxl1', order: 1, by: 'user_lee', created: '2026-11-01T10:00:00Z' });
await addShow(db, { id: 'late-empty-lxl2', name: 'Late Empty', creatorId: 'user_lee' });
const third = await run118(db);
assert.deepEqual(await one(db, `select status, public_at from series where id = 'late-show-lxl1'`), { status: 'approved', public_at: new Date('2026-11-01T10:00:00Z') });
assert.deepEqual(topics(third.notes, 'public').map((x) => x.line), ['1 approved show with an approved episode stays public; public_at is the first episode\'s release.']);
assert.deepEqual(await one(db, `select status, public_at from series where id = 'late-empty-lxl2'`), { status: 'approved', public_at: null });
assert.equal(topics(third.notes, 'private').length, 0);
ok('a later run fills public_at for a show approved since without one, and makes no show private (that happens on the first run only)');

// =============================================================================
// The guard: on a database where two episodes still share a number when the
// index is made, 118 must stop, name them, and keep nothing.
const gdb = await buildDb(117);
await gdb.query(`insert into series (id, name, status, creator_id) values ('echo-lx1', 'Echo', 'approved', 'user_mara'), ('odd-one-lx2', 'Odd One', 'draft', 'user_mara')`);
await gdb.query(`insert into episodes (id, title, content_type, series_id, season, series_order, status, submitted_by, created_at, released_at) values
  ('echo-first-lx1a', 'First', 'series', 'echo-lx1', 1, 2, 'approved', 'user_mara', '2026-09-01T10:00:00Z', '2026-09-01T10:00:00Z'),
  ('echo-second-lx1b', 'Second', 'series', 'echo-lx1', 1, 2, 'approved', 'user_mara', '2026-09-02T10:00:00Z', '2026-09-02T10:00:00Z')`);
const i10 = SQL.indexOf('\n-- 10. ');
const i11 = SQL.indexOf('\n-- 11. ');
assert.ok(i10 > 0 && i11 > i10, 'found sections 10 and 11');
assert.match(SQL.slice(i10, i11), /row_number\(\)/);
const withoutShove = SQL.slice(0, i10) + SQL.slice(i11);
let stopped = null;
try {
  await gdb.exec(withoutShove);
} catch (err) {
  stopped = err;
}
assert.ok(stopped, 'the run without the de-duplication must stop');
assert.match(stopped.message, /Migration 118 stopped before the unique index: these episodes still share a number: echo-lx1 season 1 E2: echo-first-lx1a, echo-second-lx1b/);
ok('with the de-duplication cut out, 118 stops before the index and names the two episodes on E2');
const afterFail = await one(gdb, `select
  exists (select 1 from information_schema.columns where table_name = 'series' and column_name = 'kind') kind_col,
  exists (select 1 from pg_indexes where indexname = 'episodes_show_position_uq') idx,
  to_regclass('public.payee_invites') is not null invites,
  (select string_agg(id || ':' || series_order, ',' order by id) from episodes) nums`);
assert.deepEqual(afterFail, { kind_col: false, idx: false, invites: false, nums: 'echo-first-lx1a:2,echo-second-lx1b:2' });
ok('…and keeps nothing: no new column, no index, no new table, the numbers as they were (one transaction)');

const g1 = await run118(gdb);
assert.equal((await pos(gdb, 'echo-second-lx1b')).series_order, 1003);
assert.equal((await pos(gdb, 'echo-first-lx1a')).series_order, 2);
assert.deepEqual(topics(g1.notes, 'renumbered').map((x) => x.line), ['Echo (echo-lx1) season 1: "Second" (echo-second-lx1b) moved from E2 to E1003; E2 stays with "First" (echo-first-lx1a).']);
ok('the whole of 118 on the same database moves the newer of two live episodes to 2 + 1000 + 1 and builds the index');
assert.equal(await one(gdb, `select 1 x from pg_constraint where conname = 'series_status_check'`), undefined);
assert.deepEqual(topics(g1.notes, 'check').map((x) => x.line), ['The status check was not added: odd-one-lx2 (draft). A show is pending, approved or rejected; set these by hand and run 118 again.']);
assert.equal((await one(gdb, `select status from series where id = 'odd-one-lx2'`)).status, 'draft');
ok('a show with a status the site does not know keeps it, the check is not added, and the notice names it');
await gdb.query(`update series set status = 'pending' where id = 'odd-one-lx2'`);
const g2 = await run118(gdb);
assert.ok(await one(gdb, `select 1 x from pg_constraint where conname = 'series_status_check'`));
assert.equal(topics(g2.notes, 'check').length, 0);
await expectError(gdb, `update series set status = 'draft' where id = 'odd-one-lx2'`, [], { code: '23514' }, 'once the odd status is fixed, the next run adds the check');

// =============================================================================
// Jose may run 118 before 116 and 117 (116 still waits on him): it needs
// nothing from either. On an empty database at 115 it runs and says so.
const edb = await buildDb(115);
const empty = await run118(edb);
assert.deepEqual(empty.report, [{ topic: 'done', line: 'Migration 118 finished; nothing needed changing.' }]);
assert.ok(await one(edb, `select 1 x from pg_indexes where indexname = 'episodes_show_position_uq'`));
assert.ok(await one(edb, `select 1 x from pg_proc where proname = 'move_episode'`));
ok('118 runs on an empty database built only to 115 (before 116 and 117) and reports nothing to change');

console.log(`\n${n} checks passed`);
