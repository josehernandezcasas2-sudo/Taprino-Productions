#!/usr/bin/env node
// The website fixes of 2026-11-13 (two read-only reviews of the player and
// of the creator and admin tools):
//   - a move between titles in one tab saves the title just left under its
//     own id (it used to go under the title being opened — after the end
//     card as "finished"), watched through the /api/watch-progress and
//     /api/watch-history requests the page sends;
//   - the trailer, then the full episode, resumes the title where it was,
//     and the described version carries on from the same moment;
//   - the end card leaves Enter and Escape to an open Tip sheet, holds its
//     timer under it, and still takes Enter in the player;
//   - Your work's Replace video on a live film stages the new file
//     (pending_src) while the title stays approved and playable, through
//     both routes; the Library lists it and approves it; a title in review
//     or declined takes the file at once;
//   - pictures too large together: the "Those pictures are too large
//     together — try smaller files." line on New show and Edit show for a
//     413 (Vercel's limit, played by the browser), and New show's pictures
//     shrunk under the limit;
//   - the review queue's Accept on an application, greyed for a sub-admin
//     with manage_applications (the route refuses it).
// Rig up, any migration from 118 on.
//   node dev/test-rig/checks/web-fixes.mjs
// The playback half plays a real WebM made with ffmpeg (served with byte
// ranges by the browser's own route, so it can seek); without ffmpeg it
// says so and skips playback. The picture half needs sharp (the app's own
// dependency) for the large test images.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { REPO_DIR } from '../lib/config.mjs';
import { ensureBucket, putObject } from '../lib/storage.mjs';
import { USERS, RUN, FAKES, ok, section, runCheck, call, page, sql, rows, q, insert, session, SIGNED_OUT, newUser, removeUser, browser, goto, cloudflare, clerk, ago } from './lib.mjs';

const MARA = session(USERS.mara);
const DEE = session(USERS.dee);
const ADMIN = session(USERS.admin);
const TOO_LARGE = 'Those pictures are too large together — try smaller files.';

const SUPA = process.env.RIG_SUPABASE_TLS === '0' ? FAKES.supabase : FAKES.supabaseTls;
const BUCKET = 'ck-media';
const OBJ = {
  e1: `ck-wf-e1-${RUN}.webm`,
  e2: `ck-wf-e2-${RUN}.webm`,
  film: `ck-wf-film-${RUN}.webm`,
  trailer: `ck-wf-trailer-${RUN}.webm`,
  described: `ck-wf-described-${RUN}.webm`
};
const URL_OF = (key) => `${SUPA}/storage/v1/object/public/${BUCKET}/${key}`;

const ID = {
  show: `ck-wf-show-${RUN}`,
  e1: `ck-wf-show-e1-${RUN}`,
  e2: `ck-wf-show-e2-${RUN}`,
  film: `ck-wf-film-${RUN}`,
  live: `ck-wf-live-${RUN}`,
  inReview: `ck-wf-review-${RUN}`,
  declined: `ck-wf-declined-${RUN}`,
  extra: `ck-wf-extra-${RUN}`
};
const TITLE = {
  e1: `Check wf first stop ${RUN}`,
  e2: `Check wf second stop ${RUN}`,
  film: `Check wf film ${RUN}`,
  live: `Check wf live film ${RUN}`,
  inReview: `Check wf film in review ${RUN}`,
  declined: `Check wf declined film ${RUN}`,
  newShow: `Check wf show ${RUN}`,
  application: `Check wf application ${RUN}`
};
const APPLICATION_ID = crypto.randomUUID();

// Fake Cloudflare videos, each Mara's and ready.
const uid = () => crypto.randomBytes(16).toString('hex');
const VID = { liveOld: uid(), liveNew: uid(), liveNewer: uid(), reviewOld: uid(), reviewNew: uid(), declinedOld: uid(), declinedNew: uid(), showNew: uid() };
const cf = (u) => `https://customer-test.cloudflarestream.com/${u}/manifest/video.m3u8`;

const base = (id, extra = {}) => ({
  id, description: `The description of ${id}.`, tier: 'free', genre: 'Drama', main_genre: 'Drama', content_type: 'movie',
  artist: 'Mara Reyes', runtime: '0:40', rating: 'TV-PG', release_year: 2026, video_type: 'html5',
  ads_enabled: false, deletion_requested: false, moderation_hold: false, submitted_by: USERS.mara, status: 'approved', reviewed_at: ago(3), released_at: ago(3), created_at: ago(5),
  has_page: true, ...extra
});

