#!/usr/bin/env node
// A title's own page (2026-11-12): its own title image drawn as the title
// (`titleImageOwn`, `.ep-title-image`, the words kept for screen readers),
// the flashing-lights chip in the meta line, og:type per kind, and in
// Chromium the card before play (lib/contentAdvisory.js
// playbackAdvisoryFor, components/ContentAdvisory.js, VideoPlayer): the
// video waits on its first frame under the photosensitivity warning until
// Watch now / a key / the card's own time, the rating advisory rides on
// the same card, it shows once per title per session, never on a trailer.
// Rig up, any migration from 118 on (nothing here needs 122).
//   node dev/test-rig/checks/film-flashing.mjs
// The browser half plays a real WebM made with ffmpeg and served from the
// storage stand-in; without ffmpeg it says so and skips playback.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ensureBucket, putObject } from '../lib/storage.mjs';
import { IDS, USERS, RUN, FAKES, ok, section, runCheck, page, sql, rows, q, insert, SIGNED_OUT, SIGNED_OUT_NO_TERMS, browser, goto, overflowPx, ago } from './lib.mjs';

const SUPA = process.env.RIG_SUPABASE_TLS === '0' ? FAKES.supabase : FAKES.supabaseTls;
const BUCKET = 'ck-media';
const OBJ = { film: `ck-ff-film-${RUN}.webm`, trailer: `ck-ff-trailer-${RUN}.webm`, short: `ck-ff-short-${RUN}.webm` };
const URL_OF = (key) => `${SUPA}/storage/v1/object/public/${BUCKET}/${key}`;
const HERO = (rows(`select hero_image from public.series where id = ${q(IDS.nightBus)}`)[0] || {}).hero_image || null;

const ID = {
  film: `ck-ff-film-${RUN}`,
  plain: `ck-ff-plain-${RUN}`,
  short: `ck-ff-short-${RUN}`,
  show: `ck-ff-show-${RUN}`,
  showEp: `ck-ff-show-e1-${RUN}`
};
const title = (id) => `Check flash ${id.slice(6, 11)} ${RUN}`;
const film = (id, extra = {}) => ({
  id, title: title(id), description: `The description of ${id}.`, tier: 'free', genre: 'Drama', main_genre: 'Drama', content_type: 'movie',
  artist: 'Mara Reyes', runtime: '0:08', rating: 'TV-14', release_year: 2026, src: URL_OF(OBJ.film), video_type: 'html5',
  ads_enabled: false, deletion_requested: false, moderation_hold: false, submitted_by: USERS.mara, status: 'approved', reviewed_at: ago(3), released_at: ago(3), created_at: ago(5),
  has_page: true, poster: HERO, thumbnail: HERO, ...extra
});

let haveVideo = false;
function makeVideo() {
  try {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ck-ff-'));
    const out = path.join(dir, 'clip.webm');
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=25', '-t', '10', '-c:v', 'libvpx', '-b:v', '150k', '-an', out], { stdio: 'ignore' });
    const buf = fs.readFileSync(out);
    fs.rmSync(dir, { recursive: true, force: true });
    ensureBucket(BUCKET, { public: true });
    for (const key of Object.values(OBJ)) putObject(BUCKET, key, buf, { contentType: 'video/webm' });
    return true;
  } catch (err) {
    console.log(`(no ffmpeg/libvpx here: playback is skipped — ${String(err.message || err).split('\n')[0]})`);
    return false;
  }
}

function seed() {
  insert('episodes', film(ID.film, { has_flashing_lights: true, title_image_url: HERO, trailer_src: URL_OF(OBJ.trailer) }));
  insert('episodes', film(ID.plain, { rating: 'TV-PG' }));
  insert('episodes', film(ID.short, { content_type: 'short', rating: 'TV-G', has_flashing_lights: true, src: URL_OF(OBJ.short) }));
  insert('series', {
    id: ID.show, name: `Check flash show ${RUN}`, description: 'A show with its name as a picture.', creator_id: USERS.mara, release_year: 2026, status: 'approved',
    submitted_by_user_id: USERS.mara, reviewed_at: ago(10), public_at: ago(10), created_at: ago(12), kind: 'series', poster: HERO, thumbnail: HERO, hero_image: HERO, title_image_url: HERO,
    defaults: {}, seasons: [], credits: {}
  });
  insert('episodes', film(ID.showEp, { title: `Check flash episode ${RUN}`, content_type: 'series', series_id: ID.show, season: 1, series_order: 1, has_page: true }));
}
function cleanup() {
  const ids = Object.values(ID).map(q).join(', ');
  sql(`delete from public.notifications where episode_id in (${ids})`);
  sql(`delete from public.episodes where id in (${ids})`);
  sql(`delete from public.series where id = ${q(ID.show)}`);
}

