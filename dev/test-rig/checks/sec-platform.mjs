// node dev/test-rig/checks/sec-platform.mjs — the security fixes of
// 2026-11-15, platform, uploads and the app (scripts/test-sec-platform.mjs
// holds the pure rules):
//   - the beta door can't be walked past through the catch-all pages
//     (/crew/calls/x.css, /messages/x.css: the middleware skips any address
//     that ends like a file; the pages now answer 404);
//   - a drafts list asks Cloudflare once per video, remembers the answer
//     for a minute, leaves a draft a day old alone, marks a video Cloudflare
//     no longer knows as failed, and a 101st draft is refused;
//   - a place's photo must be the host's own upload (a CSS-carrying
//     address is refused) and a photo stored before is drawn quoted;
//   - /api/checkout-return forwards only to the app's own Expo Go hosts;
//   - the referral cookie is set only on the creator's own profile;
//   - a cross-site POST to a cron route is refused;
//   - house ads and Film University take no video another title uses;
//   - a suspended account gets no snippet, self-tape or lesson link, and a
//     suspension isn't made while the target's role can't be read;
//   - with "Require two-step for the team" on, a sub-admin without it is
//     refused by a capability-gated API (last, and switched back).
// Seeds and removes its own rows and accounts.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { PATHS } from '../lib/config.mjs';
import { IDS, USERS, RUN, FAKES, ok, section, runCheck, call, page, sql, rows, q, insert, newUser, removeUser, clerk, cloudflare, session, uidFor } from './lib.mjs';

const ADMIN = session(USERS.admin);
const MARA = session(USERS.mara);
const SUPA = process.env.RIG_SUPABASE_TLS === '0' ? FAKES.supabase : FAKES.supabaseTls;
const ART = `${SUPA}/storage/v1/object/public/episode-art`;
const people = [];
const LOC = crypto.randomUUID();
const wait = (ms) => new Promise((res) => setTimeout(res, ms));
const hex = () => crypto.randomBytes(16).toString('hex');

async function member(tag, opts) {
  const m = await newUser(tag, opts);
  people.push(m.id);
  return m;
}

// Cloudflare API reads of one video, from the fake's request log.
const CF_LOG = path.join(PATHS.logs, 'cloudflare.requests.log');
function cfReads(uid) {
  let text = '';
  try { text = fs.readFileSync(CF_LOG, 'utf8'); } catch { return 0; }
  return text.split('\n').filter((l) => l.includes(' GET /client/v4/accounts/') && l.includes(`/stream/${uid} `)).length;
}

async function waitDoor(shut) {
  for (let i = 0; i < 45; i += 1) {
    const r = await call('/api/creator/money', { accept: 'application/json' });
    const isShut = r.status === 401 && r.json && r.json.privateBeta === true;
    if (isShut === shut) return true;
    await wait(1000);
  }
  return false;
}

async function door() {
  section('The beta door and the catch-all pages');
  const saved = rows('select private_beta from public.site_settings where id = 1')[0];
  sql('update public.site_settings set private_beta = true where id = 1');
  try {
    ok('the door is shut (the middleware has read the switch)', await waitDoor(true));
    const forged = { headers: { 'x-clerk-auth-status': 'signed-out' }, accept: 'text/html' };
    for (const p of ['/crew/calls/x.css', '/messages/x.css', '/crew/calls/board.js', '/messages/thread.png']) {
      const r = await call(p, forged);
      ok(`${p}, signed out with a forged header: 404, not the page`, r.status === 404, `${r.status} ${r.text.slice(0, 120)}`);
    }
    let r = await page('/crew/calls');
    ok('/crew/calls signed out still goes to the door (307 /welcome)', r.status === 307 && /\/welcome/.test(r.headers.get('location') || ''), `${r.status} ${r.headers.get('location')}`);
    for (const p of ['/crew/calls/new/extra', '/messages/a/b', '/crew/calls/x.css']) {
      r = await page(p, MARA);
      ok(`${p} signed in: 404`, r.status === 404, `${r.status}`);
    }
    for (const p of ['/crew/calls', '/crew/calls/new', '/messages']) {
      r = await page(p, MARA);
      ok(`${p} signed in still opens (200)`, r.status === 200, `${r.status}`);
    }
  } finally {
    sql(`update public.site_settings set private_beta = ${saved && saved.private_beta === true ? 'true' : 'false'} where id = 1`);
    await waitDoor(saved && saved.private_beta === true);
  }
}