let videoBuf = null;
function makeVideo() {
  try {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ck-wf-'));
    const out = path.join(dir, 'clip.webm');
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=25', '-t', '40', '-c:v', 'libvpx', '-b:v', '120k', '-an', out], { stdio: 'ignore' });
    const buf = fs.readFileSync(out);
    fs.rmSync(dir, { recursive: true, force: true });
    ensureBucket(BUCKET, { public: true });
    for (const key of Object.values(OBJ)) putObject(BUCKET, key, buf, { contentType: 'video/webm' });
    return buf;
  } catch (err) {
    console.log(`(no ffmpeg/libvpx here: playback is skipped — ${String(err.message || err).split('\n')[0]})`);
    return null;
  }
}

let sharp = null;
try {
  sharp = createRequire(path.join(REPO_DIR, 'package.json'))('sharp');
} catch (err) {
  sharp = null;
}
// A grainy 3000 × 4500 JPEG between 3 and 5.8 MB, like a camera's (New
// show takes files under 6 MB; two of them as data URLs are well over
// Vercel's 4.5 MB body). Shrunk to 2000 px it is a few hundred KB.
async function bigJpeg(seed) {
  let w = 3000;
  for (let i = 0; i < 6; i += 1) {
    const h = Math.round(w * 1.5);
    const buf = await sharp({ create: { width: w, height: h, channels: 3, noise: { type: 'gaussian', mean: 120 + seed * 4, sigma: 14 } } }).jpeg({ quality: 92 }).toBuffer();
    if (buf.length > 5.8 * 1024 * 1024) w = Math.round(w * 0.85);
    else if (buf.length < 3 * 1024 * 1024) w = Math.round(w * 1.2);
    else return buf;
  }
  return null;
}

async function seed() {
  for (const [key, u] of Object.entries(VID)) {
    const r = await cloudflare('/__video', { method: 'POST', body: { uid: u, name: `ck-wf-${key}.mp4`, creator: USERS.mara, duration: 600, ready: true } });
    if (r.status !== 200) throw new Error(`fake Cloudflare refused a video: ${r.status}`);
  }
  insert('series', {
    id: ID.show, name: `Check wf show seed ${RUN}`, description: 'A show for the web fixes check.', creator_id: USERS.mara, release_year: 2026, status: 'approved',
    submitted_by_user_id: USERS.mara, reviewed_at: ago(10), public_at: ago(10), created_at: ago(12), kind: 'series', defaults: {}, seasons: [], credits: {}
  });
  insert('episodes', base(ID.e1, { title: TITLE.e1, content_type: 'series', series_id: ID.show, season: 1, series_order: 1, has_page: false, src: URL_OF(OBJ.e1) }));
  insert('episodes', base(ID.e2, { title: TITLE.e2, content_type: 'series', series_id: ID.show, season: 1, series_order: 2, has_page: false, src: URL_OF(OBJ.e2), created_at: ago(4) }));
  insert('episodes', base(ID.film, { title: TITLE.film, src: URL_OF(OBJ.film), trailer_src: URL_OF(OBJ.trailer), audio_description_src: URL_OF(OBJ.described) }));
  insert('episodes', base(ID.live, { title: TITLE.live, src: cf(VID.liveOld), video_provider: 'cloudflare', runtime: '10:00' }));
  insert('episodes', base(ID.inReview, { title: TITLE.inReview, src: cf(VID.reviewOld), video_provider: 'cloudflare', status: 'pending', reviewed_at: null, released_at: null }));
  insert('episodes', base(ID.declined, { title: TITLE.declined, src: cf(VID.declinedOld), video_provider: 'cloudflare', status: 'rejected', rejection_reason: 'The sound drops out at 3:10.' }));
  // An extra filed only after the show's first episode (no series_id).
  insert('episodes', base(ID.extra, { title: `Check wf extra ${RUN}`, content_type: 'bonus', bonus_parent_type: 'episode', bonus_parent_id: ID.e1, has_page: false, src: URL_OF(OBJ.e2) }));
  insert('creator_applications', { id: APPLICATION_ID, name: 'Wf Applicant', email: `wf-applicant-${RUN}@rig.example.com`, title: TITLE.application, logline: 'A film sent in for the check.', content_type: 'movie', main_genre: 'Drama', media_link: 'https://files.example.com/ck-wf', status: 'new', created_at: ago(1) });
}
function cleanup() {
  const ids = Object.values(ID).map(q).join(', ');
  const uids = Object.values(VID).map(q).join(', ');
  sql(`delete from public.notifications where episode_id in (${ids}) or message like '%Check wf%'`);
  sql(`delete from public.audit_log where target_id in (${ids}) or target_id in (select id from public.series where name like ${q(`Check wf show %${RUN}`)})`);
  sql(`delete from public.orphaned_media where reference in (${uids}) or context like ${q(`Check wf%${RUN}%`)}`);
  sql(`delete from public.episodes where id in (${ids})`);
  sql(`delete from public.series where id = ${q(ID.show)} or name like ${q(`Check wf show %${RUN}`)}`);
  sql(`delete from public.creator_applications where id = ${q(APPLICATION_ID)}`);
}