const ogType = (html) => {
  const m = /<meta property="og:type" content="([^"]+)"/.exec(html || '');
  return m ? m[1] : null;
};
const has = (html, cls) => new RegExp(`class="[^"]*\\b${cls}\\b`).test(html || '');

async function httpPart() {
  section('The title image as the title, the chip, og:type');
  let r = await page(`/episode/${ID.film}`);
  ok('a film with its own title image: the landing draws it as the h1', r.status === 200 && /<h1 class="ep-title ep-title-art"><img[^>]*class="ep-title-image"/.test(r.text), r.status);
  ok('…the words stay for screen readers (visually-hidden)', new RegExp(`<span class="visually-hidden">${title(ID.film)}</span>`).test(r.text));
  ok('…one h1', (r.text.match(/<h1 /g) || []).length === 1, (r.text.match(/<h1 /g) || []).length);
  ok('the flashing-lights chip in the meta line, pointing at the Accessibility panel', /<a href="#a11y-heading" class="ep-flash-chip">/.test(r.text) && />\s*(<!-- -->)?\s*Flashing lights</.test(r.text) && /id="a11y-heading"/.test(r.text));
  ok('og:type video.movie for a film', ogType(r.text) === 'video.movie', ogType(r.text));
  r = await page(`/episode/${ID.film}?autoplay=1`);
  ok('in the player (?autoplay=1) the title is text again', r.status === 200 && !has(r.text, 'ep-title-image') && r.text.includes(`<h1 class="ep-title">${title(ID.film)}</h1>`), r.status);
  r = await page(`/episode/${ID.plain}`);
  ok('a film without the flag: no chip, no title image', r.status === 200 && !has(r.text, 'ep-flash-chip') && !has(r.text, 'ep-title-image'), r.status);
  r = await page(`/episode/${ID.short}`);
  ok('a short: og:type video.movie, the chip', r.status === 200 && ogType(r.text) === 'video.movie' && has(r.text, 'ep-flash-chip'), `${r.status} ${ogType(r.text)}`);
  r = await page(`/episode/${ID.showEp}`);
  ok('a show’s episode whose show has a title image: never drawn as the episode’s title', r.status === 200 && !has(r.text, 'ep-title-image') && has(r.text, 'ep-title'), r.status);
  ok('…og:type video.episode', ogType(r.text) === 'video.episode', ogType(r.text));
  r = await page(`/episode/${IDS.nbS1E1}`);
  ok('a seed series episode: video.episode', ogType(r.text) === 'video.episode', ogType(r.text));
  r = await page(`/episode/${IDS.nbExtraShow}`);
  ok('an extra: video.other', r.status === 200 && ogType(r.text) === 'video.other', `${r.status} ${ogType(r.text)}`);
  r = await page(`/episode/${ID.film}`, SIGNED_OUT_NO_TERMS);
  ok('the viewing-terms card (what a link preview reads) carries og:type too', r.status === 200 && !has(r.text, 'epl-strip') && ogType(r.text) === 'video.movie', `${r.status} ${ogType(r.text)}`);
}

// Starts playback the way a viewer does (the big play button) and waits
// for the video element.
async function start(pg) {
  await pg.waitForSelector('video', { timeout: 30000 });
  // After a move between titles with ?autoplay=1 the player may already
  // be going (the earlier click counts as the gesture).
  await pg.waitForTimeout(500);
  const playing = await pg.evaluate(() => { const v = document.querySelector('video'); return Boolean(v && !v.paused); });
  if (playing) return;
  const big = pg.locator('.tp-bigplay');
  const clicked = (await big.count()) ? await big.first().click({ timeout: 5000 }).then(() => true, () => false) : false;
  if (!clicked) await pg.evaluate(() => document.querySelector('video') && document.querySelector('video').play().catch(() => {}));
}
const videoState = (pg) => pg.evaluate(() => {
  const v = document.querySelector('video.tp-video') || document.querySelector('video');
  return v ? { t: v.currentTime, paused: v.paused, src: v.currentSrc || v.src } : null;
});
const advisory = (pg) => pg.evaluate(() => {
  const a = document.querySelector('.tp-advisory');
  return a ? { warning: Boolean(a.querySelector('.tp-advisory-warning')), rating: (a.querySelector('.tp-advisory-rating') || {}).textContent || null, go: Boolean(a.querySelector('.tp-advisory-go')), focused: document.activeElement && document.activeElement.classList.contains('tp-advisory-go'), cards: document.querySelectorAll('.tp-advisory').length, text: a.textContent } : null;
});
const wait = (pg, ms) => pg.waitForTimeout(ms);

