#!/usr/bin/env node
// Season art and the newest season as the hero (migration 122:
// series.season_art / pending_season_art / newest_season_hero;
// lib/seasonArt.js). Runs the half that matches the database it finds:
//   after 122  (the rig's default): a picture on a show that was never
//              approved applies at once; on a live show it waits
//              (pending_season_art) and never reaches a viewer; the
//              team's "Waiting for approval" lists each season with its
//              `seen`, approves and denies it (a stale `seen` → 409),
//              the owner takes one back; the jsonb write guards through
//              PostgREST (a second staged season while another waits, and
//              a save whose read went stale answering 409 `changed`); the
//              switch; the series page, /api/series-hub and the /stream
//              hero show the newest released season's live art, never a
//              waiting one and never an unreleased season's; a removal;
//              the admin's own save applies at once;
//   before 122 (RIG_MIGRATE_TO=121 RIG_REBUILD=1 dev/test-rig/start.sh):
//              a season-art save and the switch answer 503
//              migration-122, the show page says so, every page still 200.
//   node dev/test-rig/checks/season-art.mjs
import { spawn } from 'node:child_process';
import { jpegCard } from '../lib/images.mjs';
import { IDS, USERS, RUN, ok, section, runCheck, call, page, sql, rows, q, insert, hasColumn, session, browser, goto, overflowPx, ago, uidFor } from './lib.mjs';

const MARA = session(USERS.mara);
const DEE = session(USERS.dee);
const ADMIN = session(USERS.admin);

const ID = {
  live: `ck-sa-live-${RUN}`,
  priv: `ck-sa-priv-${RUN}`,
  l1: `ck-sa-live-s1-${RUN}`,
  l2: `ck-sa-live-s2-${RUN}`,
  l3: `ck-sa-live-s3-${RUN}`,
  p1: `ck-sa-priv-s1-${RUN}`
};
const BASE_HERO = (rows(`select hero_image from public.series where id = ${q(IDS.nightBus)}`)[0] || {}).hero_image || null;
const src = (key) => `https://customer-test.cloudflarestream.com/${uidFor(key)}/manifest/video.m3u8`;

function show(id, extra = {}) {
  return {
    id, name: `Check season show ${id.slice(6, 10)} ${RUN}`, description: 'A show for the season-art check.', creator_id: USERS.mara, release_year: 2026,
    status: 'approved', submitted_by: 'mara@rig.example.com', submitted_by_user_id: USERS.mara, reviewed_by: 'admin@rig.example.com', reviewed_by_user_id: USERS.admin,
    reviewed_at: ago(10), public_at: ago(10), created_at: ago(12), kind: 'series', poster: BASE_HERO, thumbnail: BASE_HERO, hero_image: BASE_HERO,
    defaults: { genre: 'Drama', mainGenre: 'Drama', rating: 'TV-14' },
    seasons: [{ number: 1, name: 'The First' }, { number: 2, name: 'The Second' }, { number: 3, name: 'The Third' }],
    credits: {}, ...extra
  };
}
function ep(id, seriesId, season, extra = {}) {
  return {
    id, title: `Check season ep ${season} ${RUN}`, description: 'A check episode.', tier: 'free', genre: 'Drama', main_genre: 'Drama', content_type: 'series',
    series_id: seriesId, season, series_order: 1, artist: 'Mara Reyes', runtime: '22:00', rating: 'TV-14', release_year: 2026,
    src: src(IDS.nbS1E1), video_type: 'html5', video_provider: 'cloudflare', ads_enabled: true, deletion_requested: false, moderation_hold: false,
    submitted_by: USERS.mara, status: 'approved', reviewed_at: ago(8 - season), released_at: ago(8 - season), created_at: ago(9),
    poster: BASE_HERO, thumbnail: BASE_HERO, ...extra
  };
}

