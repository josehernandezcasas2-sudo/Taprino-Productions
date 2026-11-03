// Migration 117 (title ids are text) on a real Postgres: builds the database
// from schema.sql and every migration through 116, shows the bug (a title's
// text id refused by the uuid columns of 097/103), runs 117, then exercises
// the writes and reads Buy to own and ad share make with real title ids,
// re-runs 117, and checks who may call record_ad_impression.
// Needs PGlite (see scripts/pg-chain.mjs): node scripts/check-migration-117.mjs
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { buildDb, runMigration } from './pg-chain.mjs';
import { adShareLines } from '../lib/adShareRules.js';

let n = 0;
const ok = (name) => { n += 1; console.log('ok', name); };
const EP = 'night-bus-last-stop-lx3k9a';
const EP2 = 'the-long-way-lx3k9b';
const SERIES = 'night-bus-lx1';
const LEGACY = '0b9f3c2e-5a61-4d0e-9a7b-1c2d3e4f5a6b';
const UUID_ERR = /invalid input syntax for type uuid/i;

// Same as lib/adShare.js adShareLineId (copied so this file needs no Supabase client).
function adShareLineId(episodeId, period) {
  const h = createHash('sha1').update(`ad_share:${episodeId}:${period}`).digest('hex');
  const v = ((parseInt(h[16], 16) & 3) | 8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${v}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

async function expectError(db, sql, params, re, name) {
  try {
    await db.query(sql, params);
  } catch (err) {
    assert.match(err.message, re, `${name}: ${err.message}`);
    ok(name);
    return;
  }
  throw new Error(`${name}: expected an error, the statement ran`);
}

const db = await buildDb(116);
ok('schema.sql + migrations 002–116 run on a fresh Postgres');

// --- the titles and ads the money paths point at ---------------------------
await db.query(`insert into series (id, name, creator_id, status) values ($1, 'Night Bus', 'user_mara', 'approved')`, [SERIES]);
await db.query(`insert into episodes (id, title, content_type, series_id, status, submitted_by) values ($1, 'Last Stop', 'series', $2, 'approved', 'user_mara'), ($3, 'The Long Way', 'series', $2, 'approved', 'user_mara')`, [EP, SERIES, EP2]);
const houseAd = (await db.query(`insert into house_ads (title, video_url, duration_seconds) values ('Studio promo', 'https://example.test/promo.mp4', 15) returning id`)).rows[0].id;
const account = (await db.query(`insert into ad_accounts (user_id, company_name, contact_email) values ('user_cafe', 'Corner Cafe', 'cafe@example.test') returning id`)).rows[0].id;
const paidAd = (await db.query(`insert into house_ads (title, video_url, duration_seconds, ad_account_id, cost_per_impression_cents) values ('Corner Cafe 15s', 'https://example.test/cafe.mp4', 15, $1, 3) returning id`, [account])).rows[0].id;
ok('seeded a show, two episodes with slug ids, a house ad and an advertiser ad');

// --- before 117: the bug ------------------------------------------------------
await expectError(db, `insert into title_prices (target_type, target_id, creator_id, pending_cents, status) values ('episode', $1, 'user_mara', 199, 'pending')`, [EP], UUID_ERR, 'before 117: saving a price for a real episode is refused');
await expectError(db, `select * from title_prices where target_type = 'episode' and target_id in ($1)`, [EP], UUID_ERR, 'before 117: looking up a real episode\'s price is refused (no Buy card)');
await expectError(db, `select record_ad_impression($1, $2, 'vod')`, [paidAd, EP], UUID_ERR, 'before 117: an ad play inside a real episode is refused');
await db.query(`insert into title_prices (target_type, target_id, creator_id, price_cents, status) values ('series', $1, 'user_old', 499, 'on')`, [LEGACY]);
ok('before 117: a uuid-shaped id still fits (kept to check it survives the change)');

// --- run 117 ------------------------------------------------------------------
const file = await runMigration(db, 117);
ok(`ran ${file}`);

const types = (await db.query(`select table_name, column_name, data_type from information_schema.columns where (table_name, column_name) in (('title_prices','target_id'), ('purchases','target_id'), ('ad_impression_days','episode_id'), ('creator_ledger','episode_id')) order by 1`)).rows;
assert.equal(types.length, 4);
for (const t of types) assert.equal(t.data_type, 'text', `${t.table_name}.${t.column_name} is ${t.data_type}`);
ok('the four title columns are text');

// --- Buy to own after 117 -----------------------------------------------------
await db.query(`insert into title_prices (target_type, target_id, creator_id, pending_cents, status, requested_at) values ('episode', $1, 'user_mara', 199, 'pending', now())`, [EP]);
await db.query(`insert into title_prices (target_type, target_id, creator_id, price_cents, status) values ('episode', $1, 'user_mara', 199, 'on') on conflict (target_type, target_id) do update set price_cents = excluded.price_cents, pending_cents = null, status = excluded.status`, [EP]);
const prices = (await db.query(`select target_id, price_cents, status from title_prices where target_type = 'episode' and target_id in ($1, $2)`, [EP, EP2])).rows;
assert.deepEqual(prices, [{ target_id: EP, price_cents: 199, status: 'on' }]);
ok('a price is saved, approved through the upsert the code uses, and found again (one row per title)');
await expectError(db, `insert into title_prices (target_type, target_id, creator_id, price_cents, status) values ('episode', $1, 'user_mara', 299, 'on')`, [EP], /duplicate key value/i, 'one price row per title is still enforced');

await db.query(`insert into purchases (buyer_id, target_type, target_id, creator_id, title, price_cents, paid_cents, fee_cents, creator_cents, platform_cents, status) values ('user_viewer', 'episode', $1, 'user_mara', 'Last Stop', 199, 199, 36, 130, 69, 'completed'), ('user_viewer', 'series', $2, 'user_mara', 'Night Bus', 999, 999, 59, 752, 247, 'completed')`, [EP, SERIES]);
const owned = (await db.query(`select target_type, target_id from purchases where buyer_id = 'user_viewer' and status = 'completed' order by target_type`)).rows;
assert.deepEqual(owned, [{ target_type: 'episode', target_id: EP }, { target_type: 'series', target_id: SERIES }]);
const buyers = (await db.query(`select count(*)::int c from purchases where target_type = 'episode' and target_id = $1 and status = 'completed'`, [EP])).rows[0].c;
assert.equal(buyers, 1);
ok('purchases of an episode and a whole series are recorded and found by title');

// --- ad share after 117 -------------------------------------------------------
for (let i = 0; i < 2; i += 1) await db.query(`select record_ad_impression($1, $2, 'vod')`, [houseAd, EP]);
for (let i = 0; i < 3; i += 1) await db.query(`select record_ad_impression($1, $2, 'preroll')`, [paidAd, EP]);
await db.query(`select record_ad_impression($1, $2, 'vod')`, [paidAd, EP2]);
const days = (await db.query(`select ad_id, episode_id, surface, impressions, credit_cents::float credit from ad_impression_days order by episode_id, surface`)).rows;
const house = days.find((d) => d.ad_id === houseAd);
const paid = days.find((d) => d.ad_id === paidAd && d.episode_id === EP);
assert.equal(house.episode_id, EP); assert.equal(house.impressions, 2); assert.equal(house.credit, 0);
assert.equal(paid.impressions, 3); assert.equal(paid.credit, 9);
ok('ad plays inside real episodes are counted per ad, title, surface and day (house ad free, advertiser 3¢ each)');

const period = (await db.query(`select to_char(current_date, 'YYYY-MM') p`)).rows[0].p;
const rows = (await db.query(`select episode_id, impressions, credit_cents from ad_impression_days where day >= date_trunc('month', current_date)`)).rows;
const episodes = {
  [EP]: { id: EP, title: 'Last Stop', creatorId: 'user_mara', contentType: 'series' },
  [EP2]: { id: EP2, title: 'The Long Way', creatorId: 'user_mara', contentType: 'series' }
};
const planned = adShareLines({ rows, episodes, percent: 50, period, createdBy: 'check-117' });
assert.equal(planned.lines.length, 2, JSON.stringify(planned.skipped));
const lines = planned.lines.map((l) => ({ ...l, id: adShareLineId(l.episode_id, period) }));
for (const l of lines) {
  await db.query(`insert into creator_ledger (id, creator_id, lane, kind, cents, moves_money, basis, episode_id, units, period, note, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [l.id, l.creator_id, l.lane, l.kind, l.cents, l.moves_money, l.basis, l.episode_id, l.units, l.period, l.note, l.created_by]);
}
const credited = (await db.query(`select episode_id, cents, units from creator_ledger where kind = 'ad_share' order by episode_id`)).rows;
assert.deepEqual(credited.map((c) => c.episode_id), planned.lines.map((l) => l.episode_id));
assert.equal(credited.find((c) => c.episode_id === EP).cents, 4); // 9¢ × 50% = 4.5 → 4
assert.equal(credited.find((c) => c.episode_id === EP).units, 5); // 2 house + 3 paid plays
assert.equal(credited.find((c) => c.episode_id === EP2).cents, 1); // 3¢ × 50% = 1.5 → 1
ok('the month\'s ad share lines are written to the ledger against the real title id (Last Stop: 9¢ served → 4¢; The Long Way: 3¢ → 1¢)');
await expectError(db, `insert into creator_ledger (id, creator_id, lane, kind, cents, episode_id, period) values ($1, 'user_mara', 'earnings', 'ad_share', 4, $2, $3)`, [lines[0].id, EP, period], /duplicate key value/i, 'a re-run of the month credits nothing twice (same line id)');

// --- the function, its privileges, and a second run of 117 --------------------
const sigs = (await db.query(`select pg_get_function_identity_arguments(oid) a from pg_proc where proname = 'record_ad_impression'`)).rows.map((r) => r.a);
assert.deepEqual(sigs, ['p_ad uuid, p_episode text, p_surface text']);
ok('only the text version of record_ad_impression exists');
const priv = async (role) => (await db.query(`select has_function_privilege($1, 'record_ad_impression(uuid, text, text)', 'execute') p`, [role])).rows[0].p;
assert.equal(await priv('anon'), false);
assert.equal(await priv('authenticated'), false);
assert.equal(await priv('service_role'), true);
ok('only the service role may call it (anon and authenticated may not)');

const before = (await db.query(`select (select count(*) from title_prices)::int a, (select count(*) from purchases)::int b, (select count(*) from ad_impression_days)::int c, (select count(*) from creator_ledger)::int d`)).rows[0];
await runMigration(db, 117);
const after = (await db.query(`select (select count(*) from title_prices)::int a, (select count(*) from purchases)::int b, (select count(*) from ad_impression_days)::int c, (select count(*) from creator_ledger)::int d`)).rows[0];
assert.deepEqual(after, before);
await db.query(`select record_ad_impression($1, $2, 'vod')`, [houseAd, EP]);
ok('117 runs a second time without an error and leaves the rows as they were');

const legacy = (await db.query(`select target_id from title_prices where target_type = 'series'`)).rows[0].target_id;
assert.equal(legacy, LEGACY);
ok('a value stored before the change keeps its exact text');

// --- the database of 2026-11-03: everything through 116 but 103 -------------
// 117 first stopped at "relation ad_impression_days does not exist". Build
// that database (the chain to 116 with 103 left out), show 117 now names
// 103 and changes nothing, then run 103 (after 112, as it will be there)
// and 117, and check ad share works and its table has row level security.
{
  const { migrationFiles, runFile, SUPABASE_DIR } = await import('./pg-chain.mjs');
  const path = await import('node:path');
  const { PGlite } = await import('@electric-sql/pglite');
  const gap = new PGlite();
  await gap.exec('create role anon; create role authenticated; create role service_role;');
  await runFile(gap, path.join(SUPABASE_DIR, 'schema.sql'));
  for (const f of migrationFiles()) {
    const m = Number(f.slice(0, 3));
    if (m > 116 || m === 103) continue;
    await runFile(gap, path.join(SUPABASE_DIR, 'migrations', f));
  }
  ok('a database with every migration through 116 except 103');
  try {
    await runMigration(gap, 117);
    throw new Error('117 ran without 103');
  } catch (err) {
    assert.match(err.message, /117 needs migration 103 \(Ad share\) first/);
  }
  const t = await gap.query(`select data_type from information_schema.columns where table_name = 'title_prices' and column_name = 'target_id'`);
  assert.equal(t.rows[0].data_type, 'uuid');
  ok('117 without 103 stops with "117 needs migration 103 (Ad share) first" and changes nothing');

  await runMigration(gap, 103);
  const before = await gap.query(`select relrowsecurity from pg_class where relname = 'ad_impression_days'`);
  assert.equal(before.rows[0].relrowsecurity, false);
  ok('103 run after 112 makes ad_impression_days without row level security');
  await runMigration(gap, 117);
  const after = await gap.query(`select relrowsecurity from pg_class where relname = 'ad_impression_days'`);
  assert.equal(after.rows[0].relrowsecurity, true);
  const cols = await gap.query(`select table_name, data_type from information_schema.columns where (table_name, column_name) in (('title_prices','target_id'),('purchases','target_id'),('ad_impression_days','episode_id'),('creator_ledger','episode_id')) order by 1`);
  assert.deepEqual(cols.rows.map((r) => r.data_type), ['text', 'text', 'text', 'text']);
  const ad = (await gap.query(`insert into house_ads (title, video_url, duration_seconds) values ('Studio promo', 'https://example.test/promo.mp4', 15) returning id`)).rows[0].id;
  await gap.query(`select record_ad_impression($1, $2, 'vod')`, [ad, EP]);
  const plays = await gap.query(`select impressions from ad_impression_days where episode_id = $1`, [EP]);
  assert.equal(plays.rows[0].impressions, 1);
  ok('then 117 runs: the four columns are text, ad plays count against a real title, and the table has row level security');
  const grants = await gap.query(`select has_table_privilege('anon', 'ad_impression_days', 'select') as anon_reads`);
  assert.equal(grants.rows[0].anon_reads, false);
  ok('the anon key cannot read ad_impression_days (112\'s default privileges cover a table made after it)');
}

console.log(`\n${n} checks passed`);