async function browserPart(b) {
  for (const width of [390, 1280]) {
    section(`Browser at ${width}: the landing`);
    const { ctx, page: pg, errors } = await b.open(SIGNED_OUT, width);
    await goto(pg, `/episode/${ID.film}`);
    ok(`${width}: the title image is drawn`, await pg.locator('h1.ep-title-art img.ep-title-image').isVisible().catch(() => false));
    ok(`${width}: the heading’s name is the title`, ((await pg.locator('h1.ep-title').textContent()) || '').includes(title(ID.film)));
    ok(`${width}: the chip shows "Flashing lights"`, ((await pg.locator('.ep-flash-chip').textContent().catch(() => '')) || '').includes('Flashing lights'));
    ok(`${width}: no overflow, no page errors`, (await overflowPx(pg)) <= 0 && errors.length === 0, errors);
    await ctx.close();
  }
  if (!haveVideo) return;

  section('Chromium: the card holds the first frame until Watch now');
  {
    const { ctx, page: pg, errors } = await b.open(SIGNED_OUT, 1280);
    await goto(pg, `/episode/${ID.film}?autoplay=1`);
    await start(pg);
    await pg.waitForSelector('.tp-advisory', { timeout: 15000 }).catch(() => {});
    const a = await advisory(pg);
    ok('the card comes up when the film starts', Boolean(a), a);
    ok('…one card with the rating (TV-14) and the warning', a && a.cards === 1 && a.warning && a.rating === 'TV-14' && /flashing lights/i.test(a.text), a);
    ok('…Watch now has the focus', a && a.go && a.focused, a);
    await wait(pg, 2000);
    let v = await videoState(pg);
    ok('…the video waits on its first frame (paused at 0)', v && v.paused && v.t < 0.3, v);
    await pg.locator('.tp-advisory-go').click();
    await wait(pg, 2000);
    v = await videoState(pg);
    ok('Watch now: the card goes and the film plays', !(await advisory(pg)) && v && !v.paused && v.t > 0.5, v);

    section('Chromium: once per title per session');
    await pg.evaluate((href) => window.next.router.push(href), `/episode/${ID.plain}?autoplay=1`);
    await pg.waitForFunction((id) => window.location.pathname.endsWith(id), ID.plain, { timeout: 60000 });
    await wait(pg, 1500);
    await start(pg);
    await wait(pg, 2500);
    v = await videoState(pg);
    ok('a title with nothing to say (TV-PG film, no flag): no card, it plays', !(await advisory(pg)) && v && !v.paused, v);
    await pg.evaluate((href) => window.next.router.push(href), `/episode/${ID.film}?autoplay=1`);
    await pg.waitForFunction((id) => window.location.pathname.endsWith(id), ID.film, { timeout: 60000 });
    await wait(pg, 1500);
    await start(pg);
    await wait(pg, 2500);
    v = await videoState(pg);
    ok('back to the film in the same tab: no card again, it plays', !(await advisory(pg)) && v && !v.paused && v.t > 0.5, v);
    ok('no page errors', errors.length === 0, errors);
    await ctx.close();
  }

  section('Chromium: a trailer never gets the card');
  {
    const { ctx, page: pg, errors } = await b.open(SIGNED_OUT, 1280);
    await goto(pg, `/episode/${ID.film}?trailer=1`);
    await start(pg);
    await wait(pg, 3000);
    const v = await videoState(pg);
    ok('the trailer plays with no card', !(await advisory(pg)) && v && !v.paused && /ck-ff-trailer/.test(v.src || ''), v);
    ok('no page errors', errors.length === 0, errors);
    await ctx.close();
  }

  section('Chromium: Escape lets it go; the card’s own time does too');
  {
    const { ctx, page: pg, errors } = await b.open(SIGNED_OUT, 390);
    await goto(pg, `/episode/${ID.short}?autoplay=1`);
    await start(pg);
    await pg.waitForSelector('.tp-advisory', { timeout: 15000 }).catch(() => {});
    const a = await advisory(pg);
    ok('a short (TV-G): the warning alone, no rating box', a && a.warning && !a.rating, a);
    await pg.keyboard.press('Escape');
    await wait(pg, 1800);
    const v = await videoState(pg);
    ok('Escape: the card goes and the short plays', !(await advisory(pg)) && v && !v.paused && v.t > 0.3, v);
    ok('no page errors', errors.length === 0, errors);
    await ctx.close();
  }
  {
    const { ctx, page: pg } = await b.open(SIGNED_OUT, 1280);
    await goto(pg, `/episode/${ID.film}?autoplay=1`);
    await start(pg);
    await pg.waitForSelector('.tp-advisory', { timeout: 15000 }).catch(() => {});
    await wait(pg, 3000);
    let v = await videoState(pg);
    ok('left alone: still held at 3 s', v && v.paused && v.t < 0.3, v);
    await wait(pg, 4500);
    v = await videoState(pg);
    ok('…after its five seconds the card fades and the film plays', !(await advisory(pg)) && v && !v.paused && v.t > 0.5, v);
    await ctx.close();
  }
}

await runCheck('film-flashing', async () => {
  cleanup();
  haveVideo = makeVideo();
  seed();
  const b = await browser();
  try {
    await httpPart();
    await browserPart(b);
  } finally {
    await b.close();
    cleanup();
  }
});