function seed() {
  insert('series', show(ID.live));
  insert('series', show(ID.priv, { status: 'pending', public_at: null, reviewed_at: null, reviewed_by: null, reviewed_by_user_id: null }));
  insert('episodes', ep(ID.l1, ID.live, 1, { featured: true }));
  insert('episodes', ep(ID.l2, ID.live, 2));
  insert('episodes', ep(ID.l3, ID.live, 3, { status: 'pending', reviewed_at: null, released_at: null }));
  insert('episodes', ep(ID.p1, ID.priv, 1, { status: 'pending', reviewed_at: null, released_at: null }));
}
function cleanup() {
  const eps = [ID.l1, ID.l2, ID.l3, ID.p1].map(q).join(', ');
  const shows = [ID.live, ID.priv].map(q).join(', ');
  sql(`delete from public.notifications where episode_id in (${eps}) or href like '%ck-sa-%${RUN}%' or message like '%Check season show%${RUN}%'`);
  sql(`delete from public.audit_log where target_id in (${eps}, ${shows})`);
  sql(`delete from public.orphaned_media where reference like '%series-ck-sa-%${RUN}%'`);
  sql(`delete from public.episodes where id in (${eps})`);
  sql(`delete from public.series where id in (${shows})`);
}

const live = (id) => rows(`select season_art, pending_season_art, newest_season_hero from public.series where id = ${q(id)}`)[0] || {};
const parse = (v) => (typeof v === 'string' ? JSON.parse(v) : v);
const imageOf = (list, n) => ((parse(list) || []).find((x) => x.number === n) || {}).image;
async function picture(label) {
  const buf = await jpegCard({ width: 320, height: 180, title: label });
  return `data:image/jpeg;base64,${buf.toString('base64')}`;
}
const patch = (who, id, body) => call(`/api/show/${encodeURIComponent(id)}`, { who, method: 'PATCH', body });
const hub = (id, who) => call(`/api/series-hub?id=${encodeURIComponent(id)}`, { who });
async function streamHero(id) {
  const r = await call('/api/stream-feed');
  const pool = (r.json && (r.json.heroPool || r.json.heroes)) || [];
  return pool.find((h) => h && h.id === id) || null;
}
// A raw address or its next/image form in a page.
const inPage = (html, url) => Boolean(url) && (html.includes(url) || html.includes(encodeURIComponent(url)));
// The admin's Shows badge (and the app's "N waiting" on its Shows row).
async function showsBadge() {
  const r = await call('/api/admin/queue-counts', { who: ADMIN });
  return r.json ? r.json.shows : null;
}
async function decide(items, decision, note) {
  return call(`/api/admin/show/${encodeURIComponent(ID.live)}`, { who: ADMIN, method: 'POST', body: { action: 'staged', decision, items, ...(note ? { note } : {}) } });
}
async function stagedItems() {
  const r = await call(`/api/admin/show/${encodeURIComponent(ID.live)}`, { who: ADMIN });
  return ((r.json && r.json.staged) || []).filter((i) => typeof i.field === 'string' && i.field.startsWith('seasonArt:'));
}