const one = (sqlText) => rows(sqlText)[0] || {};

// ---- HTTP: Replace video stages on a live title ---------------------------------
async function replaceVideoPart() {
  section('Replace video on a live film: staged, the title stays live');
  const countsBefore = await call('/api/admin/queue-counts', { who: ADMIN });
  let r = await call(`/api/show/episode/${ID.live}/video`, { who: MARA, method: 'POST', body: { videoUid: VID.liveNew } });
  ok('the modal’s route (POST /api/show/episode/<id>/video) → 200, staged', r.status === 200 && r.json && r.json.staged === true && r.json.resubmitted === false, r.text.slice(0, 300));
  ok('…its line says the current file keeps playing', r.json && /keeps playing/.test(r.json.message || ''), r.json && r.json.message);
  let row = one(`select status, src, pending_src from public.episodes where id = ${q(ID.live)}`);
  ok('the title stays approved with its file; the new one waits in pending_src', row.status === 'approved' && (row.src || '').includes(VID.liveOld) && (row.pending_src || '').includes(VID.liveNew), row);
  r = await call('/api/creator/replace-video', { who: MARA, method: 'POST', body: { episodeId: ID.live, videoUid: VID.liveNewer } });
  ok('the older route (/api/creator/replace-video) stages too → 200, staged', r.status === 200 && r.json && r.json.staged === true, r.text.slice(0, 300));
  row = one(`select status, src, pending_src from public.episodes where id = ${q(ID.live)}`);
  ok('…still approved, still its file; the newer file replaces the waiting one', row.status === 'approved' && (row.src || '').includes(VID.liveOld) && (row.pending_src || '').includes(VID.liveNewer), row);
  ok('…the replaced waiting file went to Orphaned media', rows(`select id from public.orphaned_media where reference = ${q(VID.liveNew)}`).length >= 1);
  ok('…the live file was not orphaned', rows(`select id from public.orphaned_media where reference = ${q(VID.liveOld)}`).length === 0);
  r = await call('/api/creator/replace-video', { who: DEE, method: 'POST', body: { episodeId: ID.live, videoUid: VID.liveNew } });
  ok('another creator is refused', r.status === 404 || r.status === 403, r.status);

  r = await page(`/episode/${ID.live}?autoplay=1`);
  ok('the title’s page still plays (200, the player)', r.status === 200 && /player-full-bleed/.test(r.text) && !/Pulled|not this time/i.test(r.text.slice(0, 2000)), r.status);
  r = await call('/api/stream-token', { method: 'POST', body: { episodeId: ID.live } });
  ok('/api/stream-token still hands out a link for it', r.status === 200 && r.json && typeof r.json.src === 'string' && r.json.src.length > 0, r.text.slice(0, 200));
  r = await call(`/api/episode-page?id=${encodeURIComponent(ID.live)}`);
  ok('/api/episode-page still answers it', r.status === 200 && r.json && r.json.episode && r.json.episode.id === ID.live, r.status);

  section('The Library lists the waiting file and decides it');
  const countsAfter = await call('/api/admin/queue-counts', { who: ADMIN });
  ok('the Library badge counts it (one more than before)', countsBefore.json && countsAfter.json && countsAfter.json.library === countsBefore.json.library + 1, { before: countsBefore.json && countsBefore.json.library, after: countsAfter.json && countsAfter.json.library });
  r = await call('/api/admin/pending-artwork', { who: ADMIN });
  const item = r.json && Array.isArray(r.json.videos) ? r.json.videos.find((v) => v.id === ID.live) : null;
  ok('/api/admin/pending-artwork lists it under videos, with what was seen', r.status === 200 && item && item.seen && typeof item.seen.video === 'string', r.text.slice(0, 300));

  section('A show’s titles are decided on its page: the Shows badge, not the Library');
  const showsBefore = await call('/api/admin/queue-counts', { who: ADMIN });
  r = await call(`/api/show/episode/${ID.e1}/video`, { who: MARA, method: 'POST', body: { videoUid: VID.showNew } });
  ok('a live show episode’s new file is staged too', r.status === 200 && r.json && r.json.staged === true, r.text.slice(0, 200));
  // A waiting still on an extra filed only after E1 (bonus_parent_*).
  sql(`update public.episodes set pending_thumbnail = ${q(`${SUPA}/storage/v1/object/public/episode-art/ck-wf-extra-${RUN}.jpg`)} where id = ${q(ID.extra)}`);
  const showsAfter = await call('/api/admin/queue-counts', { who: ADMIN });
  ok('the Shows badge counts both: the episode’s new file and the extra’s still (two more)', showsBefore.json && showsAfter.json && showsAfter.json.shows === showsBefore.json.shows + 2, { before: showsBefore.json && showsBefore.json.shows, after: showsAfter.json && showsAfter.json.shows });
  r = await call('/api/admin/pending-artwork', { who: ADMIN });
  ok('…and the Library’s videos leave the show’s episode out', r.status === 200 && Array.isArray(r.json.videos) && !r.json.videos.some((v) => v.id === ID.e1) && r.json.videos.some((v) => v.id === ID.live), (r.json && r.json.videos || []).map((v) => v.id));

  section('A title in review or declined takes the file at once');
  r = await call(`/api/show/episode/${ID.inReview}/video`, { who: MARA, method: 'POST', body: { videoUid: VID.reviewNew } });
  row = one(`select status, src, pending_src from public.episodes where id = ${q(ID.inReview)}`);
  ok('in review: the new file replaces the old one, still in review', r.status === 200 && r.json && r.json.staged === false && row.status === 'pending' && (row.src || '').includes(VID.reviewNew) && !row.pending_src, { status: r.status, row });
  r = await call('/api/creator/replace-video', { who: MARA, method: 'POST', body: { episodeId: ID.declined, videoUid: VID.declinedNew } });
  row = one(`select status, src, rejection_reason from public.episodes where id = ${q(ID.declined)}`);
  ok('declined: back in review with the new file', r.status === 200 && r.json && r.json.resubmitted === true && row.status === 'pending' && (row.src || '').includes(VID.declinedNew) && !row.rejection_reason, { status: r.status, row });
}