async function drafts() {
  section('Drafts ask Cloudflare once per video, and stop asking');
  const creator = await member('secdraft', { role: 'creator' });
  const live = hex();
  const gone = hex();
  const old = hex();
  await cloudflare('/__video', { method: 'POST', body: { uid: live, name: 'pending.mp4', creator: creator.id, ready: false } });
  await cloudflare('/__video', { method: 'POST', body: { uid: old, name: 'old.mp4', creator: creator.id, ready: false } });
  const day2 = new Date(Date.now() - 2 * 86400000).toISOString();
  sql(`insert into public.creator_drafts (user_id, form, video_uid, video_state, updated_at) select ${q(creator.id)}, jsonb_build_object('title', 'Check draft ' || g), ${q(live)}, 'uploading', now() from generate_series(1, 40) g`);
  insert('creator_drafts', { user_id: creator.id, form: { title: 'Check draft gone' }, video_uid: gone, video_state: 'uploading' });
  sql(`insert into public.creator_drafts (user_id, form, video_uid, video_state, created_at, updated_at) values (${q(creator.id)}, '{"title":"Check draft old"}'::jsonb, ${q(old)}, 'uploading', ${q(day2)}, ${q(day2)})`);
  const before = { live: cfReads(live), gone: cfReads(gone), old: cfReads(old) };
  let r = await call('/api/creator/drafts', { who: creator });
  ok('the list answers (200, 42 drafts)', r.status === 200 && r.json && r.json.drafts && r.json.drafts.length === 42, `${r.status} ${r.json && r.json.drafts && r.json.drafts.length}`);
  ok('40 drafts on one video: one Cloudflare read', cfReads(live) - before.live === 1, cfReads(live) - before.live);
  ok('a video Cloudflare doesn’t know: one read…', cfReads(gone) - before.gone === 1, cfReads(gone) - before.gone);
  ok('…and the draft is marked failed', (rows(`select video_state from public.creator_drafts where video_uid = ${q(gone)}`)[0] || {}).video_state === 'error');
  ok('a draft unchanged for two days: not asked about', cfReads(old) - before.old === 0, cfReads(old) - before.old);
  r = await call('/api/creator/drafts', { who: creator });
  ok('reading the list again within the minute: no Cloudflare reads at all', r.status === 200 && cfReads(live) - before.live === 1 && cfReads(gone) - before.gone === 1 && cfReads(old) - before.old === 0, { live: cfReads(live) - before.live, gone: cfReads(gone) - before.gone, old: cfReads(old) - before.old });

  sql(`insert into public.creator_drafts (user_id, form) select ${q(creator.id)}, jsonb_build_object('title', 'Check filler ' || g) from generate_series(1, 58) g`);
  r = await call('/api/creator/drafts', { who: creator, method: 'POST', body: { form: { title: 'One too many' } } });
  ok('a 101st draft is refused (409, the cap’s words)', r.status === 409 && r.json && /You have 100 drafts\. Send or discard some first\./.test(r.json.error || ''), `${r.status} ${r.text.slice(0, 160)}`);
  ok('…and nothing was saved', rows(`select count(*)::int as n from public.creator_drafts where user_id = ${q(creator.id)}`)[0].n === 100);
  sql(`delete from public.creator_drafts where user_id = ${q(creator.id)} and form->>'title' like 'Check filler %'`);
  r = await call('/api/creator/drafts', { who: creator, method: 'POST', body: { form: { title: 'Fits again' } } });
  ok('under the cap a new draft saves (200)', r.status === 200 && r.json && r.json.draft && r.json.draft.id, `${r.status} ${r.text.slice(0, 160)}`);
  sql(`delete from public.creator_drafts where user_id = ${q(creator.id)}`);
}