// A save whose read goes stale: psql locks the row, the app reads it (no
// lock) and blocks on its UPDATE, psql changes season_art and commits, and
// the UPDATE's guard no longer matches → 409 changed.
async function staleSave(body) {
  const changed = JSON.stringify([{ number: 1, image: `${BASE_HERO}?changed-by-psql=${RUN}` }]);
  const script = `begin; select 1 from public.series where id = ${q(ID.live)} for update; select pg_sleep(6); update public.series set season_art = ${q(changed)}::jsonb where id = ${q(ID.live)}; commit;`;
  const child = spawn('psql', ['-h', '127.0.0.1', '-p', '54329', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q', '-c', script], { stdio: 'ignore' });
  const done = new Promise((resolve) => child.on('exit', resolve));
  await new Promise((r) => setTimeout(r, 700));
  const r = await patch(MARA, ID.live, body);
  await done;
  return r;
}

async function after122() {
  section('A show that was never approved: season art applies at once');
  const p1 = await picture(`P1 ${RUN}`);
  let r = await patch(MARA, ID.priv, { seasonArt: [{ number: 1, imageBase64: p1, fileName: 'p1.jpg' }] });
  ok('private show → 200', r.status === 200, `${r.status} ${r.text.slice(0, 200)}`);
  ok('…applied (seasonArt:1), nothing staged', r.json && (r.json.applied || []).includes('seasonArt:1') && !(r.json.staged || []).length, r.json && { a: r.json.applied, s: r.json.staged });
  let row = live(ID.priv);
  ok('…season_art holds it, nothing waits', /^https:\/\//.test(imageOf(row.season_art, 1) || '') && row.pending_season_art === null, row);

  section('A live show: it waits and never reaches a viewer');
  // Warm the route first (the stale-save test below needs a quick read).
  await patch(MARA, ID.live, { newestSeasonHero: true });
  const showsBefore = await showsBadge();
  const s2 = await picture(`S2 ${RUN}`);
  r = await patch(MARA, ID.live, { seasonArt: [{ number: 2, imageBase64: s2, fileName: 's2.jpg' }] });
  ok('live show → 200, staged seasonArt:2', r.status === 200 && r.json && (r.json.staged || []).includes('seasonArt:2'), `${r.status} ${r.text.slice(0, 200)}`);
  row = live(ID.live);
  const waiting2 = imageOf(row.pending_season_art, 2);
  ok('…pending_season_art holds Season 2, season_art still empty', /^https:\/\//.test(waiting2 || '') && (parse(row.season_art) || []).length === 0, row);
  const showsWaiting = await showsBadge();
  ok('the team’s Shows badge counts the show (queue-counts.shows + 1)', showsWaiting === showsBefore + 1, `${showsBefore} → ${showsWaiting}`);
  r = await hub(ID.live);
  ok('/api/series-hub: the show’s own hero, not the waiting picture', r.status === 200 && r.json.seriesInfo.heroImage === BASE_HERO && r.json.seriesInfo.heroSeason === null, r.json && r.json.seriesInfo && r.json.seriesInfo.heroImage);
  ok('/api/series-hub carries nothing of the waiting picture', !r.text.includes(waiting2) && !/pending_?[sS]eason/.test(r.text));
  let html = await page(`/series/${ID.live}`);
  ok('/series page 200 without the waiting picture', html.status === 200 && !inPage(html.text, waiting2), html.status);
  let hero = await streamHero(ID.live);
  ok('/stream hero: the show is there with its own hero', hero && hero.heroImage === BASE_HERO, hero && hero.heroImage);
  r = await call(`/api/show/${encodeURIComponent(ID.live)}`, { who: DEE });
  ok('another creator can’t open the show page (404)', r.status === 404, r.status);
  r = await patch(DEE, ID.live, { seasonArt: [{ number: 1, imageBase64: s2 }] });
  ok('another creator can’t send season art (403/404)', r.status === 403 || r.status === 404, r.status);
  r = await call(`/api/show/${encodeURIComponent(ID.live)}`, { who: MARA });
  ok('the owner’s show page shows Season 2 waiting', r.status === 200 && r.json.show && r.json.show.staged && (r.json.show.staged.seasonArt || []).some((x) => x.number === 2), r.json && r.json.show && r.json.show.staged);

  section('A second season staged while one waits (the pending guard as a jsonb value)');
  const s1 = await picture(`S1 ${RUN}`);
  r = await patch(MARA, ID.live, { seasonArt: [{ number: 1, imageBase64: s1, fileName: 's1.jpg' }] });
  ok('Season 1 staged too → 200', r.status === 200 && (r.json.staged || []).includes('seasonArt:1'), `${r.status} ${r.text.slice(0, 200)}`);
  row = live(ID.live);
  ok('…both wait', (parse(row.pending_season_art) || []).map((x) => x.number).join(',') === '1,2', row.pending_season_art);
  r = await patch(MARA, ID.live, { seasonArt: [{ number: 7, imageBase64: s1 }] });
  ok('a season the show doesn’t have → 400', r.status === 400 && /no Season 7/.test(r.text), `${r.status} ${r.text.slice(0, 160)}`);
  r = await patch(MARA, ID.live, { seasonArt: [{ number: 2, remove: true, imageBase64: s1 }] });
  ok('a picture and a removal at once → 400', r.status === 400, r.status);

  section('In the browser: the admin show page and the owner’s editor');
  {
    const b = await browser();
    try {
      const a = await b.open(ADMIN, 1280);
      await goto(a.page, `/admin/shows/${ID.live}`);
      const card = a.page.locator('text=Season 2 · The Second art').first();
      await card.waitFor({ timeout: 30000 }).catch(() => {});
      ok('Waiting for approval shows “Season 2 · The Second art”', await card.isVisible().catch(() => false));
      ok('…and Season 1’s', await a.page.locator('text=Season 1 · The First art').first().isVisible().catch(() => false));
      ok('…no page errors', a.errors.length === 0, a.errors);
      await a.ctx.close();
      const m = await b.open(MARA, 390);
      await goto(m.page, `/creator/show/${ID.live}/edit?tab=art`);
      const rowWords = m.page.locator('text=Season art').first();
      await rowWords.waitFor({ timeout: 30000 }).catch(() => {});
      ok('the owner’s editor (390) has the Season art block', await rowWords.isVisible().catch(() => false));
      ok('…no overflow, no page errors', (await overflowPx(m.page)) <= 0 && m.errors.length === 0, m.errors);
      await m.ctx.close();
    } finally {
      await b.close();
    }
  }

  section('The team decides each season');
  let items = await stagedItems();
  const it2 = items.find((i) => i.field === 'seasonArt:2');
  const it1 = items.find((i) => i.field === 'seasonArt:1');
  ok('Waiting for approval lists Season 1 and Season 2 with their seen', it1 && it2 && it1.seen && it2.seen && it2.proposed === waiting2, items.map((i) => [i.field, i.seen]));
  r = await decide([{ target: 'series', id: ID.live, field: 'seasonArt:2', seen: 'stale-mark' }], 'approve');
  ok('approve with a stale seen → 409 changed (nothing moves)', r.status === 200 && r.json.results[0].ok === false && /changed/i.test(r.json.results[0].error || ''), r.json);
  ok('…still waiting', imageOf(live(ID.live).pending_season_art, 2) === waiting2);
  r = await decide([{ target: 'series', id: ID.live, field: 'seasonArt:2', seen: it2.seen }], 'approve');
  ok('approve Season 2 → ok', r.status === 200 && r.json.ok === true, r.json);
  row = live(ID.live);
  ok('…Season 2 live, Season 1 still waiting', imageOf(row.season_art, 2) === waiting2 && (parse(row.pending_season_art) || []).map((x) => x.number).join(',') === '1', row);
  r = await hub(ID.live);
  ok('/api/series-hub: the hero is Season 2’s art (the newest released season)', r.json.seriesInfo.heroImage === waiting2 && r.json.seriesInfo.heroSeason === 2, r.json.seriesInfo && [r.json.seriesInfo.heroImage, r.json.seriesInfo.heroSeason]);
  ok('…and nothing of Season 1’s waiting picture', !r.text.includes(imageOf(row.pending_season_art, 1)));
  html = await page(`/series/${ID.live}`);
  ok('/series page draws Season 2’s art', html.status === 200 && inPage(html.text, waiting2) && !inPage(html.text, imageOf(row.pending_season_art, 1)), html.status);
  hero = await streamHero(ID.live);
  ok('/stream hero: Season 2’s art', hero && hero.heroImage === waiting2, hero && hero.heroImage);
  const waiting1 = imageOf(row.pending_season_art, 1);
  items = await stagedItems();
  r = await decide([{ target: 'series', id: ID.live, field: 'seasonArt:1', seen: items.find((i) => i.field === 'seasonArt:1').seen }], 'deny', 'Too dark.');
  ok('deny Season 1 → ok, nothing waits', r.status === 200 && r.json.ok === true && live(ID.live).pending_season_art === null, r.json);
  ok('…and the Shows badge drops back', (await showsBadge()) === showsBefore, showsBefore);
  ok('…the denied picture went to Orphaned media (by its storage path)', rows(`select id from public.orphaned_media where kind = 'storage_image' and reference = ${q((waiting1 || '').split('/episode-art/')[1] || '')}`).length === 1, waiting1);
  ok('…the owner was told (show_edit_denied)', rows(`select message from public.notifications where user_id = ${q(USERS.mara)} and type = 'show_edit_denied' and message like '%${RUN}%'`).some((n) => /Season 1/.test(n.message) && /Too dark/.test(n.message)));

  section('The owner takes one back');
  r = await patch(MARA, ID.live, { seasonArt: [{ number: 1, imageBase64: s1, fileName: 's1.jpg' }] });
  ok('Season 1 staged again', r.status === 200 && (r.json.staged || []).includes('seasonArt:1'));
  r = await call(`/api/show/${encodeURIComponent(ID.live)}/staged?field=seasonArt&season=1`, { who: MARA, method: 'DELETE' });
  ok('DELETE …/staged?field=seasonArt&season=1 → cancelled', r.status === 200 && r.json.cancelled === 'seasonArt' && r.json.season === 1 && live(ID.live).pending_season_art === null, `${r.status} ${r.text.slice(0, 160)}`);
  r = await call(`/api/show/${encodeURIComponent(ID.live)}/staged?field=seasonArt:1`, { who: MARA, method: 'DELETE' });
  ok('again → 409 nothing-staged', r.status === 409, r.status);

  section('The jsonb write guard: a save whose read went stale');
  r = await staleSave({ seasonArt: [{ number: 1, imageBase64: s1, fileName: 's1.jpg' }] });
  ok('→ 409 changed (the season lists moved under it)', r.status === 409 && r.json && r.json.code === 'changed', `${r.status} ${r.text.slice(0, 200)}`);
  row = live(ID.live);
  ok('…psql’s value stands, nothing staged', /changed-by-psql/.test(imageOf(row.season_art, 1) || '') && row.pending_season_art === null, row);
  // Back to Season 2 only.
  sql(`update public.series set season_art = ${q(JSON.stringify([{ number: 2, image: waiting2 }]))}::jsonb where id = ${q(ID.live)}`);

  section('Which season is out, and the switch');
  const s3 = await picture(`S3 ${RUN}`);
  r = await patch(ADMIN, ID.live, { seasonArt: [{ number: 3, imageBase64: s3, fileName: 's3.jpg' }] });
  ok('the admin’s own save applies at once (seasonArt:3)', r.status === 200 && (r.json.applied || []).includes('seasonArt:3'), `${r.status} ${r.text.slice(0, 200)}`);
  const art3 = imageOf(live(ID.live).season_art, 3);
  r = await hub(ID.live);
  ok('Season 3 isn’t out yet: the hero stays Season 2’s', r.json.seriesInfo.heroImage === waiting2 && r.json.seriesInfo.heroSeason === 2, r.json.seriesInfo.heroImage);
  sql(`update public.episodes set status = 'approved', reviewed_at = now(), released_at = now() where id = ${q(ID.l3)}`);
  r = await hub(ID.live);
  ok('Season 3 released → the hero is Season 3’s art', r.json.seriesInfo.heroImage === art3 && r.json.seriesInfo.heroSeason === 3, r.json.seriesInfo.heroImage);
  hero = await streamHero(ID.live);
  ok('/stream hero follows (Season 3)', hero && hero.heroImage === art3, hero && hero.heroImage);
  r = await patch(MARA, ID.live, { newestSeasonHero: false });
  ok('switch off → applied at once (a layout choice)', r.status === 200 && (r.json.applied || []).includes('newestSeasonHero') && live(ID.live).newest_season_hero === false, `${r.status} ${r.text.slice(0, 160)}`);
  r = await hub(ID.live);
  ok('…the hero is the show’s own again', r.json.seriesInfo.heroImage === BASE_HERO && r.json.seriesInfo.heroSeason === null, r.json.seriesInfo.heroImage);
  hero = await streamHero(ID.live);
  ok('…on /stream too', hero && hero.heroImage === BASE_HERO, hero && hero.heroImage);
  r = await patch(MARA, ID.live, { newestSeasonHero: 'yes' });
  ok('the switch takes only true/false (400)', r.status === 400, r.status);
  r = await patch(MARA, ID.live, { newestSeasonHero: true });
  ok('switch on again', r.status === 200 && live(ID.live).newest_season_hero === true);

  section('A removal waits too');
  r = await patch(MARA, ID.live, { seasonArt: [{ number: 3, remove: true }] });
  ok('removing Season 3 → staged', r.status === 200 && (r.json.staged || []).includes('seasonArt:3') && imageOf(live(ID.live).pending_season_art, 3) === null && (parse(live(ID.live).pending_season_art) || []).some((x) => x.number === 3 && x.image === null), r.json && r.json.staged);
  r = await hub(ID.live);
  ok('…the hero is still Season 3’s until approved', r.json.seriesInfo.heroImage === art3);
  items = await stagedItems();
  const rm = items.find((i) => i.field === 'seasonArt:3');
  ok('Waiting for approval says it’s a removal', rm && rm.kind === 'removal', rm);
  r = await decide([{ target: 'series', id: ID.live, field: 'seasonArt:3', seen: rm && rm.seen }], 'approve');
  ok('approved → Season 3’s art is gone, the hero falls back to the show’s own (Season 3 has none)', r.json && r.json.ok === true && !imageOf(live(ID.live).season_art, 3), r.json);
  r = await hub(ID.live);
  ok('…/api/series-hub: own hero', r.json.seriesInfo.heroImage === BASE_HERO, r.json.seriesInfo.heroImage);
  r = await page(`/admin/shows/${ID.live}`, ADMIN);
  ok('the admin show page answers 200', r.status === 200, r.status);
}

async function before122() {
  section('Before 122: season art says it needs the migration');
  const s2 = await picture(`S2 ${RUN}`);
  let r = await patch(MARA, ID.live, { seasonArt: [{ number: 2, imageBase64: s2 }] });
  ok('a season-art save → 503 migration-122', r.status === 503 && r.json && r.json.code === 'migration-122' && /migration 122/.test(r.json.error || ''), `${r.status} ${r.text.slice(0, 200)}`);
  r = await patch(MARA, ID.live, { newestSeasonHero: false });
  ok('the switch → 503 migration-122', r.status === 503 && r.json && r.json.code === 'migration-122', `${r.status} ${r.text.slice(0, 200)}`);
  r = await patch(MARA, ID.live, { description: 'A show for the season-art check.' });
  ok('a save without them still works', r.status === 200, `${r.status} ${r.text.slice(0, 160)}`);
  r = await call(`/api/show/${encodeURIComponent(ID.live)}`, { who: MARA });
  ok('the show page says season art isn’t there yet (migration.series122 false)', r.status === 200 && r.json.migration && r.json.migration.series122 === false, r.json && r.json.migration);
  r = await hub(ID.live);
  ok('/api/series-hub 200, the show’s own hero', r.status === 200 && r.json.seriesInfo.heroImage === BASE_HERO, r.status);
  for (const p of [`/series/${ID.live}`, `/creator/show/${ID.live}/edit?tab=art`]) {
    const h = await page(p, MARA);
    ok(`${p} → 200`, h.status === 200, h.status);
  }
  // The editor draws in the browser (its data comes from /api/show/<id>).
  const b = await browser();
  try {
    const { ctx, page: pg, errors } = await b.open(MARA, 1280);
    await goto(pg, `/creator/show/${ID.live}/edit?tab=art`);
    const line = pg.locator('text=Season art needs a database update (migration 122).').first();
    await line.waitFor({ timeout: 30000 }).catch(() => {});
    ok('the editor says season art needs migration 122', await line.isVisible().catch(() => false));
    ok('…no page errors', errors.length === 0, errors);
    await ctx.close();
  } finally {
    await b.close();
  }
  r = await page(`/admin/shows/${ID.live}`, ADMIN);
  ok('the admin show page answers 200', r.status === 200, r.status);
  const hero = await streamHero(ID.live);
  ok('/stream hero: the show’s own', hero && hero.heroImage === BASE_HERO, hero && hero.heroImage);
}

await runCheck('season-art', async () => {
  const has122 = hasColumn('series', 'season_art');
  console.log(`database ${has122 ? 'with' : 'without'} migration 122`);
  cleanup();
  seed();
  try {
    if (has122) await after122();
    else await before122();
  } finally {
    cleanup();
  }
});