// ---- HTTP: the review queue's Accept for a sub-admin -------------------------------
async function acceptPart(sub) {
  section('The review queue: Accept on an application for a sub-admin');
  let r = await call('/api/admin/review-queue', { who: sub });
  let item = r.json && Array.isArray(r.json.items) ? r.json.items.find((i) => i.kind === 'application' && i.id === APPLICATION_ID) : null;
  ok('a sub-admin with manage_applications sees the application', r.status === 200 && Boolean(item), r.text.slice(0, 200));
  ok('…canAccept false, with the line why', item && item.meta && item.meta.canAccept === false && /full admin/i.test(item.meta.acceptBlocker || ''), item && item.meta);
  r = await call('/api/admin/review-queue', { who: ADMIN });
  item = r.json && Array.isArray(r.json.items) ? r.json.items.find((i) => i.kind === 'application' && i.id === APPLICATION_ID) : null;
  ok('a full admin: canAccept true, no blocker', item && item.meta && item.meta.canAccept === true && !item.meta.acceptBlocker, item && item.meta);
  r = await call('/api/admin/review-queue', { who: sub, method: 'POST', body: { kind: 'application', id: APPLICATION_ID, decision: 'approve' } });
  ok('the route still refuses the sub-admin’s Accept (403)', r.status === 403, r.status);
  ok('…and the application is untouched', one(`select status from public.creator_applications where id = ${q(APPLICATION_ID)}`).status === 'new');
}