async function photos() {
  section('A place’s photos: the host’s own uploads, drawn quoted');
  const host = await member('sechost');
  const own = (h) => `${ART}/location-photo-${host.id}-${h}.jpg`;
  insert('locations', { id: LOC, host_id: host.id, title: `Check place ${RUN}`, kind: 'studio', status: 'listed', verified: true, day_cents: 50000, cleaning_cents: 0, cancellation: 'moderate', city: 'Los Angeles', place_label: 'Echo Park', lat: 34.08, lng: -118.26, address: '123 Check Street', ownership: 'owner' });
  insert('location_photos', { location_id: LOC, url: own('0a1b2c3d4e5f6a7b8c'), sort_order: 0 });
  const evil = `${own('0a1b2c3d4e5f6a7b8d')}");position:fixed;inset:0;z-index:99999;background:url("https://evil.example/fake-sign-in.png`;
  let r = await call(`/api/locations/${LOC}`, { who: host, method: 'PATCH', body: { photos: [{ url: evil }] } });
  ok('a photo address carrying CSS is dropped (400, no photo left)', r.status === 400 && /Add at least one photo/.test((r.json && r.json.error) || ''), `${r.status} ${r.text.slice(0, 160)}`);
  r = await call(`/api/locations/${LOC}`, { who: host, method: 'PATCH', body: { photos: [{ url: `${ART}/location-photo-${USERS.mara}-0a1b2c3d4e5f6a7b8c.jpg` }] } });
  ok('another host’s upload is refused', r.status === 400, `${r.status} ${r.text.slice(0, 160)}`);
  r = await call(`/api/locations/${LOC}`, { who: host, method: 'PATCH', body: { photos: [{ url: 'https://evil.example/location-photo.jpg' }] } });
  ok('a picture hosted anywhere else is refused', r.status === 400, `${r.status} ${r.text.slice(0, 160)}`);
  r = await call(`/api/locations/${LOC}`, { who: host, method: 'PATCH', body: { photos: [{ url: own('1a1b2c3d4e5f6a7b8c'), caption: 'Front' }, { url: evil }] } });
  const stored = rows(`select url from public.location_photos where location_id = ${q(LOC)} order by sort_order`).map((x) => x.url);
  ok('the host’s own upload saves, the CSS one beside it doesn’t', r.status === 200 && stored.length === 1 && stored[0] === own('1a1b2c3d4e5f6a7b8c'), { status: r.status, stored });

  // A payload stored before the check (the row written straight into the table).
  sql(`delete from public.location_photos where location_id = ${q(LOC)}`);
  insert('location_photos', { location_id: LOC, url: evil, sort_order: 0 });
  r = await page(`/locations/${LOC}`, MARA);
  ok('the listing still opens (200)', r.status === 200, r.status);
  ok('…its stored address is drawn quoted, every quote inside escaped', r.text.includes('\\&quot;);position:fixed') && !/[^\\]&quot;\);position:fixed/.test(r.text), (r.text.match(/background-image:[^"]{0,220}/) || [''])[0]);
  r = await page('/locations', MARA);
  ok('the directory too', r.status === 200 && !/[^\\]&quot;\);position:fixed/.test(r.text), r.status);
}

async function appReturn() {
  section('The way back to the app forwards only to the app');
  const follow = async (app) => {
    const r = await call(`/api/checkout-return?app=${encodeURIComponent(app)}&kind=tip&status=paid&id=abc`, { accept: 'text/html' });
    return { status: r.status, location: r.headers.get('location') };
  };
  let f = await follow('exp://192.168.1.20:8081/--/checkout-return');
  ok('Expo Go on the PC’s network: forwarded', f.status === 302 && f.location === 'exp://192.168.1.20:8081/--/checkout-return?kind=tip&status=paid&id=abc', f);
  f = await follow('exp://u.expo.dev/217f9775-b623-406f-bbfa-54fbe11eeefa/--/checkout-return');
  ok('Expo Go from an EAS Update: forwarded', f.status === 302 && /^exp:\/\/u\.expo\.dev\//.test(f.location || ''), f);
  for (const app of ['exp://evil.example/--/checkout-return', 'exp://evil.example:8081/x/--/checkout-return', 'exps://abc-anonymous-8081.exp.direct/--/checkout-return', 'exp://8.8.8.8/--/checkout-return']) {
    f = await follow(app);
    ok(`${app}: sent home instead`, f.status === 302 && f.location === '/', f);
  }
}

async function referral() {
  section('The referral cookie is set only where the link lands');
  const cookieOf = (r) => /tapa_via=([^;]+)/.exec(r.headers.get('set-cookie') || '');
  let r = await page('/stream?via=mara');
  ok('?via= on any other page sets nothing', !cookieOf(r), r.headers.get('set-cookie'));
  r = await page('/profile/dee?via=mara');
  ok('?via= on someone else’s profile sets nothing', !cookieOf(r), r.headers.get('set-cookie'));
  r = await page('/profile/mara?via=mara');
  const c = cookieOf(r);
  ok('/profile/mara?via=mara (where /@mara lands) sets it', c && c[1] === 'mara', r.headers.get('set-cookie'));
}

async function cron() {
  section('A cross-site POST to a cron route is refused');
  const r = await call('/api/cron/creator-reminders', { who: ADMIN, method: 'POST', headers: { Origin: 'https://evil.example' }, body: {} });
  ok('refused before the route runs (403)', r.status === 403 && /other websites/.test((r.json && r.json.error) || ''), `${r.status} ${r.text.slice(0, 160)}`);
}

async function videos() {
  section('House ads and Film University take no video another title uses');
  const filmUid = uidFor(IDS.nbS1E3);
  let r = await call(`/api/admin/house-ads-cloudflare-status?uid=${filmUid}`, { who: ADMIN });
  ok('a house ad’s MP4 can’t be switched on for a film’s video (403)', r.status === 403, `${r.status} ${r.text.slice(0, 160)}`);
  r = await call('/api/admin/house-ads', { who: ADMIN, method: 'POST', body: { title: `Check ad ${RUN}`, cloudflareUid: filmUid, durationSeconds: 15 } });
  ok('…nor an ad made from it (403)', r.status === 403, `${r.status} ${r.text.slice(0, 160)}`);
  const fresh = hex();
  await cloudflare('/__video', { method: 'POST', body: { uid: fresh, name: 'ad.mp4', creator: USERS.admin, duration: 15, ready: true } });
  r = await call(`/api/admin/house-ads-cloudflare-status?uid=${fresh}`, { who: ADMIN });
  ok('the ad’s own fresh upload polls as before (200)', r.status === 200 && r.json && r.json.stage, `${r.status} ${r.text.slice(0, 160)}`);

  const uni = await member('secuni', { role: 'sub_admin' });
  await clerk(`/__users/${uni.id}`, { method: 'POST', body: { permissions: ['manage_university'], twoFactorEnabled: true } });
  const lesson = (extra) => ({ type: 'lesson', title: `Check lesson ${RUN}`, courseId: crypto.randomUUID(), kind: 'video', coverUrl: 'https://example.com/cover.jpg', ...extra });
  r = await call('/api/admin/university', { who: uni, method: 'POST', body: lesson({ cloudflareUid: filmUid }) });
  ok('a University sub-admin can’t make a lesson of a film (403)', r.status === 403 && /used elsewhere/.test((r.json && r.json.error) || ''), `${r.status} ${r.text.slice(0, 160)}`);
  r = await call('/api/admin/university', { who: uni, method: 'POST', body: lesson({ videoSrc: `https://customer-x.cloudflarestream.com/${filmUid}/manifest/video.m3u8` }) });
  ok('…nor type a video address (403)', r.status === 403 && /full admin/.test((r.json && r.json.error) || ''), `${r.status} ${r.text.slice(0, 160)}`);
  r = await call('/api/admin/university', { who: uni, method: 'POST', body: lesson({ cloudflareUid: 'not a uid!' }) });
  ok('…and a uid that isn’t one is refused (400)', r.status === 400 && /video id/.test((r.json && r.json.error) || ''), `${r.status} ${r.text.slice(0, 160)}`);
  const own = hex();
  await cloudflare('/__video', { method: 'POST', body: { uid: own, name: 'lesson.mp4', duration: 60, ready: true } });
  r = await call('/api/admin/university', { who: uni, method: 'POST', body: lesson({ cloudflareUid: own }) });
  ok('…their own fresh upload passes the video check (on to the course check)', r.status === 400 && /course no longer exists/.test((r.json && r.json.error) || ''), `${r.status} ${r.text.slice(0, 160)}`);
  r = await call('/api/admin/university', { who: ADMIN, method: 'POST', body: lesson({ cloudflareUid: filmUid }) });
  ok('a full admin may (on to the course check)', r.status === 400 && /course no longer exists/.test((r.json && r.json.error) || ''), `${r.status} ${r.text.slice(0, 160)}`);
}

async function suspended() {
  section('A suspended account gets no video link');
  const who = await member('secsus');
  const clean = await member('secok');
  insert('account_suspensions', { user_id: who.id, scope: 'all', public_reason: 'Check: suspended for the security check.', created_by: 'check' });
  const id = crypto.randomUUID();
  const reads = [
    ['a snippet', `/api/vertical/playback?episodeId=post:${id}`],
    ['a self-tape', `/api/crew/self-tape-play?callId=${id}&responseId=${crypto.randomUUID()}`]
  ];
  for (const [label, p] of reads) {
    let r = await call(p, { who });
    ok(`${label}: refused for the suspended account (403, suspended)`, r.status === 403 && r.json && r.json.suspended === true, `${r.status} ${r.text.slice(0, 160)}`);
    r = await call(p, { who: clean });
    ok(`${label}: another account gets the usual answer (404)`, r.status === 404, `${r.status} ${r.text.slice(0, 160)}`);
  }
  for (const [label, p, body] of [['a lesson', '/api/university/stream-token', { lessonId: crypto.randomUUID() }], ['Live TV', '/api/channel/play', { channel: 'tapatv' }]]) {
    const r = await call(p, { who, method: 'POST', bearer: true, body });
    ok(`${label}: refused for the suspended account (403, suspended)`, r.status === 403 && r.json && r.json.suspended, `${r.status} ${r.text.slice(0, 160)}`);
  }
  sql(`delete from public.account_suspensions where user_id = ${q(who.id)}`);

  section('No suspension while the target’s role can’t be read');
  const target = await member('sectarget');
  await clerk(`/__fail?user=${encodeURIComponent(target.id)}&on=1`, { method: 'POST' });
  try {
    const r = await call('/api/admin/accounts', { who: ADMIN, method: 'POST', body: { action: 'suspend', userId: target.id, scope: 'all', publicReason: 'Check: a suspension while Clerk is down.' } });
    ok('refused (503, try again)', r.status === 503 && /Couldn’t check their role/.test((r.json && r.json.error) || ''), `${r.status} ${r.text.slice(0, 160)}`);
    ok('…and nothing was written', rows(`select id from public.account_suspensions where user_id = ${q(target.id)}`).length === 0);
  } finally {
    await clerk(`/__fail?user=${encodeURIComponent(target.id)}&on=0`, { method: 'POST' });
    sql(`delete from public.account_suspensions where user_id = ${q(target.id)}`);
  }
}

async function twoStep() {
  section('Two-step for the team covers a sub-admin on the API');
  const sub = await member('sec2fa', { role: 'sub_admin' });
  await clerk(`/__users/${sub.id}`, { method: 'POST', body: { permissions: ['manage_episodes'], twoFactorEnabled: false } });
  let r = await call('/api/admin/pending-edits', { who: sub });
  ok('with the requirement off, the capability works (200)', r.status === 200, `${r.status} ${r.text.slice(0, 120)}`);
  const saved = rows('select admin_require_2fa from public.site_settings where id = 1')[0];
  sql('update public.site_settings set admin_require_2fa = true where id = 1');
  try {
    let refused = false;
    for (let i = 0; i < 45 && !refused; i += 1) {
      r = await call('/api/admin/pending-edits', { who: sub });
      refused = r.status === 403;
      if (!refused) await wait(1000);
    }
    ok('switched on: the same sub-admin without two-step is refused (403)', refused, `${r.status} ${r.text.slice(0, 120)}`);
  } finally {
    sql(`update public.site_settings set admin_require_2fa = ${saved && saved.admin_require_2fa === true ? 'true' : 'false'} where id = 1`);
  }
  for (let i = 0; i < 45; i += 1) {
    r = await call('/api/admin/pending-edits', { who: sub });
    if (r.status === 200) break;
    await wait(1000);
  }
  ok('switched back: it works again', r.status === 200, r.status);
}

await runCheck('sec-platform', async () => {
  try {
    await door();
    await drafts();
    await photos();
    await appReturn();
    await referral();
    await cron();
    await videos();
    await suspended();
    await twoStep();
  } finally {
    const ids = people.map(q).join(', ') || "''";
    sql(`delete from public.creator_drafts where user_id in (${ids})`);
    sql(`delete from public.location_photos where location_id = ${q(LOC)}`);
    sql(`delete from public.locations where id = ${q(LOC)}`);
    sql(`delete from public.account_suspensions where user_id in (${ids})`);
    sql(`delete from public.house_ads where title = ${q(`Check ad ${RUN}`)}`);
    sql(`delete from public.notifications where user_id in (${ids})`);
    for (const id of people) await removeUser(id);
  }
});