// ---- the browser ---------------------------------------------------------------------
// The test video with byte ranges (the storage stand-in sends the whole file,
// which Chromium can't seek in).
async function serveVideos(pg) {
  await pg.route(/\/ck-media\/ck-wf-[^/?]+\.webm/, async (route) => {
    const buf = videoBuf;
    const total = buf.length;
    const range = route.request().headers().range;
    const m = range ? /bytes=(\d*)-(\d*)/.exec(range) : null;
    if (m) {
      const start = m[1] ? Number(m[1]) : 0;
      const end = Math.min(total - 1, m[2] ? Number(m[2]) : total - 1);
      return route.fulfill({ status: 206, headers: { 'Content-Type': 'video/webm', 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${total}`, 'Content-Length': String(end - start + 1) }, body: buf.subarray(start, end + 1) });
    }
    return route.fulfill({ status: 200, headers: { 'Content-Type': 'video/webm', 'Accept-Ranges': 'bytes', 'Content-Length': String(total) }, body: buf });
  });
}
// Every save the page sends: { at, url, body }.
function recordSaves(pg) {
  const saves = [];
  pg.on('request', (req) => {
    if (req.method() !== 'POST') return;
    const u = req.url();
    if (!/\/api\/watch-(progress|history)$/.test(new URL(u).pathname)) return;
    let body = null;
    try { body = JSON.parse(req.postData() || 'null'); } catch (err) { body = null; }
    saves.push({ at: Date.now(), kind: /history$/.test(u) ? 'history' : 'progress', body: body || {} });
  });
  return saves;
}
const videoState = (pg) => pg.evaluate(() => {
  const v = document.querySelector('video.tp-video');
  return v ? { t: v.currentTime, d: v.duration, paused: v.paused, ended: v.ended, src: v.currentSrc || v.src } : null;
});
async function start(pg) {
  await pg.waitForSelector('video.tp-video', { timeout: 30000 });
  await pg.waitForTimeout(600);
  const playing = await pg.evaluate(() => { const v = document.querySelector('video.tp-video'); return Boolean(v && !v.paused); });
  if (playing) return;
  const big = pg.locator('.tp-bigplay');
  const clicked = (await big.count()) ? await big.first().click({ timeout: 5000 }).then(() => true, () => false) : false;
  if (!clicked) await pg.evaluate(() => document.querySelector('video.tp-video') && document.querySelector('video.tp-video').play().catch(() => {}));
  await pg.waitForFunction(() => { const v = document.querySelector('video.tp-video'); return v && !v.paused && v.readyState >= 2; }, null, { timeout: 20000 }).catch(() => {});
}
async function seekTo(pg, seconds) {
  await pg.evaluate((s) => { const v = document.querySelector('video.tp-video'); if (v) v.currentTime = s; }, seconds);
  await pg.waitForFunction((s) => { const v = document.querySelector('video.tp-video'); return v && Math.abs(v.currentTime - s) < 3; }, seconds, { timeout: 10000 }).catch(() => {});
}
const pushTo = (pg, href) => pg.evaluate((h) => window.next.router.push(h), href);
const onPath = (pg, id) => pg.waitForFunction((x) => window.location.pathname.endsWith(x), id, { timeout: 60000 });

async function movePart(b, viewer) {
  section('Chromium: a move between titles saves the last one under its own id');
  const { ctx, page: pg, errors } = await b.open(viewer, 1280);
  await serveVideos(pg);
  const saves = recordSaves(pg);
  await goto(pg, `/episode/${ID.e1}?autoplay=1`);
  await start(pg);
  await seekTo(pg, 20);
  // Past the player's 3-second guard, so the save on the way out goes.
  await pg.waitForTimeout(4200);
  const before = await videoState(pg);
  ok('E1 plays past 20 s', before && before.t >= 19 && !before.paused, before);
  const movedAt = Date.now();
  await pushTo(pg, `/episode/${ID.e2}?autoplay=1`);
  await onPath(pg, ID.e2);
  await pg.waitForTimeout(3000);
  const after = saves.filter((s) => s.at >= movedAt && s.kind === 'progress');
  ok('E1’s place is saved under E1 on the way out', after.some((s) => s.body.episodeId === ID.e1 && s.body.position >= 18), after.map((s) => s.body));
  ok('…and nothing of E1’s goes under E2 (no E2 save past 5 s)', !after.some((s) => s.body.episodeId === ID.e2 && s.body.position >= 5), after.map((s) => s.body));
  ok('no page errors', errors.length === 0, errors);
  await ctx.close();
}

async function endCardPart(b, viewer) {
  section('Chromium: the end card and the Tip sheet');
  const { ctx, page: pg, errors } = await b.open(viewer, 1280);
  await serveVideos(pg);
  const saves = recordSaves(pg);
  await goto(pg, `/episode/${ID.e1}?autoplay=1`);
  await start(pg);
  await seekTo(pg, 37.5);
  await pg.waitForSelector('.tp-endcard', { timeout: 20000 }).catch(() => {});
  ok('E1 plays out and the end card comes up (Up next: E2)', await pg.locator('.tp-endcard').isVisible().catch(() => false));
  const count = async () => Number((await pg.locator('.tp-endcard-count').textContent().catch(() => '')) || NaN);
  const c0 = await count();
  const tip = pg.locator('.ep-action-tip');
  const hasTip = (await tip.count()) > 0;
  ok('the page’s Tip action is there (Mara can be tipped)', hasTip);
  if (hasTip) {
    await tip.first().click();
    await pg.waitForSelector('.tip-modal', { timeout: 10000 }).catch(() => {});
    ok('the Tip sheet opens over the page', await pg.locator('.tip-modal').isVisible().catch(() => false));
    await pg.waitForTimeout(3500);
    const c1 = await count();
    ok('the end card’s timer waits while the sheet is open', Number.isFinite(c0) && Number.isFinite(c1) && c1 >= c0 - 1, { c0, c1 });
    await pg.locator('.tip-preset').first().focus();
    await pg.keyboard.press('Enter');
    await pg.waitForTimeout(1500);
    ok('Enter on a preset picks it and stays on E1 (no jump to E2)', (await pg.evaluate(() => window.location.pathname)).endsWith(ID.e1) && (await pg.locator('.tip-preset').first().getAttribute('aria-pressed')) === 'true', await pg.evaluate(() => window.location.pathname));
    await pg.keyboard.press('Escape');
    await pg.waitForTimeout(800);
    ok('Escape closes the sheet', !(await pg.locator('.tip-modal').isVisible().catch(() => false)));
    ok('…and the end card is still up (Escape wasn’t taken from the sheet)', await pg.locator('.tp-endcard').isVisible().catch(() => false));
  }
  const ended = saves.filter((s) => s.kind === 'progress' && s.body.episodeId === ID.e1 && s.body.finished === true);
  ok('E1’s finish was saved under E1', ended.length >= 1, saves.map((s) => s.body));
  await pg.evaluate(() => { const p = document.querySelector('.tp-player'); if (p) p.focus(); });
  const movedAt = Date.now();
  await pg.keyboard.press('Enter');
  await onPath(pg, ID.e2).catch(() => {});
  ok('Enter with the focus in the player still plays the next episode', (await pg.evaluate(() => window.location.pathname)).endsWith(ID.e2));
  await pg.waitForTimeout(3000);
  const after = saves.filter((s) => s.at >= movedAt);
  ok('after the move: E2 is not saved as finished', !after.some((s) => s.body.episodeId === ID.e2 && (s.body.finished === true || s.kind === 'history' || s.body.position >= 5)), after.map((s) => ({ kind: s.kind, ...s.body })));
  ok('…and E1 isn’t saved a second time on the way out', !after.some((s) => s.kind === 'progress' && s.body.episodeId === ID.e1), after.map((s) => s.body));
  ok('no page errors', errors.length === 0, errors);
  await ctx.close();
}

async function trailerPart(b) {
  section('Chromium: the trailer, then the full episode, resumes the title');
  const { ctx, page: pg, errors } = await b.open(SIGNED_OUT, 1280);
  await serveVideos(pg);
  await goto(pg, `/episode/${ID.film}?autoplay=1`);
  await start(pg);
  await seekTo(pg, 22);
  await pg.waitForTimeout(4200);
  const playing = await videoState(pg);
  ok('the film plays past 22 s', playing && playing.t >= 21 && /ck-wf-film/.test(playing.src || ''), playing);
  await pg.locator('.ep-action', { hasText: 'Trailer' }).first().click();
  await pg.waitForFunction(() => /ck-wf-trailer/.test((document.querySelector('video.tp-video') || {}).currentSrc || ''), null, { timeout: 15000 }).catch(() => {});
  ok('Trailer swaps in the trailer', /ck-wf-trailer/.test(((await videoState(pg)) || {}).src || ''));
  await pg.waitForTimeout(1500);
  await pg.locator('.ep-action', { hasText: 'Full episode' }).first().click();
  await pg.waitForFunction(() => { const v = document.querySelector('video.tp-video'); return v && /ck-wf-film/.test(v.currentSrc || '') && v.readyState >= 1; }, null, { timeout: 15000 }).catch(() => {});
  await pg.waitForTimeout(1500);
  const back = await videoState(pg);
  ok('Full episode: the film is back where it was (not 0:00)', back && /ck-wf-film/.test(back.src || '') && back.t >= 18, back);
  const stored = await pg.evaluate((id) => { try { return JSON.parse(window.localStorage.getItem('taprino_watch_progress') || '{}')[id] || 0; } catch (e) { return -1; } }, ID.film);
  ok('…and its saved place wasn’t overwritten with a start', stored >= 18, stored);

  section('Chromium: the described version carries on from the same moment');
  await start(pg);
  await pg.waitForTimeout(1500);
  const was = await videoState(pg);
  await pg.locator('button.a11y-link', { hasText: 'Play described version' }).first().click();
  await pg.waitForFunction(() => /ck-wf-described/.test((document.querySelector('video.tp-video') || {}).currentSrc || ''), null, { timeout: 15000 }).catch(() => {});
  await pg.waitForTimeout(2000);
  const described = await videoState(pg);
  ok('the described version picks up where the film was, and plays', described && /ck-wf-described/.test(described.src || '') && was && described.t >= was.t - 1 && !described.paused, { was, described });
  ok('no page errors', errors.length === 0, errors);
  await ctx.close();
}

async function picturesPart(b) {
  section('Chromium: pictures too large together (New show, Edit show)');
  const { ctx, page: pg, errors } = await b.open(MARA, 1280);
  await goto(pg, '/creator/show/new');
  await pg.fill('#ns-name', TITLE.newShow);
  // Vercel's own 413 page for a body over 4.5 MB (the rig's Next would take it).
  const too = (route) => (route.request().method() === 'POST' ? route.fulfill({ status: 413, contentType: 'text/plain', body: 'Request Entity Too Large' }) : route.fallback());
  await pg.route('**/api/show', too);
  await pg.locator('button[type="submit"]', { hasText: 'Create the show' }).click();
  await pg.waitForSelector('.admin-error', { timeout: 15000 }).catch(() => {});
  ok('New show: a 413 reads the pictures line', ((await pg.locator('.admin-error').textContent().catch(() => '')) || '').trim() === TOO_LARGE, await pg.locator('.admin-error').textContent().catch(() => null));
  await pg.unroute('**/api/show', too);

  let rawBytes = 0;
  if (sharp) {
    const poster = await bigJpeg(1);
    const still = await bigJpeg(2);
    if (poster && still) {
      rawBytes = poster.length + still.length;
      await pg.setInputFiles('#ns-poster', { name: 'big-poster.jpg', mimeType: 'image/jpeg', buffer: poster });
      await pg.setInputFiles('#ns-still', { name: 'big-still.jpg', mimeType: 'image/jpeg', buffer: still });
    }
  } else {
    console.log('(no sharp: New show is created without the large pictures)');
  }
  const sent = pg.waitForRequest((req) => req.method() === 'POST' && new URL(req.url()).pathname === '/api/show', { timeout: 120000 });
  await pg.locator('button[type="submit"]', { hasText: 'Create the show' }).click();
  const req = await sent.catch(() => null);
  await pg.waitForFunction(() => /\/creator\/show\/[^/]+$/.test(window.location.pathname) && !/\/new$/.test(window.location.pathname), null, { timeout: 120000 }).catch(() => {});
  const bodyBytes = req && req.postDataBuffer() ? req.postDataBuffer().length : 0;
  const show = one(`select id, poster, thumbnail from public.series where name = ${q(TITLE.newShow)}`);
  ok('New show is created', Boolean(show.id), await pg.evaluate(() => window.location.pathname));
  if (rawBytes) {
    ok(`two pictures of ${(rawBytes / 1048576).toFixed(1)} MB (over 4.5 MB as data URLs) go in a body under 4.2 MB`, bodyBytes > 0 && bodyBytes < 4.2 * 1024 * 1024 && rawBytes * 4 / 3 > 4.5 * 1024 * 1024, { rawBytes, bodyBytes });
    ok('…and both pictures are stored', Boolean(show.poster) && Boolean(show.thumbnail), show);
  }
  await ctx.close();

  if (show.id) {
    const { ctx: c2, page: p2, errors: e2 } = await b.open(MARA, 390);
    await goto(p2, `/creator/show/${encodeURIComponent(show.id)}/edit`);
    await p2.waitForSelector('#sh-name', { timeout: 30000 }).catch(() => {});
    await p2.fill('#sh-name', `${TITLE.newShow} renamed`);
    const tooPatch = (route) => (route.request().method() === 'PATCH' ? route.fulfill({ status: 413, contentType: 'text/plain', body: 'Request Entity Too Large' }) : route.fallback());
    await p2.route(`**/api/show/${encodeURIComponent(show.id)}`, tooPatch);
    await p2.locator('.show-ed-save').first().click();
    await p2.waitForSelector('.show-ed-error', { timeout: 15000 }).catch(() => {});
    ok('Edit show (callApi): a 413 reads the pictures line', ((await p2.locator('.show-ed-error').textContent().catch(() => '')) || '').trim() === TOO_LARGE, await p2.locator('.show-ed-error').textContent().catch(() => null));
    ok('no page errors (Edit show)', e2.length === 0, e2);
    await c2.close();
  }
  ok('no page errors (New show)', errors.length === 0, errors);
}

async function libraryPart(b) {
  section('Chromium: the Library approves the waiting file');
  const { ctx, page: pg, errors } = await b.open(ADMIN, 1280);
  await goto(pg, '/admin/library');
  const row = pg.locator('.lib-staged-video', { hasText: TITLE.live });
  await row.first().waitFor({ timeout: 30000 }).catch(() => {});
  ok('the Library’s artwork card lists the live film’s new video', (await row.count()) === 1);
  if (await row.count()) {
    await row.first().locator('button.account-btn-primary').click();
    await pg.waitForFunction((t) => !Array.from(document.querySelectorAll('.lib-staged-video')).some((el) => el.textContent.includes(t)), TITLE.live, { timeout: 30000 }).catch(() => {});
    const r = one(`select status, src, pending_src from public.episodes where id = ${q(ID.live)}`);
    ok('Approve: the new file is the title’s now, still approved, nothing waiting', r.status === 'approved' && (r.src || '').includes(VID.liveNewer) && !r.pending_src, r);
    ok('…the old master went to Orphaned media', rows(`select id from public.orphaned_media where reference = ${q(VID.liveOld)}`).length >= 1);
  }
  ok('no page errors', errors.length === 0, errors);
  await ctx.close();
}

async function reviewPart(b, sub) {
  section('Chromium: the review queue’s Accept, sub-admin and full admin');
  for (const [who, label, greyed] of [[sub, 'the sub-admin', true], [ADMIN, 'a full admin', false]]) {
    const { ctx, page: pg, errors } = await b.open(who, 1280);
    await goto(pg, '/admin/review');
    const row = pg.locator('.rq-row', { hasText: TITLE.application });
    await row.first().waitFor({ timeout: 30000 }).catch(() => {});
    const btn = row.first().locator('.rq-btn-ok');
    const disabled = (await btn.count()) ? await btn.isDisabled() : null;
    ok(`${label}: Accept is ${greyed ? 'greyed' : 'there'}`, disabled === greyed, disabled);
    if (greyed) ok(`${label}: the line says a full admin accepts`, /full admin accepts/i.test((await row.first().locator('.rq-blocked').textContent().catch(() => '')) || ''));
    ok(`${label}: no page errors`, errors.length === 0, errors);
    await ctx.close();
  }
}

await runCheck('web-fixes', async () => {
  cleanup();
  videoBuf = makeVideo();
  await seed();
  const viewer = await newUser('wfview', { firstName: 'Wanda' });
  const sub = await newUser('wfsub', { firstName: 'Subby' });
  await clerk(`/__users/${sub.id}`, { method: 'POST', body: { role: 'sub_admin', permissions: ['review_submissions', 'manage_applications'], twoFactorEnabled: true } });
  const b = await browser();
  try {
    await replaceVideoPart();
    await acceptPart(sub);
    if (videoBuf) {
      await movePart(b, viewer);
      await endCardPart(b, viewer);
      await trailerPart(b);
    }
    await picturesPart(b);
    await libraryPart(b);
    await reviewPart(b, sub);
  } finally {
    await b.close();
    cleanup();
    await removeUser(viewer.id);
    await removeUser(sub.id);
  }
});
