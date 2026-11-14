#!/usr/bin/env node
// Downloads in the app (2026-11-14; contract mockups/app-downloads-contract.md,
// migration 123), called the way the app calls: Authorization: Bearer, no
// Origin, no cookie (the website's own calls with the cookie; start, sync
// and remove refuse those).
//
// After 123:
//   the switch       Admin → Downloads: a full admin turns it on and off,
//                    locks it, a locked flip is refused, unlocking needs
//                    the word; a sub-admin holding every capability, a
//                    creator, a viewer and signed out are refused; one
//                    audit line per change; /api/site-settings follows it
//   who may download Basic and Standard `plan`, Premium, Sponsor, the team
//                    (an admin and a sub-admin), a buyer on Basic; a title
//                    its maker switched off `title`; a podcast and a file
//                    that isn't Cloudflare's `kind`; signed out 401;
//                    suspended 403; the gate's own answers (no terms, no
//                    plan for a premium title); /api/episode-page's and
//                    the website page's `download`
//   the link         202 while Cloudflare makes the file (the title holds
//                    its place without a date), then a link that
//                    really downloads from the fake (whole and by range)
//                    with the `downloadable` claim; a playback token and
//                    the bare uid don't; a video Cloudflare doesn't have
//                    is 503 `cloudflare`
//   the dates        a member: paid-through + 2 days, capped at 33 days
//                    without connecting; a buyer and the team: 30 days; a
//                    promo never past its end
//   the two limits   25 titles on a phone, 2 phones an account; removing a
//                    title or a phone frees the place
//   new copies       asking again never counts; 30 new copies an hour and
//                    60 a day per account (429 says which, and for how
//                    long); the same title on the same phone again isn't
//                    a new copy; a title is counted at its first ask, the
//                    asks while its file is made are not
//   racing           ten titles at once onto a phone with room for one,
//                    six phones at once beside one that holds a copy, six
//                    new copies at once with room for two: the limits hold
//   only the app     start, sync and remove refuse a browser's session
//                    cookie and a request with an Origin or Sec-Fetch-Site
//                    header (403 `app-only`); the list of phones stays
//                    open to the website
//   the check-in     a copy the phone no longer lists frees its slot (only
//                    after a link's life); a plan that ended (`ended`,
//                    `keepUntil`, set once, cleared on rejoining); a bought
//                    copy refunded; a title switched off, pulled or on its
//                    way out (`revoked`; an owner keeps a withdrawn one);
//                    the switch off (`paused`, nothing renewed); a phone
//                    removed from the website (`deviceRemoved`); a
//                    check-in without its list is refused and frees
//                    nothing; and never on a guess: Clerk not answering,
//                    or the purchases, the comped list, a promo's date, a
//                    suspension or the settings unreadable, answers 503
//                    `unavailable` and changes nothing — a buyer on Basic
//                    is never told "plan", no link goes out on an older
//                    "on"
//   the creator's switch  the uploader and the show's owner in every
//                    state, the team (the show editor's save and the
//                    Library's), someone else refused; the Library's row;
//                    Your work's two edit boxes for a film or a short
//   the pages        /admin/downloads for a full admin at 390 and 1280 (a
//                    real click on the switch, the lock, UNLOCK), a
//                    sub-admin sent away; /downloads signed out and with
//                    phones (Remove this phone); the tab bar's row; the AI
//                    policy's sentence only while the switch is on
// Before 123 (RIG_MIGRATE_TO=122 RIG_REBUILD=1 dev/test-rig/start.sh): every
// route's 503 `migration-123`, the switch reading off, the creator's
// switch greyed and refused, the admin page's banner.
//   node dev/test-rig/checks/downloads.mjs
// RIG_CHECK_SKIP_REVOKE=1 leaves out the parts that take SELECT on a table
// (purchases, comped_access, user_profiles, account_suspensions,
// site_settings) from service_role for a moment.
import crypto from 'node:crypto';
import { IDS, USERS, RUN, BASE, FAKES, ok, section, runCheck, call, sql, rows, q, insert, hasColumn, session, newUser, removeUser, clerk, stripeHook, stripeApi, cloudflare, forgetInvoiceEvents, ago, browser, goto, overflowPx, SIGNED_OUT } from './lib.mjs';
import { FAKE_KEYS } from '../lib/config.mjs';
import { CHECKIN_DAYS, DOWNLOAD_WORDS, GRACE_DAYS, KEEP_AFTER_END_DAYS, LINK_SECONDS, MAX_DEVICES, MAX_TITLES_PER_DEVICE, MEMBER_MAX_DAYS, playState } from '../../../lib/downloadRules.js';
import { ADMIN_DOWNLOAD_WORDS, DOWNLOADS_ALLOWED_LABEL, MIGRATION_123_MSG, NEW_COPIES_PER_DAY, NEW_COPIES_PER_HOUR, RATE_WORDS, START_WORDS, SWITCH_CHANGES_PER_HOUR, UNAVAILABLE_LINE, UNDONE_REASON, UNLOCK_WORD } from '../../../lib/downloadSiteRules.js';

const HAS123 = hasColumn('site_settings', 'downloads_enabled');
const DAY = 86400000;
const SKIP_REVOKE = process.env.RIG_CHECK_SKIP_REVOKE === '1';
// The tables a part of this check takes SELECT from for a moment.
const REVOKED = ['purchases', 'comped_access', 'user_profiles', 'account_suspensions', 'site_settings'];
const MARA = session(USERS.mara);
const DEE = session(USERS.dee);

// Every account gets an address of its own, as phones would (the routes
// keep a per-address limit beside the per-account one).
let ipSeq = 0;
const runByte = parseInt(RUN.slice(0, 2), 16);
const ipOf = new Map();
const ip = (who) => {
  const k = (who && who.userId) || 'signed-out';
  if (!ipOf.has(k)) { ipSeq += 1; ipOf.set(k, `10.${runByte}.${Math.floor(ipSeq / 250)}.${(ipSeq % 250) + 1}`); }
  return ipOf.get(k);
};
const app = (who) => ({ who, bearer: true, headers: { 'X-Forwarded-For': ip(who) } });
const web = (who) => ({ who, headers: { 'X-Forwarded-For': ip(who) } });
const get = (path, who) => call(path, app(who));
const post = (path, who, body) => call(path, { ...app(who), method: 'POST', body });
const phone = (tag) => `ck${tag}_${RUN}_${crypto.randomBytes(6).toString('hex')}`;
const start = (who, episodeId, deviceId, extra = {}) => post('/api/downloads/start', who, { episodeId, deviceId, deviceName: 'Check phone', platform: 'ios', terms: 1, ...extra });
const sync = (who, deviceId, have, extra = {}) => post('/api/downloads/sync', who, { deviceId, deviceName: 'Check phone', platform: 'ios', have, ...extra });
// Cloudflare makes the file on the first ask (202), then hands the link.
async function download(who, episodeId, deviceId, extra) {
  let r = await start(who, episodeId, deviceId, extra);
  for (let i = 0; i < 3 && r.status === 202; i += 1) r = await start(who, episodeId, deviceId, extra);
  return r;
}
const brief = (r) => `${r.status} ${r.text.slice(0, 240)}`;
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
// A flip of the switch reaches the API routes of the instance that made
// it at once, and every other reader (the pages, another instance) within
// about half a minute (lib/securitySwitches.js keeps the settings row that
// long): a page that follows the switch is asked until it does.
async function eventually(ask, good, seconds = 45) {
  const until = Date.now() + seconds * 1000;
  let r = await ask();
  while (!good(r) && Date.now() < until) {
    await sleep(2500);
    r = await ask();
  }
  return r;
}
const near = (a, b, slack = 5000) => Math.abs(Date.parse(a) - Date.parse(b)) <= slack;
// The site's own key can't read `table` while `work` runs.
async function unreadable(table, work) {
  sql(`revoke select on public.${table} from service_role`);
  try {
    return await work();
  } finally {
    sql(`grant select on public.${table} to service_role`);
  }
}
const isUnavailable = (r) => r.status === 503 && r.json && r.json.code === 'unavailable' && r.json.error === UNAVAILABLE_LINE;

const UID = { main: crypto.randomBytes(16).toString('hex'), slow: crypto.randomBytes(16).toString('hex'), gone: crypto.randomBytes(16).toString('hex'), open: crypto.randomBytes(16).toString('hex'), wait: crypto.randomBytes(16).toString('hex') };
const srcOf = (uid) => `https://customer-test.cloudflarestream.com/${uid}/manifest/video.m3u8`;
const ID = {
  film: `ck-dl-film-${RUN}`, // free, Mara's
  prem: `ck-dl-prem-${RUN}`, // premium, Mara's
  off: `ck-dl-off-${RUN}`, // its maker switched downloads off
  pod: `ck-dl-pod-${RUN}`, // a podcast episode with a video
  plain: `ck-dl-plain-${RUN}`, // a file that isn't Cloudflare's
  bought: `ck-dl-bought-${RUN}`, // premium, bought by a Basic account
  slow: `ck-dl-slow-${RUN}`, // Cloudflare is still making its file
  gone: `ck-dl-gone-${RUN}`, // Cloudflare doesn't have its video
  held: `ck-dl-held-${RUN}`, // pulled later
  leaving: `ck-dl-leaving-${RUN}`, // its removal asked for later
  teen: `ck-dl-teen-${RUN}`, // rated TV-14: the viewing terms first
  open: `ck-dl-open-${RUN}`, // its video doesn't demand signed links yet
  wait: `ck-dl-wait-${RUN}`, // Cloudflare takes its time over this one's file
  review: `ck-dl-review-${RUN}`, // Mara's short, still in review
  freebuy: `ck-dl-freebuy-${RUN}`, // a free title someone bought anyway
  show: `ck-dl-show-${RUN}`, // Mara's show
  showEp: `ck-dl-show-ep-${RUN}` // an episode of it, uploaded by Dee
};
const LIMIT = Array.from({ length: MAX_TITLES_PER_DEVICE + 1 }, (_, i) => `ck-dl-lim${String(i).padStart(2, '0')}-${RUN}`);
const people = [];
const admins = [];
const invoices = [];
let before = null;

const film = (id, extra = {}) => ({
  id, title: `Check download ${id.slice(6, 12)} ${RUN}`, description: 'Downloads in the app.', tier: 'free', genre: 'Drama', main_genre: 'Drama', content_type: 'movie', artist: 'Mara Reyes',
  runtime: '24:00', rating: 'TV-PG', release_year: 2026, src: srcOf(UID.main), video_type: 'html5', video_provider: 'cloudflare', ads_enabled: true,
  deletion_requested: false, moderation_hold: false, submitted_by: USERS.mara, status: 'approved', reviewed_at: ago(40), released_at: ago(40), created_at: ago(41), ...extra
});

async function seed() {
  for (const uid of [UID.main, UID.slow, UID.wait]) await cloudflare('/__video', { method: 'POST', body: { uid, name: `Check download ${RUN}`, creator: USERS.mara, duration: 1440, ready: true, requireSignedURLs: true } });
  insert('episodes', film(ID.wait, { src: srcOf(UID.wait) }));
  insert('episodes', film(ID.review, { content_type: 'short', status: 'pending', reviewed_at: null, released_at: null }));
  insert('episodes', film(ID.freebuy));
  insert('episodes', film(ID.film));
  insert('episodes', film(ID.prem, { tier: 'premium' }));
  insert('episodes', film(ID.off, { downloads_allowed: false }));
  insert('episodes', film(ID.pod, { content_type: 'podcast' }));
  insert('episodes', film(ID.plain, { src: 'https://127.0.0.1:54331/storage/v1/object/public/episode-art/rig/check-plain.mp4' }));
  insert('episodes', film(ID.bought, { tier: 'premium' }));
  insert('episodes', film(ID.slow, { src: srcOf(UID.slow) }));
  insert('episodes', film(ID.gone, { src: srcOf(UID.gone) }));
  insert('episodes', film(ID.held));
  insert('episodes', film(ID.leaving));
  insert('episodes', film(ID.teen, { rating: 'TV-14', has_flashing_lights: true }));
  await cloudflare('/__video', { method: 'POST', body: { uid: UID.open, name: `Check download open ${RUN}`, creator: USERS.mara, duration: 1440, ready: true, requireSignedURLs: false } });
  insert('episodes', film(ID.open, { src: srcOf(UID.open) }));
  insert('series', { id: ID.show, name: `Check download show ${RUN}`, description: 'Downloads in the app.', creator_id: USERS.mara, status: 'approved', kind: 'series', public_at: ago(30) });
  insert('episodes', film(ID.showEp, { content_type: 'series', series_id: ID.show, season: 1, series_order: 1, submitted_by: USERS.dee, artist: 'Dee Park' }));
  for (const id of LIMIT) insert('episodes', film(id));
}

async function cleanup() {
  for (const t of REVOKED) sql(`grant select on public.${t} to service_role`);
  await clerk('/__fail?user=*&on=0', { method: 'POST' });
  const eps = [...Object.values(ID).filter((id) => id !== ID.show), ...LIMIT].map(q).join(', ');
  const ids = people.map(q).join(', ') || "''";
  await forgetInvoiceEvents({ members: people, invoices });
  const subs = (await stripeHook('/__state')).json.objects.filter((o) => o.object === 'subscription' && o.metadata && people.includes(o.metadata.member) && o.status !== 'canceled');
  for (const s of subs) await stripeApi(`/subscriptions/${s.id}`, { method: 'DELETE' });
  if (HAS123) {
    sql(`delete from public.downloads where user_id in (${ids}) or episode_id in (${eps})`);
    sql(`delete from public.download_devices where user_id in (${ids})`);
  }
  sql(`delete from public.account_suspensions where user_id in (${ids})`);
  sql(`delete from public.comped_access where email like ${q(`%-${RUN}@rig.example.com`)}`);
  sql(`delete from public.purchases where buyer_id in (${ids})`);
  sql(`delete from public.creator_ledger where member_id in (${ids})`);
  sql(`delete from public.member_referrals where user_id in (${ids})`);
  sql(`delete from public.member_payments where user_id in (${ids})`);
  sql(`delete from public.member_customers where user_id in (${ids})`);
  sql(`delete from public.member_lineups where user_id in (${ids})`);
  sql(`delete from public.audit_log where admin_id in (${ids}) or target_id in (${eps}) or (action = 'downloads_switch' and admin_id in (${ids}))`);
  sql(`delete from public.notifications where user_id in (${ids}) or episode_id in (${eps})`);
  sql(`delete from public.episodes where id in (${eps})`);
  sql(`delete from public.series where id = ${q(ID.show)}`);
  for (const uid of [UID.main, UID.slow, UID.open, UID.wait]) await fetch(`${FAKES.cloudflare}/client/v4/accounts/rig/stream/${uid}`, { method: 'DELETE', headers: { Authorization: `Bearer ${FAKE_KEYS.cloudflareToken}` } }).catch(() => {});
  if (before) sql(`update public.site_settings set downloads_enabled = ${before.enabled}, downloads_locked = ${before.locked} where id = 1`);
  for (const id of people) await removeUser(id);
}

async function person(tag, opts) {
  const m = await newUser(tag, opts);
  people.push(m.id);
  return m;
}
async function teamAdmin(tag) {
  const a = await person(tag, { role: 'admin' });
  admins.push(a.id);
  return a;
}
async function subAdmin(tag, permissions) {
  const s = await person(tag);
  await clerk(`/__users/${s.id}`, { method: 'POST', body: { role: 'sub_admin', permissions, twoFactorEnabled: true } });
  return s;
}
// A member through the fake Stripe's Checkout, as the website subscribes.
async function subscribe(who, tier) {
  const r = await call('/api/create-checkout-session', { ...web(who), method: 'POST', body: { tier } });
  const sid = r.json && r.json.url ? r.json.url.split('/checkout/')[1] : null;
  if (!sid) return false;
  const done = await stripeHook(`/__checkout/${sid}/complete`, { method: 'POST' });
  const objs = (await stripeHook('/__state')).json.objects;
  for (const o of objs) if (o.object === 'invoice' && o.customer && done.json && done.json.session && o.customer === done.json.session.customer) invoices.push(o.id);
  return done.status === 200;
}
const subscriptionOf = async (who) => ((await stripeHook('/__state')).json.objects.find((o) => o.object === 'subscription' && o.metadata && o.metadata.member === who.id && o.status === 'active') || null);
const buy = (who, type, id) => insert('purchases', { buyer_id: who.id, target_type: type, target_id: id, creator_id: USERS.mara, title: 'Check', price_cents: 199, paid_cents: 199, creator_cents: 129, fee_cents: 36, platform_cents: 70, status: 'completed', completed_at: ago(1) });

const ALL_CAPS = ['manage_episodes', 'review_submissions', 'manage_deletions', 'manage_artwork', 'manage_schedule', 'manage_house_ads', 'manage_live', 'manage_applications', 'manage_content_lifecycle', 'manage_genre_icons', 'view_all_content', 'handle_flags', 'manage_comped_access', 'manage_university'];
const settingsNow = () => rows('select downloads_enabled as enabled, downloads_locked as locked from public.site_settings where id = 1')[0];
const adminPost = (who, body) => call('/api/admin/downloads', { ...app(who), method: 'POST', body });
const auditOf = (who) => rows(`select details, target_id, admin_email from public.audit_log where action = 'downloads_switch' and admin_id = ${q(who.id)} order by created_at`);
const copy = (who, deviceId, episodeId) => rows(`select status, basis, licensed_until, ended_at, renewed_at, removed_at, revoke_reason from public.downloads where user_id = ${q(who.id)} and device_id = ${q(deviceId)} and episode_id = ${q(episodeId)} order by created_at desc limit 1`)[0] || null;
const activeCount = (who, deviceId) => Number(rows(`select count(*)::int as n from public.downloads where user_id = ${q(who.id)} and device_id = ${q(deviceId)} and status = 'active'`)[0].n);
// The copies on a phone (a title still waiting for its file isn't one), and
// a check-in that lists them all — so that nothing is freed by the way.
const copiesOn = (who, deviceId) => rows(`select episode_id from public.downloads where user_id = ${q(who.id)} and device_id = ${q(deviceId)} and status = 'active' and licensed_until is not null order by created_at`).map((x) => x.episode_id);
const syncAll = (who, deviceId) => sync(who, deviceId, copiesOn(who, deviceId));
// Rows on record as if made earlier: copies a phone holds, or titles it
// asked for and no longer has.
function pastRows(who, deviceId, count, { tag, status = 'active', ago: back = '2 days' }) {
  sql(`insert into public.downloads (user_id, device_id, episode_id, basis, status, licensed_until, renewed_at, created_at, removed_at)
    select ${q(who.id)}, ${q(deviceId)}, 'ck-dl-${tag}' || g || '-${RUN}', 'member', ${q(status)}, now() + interval '20 days', now() - interval '${back}', now() - interval '${back}', ${status === 'active' ? 'null' : 'now()'}
    from generate_series(1, ${count}) g`);
}
const phoneRow = (who, deviceId, name = 'Check phone') => insert('download_devices', { user_id: who.id, device_id: deviceId, name, platform: 'ios' });
// The account's rows that count as new copies in the last hour.
const countedThisHour = (who) => Number(rows(`select count(*)::int as n from public.downloads where user_id = ${q(who.id)} and created_at > now() - interval '1 hour' and revoke_reason is distinct from ${q(UNDONE_REASON)}`)[0].n);
const item = (r, id) => (r.json && Array.isArray(r.json.items) ? r.json.items.find((x) => x.episodeId === id) : null) || null;
const offer = async (who, id) => {
  const r = await get(`/api/episode-page?id=${encodeURIComponent(id)}&terms=1`, who);
  return r.json ? r.json.download : null;
};
async function setSwitch(admin, on) {
  const r = await adminPost(admin, { enabled: on });
  if (r.status !== 200) throw new Error(`couldn’t switch downloads ${on ? 'on' : 'off'}: ${brief(r)}`);
}

// ---- the switch ------------------------------------------------------------------
async function theSwitch(ctx) {
  section('The switch (Admin → Downloads)');
  const { admin, sub, viewer } = ctx;
  let r = await get('/api/site-settings', viewer);
  ok('/api/site-settings carries downloadsEnabled (off to start)', r.status === 200 && r.json.downloadsEnabled === false, r.json && r.json.downloadsEnabled);
  for (const [who, name] of [[sub, 'a sub-admin holding every capability'], [MARA, 'a creator'], [viewer, 'a viewer'], [SIGNED_OUT, 'signed out']]) {
    const g = await get('/api/admin/downloads', who);
    const p = await adminPost(who, { enabled: true });
    const u = await adminPost(who, { locked: false, confirm: UNLOCK_WORD });
    ok(`${name}: the admin route refuses the read, the flip and the unlock (403)`, g.status === 403 && p.status === 403 && u.status === 403, `${g.status} ${p.status} ${u.status}`);
  }
  ok('…and nothing changed', settingsNow().enabled === false && settingsNow().locked === false);

  r = await get('/api/admin/downloads', admin);
  ok('a full admin reads the switch, the numbers and the list', r.status === 200 && r.json.switch.available === true && r.json.switch.enabled === false && r.json.switch.locked === false
    && ['phones', 'copies', 'titlesOff'].every((k) => Number.isInteger(r.json.numbers[k])) && Array.isArray(r.json.titlesOff), brief(r));
  ok('…the titles switched off include the check’s', r.json.titlesOff.some((t) => t.id === ID.off) && r.json.numbers.titlesOff >= 1, r.json.titlesOff);

  r = await adminPost(admin, { enabled: true });
  ok('the admin turns it on', r.status === 200 && r.json.switch.enabled === true && settingsNow().enabled === true, brief(r));
  ok('…the answer says when and who', r.json.switch.changedBy === admin.email && near(r.json.switch.changedAt, new Date().toISOString(), 20000), r.json.switch);
  r = await get('/api/site-settings', viewer);
  ok('…and /api/site-settings says on', r.json.downloadsEnabled === true);
  r = await adminPost(admin, { enabled: true });
  ok('on again changes nothing (no second audit line)', r.status === 200 && auditOf(admin).length === 1, auditOf(admin).length);

  r = await adminPost(admin, { locked: true });
  ok('the admin locks it', r.status === 200 && r.json.switch.locked === true && r.json.switch.lockedBy === admin.email && Boolean(r.json.switch.lockedAt) && settingsNow().locked === true, brief(r));
  r = await adminPost(admin, { enabled: false });
  ok('locked: a flip is refused (409 locked), and it stays on', r.status === 409 && r.json.code === 'locked' && settingsNow().enabled === true, brief(r));
  r = await adminPost(admin, { locked: false });
  ok('unlocking without the word is refused (400 confirm)', r.status === 400 && r.json.code === 'confirm' && settingsNow().locked === true, brief(r));
  r = await adminPost(admin, { locked: false, confirm: 'unlock' });
  ok('…and with the word in the wrong case', r.status === 400 && r.json.code === 'confirm', brief(r));
  r = await adminPost(sub, { locked: false, confirm: UNLOCK_WORD });
  ok('a sub-admin can’t unlock it even with the word', r.status === 403 && settingsNow().locked === true, brief(r));
  r = await adminPost(admin, { locked: false, confirm: UNLOCK_WORD });
  ok('the admin unlocks it with the word', r.status === 200 && r.json.switch.locked === false && r.json.switch.lockedAt === null && settingsNow().locked === false, brief(r));
  r = await adminPost(admin, { enabled: 'yes' });
  const both = await adminPost(admin, { enabled: false, locked: true });
  ok('a value that isn’t on or off, and two changes at once, are refused (400)', r.status === 400 && both.status === 400 && settingsNow().enabled === true && settingsNow().locked === false, `${r.status} ${both.status}`);

  const lines = auditOf(admin).map((a) => ({ ...JSON.parse(a.details), target: a.target_id, email: a.admin_email }));
  ok('one audit line per change: on, locked, unlocked', lines.length === 3
    && lines[0].field === 'enabled' && lines[0].from === false && lines[0].to === true && lines[0].target === 'downloads_enabled'
    && lines[1].field === 'locked' && lines[1].to === true && lines[2].field === 'locked' && lines[2].to === false && lines.every((l) => l.email === admin.email), lines);
  r = await get('/api/admin/audit-log', admin);
  const mine = ((r.json && r.json.entries) || []).filter((e) => e.action === 'downloads_switch' && e.adminEmail === admin.email);
  ok('the audit log prints their words', mine.some((e) => e.words === 'Downloads off → on') && mine.some((e) => e.words === 'the Downloads switch locked'), mine.map((e) => e.words));
  // 30 changes an hour: a fresh admin's 31st ask in a row is turned away
  // (asks the route refuses count too), and nothing was written.
  const busy = await teamAdmin('dlbusy');
  let last = null;
  for (let i = 0; i < SWITCH_CHANGES_PER_HOUR + 1; i += 1) last = await adminPost(busy, { enabled: 'x' });
  ok(`the ${SWITCH_CHANGES_PER_HOUR + 1}st change an admin asks for within the hour is 429`, last.status === 429 && auditOf(busy).length === 0 && settingsNow().enabled === true, brief(last));
  r = await get('/api/admin/security?page=security', admin);
  ok('…and Admin → Security’s latest events list them', r.status === 200 && r.json.alerts.events.some((e) => /Downloads|the Downloads switch/.test(e.line)), r.json && r.json.alerts && r.json.alerts.events);
}

// ---- who may download ---------------------------------------------------------------
async function whoMayDownload(ctx) {
  section('Who may download (the switch on)');
  const { admin, sub, viewer, standard, premium, sponsor, buyer } = ctx;
  let r = await start(SIGNED_OUT, ID.film, phone('out'));
  ok('signed out: 401', r.status === 401, brief(r));
  r = await get('/api/downloads', SIGNED_OUT);
  const r2 = await post('/api/downloads/sync', SIGNED_OUT, { deviceId: phone('out'), have: [] });
  ok('…and the list and the check-in too', r.status === 401 && r2.status === 401, `${r.status} ${r2.status}`);

  const want = [
    [SIGNED_OUT, ID.film, { state: 'signin' }, 'signed out'],
    [viewer, ID.film, { state: 'plan' }, 'Basic'],
    [standard, ID.film, { state: 'plan' }, 'Standard'],
    [premium, ID.film, { state: 'ok', basis: 'member' }, 'Premium'],
    [sponsor, ID.film, { state: 'ok', basis: 'member' }, 'Sponsor'],
    [admin, ID.film, { state: 'ok', basis: 'member' }, 'a full admin'],
    [sub, ID.film, { state: 'ok', basis: 'member' }, 'a sub-admin'],
    [buyer, ID.bought, { state: 'ok', basis: 'owned' }, 'a buyer on Basic, the title they bought'],
    [buyer, ID.film, { state: 'plan' }, 'the same buyer, another title'],
    [premium, ID.off, { state: 'hidden', reason: 'title' }, 'a title its maker switched off'],
    [premium, ID.pod, { state: 'hidden', reason: 'kind' }, 'a podcast'],
    [premium, ID.plain, { state: 'hidden', reason: 'kind' }, 'a file that isn’t Cloudflare’s']
  ];
  for (const [who, id, expected, name] of want) {
    const d = await offer(who, id);
    ok(`/api/episode-page download — ${name}: ${JSON.stringify(expected)}`, JSON.stringify(d) === JSON.stringify(expected), d);
  }
  r = await eventually(() => call(`/episode/${ID.film}?autoplay=1`, { ...web(premium), accept: 'text/html' }), (x) => x.text.includes('"download":{"state":"ok"'));
  ok('the website’s episode page carries the same answer in its props (within half a minute of the flip)', r.status === 200 && r.text.includes('"download":{"state":"ok","basis":"member"}'), r.status);
  r = await call(`/episode/${ID.film}`, { ...web(viewer), accept: 'text/html' });
  ok('…and draws no Download button', r.status === 200 && r.text.includes('"download":{"state":"plan"}') && !/>\s*Download\s*</.test(r.text), r.status);

  const P = { viewer: phone('v'), standard: phone('s'), premium: phone('p'), sponsor: phone('sp'), admin: phone('a'), sub: phone('sb'), buyer: phone('b') };
  ctx.phones = P;
  r = await start(viewer, ID.film, P.viewer);
  ok('Basic: 403 plan, in the app’s words', r.status === 403 && r.json.code === 'plan' && r.json.error === DOWNLOAD_WORDS.planTitle, brief(r));
  r = await start(standard, ID.film, P.standard);
  ok('Standard: 403 plan', r.status === 403 && r.json.code === 'plan', brief(r));
  r = await start(standard, ID.prem, P.standard);
  ok('Standard, a premium title they can play: still 403 plan', r.status === 403 && r.json.code === 'plan', brief(r));
  r = await start(viewer, ID.prem, P.viewer);
  ok('Basic, a premium title: the playback gate’s own 403 (no link, no code)', r.status === 403 && !r.json.url && r.json.code === undefined && /members/.test(r.json.error || ''), brief(r));
  r = await start(premium, ID.teen, P.premium, { terms: undefined });
  ok('a TV-14 title with no viewing terms sent: the gate’s own 403 (termsRequired), no file asked of Cloudflare', r.status === 403 && r.json.termsRequired === true && r.json.ageRestricted === true, brief(r));

  r = await start(premium, ID.film, P.premium);
  ok('Premium, the first ask: 202 while Cloudflare makes the file', r.status === 202 && r.json.ready === false && r.json.percent === 0, brief(r));
  const waiting = copy(premium, P.premium, ID.film);
  ok('…the title holds its place on record from this first ask, without a date yet', activeCount(premium, P.premium) === 1 && waiting.status === 'active' && waiting.licensed_until === null && waiting.basis === 'member', waiting);
  r = await get(`/api/downloads?deviceId=${P.premium}`, premium);
  ok('…it isn’t a copy yet: the list has the phone, with nothing on it', r.status === 200 && r.json.items.length === 0 && r.json.devices.length === 1 && r.json.devices[0].count === 0 && r.json.devices[0].current === true, brief(r));
  r = await sync(premium, P.premium, []);
  ok('…and a check-in that lists nothing leaves it waiting (it was never on the phone’s list)', r.status === 200 && activeCount(premium, P.premium) === 1, brief(r));
  r = await start(premium, ID.film, P.premium);
  ok('…then 200 with a link', r.status === 200 && r.json.ready === true && typeof r.json.url === 'string' && r.json.basis === 'member', brief(r));
  ctx.premiumStart = r.json;
  r = await download(sponsor, ID.film, P.sponsor);
  ok('Sponsor: 200, a member’s copy', r.status === 200 && r.json.basis === 'member', brief(r));
  r = await download(admin, ID.prem, P.admin);
  ok('a full admin (the team counts as Premium): 200', r.status === 200 && r.json.basis === 'member' && r.json.paidThrough === null, brief(r));
  r = await download(sub, ID.prem, P.sub);
  ok('a sub-admin: 200', r.status === 200 && r.json.basis === 'member' && r.json.paidThrough === null, brief(r));
  r = await download(buyer, ID.bought, P.buyer);
  ok('a buyer on Basic, the title they bought: 200, theirs', r.status === 200 && r.json.basis === 'owned' && r.json.paidThrough === null, brief(r));
  r = await start(buyer, ID.film, P.buyer);
  ok('…another title: 403 plan', r.status === 403 && r.json.code === 'plan', brief(r));
  buy(premium, 'episode', ID.prem);
  r = await download(premium, ID.prem, P.premium);
  ok('a member who also bought the title: the purchase wins (owned)', r.status === 200 && r.json.basis === 'owned', brief(r));

  r = await start(premium, ID.off, P.premium);
  ok('a title its maker switched off: 403 title', r.status === 403 && r.json.code === 'title' && r.json.error === START_WORDS.title, brief(r));
  r = await start(premium, ID.pod, P.premium);
  ok('a podcast: 422 kind', r.status === 422 && r.json.code === 'kind', brief(r));
  r = await start(premium, ID.plain, P.premium);
  ok('a file that isn’t Cloudflare’s: 422 kind', r.status === 422 && r.json.code === 'kind', brief(r));
  r = await start(premium, `ck-dl-nothing-${RUN}`, P.premium);
  ok('a title that isn’t there: 404', r.status === 404, brief(r));
  r = await start(premium, 'not a title id', P.premium);
  const badPhone = await start(premium, ID.film, 'short');
  ok('a malformed title id or phone id: 400', r.status === 400 && badPhone.status === 400 && badPhone.json.code === 'device', `${r.status} ${badPhone.status}`);
  r = await call('/api/downloads/start', { ...app(premium), method: 'GET' });
  ok('GET on the start route: 405', r.status === 405, r.status);

  const banned = await person('dlbanned', { role: 'admin' });
  insert('account_suspensions', { user_id: banned.id, scope: 'all', public_reason: 'Check', created_by: USERS.admin });
  r = await start(banned, ID.film, phone('x'));
  const list = await get(`/api/downloads?deviceId=${phone('x')}`, banned);
  const devices = await get('/api/downloads/devices', banned);
  ok('a suspended account: 403 suspended on the download, the list and the phones', r.status === 403 && Boolean(r.json.suspended) && !r.json.url && list.status === 403 && list.json.suspended === true && devices.status === 403, `${brief(r)} | ${brief(list)} | ${devices.status}`);
}

// ---- the link -----------------------------------------------------------------------
const claimsOf = (token) => JSON.parse(Buffer.from(String(token).split('.')[1] || '', 'base64url').toString('utf8') || '{}');
const fromFake = (url, init) => fetch(String(url).replace('https://customer-test.cloudflarestream.com', FAKES.cloudflare), init);

async function theLink(ctx) {
  section('The link');
  const { premium, phones: P } = ctx;
  const s = ctx.premiumStart;
  const m = /^https:\/\/customer-test\.cloudflarestream\.com\/([^/]+)\/downloads\/default\.mp4$/.exec(s.url || '');
  ok('the link is Cloudflare’s MP4 address with a token where the uid goes', Boolean(m), s.url);
  const claims = m ? claimsOf(m[1]) : {};
  ok('…the token names this video and carries downloadable: true', claims.sub === UID.main && claims.downloadable === true, claims);
  const life = Date.parse(s.expiresAt) - Date.now();
  ok(`…it lasts a link’s life (${LINK_SECONDS / 3600} hours), and the answer’s expiresAt is the token’s`, life > (LINK_SECONDS - 120) * 1000 && life <= LINK_SECONDS * 1000 && Math.round(Date.parse(s.expiresAt) / 1000) === claims.exp, { expiresAt: s.expiresAt, exp: claims.exp });
  ok('…and no uid, manifest or stored address is anywhere in the answer', !JSON.stringify(s).includes(UID.main) && !JSON.stringify(s).includes('manifest'));

  let res = await fromFake(s.url);
  let bytes = Buffer.from(await res.arrayBuffer());
  ok('the link really downloads the file from the fake Cloudflare', res.status === 200 && res.headers.get('content-type') === 'video/mp4' && bytes.length === 262144 && bytes[1000] === 1000 % 251, `${res.status} ${bytes.length}`);
  res = await fromFake(s.url, { headers: { Range: 'bytes=1000-1999' } });
  bytes = Buffer.from(await res.arrayBuffer());
  ok('…and by range (a paused download picking up)', res.status === 206 && bytes.length === 1000 && bytes[0] === 1000 % 251 && res.headers.get('content-range') === 'bytes 1000-1999/262144', `${res.status} ${res.headers.get('content-range')}`);

  const play = await post('/api/stream-token', premium, { episodeId: ID.film, terms: 1 });
  const pm = /cloudflarestream\.com\/([^/]+)\/manifest/.exec((play.json && play.json.src) || '');
  ok('a playback token for the same title is downloadable: false', play.status === 200 && Boolean(pm) && claimsOf(pm[1]).downloadable === false && claimsOf(pm[1]).sub === UID.main, brief(play));
  res = await fromFake(`https://customer-test.cloudflarestream.com/${pm ? pm[1] : 'x'}/downloads/default.mp4`);
  ok('…and can’t fetch the file (403)', res.status === 403, res.status);
  res = await fromFake(`https://customer-test.cloudflarestream.com/${pm ? pm[1] : 'x'}/manifest/video.m3u8`);
  ok('…though it still plays', res.status === 200, res.status);
  res = await fromFake(`https://customer-test.cloudflarestream.com/${UID.main}/downloads/default.mp4`);
  ok('the bare uid can’t fetch it either (401)', res.status === 401, res.status);
  res = await fromFake(`https://customer-test.cloudflarestream.com/${m ? m[1] : 'x'}x/downloads/default.mp4`);
  ok('nor a token someone changed', res.status === 404 || res.status === 401 || res.status === 403, res.status);

  const it = s.item || {};
  ok('the item the app keeps: title, kicker, type, runtime, rating, art', it.episodeId === ID.film && /^Check download/.test(it.title || '') && it.kicker === 'Movie · Drama' && it.contentType === 'movie' && it.runtimeSeconds === 1440 && it.rating === 'TV-PG'
    && it.seriesId === null && it.seriesName === null && it.season === null && it.number === null && it.hasCaptions === false && it.hasFlashingLights === false && Object.prototype.hasOwnProperty.call(it, 'art'), it);
  let r = await download(premium, ID.teen, P.premium);
  ok('a title marked with flashing lights says so in its item (the warning shows offline too)', r.status === 200 && r.json.item.hasFlashingLights === true && r.json.item.rating === 'TV-14', brief(r));
  await post('/api/downloads/remove', premium, { deviceId: P.premium, episodeId: ID.teen });
  r = await download(premium, IDS.nbS1E1, P.premium);
  const ep = (r.json && r.json.item) || {};
  ok('a show’s episode: the show’s name, its season and number, the page’s kicker, a picture to keep', r.status === 200 && ep.seriesId === IDS.nightBus && ep.seriesName === 'Night Bus' && ep.season === 1 && ep.number === 1 && ep.kicker === 'Night Bus · Season 1 · Episode 1' && ep.contentType === 'series' && /^https?:\/\//.test(ep.art || ''), brief(r));

  const row = copy(premium, P.premium, ID.film);
  ok('the answer carries serverTime, the clock its date was worked out on (the phone keeps the date in its own clock)', near(s.serverTime, new Date().toISOString(), 20000) && Date.parse(s.licensedUntil) > Date.parse(s.serverTime), { serverTime: s.serverTime, licensedUntil: s.licensedUntil });
  ok('the copy is on record: active, a member’s, licensed until the answer’s date', row && row.status === 'active' && row.basis === 'member' && near(row.licensed_until, s.licensedUntil, 1000) && row.ended_at === null, row);
  const dev = rows(`select name, platform, removed_at, last_seen_at from public.download_devices where user_id = ${q(premium.id)} and device_id = ${q(P.premium)}`)[0];
  ok('…and so is the phone, with its name and platform', dev && dev.name === 'Check phone' && dev.platform === 'ios' && dev.removed_at === null, dev);
  await sleep(1100);
  r = await start(premium, ID.film, P.premium, { deviceName: '  <b>Mara’s</b>   iPhone  ', platform: 'iOS' });
  const again = rows(`select count(*)::int as n from public.downloads where user_id = ${q(premium.id)} and device_id = ${q(P.premium)} and episode_id = ${q(ID.film)}`)[0];
  const renamed = rows(`select name from public.download_devices where user_id = ${q(premium.id)} and device_id = ${q(P.premium)}`)[0];
  const rowAgain = copy(premium, P.premium, ID.film);
  ok('asking again (a link ran out, the app restarted): ready, a fresh link, a date, still one row, renewed', r.status === 200 && r.json.ready === true && typeof r.json.url === 'string' && r.json.url !== s.url && Date.parse(r.json.licensedUntil) >= Date.parse(s.licensedUntil)
    && Number(again.n) === 1 && rowAgain.renewed_at !== row.renewed_at && near(rowAgain.licensed_until, r.json.licensedUntil, 1000), `${brief(r)} | ${again.n} | ${JSON.stringify(rowAgain)}`);
  ok('…and the phone’s name is cleaned', renamed.name === 'b Mara’s /b iPhone', renamed.name);

  await cloudflare(`/__downloads?uid=${UID.slow}&state=inprogress&percent=40`, { method: 'POST' });
  r = await start(premium, ID.slow, P.premium);
  ok('Cloudflare still making the file: 202 with its percent, the title waiting without a date', r.status === 202 && r.json.ready === false && r.json.percent === 40 && copy(premium, P.premium, ID.slow).licensed_until === null, brief(r));
  await cloudflare(`/__downloads?uid=${UID.slow}&state=ready`, { method: 'POST' });
  r = await start(premium, ID.slow, P.premium);
  ok('…ready: 200', r.status === 200 && r.json.ready === true && claimsOf(r.json.url.split('/')[3]).sub === UID.slow, brief(r));
  r = await start(premium, ID.gone, P.premium);
  ok('a video Cloudflare doesn’t have: 503 cloudflare, in plain words, no copy and no date', r.status === 503 && r.json.code === 'cloudflare' && r.json.error === START_WORDS.cloudflare && copy(premium, P.premium, ID.gone).licensed_until === null && !copiesOn(premium, P.premium).includes(ID.gone), brief(r));

  // A video that never demanded signed links: protected before its file is made.
  const stateOf = async (uid) => ((await cloudflare('/__state')).json.videos.find((x) => x.uid === uid) || {});
  const openBefore = (await stateOf(UID.open)).requireSignedURLs;
  r = await download(premium, ID.open, P.premium);
  res = await fromFake(`https://customer-test.cloudflarestream.com/${UID.open}/downloads/default.mp4`);
  ok('a video that didn’t demand signed links is protected before its file is made: the bare uid can’t fetch it', openBefore === false && r.status === 200 && (await stateOf(UID.open)).requireSignedURLs === true && res.status === 401, `${openBefore} ${brief(r)} ${res.status}`);
  await post('/api/downloads/remove', premium, { deviceId: P.premium, episodeId: ID.open });

  r = await get(`/api/downloads?deviceId=${P.premium}`, premium);
  const mine = (r.json && r.json.devices) || [];
  ok('GET /api/downloads: the plan, the limits, this phone and its copies', r.status === 200 && r.json.enabled === true && r.json.plan.carries === true && r.json.plan.tier === 'premium'
    && r.json.limits.titles === MAX_TITLES_PER_DEVICE && r.json.limits.devices === MAX_DEVICES && mine.length === 1 && mine[0].deviceId === P.premium && mine[0].current === true && mine[0].count === r.json.items.length
    && r.json.items.some((x) => x.episodeId === ID.film && x.basis === 'member' && near(x.licensedUntil, s.licensedUntil, 1000) && x.endedAt === null), brief(r));
  const shape = (d) => Object.keys(d || {}).sort().join(',');
  ok('…each phone is { deviceId, name, platform, lastSeenAt, count, current }', shape(mine[0]) === 'count,current,deviceId,lastSeenAt,name,platform', shape(mine[0]));
  r = await get('/api/downloads', premium);
  ok('…without a phone id (the website): the phones, no copies', r.status === 200 && r.json.items.length === 0 && r.json.devices.length === 1 && r.json.devices[0].current === false, brief(r));
  r = await get('/api/downloads?deviceId=nope', premium);
  ok('…a malformed phone id: 400', r.status === 400 && r.json.code === 'device', brief(r));
}

// ---- the dates ------------------------------------------------------------------------
async function theDates(ctx) {
  section('Until when a copy plays');
  const { admin, sub, premium, buyer, phones: P } = ctx;
  const s = ctx.premiumStart;
  ok('a member: the paid month’s end is in the answer', Boolean(s.paidThrough) && Date.parse(s.paidThrough) > Date.now() + 25 * DAY, s.paidThrough);
  ok(`…and the copy plays until ${GRACE_DAYS} days after it`, Date.parse(s.licensedUntil) === Date.parse(s.paidThrough) + GRACE_DAYS * DAY, { licensedUntil: s.licensedUntil, paidThrough: s.paidThrough });
  ok('…which the app’s own rule reads as playable now and locked after it', playState({ now: Date.now(), licensedUntil: s.licensedUntil, lastSeenAt: Date.now() }).ok === true
    && playState({ now: Date.parse(s.licensedUntil) + 1000, licensedUntil: s.licensedUntil, lastSeenAt: Date.now() }).reason === 'expired');

  let r = await syncAll(premium, P.premium);
  let it = item(r, ID.film);
  ok('the check-in’s answer: enabled, serverTime, paidThrough, plan, limits, items, deviceRemoved', r.status === 200 && r.json.enabled === true && near(r.json.serverTime, new Date().toISOString(), 20000) && r.json.paidThrough === s.paidThrough
    && r.json.plan.carries === true && r.json.plan.tier === 'premium' && r.json.limits.titles === MAX_TITLES_PER_DEVICE && r.json.deviceRemoved === false && Array.isArray(r.json.items), brief(r));
  ok('…the copy is licensed again: ok, member, the same date, nothing ended', it && it.state === 'ok' && it.basis === 'member' && it.licensedUntil === s.licensedUntil && it.endedAt === null && it.keepUntil === null && it.reason === null, it);

  const subscription = await subscriptionOf(premium);
  await stripeHook(`/__subscriptions/${subscription.id}/period`, { method: 'POST', body: { endsInDays: 300 } });
  r = await syncAll(premium, P.premium);
  it = item(r, ID.film);
  ok(`a yearly plan: never longer than ${MEMBER_MAX_DAYS + GRACE_DAYS} days without connecting`, it && Date.parse(it.licensedUntil) === Date.parse(r.json.serverTime) + (MEMBER_MAX_DAYS + GRACE_DAYS) * DAY && Date.parse(r.json.paidThrough) > Date.now() + 290 * DAY, { it, serverTime: r.json.serverTime, paidThrough: r.json.paidThrough });
  await stripeHook(`/__subscriptions/${subscription.id}/period`, { method: 'POST', body: { endsInDays: 3 } });
  r = await syncAll(premium, P.premium);
  it = item(r, ID.film);
  ok('a month about to end: three days plus the two of grace', it && Date.parse(it.licensedUntil) === Date.parse(r.json.paidThrough) + GRACE_DAYS * DAY && near(r.json.paidThrough, new Date(Date.now() + 3 * DAY).toISOString(), 60000), { it, paidThrough: r.json.paidThrough });
  ok('…written on the row', near(copy(premium, P.premium, ID.film).licensed_until, it.licensedUntil, 1000));
  await stripeHook(`/__subscriptions/${subscription.id}/period`, { method: 'POST', body: { endsInDays: 30 } });

  r = await sync(buyer, P.buyer, [ID.bought]);
  it = item(r, ID.bought);
  ok(`a buyer: ${CHECKIN_DAYS} days from the check-in, no plan needed`, r.status === 200 && r.json.plan.carries === false && r.json.paidThrough === null && it && it.state === 'ok' && it.basis === 'owned' && Date.parse(it.licensedUntil) === Date.parse(r.json.serverTime) + CHECKIN_DAYS * DAY, brief(r));
  r = await sync(admin, P.admin, [ID.prem]);
  it = item(r, ID.prem);
  ok(`the team (a full admin): ${CHECKIN_DAYS} days, no paid-through date`, r.status === 200 && r.json.paidThrough === null && r.json.plan.carries === true && it && it.state === 'ok' && it.basis === 'member' && Date.parse(it.licensedUntil) === Date.parse(r.json.serverTime) + CHECKIN_DAYS * DAY, brief(r));
  r = await sync(sub, P.sub, [ID.prem]);
  it = item(r, ID.prem);
  ok('…and a sub-admin the same', r.status === 200 && it && it.state === 'ok' && Date.parse(it.licensedUntil) === Date.parse(r.json.serverTime) + CHECKIN_DAYS * DAY, brief(r));

  const promo = await person('dlpromo');
  const promoEnd = new Date(Date.now() + 9 * DAY).toISOString();
  sql(`update public.user_profiles set promo_access_expires_at = ${q(promoEnd)} where user_id = ${q(promo.id)}`);
  const promoPhone = phone('pr');
  r = await download(promo, ID.film, promoPhone);
  ok('a promo code’s access: downloads, but never past the promo’s end', r.status === 200 && r.json.basis === 'member' && r.json.paidThrough === null && near(r.json.licensedUntil, promoEnd, 2000), brief(r));
  ctx.promo = { who: promo, phone: promoPhone };
}

// ---- the two limits ---------------------------------------------------------------------
async function theLimits(ctx) {
  section(`The two limits (${MAX_TITLES_PER_DEVICE} titles a phone, ${MAX_DEVICES} phones)`);
  const who = await teamAdmin('dllimit');
  const A = phone('la');
  const B = phone('lb');
  const C = phone('lc');
  const names = { [A]: 'Phone A', [B]: 'Phone B', [C]: 'Phone C' };
  const start = (account, id, dev, extra = {}) => post('/api/downloads/start', account, { episodeId: id, deviceId: dev, deviceName: names[dev], platform: dev === B ? 'android' : 'ios', terms: 1, ...extra });
  let failed = 0;
  for (const id of LIMIT.slice(0, MAX_TITLES_PER_DEVICE)) {
    const r = await start(who, id, A);
    if (r.status !== 200) failed += 1;
  }
  ok(`${MAX_TITLES_PER_DEVICE} titles go onto one phone`, failed === 0 && activeCount(who, A) === MAX_TITLES_PER_DEVICE, `${failed} failed, ${activeCount(who, A)} on record`);
  let r = await start(who, LIMIT[MAX_TITLES_PER_DEVICE], A);
  ok('one more: 409 titles, in the app’s words', r.status === 409 && r.json.code === 'titles' && r.json.error === DOWNLOAD_WORDS.titleLimit, brief(r));
  r = await start(who, LIMIT[3], A);
  ok('a title already on it still gets a fresh link', r.status === 200 && activeCount(who, A) === MAX_TITLES_PER_DEVICE, brief(r));
  r = await post('/api/downloads/remove', who, { deviceId: A, episodeId: LIMIT[0] });
  ok('the phone removes one: { ok: true }, the row marked removed', r.status === 200 && r.json.ok === true && copy(who, A, LIMIT[0]).status === 'removed' && activeCount(who, A) === MAX_TITLES_PER_DEVICE - 1, brief(r));
  r = await post('/api/downloads/remove', who, { deviceId: A, episodeId: LIMIT[0] });
  ok('…removing it again answers the same', r.status === 200 && r.json.ok === true, brief(r));
  r = await start(who, LIMIT[MAX_TITLES_PER_DEVICE], A);
  ok('…and the place is free for another', r.status === 200 && activeCount(who, A) === MAX_TITLES_PER_DEVICE, brief(r));

  r = await start(who, LIMIT[1], B);
  ok('a second phone', r.status === 200, brief(r));
  r = await start(who, LIMIT[2], C);
  const told = (r.json && r.json.devices) || [];
  ok('a third: 409 devices, in the app’s words, with the two phones listed', r.status === 409 && r.json.code === 'devices' && r.json.error === DOWNLOAD_WORDS.deviceLimit && told.length === 2
    && told.some((d) => d.deviceId === A && d.name === 'Phone A' && d.count === MAX_TITLES_PER_DEVICE && d.platform === 'ios' && d.current === false && Boolean(d.lastSeenAt))
    && told.some((d) => d.deviceId === B && d.name === 'Phone B' && d.count === 1 && d.platform === 'android'), brief(r));
  ok('…and the third phone isn’t on record', rows(`select 1 from public.download_devices where user_id = ${q(who.id)} and device_id = ${q(C)}`).length === 0);
  const keys = (d) => Object.keys(d || {}).sort().join(',');
  r = await get('/api/downloads/devices', who);
  ok('GET /api/downloads/devices lists the two, in the same shape as the 409', r.status === 200 && r.json.devices.length === 2 && r.json.devices.every((d) => d.current === false)
    && [...told, ...r.json.devices].every((d) => keys(d) === 'count,current,deviceId,lastSeenAt,name,platform'), brief(r));

  r = await post('/api/downloads/devices', who, { remove: B });
  ok('removing a phone: { ok, devices } with the one left', r.status === 200 && r.json.ok === true && r.json.devices.length === 1 && r.json.devices[0].deviceId === A, brief(r));
  const gone = copy(who, B, LIMIT[1]);
  ok('…its copy is taken back (revoked, device) and the phone marked removed', gone.status === 'revoked' && gone.revoke_reason === 'device' && rows(`select removed_at from public.download_devices where user_id = ${q(who.id)} and device_id = ${q(B)}`)[0].removed_at !== null, gone);
  r = await start(who, LIMIT[2], C);
  ok('…and the third phone can download now', r.status === 200, brief(r));
  r = await sync(who, B, [LIMIT[1]]);
  let it = item(r, LIMIT[1]);
  ok('the removed phone checks in: deviceRemoved, its title revoked (device)', r.status === 200 && r.json.deviceRemoved === true && it && it.state === 'revoked' && it.reason === 'device' && it.licensedUntil === null, brief(r));
  r = await start(who, LIMIT[4], B);
  ok('…and can’t come back while two others hold copies (409 devices)', r.status === 409 && r.json.code === 'devices', brief(r));
  r = await post('/api/downloads/devices', who, { remove: phone('zz') });
  const bad = await post('/api/downloads/devices', who, { remove: 'x' });
  ok('removing a phone that isn’t there changes nothing; a malformed id is 400', r.status === 200 && r.json.devices.length === 2 && bad.status === 400, `${brief(r)} | ${bad.status}`);
  ctx.limits = { who, A, B, C, start };
}

// ---- asking again, and how many new copies an hour and a day -------------------------------------
async function askingAgain() {
  section(`Asking again, and ${NEW_COPIES_PER_HOUR} new copies an hour, ${NEW_COPIES_PER_DAY} a day`);
  const who = await teamAdmin('dlagain');
  const R = phone('ag');
  const R2 = phone('ag2');
  const go = (id, dev = R) => start(who, id, dev);
  const drop = (id, dev = R) => post('/api/downloads/remove', who, { deviceId: dev, episodeId: id });
  const isRate = (r, limit) => r.status === 429 && r.json.code === 'rate' && r.json.limit === limit && r.json.error === RATE_WORDS[limit]
    && Number(r.json.retryAfter) >= 60 && Number(r.headers.get('retry-after')) === Number(r.json.retryAfter);
  let r = await go(LIMIT[0]);
  const first = r.json || {};
  let bad = 0;
  const links = new Set([first.url]);
  for (let i = 0; i < NEW_COPIES_PER_HOUR + 10; i += 1) {
    const x = await go(LIMIT[0]);
    if (x.status !== 200 || x.json.ready !== true || !x.json.url || !x.json.licensedUntil) bad += 1;
    else links.add(x.json.url);
  }
  ok(`${NEW_COPIES_PER_HOUR + 11} asks in a row for a title the phone holds (202 polls, restarts, a link running out): every one 200 with a link and a date, never refused`, r.status === 200 && bad === 0 && activeCount(who, R) === 1 && links.size > 1, `${bad} bad, ${links.size} links`);
  ok('…and they are one new copy, not forty', countedThisHour(who) === 1, countedThisHour(who));
  let failed = 0;
  for (const id of LIMIT.slice(1, MAX_TITLES_PER_DEVICE)) if ((await go(id)).status !== 200) failed += 1;
  r = await go(LIMIT[MAX_TITLES_PER_DEVICE - 1]);
  ok('a full phone asking again for one of its titles: still 200', failed === 0 && activeCount(who, R) === MAX_TITLES_PER_DEVICE && r.status === 200 && r.json.ready === true, `${failed} | ${brief(r)}`);

  // The same title on the same phone again (deleted, downloaded again) is not a new copy.
  for (const id of LIMIT.slice(0, 6)) await drop(id);
  failed = 0;
  for (const id of LIMIT.slice(0, 6)) if ((await go(id)).status !== 200) failed += 1;
  ok('six titles deleted and downloaded again on the same phone: all go through, and count for nothing new', failed === 0 && activeCount(who, R) === MAX_TITLES_PER_DEVICE, failed);

  // New copies: 25 so far (one phone's worth). A second phone takes the hour to 30.
  const more = NEW_COPIES_PER_HOUR - MAX_TITLES_PER_DEVICE;
  failed = 0;
  for (const id of LIMIT.slice(0, more)) if ((await go(id, R2)).status !== 200) failed += 1;
  ok(`${NEW_COPIES_PER_HOUR} new copies within the hour all go through`, failed === 0 && activeCount(who, R2) === more, failed);
  r = await go(LIMIT[more], R2);
  ok(`the ${NEW_COPIES_PER_HOUR + 1}st new copy: 429 rate, limit "hour", in plain words, with how long to wait (Retry-After and retryAfter)`, isRate(r, 'hour') && Number(r.json.retryAfter) <= 3600, brief(r));
  ok('…nothing on record for it, and Cloudflare wasn’t asked for a link', copy(who, R2, LIMIT[more]) === null && !r.json.url, copy(who, R2, LIMIT[more]));
  r = await go(LIMIT[more], R2);
  ok('…asking for it again is refused again (a refused ask is never remembered as counted)', isRate(r, 'hour'), brief(r));
  r = await go(LIMIT[1]);
  ok('…while a title the phone already holds still gets its fresh link', r.status === 200 && r.json.ready === true && typeof r.json.url === 'string', brief(r));
  await drop(LIMIT[2]);
  r = await go(LIMIT[2]);
  ok('…and a title deleted from the phone can come back to it (not a new copy)', r.status === 200 && r.json.ready === true, brief(r));

  // The day: those thirty were asked for two hours ago, and thirty more three hours ago.
  sql(`update public.downloads set created_at = now() - interval '2 hours' where user_id = ${q(who.id)}`);
  pastRows(who, R, NEW_COPIES_PER_DAY - NEW_COPIES_PER_HOUR - 1, { tag: 'day', status: 'removed', ago: '3 hours' });
  r = await go(LIMIT[more], R2);
  ok(`with the hour clear and ${NEW_COPIES_PER_DAY - 1} asked for today, one more goes through (the ${NEW_COPIES_PER_DAY}th)`, r.status === 200 && r.json.ready === true, brief(r));
  r = await go(LIMIT[more + 1], R2);
  ok(`the ${NEW_COPIES_PER_DAY + 1}st new copy of the day: 429 rate, limit "day", with a wait of hours`, isRate(r, 'day') && Number(r.json.retryAfter) > 3600 && Number(r.json.retryAfter) <= 86400 && copy(who, R2, LIMIT[more + 1]) === null, brief(r));
  r = await go(LIMIT[3]);
  ok('…a title the phone holds still gets its link', r.status === 200 && r.json.ready === true, brief(r));
}

// ---- a title is counted when it is first asked for ------------------------------------------------
async function firstAsk() {
  section('A new title is counted at its first ask, not when its link goes out');
  const who = await teamAdmin('dlask');
  const W = phone('wa');
  pastRows(who, W, NEW_COPIES_PER_HOUR - 1, { tag: 'ask', status: 'removed', ago: '30 minutes' });
  await cloudflare(`/__downloads?uid=${UID.wait}&state=inprogress&percent=10`, { method: 'POST' });
  let r = await start(who, ID.wait, W);
  const row = copy(who, W, ID.wait);
  ok(`the ${NEW_COPIES_PER_HOUR}th new title of the hour, its file still being made: 202, and its row is on record without a date`, r.status === 202 && r.json.percent === 10 && row && row.status === 'active' && row.licensed_until === null, brief(r));
  let other = 0;
  for (let i = 0; i < 6; i += 1) if ((await start(who, ID.wait, W)).status !== 202) other += 1;
  const pairRows = Number(rows(`select count(*)::int as n from public.downloads where user_id = ${q(who.id)} and device_id = ${q(W)} and episode_id = ${q(ID.wait)}`)[0].n);
  ok('six more asks while the file is made: 202 each, still one row, and none of them refused though the hour is full', other === 0 && pairRows === 1 && countedThisHour(who) === NEW_COPIES_PER_HOUR, `${other} | ${pairRows} | ${countedThisHour(who)}`);
  r = await start(who, LIMIT[0], W);
  ok('another new title now: 429 hour — the waiting title was counted when it was first asked for, before any link', r.status === 429 && r.json.limit === 'hour' && copy(who, W, LIMIT[0]) === null, brief(r));
  r = await get(`/api/downloads?deviceId=${W}`, who);
  ok('the waiting title isn’t among the copies; the phone is listed with nothing on it', r.status === 200 && r.json.items.length === 0 && r.json.devices.length === 1 && r.json.devices[0].deviceId === W && r.json.devices[0].count === 0, brief(r));
  await cloudflare(`/__downloads?uid=${UID.wait}&state=ready`, { method: 'POST' });
  r = await start(who, ID.wait, W);
  const dated = copy(who, W, ID.wait);
  ok('the file ready: 200 with its link and date on the same row (nothing more to count)', r.status === 200 && r.json.ready === true && typeof r.json.url === 'string' && dated.licensed_until !== null && near(dated.licensed_until, r.json.licensedUntil, 1000) && pairRows === 1 && countedThisHour(who) === NEW_COPIES_PER_HOUR, brief(r));
  // A waiting title the phone stopped asking for is freed by a check-in.
  await cloudflare(`/__downloads?uid=${UID.wait}&state=inprogress&percent=10`, { method: 'POST' });
  const who2 = await teamAdmin('dlask2');
  const W2 = phone('wb');
  await start(who2, ID.wait, W2);
  r = await sync(who2, W2, []);
  const kept = copy(who2, W2, ID.wait);
  sql(`update public.downloads set renewed_at = now() - interval '3 minutes' where user_id = ${q(who2.id)} and episode_id = ${q(ID.wait)}`);
  const r2 = await sync(who2, W2, []);
  ok('a waiting title is spared by a check-in while the phone keeps asking, and freed once it has stopped for a couple of minutes', r.status === 200 && kept.status === 'active' && r2.status === 200 && copy(who2, W2, ID.wait).status === 'removed', `${kept.status} → ${copy(who2, W2, ID.wait).status}`);
  await cloudflare(`/__downloads?uid=${UID.wait}&state=ready`, { method: 'POST' });
}

// ---- the limits when requests race -----------------------------------------------------------------
async function racing() {
  section('The limits hold when requests arrive at the same moment');
  // Ten new titles at once onto a phone that holds 24.
  const who = await teamAdmin('dlrace');
  const A = phone('ra');
  phoneRow(who, A);
  pastRows(who, A, MAX_TITLES_PER_DEVICE - 1, { tag: 'old' });
  let burst = await Promise.all(LIMIT.slice(0, 10).map((id) => start(who, id, A)));
  let won = burst.filter((r) => r.status === 200);
  let lost = burst.filter((r) => r.status !== 200);
  ok(`ten new titles at once onto a phone holding ${MAX_TITLES_PER_DEVICE - 1}: the phone never passes ${MAX_TITLES_PER_DEVICE}`, activeCount(who, A) <= MAX_TITLES_PER_DEVICE, `${activeCount(who, A)} on record`);
  ok('…at most one link went out, one row per link, and the others heard 409 titles', won.length <= 1 && activeCount(who, A) === MAX_TITLES_PER_DEVICE - 1 + won.length && lost.every((r) => r.status === 409 && r.json.code === 'titles' && !r.json.url), burst.map((r) => r.status).join(','));
  ok('…the one that fit got through (the others looked again once things had settled)', won.length === 1, burst.map((r) => r.status).join(','));
  let r = await start(who, LIMIT[11], A);
  ok('…and the phone is full for the next ask', r.status === 409 && r.json.code === 'titles', brief(r));

  // Six phones at once beside one that holds a copy.
  const who2 = await teamAdmin('dlrace2');
  const first = phone('r0');
  phoneRow(who2, first, 'First phone');
  pastRows(who2, first, 1, { tag: 'one' });
  const others = Array.from({ length: 6 }, (_, i) => phone(`r${i + 1}`));
  burst = await Promise.all(others.map((dev, i) => start(who2, LIMIT[i], dev)));
  won = burst.filter((x) => x.status === 200);
  lost = burst.filter((x) => x.status !== 200);
  const holders = Number(rows(`select count(distinct device_id)::int as n from public.downloads where user_id = ${q(who2.id)} and status = 'active'`)[0].n);
  ok(`six other phones asking at once beside one that holds a copy: never more than ${MAX_DEVICES} phones hold one`, holders <= MAX_DEVICES, `${holders} phones`);
  ok('…at most one of them got a link, and the others heard 409 devices', won.length <= 1 && holders === 1 + won.length && lost.every((x) => x.status === 409 && x.json.code === 'devices' && Array.isArray(x.json.devices) && !x.json.url), burst.map((x) => x.status).join(','));
  ok('…one did get in', won.length === 1, burst.map((x) => x.status).join(','));
  const listed = Number(rows(`select count(*)::int as n from public.download_devices where user_id = ${q(who2.id)} and removed_at is null`)[0].n);
  ok('…and only the phones that hold a copy are on record', listed === holders, `${listed} on record, ${holders} holding`);

  // Six new copies at once with room for two in the hour.
  const who3 = await teamAdmin('dlrace3');
  const R = phone('rr');
  pastRows(who3, R, NEW_COPIES_PER_HOUR - 2, { tag: 'hr', status: 'removed', ago: '30 minutes' });
  burst = await Promise.all(LIMIT.slice(0, 6).map((id) => start(who3, id, R)));
  won = burst.filter((x) => x.status === 200);
  lost = burst.filter((x) => x.status !== 200);
  ok(`six new copies at once with room for two this hour: the account never passes ${NEW_COPIES_PER_HOUR}`, countedThisHour(who3) <= NEW_COPIES_PER_HOUR && won.length <= 2 && countedThisHour(who3) === NEW_COPIES_PER_HOUR - 2 + won.length, `${countedThisHour(who3)} counted, ${won.length} links`);
  ok('…the others heard 429 hour, and their rows were taken back', lost.every((x) => x.status === 429 && x.json.code === 'rate' && x.json.limit === 'hour') && activeCount(who3, R) === won.length, burst.map((x) => x.status).join(','));
  ok('…and the room there was got used', won.length >= 1, burst.map((x) => x.status).join(','));
}

// ---- only the app ----------------------------------------------------------------------------------
async function onlyTheApp(ctx) {
  section('Only the app starts, checks in and removes');
  const { premium, phones: P } = ctx;
  const held = copiesOn(premium, P.premium);
  const bodies = {
    start: { episodeId: ID.prem, deviceId: P.premium, deviceName: 'Check phone', platform: 'ios', terms: 1 },
    sync: { deviceId: P.premium, deviceName: 'Check phone', platform: 'ios', have: [] },
    remove: { deviceId: P.premium, episodeId: held[0] }
  };
  const isAppOnly = (r) => r.status === 403 && r.json && r.json.code === 'app-only' && r.json.error === DOWNLOAD_WORDS.webOnly && !r.json.url;
  const fromPage = (route, headers) => call(`/api/downloads/${route}`, { who: premium, bearer: true, method: 'POST', body: bodies[route], headers: { 'X-Forwarded-For': ip(premium), ...headers } });
  for (const route of ['start', 'sync', 'remove']) {
    const cookie = await call(`/api/downloads/${route}`, { ...web(premium), method: 'POST', body: bodies[route] });
    ok(`${route}: a signed-in browser session (the cookie, no token) is refused — 403 app-only, in the app’s words`, isAppOnly(cookie), brief(cookie));
    const origin = await fromPage(route, { Origin: BASE });
    const fetchSite = await fromPage(route, { 'Sec-Fetch-Site': 'same-origin' });
    ok(`${route}: the token sent from a page (an Origin header, or Sec-Fetch-Site) is refused the same way`, isAppOnly(origin) && isAppOnly(fetchSite), `${brief(origin)} | ${brief(fetchSite)}`);
  }
  ok('…and none of the nine started, freed or removed anything', held.length > 0 && JSON.stringify(copiesOn(premium, P.premium)) === JSON.stringify(held), `${held.length} before, ${copiesOn(premium, P.premium).length} after`);
  let r = await call('/api/downloads/start', { method: 'POST', body: bodies.start, headers: { 'X-Forwarded-For': ip(SIGNED_OUT) } });
  ok('with no sign-in at all it is still 401', r.status === 401, brief(r));
  r = await post('/api/downloads/sync', premium, { deviceId: P.premium, deviceName: 'Check phone', platform: 'ios', have: held });
  ok('the app’s own call (a token, no Origin) goes through as before', r.status === 200 && r.json.items.length === held.length, brief(r));
  r = await call('/api/downloads', web(premium));
  const phones = await call('/api/downloads/devices', web(premium));
  const removeNone = await call('/api/downloads/devices', { ...web(premium), method: 'POST', body: { remove: phone('zz') }, headers: { 'X-Forwarded-For': ip(premium), Origin: BASE } });
  ok('the list of phones stays open to the website: GET /api/downloads, GET and POST /api/downloads/devices with the cookie', r.status === 200 && phones.status === 200 && Array.isArray(phones.json.devices) && removeNone.status === 200 && removeNone.json.ok === true, `${r.status} ${phones.status} ${brief(removeNone)}`);
}

// ---- never on a guess ------------------------------------------------------------------------------
async function neverOnAGuess(ctx) {
  section('Never on a guess: what can’t be read is 503, and nothing changes');
  const { admin, premium, viewer, phones: P } = ctx;
  if (SKIP_REVOKE) {
    console.log('skip the unreadable-table parts (RIG_CHECK_SKIP_REVOKE=1)');
    return;
  }
  // A buyer on Basic while the purchases can't be read: never "plan", never "members only".
  const buyer = await person('dlbuy2');
  const bp = phone('b2');
  buy(buyer, 'episode', ID.freebuy);
  buy(buyer, 'episode', ID.prem);
  let [free, prem] = await unreadable('purchases', async () => [await start(buyer, ID.freebuy, bp), await start(buyer, ID.prem, bp)]);
  ok('a buyer on Basic, the purchases unreadable: a free title they bought is 503 unavailable — not "Downloads come with Premium"', isUnavailable(free) && free.json.code !== 'plan', brief(free));
  ok('…and a premium title they bought is 503 unavailable — not the gate’s "for members"', isUnavailable(prem), brief(prem));
  ok('…nothing was put on record', activeCount(buyer, bp) === 0);
  free = await download(buyer, ID.freebuy, bp);
  prem = await download(buyer, ID.prem, bp);
  ok('…readable again: both download, theirs', free.status === 200 && free.json.basis === 'owned' && prem.status === 200 && prem.json.basis === 'owned', `${brief(free)} | ${brief(prem)}`);

  // An account with free access (the comped list): the list can't be read.
  const comp = await person('dlcomp');
  const cp = phone('cp');
  insert('comped_access', { email: comp.email, reason: 'Check', granted_by: 'rig' });
  let r = await download(comp, ID.freebuy, cp);
  ok('an account given free access downloads as a member', r.status === 200 && r.json.basis === 'member' && r.json.paidThrough === null, brief(r));
  const compRow = copy(comp, cp, ID.freebuy);
  let [checkIn, again, fresh, list] = await unreadable('comped_access', async () => [await sync(comp, cp, [ID.freebuy]), await start(comp, ID.freebuy, cp), await start(comp, ID.wait, cp), await get(`/api/downloads?deviceId=${cp}`, comp)]);
  let after = copy(comp, cp, ID.freebuy);
  ok('the comped list unreadable: the check-in is 503 unavailable — the copy is not `ended`', isUnavailable(checkIn) && after.status === 'active' && after.ended_at === null && after.renewed_at === compRow.renewed_at, `${brief(checkIn)} | ${JSON.stringify(after)}`);
  ok('…a fresh link and a new title are 503 unavailable too — not "Downloads come with Premium" — and so is the list', isUnavailable(again) && isUnavailable(fresh) && isUnavailable(list) && copy(comp, cp, ID.wait) === null, `${brief(again)} | ${brief(fresh)} | ${brief(list)}`);
  r = await sync(comp, cp, [ID.freebuy]);
  ok('…readable again: ok, a member’s copy', r.status === 200 && item(r, ID.freebuy).state === 'ok' && r.json.plan.carries === true, brief(r));

  // A promo code's access: the promo's date can't be read.
  const { who: promo, phone: pp } = ctx.promo;
  const promoRow = copy(promo, pp, ID.film);
  [checkIn, fresh] = await unreadable('user_profiles', async () => [await sync(promo, pp, [ID.film]), await start(promo, ID.freebuy, pp)]);
  after = copy(promo, pp, ID.film);
  ok('a promo’s date unreadable: the check-in is 503 unavailable, the copy untouched, and nothing new starts', isUnavailable(checkIn) && isUnavailable(fresh) && after.status === 'active' && after.ended_at === null && after.renewed_at === promoRow.renewed_at, `${brief(checkIn)} | ${brief(fresh)} | ${JSON.stringify(after)}`);
  r = await sync(promo, pp, [ID.film]);
  ok('…readable again: ok', r.status === 200 && item(r, ID.film).state === 'ok', brief(r));

  // Whether the account is suspended can't be read.
  const heldNow = copiesOn(premium, P.premium);
  [list, checkIn, fresh] = await unreadable('account_suspensions', async () => [await get(`/api/downloads?deviceId=${P.premium}`, premium), await sync(premium, P.premium, heldNow), await start(premium, heldNow[0], P.premium)]);
  const phonesRead = await unreadable('account_suspensions', () => call('/api/downloads/devices', web(premium)));
  ok('the suspensions unreadable: the list, the check-in, a link and the phones are all 503 unavailable (never "not suspended" on a guess)', isUnavailable(list) && isUnavailable(checkIn) && isUnavailable(fresh) && isUnavailable(phonesRead) && !fresh.json.url, `${brief(list)} | ${brief(checkIn)} | ${brief(fresh)} | ${brief(phonesRead)}`);
  r = await get(`/api/downloads?deviceId=${P.premium}`, premium);
  ok('…readable again: 200', r.status === 200, brief(r));

  // The switch can't be read: a start never goes on an older "on".
  r = await start(premium, heldNow[0], P.premium);
  ok('(the switch is on, and a held title gets its fresh link)', r.status === 200 && typeof r.json.url === 'string', brief(r));
  let adminRead;
  [fresh, again, adminRead] = await unreadable('site_settings', async () => [await start(premium, heldNow[0], P.premium), await start(viewer, ID.freebuy, phone('vv')), await get('/api/admin/downloads', admin)]);
  ok('the settings unreadable: a start is 503 unavailable — no link on the "on" it read a moment ago', isUnavailable(fresh) && !fresh.json.url && isUnavailable(again), `${brief(fresh)} | ${brief(again)}`);
  ok('…and Admin → Downloads says it can’t read them (503 unavailable), not an older state', adminRead.status === 503 && adminRead.json.code === 'unavailable', brief(adminRead));
  r = await eventually(() => start(premium, heldNow[0], P.premium), (x) => x.status === 200, 20);
  const adminAgain = await get('/api/admin/downloads', admin);
  ok('…readable again: the link, and the admin’s read', r.status === 200 && typeof r.json.url === 'string' && adminAgain.status === 200 && adminAgain.json.switch.enabled === true, `${brief(r)} | ${adminAgain.status}`);
}

// ---- the check-in ---------------------------------------------------------------------------
async function theCheckIn(ctx) {
  section('The check-in');
  const { admin, premium, sponsor, buyer, phones: P } = ctx;

  // A copy the phone no longer lists.
  await download(sponsor, ID.prem, P.sponsor);
  await start(sponsor, ID.film, P.sponsor);
  let r = await sync(sponsor, P.sponsor, [ID.prem]);
  ok('a copy licensed a moment ago that this check-in doesn’t list keeps its row (its start’s answer may still be on the way)', r.status === 200 && r.json.items.length === 1 && item(r, ID.prem).state === 'ok' && copy(sponsor, P.sponsor, ID.film).status === 'active', brief(r));
  sql(`update public.downloads set renewed_at = now() - interval '3 minutes', created_at = now() - interval '3 minutes' where user_id = ${q(sponsor.id)} and episode_id = ${q(ID.film)}`);
  r = await sync(sponsor, P.sponsor, [ID.prem]);
  ok('…a couple of minutes on, the copy it doesn’t list is removed and its slot freed; the listed one is renewed', r.status === 200 && copy(sponsor, P.sponsor, ID.film).status === 'removed' && copy(sponsor, P.sponsor, ID.prem).status === 'active' && activeCount(sponsor, P.sponsor) === 1, copy(sponsor, P.sponsor, ID.film));
  const noList = await post('/api/downloads/sync', sponsor, { deviceId: P.sponsor, deviceName: 'Check phone', platform: 'ios' });
  const nullList = await post('/api/downloads/sync', sponsor, { deviceId: P.sponsor, have: null });
  ok('a check-in without its list (no `have` at all, or null) is refused — 400 have — and frees nothing', noList.status === 400 && noList.json.code === 'have' && nullList.status === 400 && nullList.json.code === 'have' && copy(sponsor, P.sponsor, ID.prem).status === 'active' && activeCount(sponsor, P.sponsor) === 1, `${brief(noList)} | ${brief(nullList)} | ${activeCount(sponsor, P.sponsor)}`);
  r = await sync(sponsor, P.sponsor, []);
  ok('an empty list (the phone lost everything, a reinstall): every copy removed at once, however fresh', r.status === 200 && r.json.items.length === 0 && r.json.deviceRemoved === false && copy(sponsor, P.sponsor, ID.prem).status === 'removed' && activeCount(sponsor, P.sponsor) === 0, brief(r));
  r = await get(`/api/downloads?deviceId=${P.sponsor}`, sponsor);
  ok('…and the phone’s places are free', r.status === 200 && r.json.items.length === 0, brief(r));
  r = await sync(sponsor, P.sponsor, [ID.film, `ck-dl-never-${RUN}`]);
  ok('a title the phone holds with no copy on record: revoked (removed) — an answer for every title listed', r.status === 200 && r.json.items.length === 2 && item(r, ID.film).state === 'revoked' && item(r, ID.film).reason === 'removed' && item(r, `ck-dl-never-${RUN}`).state === 'revoked' && item(r, `ck-dl-never-${RUN}`).reason === 'removed' && r.json.deviceRemoved === false, brief(r));
  r = await post('/api/downloads/sync', sponsor, { deviceId: P.sponsor, have: Array.from({ length: 61 }, (_, i) => `t-${i}`) });
  const notList = await post('/api/downloads/sync', sponsor, { deviceId: P.sponsor, have: 'all' });
  const badPhone = await post('/api/downloads/sync', sponsor, { deviceId: 'x', have: [] });
  ok('61 titles, a list that isn’t one, a malformed phone id: 400', r.status === 400 && notList.status === 400 && badPhone.status === 400, `${r.status} ${notList.status} ${badPhone.status}`);
  r = await sync(sponsor, phone('new'), []);
  ok('a phone that never downloaded checks in: nothing, and it isn’t put on record', r.status === 200 && r.json.items.length === 0 && r.json.deviceRemoved === false && Number(rows(`select count(*)::int as n from public.download_devices where user_id = ${q(sponsor.id)}`)[0].n) === 1, brief(r));

  // The plan ends, then comes back.
  await download(sponsor, ID.film, P.sponsor);
  const until = copy(sponsor, P.sponsor, ID.film).licensed_until;
  const subscription = await subscriptionOf(sponsor);
  await stripeApi(`/subscriptions/${subscription.id}`, { method: 'DELETE' });
  r = await sync(sponsor, P.sponsor, [ID.film]);
  let it = item(r, ID.film);
  ok('the membership ended: the copy is `ended`, its date untouched', r.status === 200 && r.json.plan.carries === false && r.json.plan.tier === 'basic' && r.json.paidThrough === null && it && it.state === 'ended' && it.basis === 'member' && near(it.licensedUntil, until, 1000), brief(r));
  ok(`…endedAt is this check-in, keepUntil ${KEEP_AFTER_END_DAYS} days on`, it && near(it.endedAt, r.json.serverTime, 1000) && Date.parse(it.keepUntil) === Date.parse(it.endedAt) + KEEP_AFTER_END_DAYS * DAY, it);
  ok('…the row stays active with ended_at set', copy(sponsor, P.sponsor, ID.film).status === 'active' && copy(sponsor, P.sponsor, ID.film).ended_at !== null);
  ok('…and the app’s rule locks it as ended', playState({ now: Date.now(), licensedUntil: it.licensedUntil, lastSeenAt: Date.now(), ended: true }).reason === 'ended');
  const firstEnded = it.endedAt;
  await new Promise((done) => setTimeout(done, 1200));
  r = await sync(sponsor, P.sponsor, [ID.film]);
  ok('a later check-in keeps the first endedAt', item(r, ID.film).state === 'ended' && item(r, ID.film).endedAt === firstEnded, item(r, ID.film));
  r = await start(sponsor, ID.prem, P.sponsor);
  ok('…and nothing new can be downloaded (the gate, then the plan)', r.status === 403, brief(r));
  // (The site refuses a second Checkout within 20 seconds of the first.)
  await sleep(Math.max(0, 21000 - (Date.now() - ctx.subscribedAt)));
  ok('rejoining (Premium this time)', await subscribe(sponsor, 'premium'));
  r = await sync(sponsor, P.sponsor, [ID.film]);
  it = item(r, ID.film);
  ok('…the copy plays again: ok, nothing ended, a new date', r.status === 200 && it.state === 'ok' && it.endedAt === null && it.keepUntil === null && Date.parse(it.licensedUntil) === Date.parse(r.json.paidThrough) + GRACE_DAYS * DAY && copy(sponsor, P.sponsor, ID.film).ended_at === null, brief(r));

  // A bought copy refunded.
  sql(`update public.purchases set status = 'refunded', refunded_at = now() where buyer_id = ${q(buyer.id)} and target_id = ${q(ID.bought)}`);
  r = await sync(buyer, P.buyer, [ID.bought]);
  ok('a bought copy refunded, no plan: revoked (refund)', r.status === 200 && item(r, ID.bought).state === 'revoked' && item(r, ID.bought).reason === 'refund' && copy(buyer, P.buyer, ID.bought).status === 'revoked' && copy(buyer, P.buyer, ID.bought).revoke_reason === 'refund', brief(r));
  r = await sync(buyer, P.buyer, [ID.bought]);
  ok('…and the next check-in still says why', item(r, ID.bought).state === 'revoked' && item(r, ID.bought).reason === 'refund', item(r, ID.bought));
  sql(`update public.purchases set status = 'refunded', refunded_at = now() where buyer_id = ${q(premium.id)} and target_id = ${q(ID.prem)}`);
  r = await syncAll(premium, P.premium);
  ok('…for a member the refunded copy becomes a member’s copy', r.status === 200 && item(r, ID.prem).state === 'ok' && item(r, ID.prem).basis === 'member' && copy(premium, P.premium, ID.prem).basis === 'member', brief(r));

  // Never on a guess.
  const rowBefore = copy(premium, P.premium, ID.film);
  await clerk(`/__fail?user=${premium.id}&on=1`, { method: 'POST' });
  r = await sync(premium, P.premium, [ID.film, ID.prem]);
  await clerk(`/__fail?user=${premium.id}&on=0`, { method: 'POST' });
  const rowAfter = copy(premium, P.premium, ID.film);
  ok('Clerk not answering for the account: 503 unavailable, and the copies are as they were', r.status === 503 && r.json.code === 'unavailable' && rowAfter.status === 'active' && rowAfter.ended_at === null && rowAfter.renewed_at === rowBefore.renewed_at, `${brief(r)} | ${JSON.stringify(rowAfter)}`);
  if (SKIP_REVOKE) {
    console.log('skip the purchases fail-closed part (RIG_CHECK_SKIP_REVOKE=1)');
  } else {
    const owner = await person('dlowner');
    const ownerPhone = phone('ow');
    buy(owner, 'episode', ID.bought);
    await download(owner, ID.bought, ownerPhone);
    const kept = copy(owner, ownerPhone, ID.bought);
    r = await unreadable('purchases', () => sync(owner, ownerPhone, [ID.bought]));
    const still = copy(owner, ownerPhone, ID.bought);
    ok('the purchases unreadable: 503 unavailable in plain words, the bought copy untouched', isUnavailable(r) && !/purchases|permission|relation/i.test(r.text) && still.status === 'active' && still.renewed_at === kept.renewed_at, `${brief(r)} | ${JSON.stringify(still)}`);
    r = await sync(owner, ownerPhone, [ID.bought]);
    ok('…readable again: ok, owned', r.status === 200 && item(r, ID.bought).state === 'ok' && item(r, ID.bought).basis === 'owned', brief(r));
    ctx.owner = { who: owner, phone: ownerPhone };
  }

  // The title goes.
  await download(premium, ID.held, P.premium);
  await download(premium, ID.leaving, P.premium);
  sql(`update public.episodes set moderation_hold = true where id = ${q(ID.held)}`);
  sql(`update public.episodes set deletion_requested = true, deletion_requested_at = now() where id = ${q(ID.leaving)}`);
  const listed = copiesOn(premium, P.premium);
  r = await sync(premium, P.premium, listed);
  ok('a title pulled, and one on its way out: revoked (title); the rest ok — an answer for every title listed', r.status === 200 && listed.length >= 3 && r.json.items.length === listed.length && item(r, ID.held).state === 'revoked' && item(r, ID.held).reason === 'title' && item(r, ID.leaving).state === 'revoked' && item(r, ID.leaving).reason === 'title' && item(r, ID.film).state === 'ok'
    && copy(premium, P.premium, ID.held).status === 'revoked' && copy(premium, P.premium, ID.held).revoke_reason === 'title', brief(r));
  if (ctx.owner) {
    sql(`update public.episodes set deletion_requested = true, withdrawn_at = now() where id = ${q(ID.bought)}`);
    r = await sync(ctx.owner.who, ctx.owner.phone, [ID.bought]);
    ok('a withdrawn title stays fine for someone who owns it', r.status === 200 && item(r, ID.bought).state === 'ok' && item(r, ID.bought).basis === 'owned', brief(r));
    r = await start(ctx.owner.who, ID.bought, ctx.owner.phone);
    ok('…and they can still get a fresh link for it', r.status === 200 && r.json.basis === 'owned', brief(r));
    sql(`update public.episodes set moderation_hold = true where id = ${q(ID.bought)}`);
    r = await sync(ctx.owner.who, ctx.owner.phone, [ID.bought]);
    ok('…but a pulled one is taken back from its owner too', r.status === 200 && item(r, ID.bought).state === 'revoked' && item(r, ID.bought).reason === 'title', brief(r));
  }

  // The switch off: nothing renewed, nothing taken away.
  const held = copy(premium, P.premium, ID.film);
  await setSwitch(admin, false);
  r = await syncAll(premium, P.premium);
  it = item(r, ID.film);
  const paused = copy(premium, P.premium, ID.film);
  ok('the switch off: the copy is `paused` with the date it had, and isn’t renewed', r.status === 200 && r.json.enabled === false && it.state === 'paused' && it.basis === 'member' && near(it.licensedUntil, held.licensed_until, 1000) && paused.status === 'active' && paused.renewed_at === held.renewed_at && paused.licensed_until === held.licensed_until, `${brief(r)} | ${JSON.stringify(paused)}`);
  r = await start(premium, ID.film, P.premium);
  ok('…nobody can start a download (403 off, in the app’s words)', r.status === 403 && r.json.code === 'off' && r.json.error === DOWNLOAD_WORDS.off, brief(r));
  ok('…the Download button is hidden', JSON.stringify(await offer(premium, ID.film)) === JSON.stringify({ state: 'hidden', reason: 'off' }));
  r = await get(`/api/downloads?deviceId=${P.premium}`, premium);
  ok('…the list still answers, with enabled: false and the copies', r.status === 200 && r.json.enabled === false && r.json.items.some((x) => x.episodeId === ID.film), brief(r));
  sql(`update public.episodes set moderation_hold = true where id = ${q(ID.slow)}`);
  r = await sync(premium, P.premium, [ID.film, ID.slow]);
  ok('…and a title pulled meanwhile is still taken back', r.status === 200 && item(r, ID.slow).state === 'revoked' && item(r, ID.slow).reason === 'title' && item(r, ID.film).state === 'paused', brief(r));
  await setSwitch(admin, true);
  r = await sync(premium, P.premium, [ID.film]);
  ok('back on: ok and renewed', r.status === 200 && item(r, ID.film).state === 'ok' && copy(premium, P.premium, ID.film).renewed_at !== held.renewed_at, brief(r));
}

// ---- the creator's switch ---------------------------------------------------------------------
async function creatorSwitch(ctx) {
  section('The creator’s switch (“Allow downloads in the app”)');
  const { admin, premium, phones: P } = ctx;
  const editor = (who, id) => call(`/api/show/episode/${encodeURIComponent(id)}`, web(who));
  const patch = (who, id, body, opts = {}) => call(`/api/show/episode/${encodeURIComponent(id)}`, { ...(opts.bearer ? app(who) : web(who)), method: 'PATCH', body });
  const allowed = (id) => rows(`select downloads_allowed as a from public.episodes where id = ${q(id)}`)[0].a;

  let r = await editor(MARA, ID.film);
  ok('the editor’s read: allowed, the box open, 123 in', r.status === 200 && r.json.episode.downloadsAllowed === true && r.json.policy.downloadsAllowed.mode === 'direct' && r.json.migration.episodes123 === true, r.json && r.json.policy && r.json.policy.downloadsAllowed);
  r = await patch(MARA, ID.film, { downloadsAllowed: false }, { bearer: true });
  ok('the uploader switches it off on a live title: applies at once', r.status === 200 && r.json.applied.includes('downloadsAllowed') && !(r.json.staged || []).includes('downloadsAllowed') && allowed(ID.film) === false && r.json.view.episode.downloadsAllowed === false && r.json.view.policy.downloadsAllowed.mode === 'direct', brief(r));
  ok('…the Download button is gone for a member', JSON.stringify(await offer(premium, ID.film)) === JSON.stringify({ state: 'hidden', reason: 'title' }));
  r = await start(premium, ID.film, P.premium);
  ok('…a new download is refused (403 title)', r.status === 403 && r.json.code === 'title', brief(r));
  r = await sync(premium, P.premium, [ID.film]);
  ok('…and the copy on a phone is removed at its next check-in (revoked, title)', r.status === 200 && item(r, ID.film).state === 'revoked' && item(r, ID.film).reason === 'title' && copy(premium, P.premium, ID.film).status === 'revoked', brief(r));
  r = await patch(MARA, ID.film, { downloadsAllowed: true });
  ok('back on: applies at once', r.status === 200 && allowed(ID.film) === true, brief(r));
  r = await download(premium, ID.film, P.premium);
  ok('…and it can be downloaded again (a new row; the old one stays as history)', r.status === 200 && copy(premium, P.premium, ID.film).status === 'active' && Number(rows(`select count(*)::int as n from public.downloads where user_id = ${q(premium.id)} and episode_id = ${q(ID.film)}`)[0].n) >= 2, brief(r));
  r = await patch(MARA, ID.film, { downloadsAllowed: true });
  ok('saving what it already is changes nothing', r.status === 200 && r.json.unchanged === true, brief(r));
  r = await patch(MARA, ID.film, { downloadsAllowed: 'no' });
  ok('a value that isn’t yes or no: 400', r.status === 400 && allowed(ID.film) === true, brief(r));

  r = await editor(MARA, ID.pod);
  ok('a podcast episode has no such entry in the editor’s policy (no checkbox, web or app)', r.status === 200 && !Object.prototype.hasOwnProperty.call(r.json.policy, 'downloadsAllowed') && Object.prototype.hasOwnProperty.call(r.json.policy, 'hasFlashingLights'), r.json && Object.keys(r.json.policy || {}).length);
  r = await patch(MARA, ID.pod, { downloadsAllowed: false });
  ok('…and a save that sends it is refused (400 kind)', r.status === 400 && r.json.code === 'kind' && allowed(ID.pod) === true, brief(r));
  r = await patch(MARA, ID.held, { downloadsAllowed: false });
  ok('a pulled title: the switch still applies (every state)', r.status === 200 && allowed(ID.held) === false, brief(r));
  r = await patch(MARA, ID.leaving, { downloadsAllowed: false });
  ok('…and one whose removal was asked for', r.status === 200 && allowed(ID.leaving) === false, brief(r));

  r = await editor(MARA, ID.showEp);
  ok('the show’s owner, an episode someone else uploaded: the box is open', r.status === 200 && r.json.viewer.isUploader === false && r.json.viewer.isRunner === true && r.json.policy.downloadsAllowed.mode === 'direct', r.json && r.json.viewer);
  r = await patch(MARA, ID.showEp, { downloadsAllowed: false });
  ok('…and the owner switches it off', r.status === 200 && allowed(ID.showEp) === false, brief(r));
  r = await patch(DEE, ID.showEp, { downloadsAllowed: true }, { bearer: true });
  ok('…its uploader back on', r.status === 200 && allowed(ID.showEp) === true, brief(r));
  r = await patch(DEE, ID.film, { downloadsAllowed: false });
  ok('another creator’s title: not theirs (404), unchanged', r.status === 404 && allowed(ID.film) === true, brief(r));
  const flags = await subAdmin('dlflags', ['handle_flags']);
  r = await editor(flags, ID.film);
  ok('a sub-admin without the episodes capability sees the box greyed with who may change it', r.status === 200 && r.json.policy.downloadsAllowed.mode === 'locked' && /uploaded it or the show’s owner/.test(r.json.policy.downloadsAllowed.line || ''), r.json && r.json.policy && r.json.policy.downloadsAllowed);
  r = await patch(flags, ID.film, { downloadsAllowed: false });
  ok('…and is refused (403 locked)', r.status === 403 && r.json.code === 'locked' && r.json.field === 'downloadsAllowed' && allowed(ID.film) === true, brief(r));
  r = await patch(admin, ID.film, { downloadsAllowed: false });
  ok('the team, through the show editor’s save', r.status === 200 && allowed(ID.film) === false, brief(r));

  r = await call('/api/admin/edit-episode', { ...web(admin), method: 'POST', body: { episodeId: ID.film, downloadsAllowed: true } });
  ok('the team, through the Library’s save', r.status === 200 && allowed(ID.film) === true, brief(r));
  r = await call('/api/admin/edit-episode', { ...web(admin), method: 'POST', body: { episodeId: ID.film, downloadsAllowed: 'maybe' } });
  ok('…a value that isn’t yes or no: 400', r.status === 400, brief(r));
  r = await call(`/api/admin/library?id=${encodeURIComponent(ID.off)}`, web(admin));
  const row = r.json && r.json.episodes && r.json.episodes[0];
  ok('the Library’s row carries the switch and that the database has it', r.status === 200 && row && row.downloadsAllowed === false && row.downloadsAllowedReady === true, row && { a: row.downloadsAllowed, ready: row.downloadsAllowedReady });
  r = await get('/api/admin/downloads', admin);
  const off = (r.json && r.json.titlesOff) || [];
  const expected = Number(rows('select count(*)::int as n from public.episodes where downloads_allowed = false')[0].n);
  ok('Admin → Downloads lists the titles switched off and counts them', r.status === 200 && r.json.numbers.titlesOff === expected && [ID.off, ID.held, ID.leaving].every((id) => off.some((t) => t.id === id && /^Check download/.test(t.title))) && !off.some((t) => t.id === ID.film), { n: r.json && r.json.numbers, expected });
  const copies = Number(rows("select count(*)::int as n from public.downloads where status = 'active' and licensed_until is not null")[0].n);
  const phonesNow = Number(rows("select count(*)::int as n from (select distinct user_id, device_id from public.downloads where status = 'active' and licensed_until is not null) x")[0].n);
  const waitingNow = Number(rows("select count(*)::int as n from public.downloads where status = 'active' and licensed_until is null")[0].n);
  ok('…and counts the copies and the phones that hold them (a title still waiting for its file isn’t a copy)', r.json.numbers.copies === copies && r.json.numbers.phones === phonesNow && copies > MAX_TITLES_PER_DEVICE, { n: r.json.numbers, copies, phonesNow, waitingNow });

  // Your work's rows carry the switch for the two edit boxes.
  r = await call('/api/creator/my-submissions', web(MARA));
  const mine = ((r.json && r.json.submissions) || []);
  const rowOf = (id) => mine.find((x) => x.id === id) || null;
  ok('Your work’s rows carry the switch and that the database has it', r.status === 200 && rowOf(ID.review) && rowOf(ID.review).downloadsAllowed === true && rowOf(ID.review).downloadsAllowedReady === true && rowOf(ID.off) && rowOf(ID.off).downloadsAllowed === false, rowOf(ID.review) && { a: rowOf(ID.review).downloadsAllowed, ready: rowOf(ID.review).downloadsAllowedReady });
}

// ---- the pages -------------------------------------------------------------------------------
async function thePages(ctx) {
  section('The pages');
  const { admin, sub, viewer, limits } = ctx;
  const html = (path, who) => call(path, { ...web(who), accept: 'text/html,application/xhtml+xml' });
  let r = await html('/admin/downloads', admin);
  ok('/admin/downloads for a full admin: the switch’s words and the numbers', r.status === 200 && r.text.includes(ADMIN_DOWNLOAD_WORDS.on.slice(0, 60)) && r.text.includes('Copies on phones') && r.text.includes(ADMIN_DOWNLOAD_WORDS.lock), r.status);
  ok('…the admin nav has its row', r.text.includes('href="/admin/downloads"'));
  r = await html('/admin/downloads', sub);
  ok('a sub-admin holding every capability is sent away from the page', r.status === 307 && r.headers.get('location') === '/admin', `${r.status} ${r.headers.get('location')}`);
  r = await html('/admin', sub);
  ok('…and its nav has no such row', r.status === 200 && !r.text.includes('href="/admin/downloads"'), r.status);
  r = await html('/admin/downloads', MARA);
  ok('a creator is sent away too', r.status === 307 && r.headers.get('location') === '/stream', `${r.status} ${r.headers.get('location')}`);

  r = await html('/downloads', SIGNED_OUT);
  ok('/downloads signed out: downloads live in the app, sign in to see your phones', r.status === 200 && r.text.includes('Downloads live in the Studio Tapa TV app') && r.text.includes('to see the phones that hold your downloads') && r.text.includes('noindex'), r.status);
  r = await eventually(() => html('/downloads', viewer), (x) => x.text.includes(DOWNLOAD_WORDS.planAction));
  ok('…a Basic account: no phones, and the way to the plans', r.status === 200 && r.text.includes('No phone holds a download of yours right now.') && r.text.includes(DOWNLOAD_WORDS.planAction), r.status);
  r = await html('/downloads', limits.who);
  ok('…an account with two phones: both, with how many titles', r.status === 200 && r.text.includes('Phone A') && r.text.includes('Phone C') && r.text.includes(`${MAX_TITLES_PER_DEVICE} titles`) && r.text.includes('1 title') && r.text.includes('Remove this phone'), r.status);

  const sentence = 'keep a title in the app to watch offline';
  r = await eventually(() => html('/ai-policy', SIGNED_OUT), (x) => x.text.includes(sentence));
  ok('the AI policy says how downloads work while the switch is on', r.status === 200 && r.text.includes(sentence) && r.text.includes('not an encrypted one'), r.status);
  ok('…without promising more than the app does: no "plays only in the app", and it says a copy can be fetched outside it', !/plays only in the app/.test(r.text) && r.text.includes('outside the app') && r.text.includes('We limit how many titles an account can take'), r.status);
  r = await html('/terms', SIGNED_OUT);
  ok('the Terms have their downloads paragraph', r.status === 200 && r.text.includes('id="downloads"') && /Downloads in the app/.test(r.text), r.status);
  r = await html('/privacy', SIGNED_OUT);
  ok('…and the Privacy page its own, and the download records among what a deletion removes', r.status === 200 && /If you download in the app/.test(r.text) && r.text.includes('the record of your phones and downloads within 30 days'), r.status);

  const b = await browser();
  try {
    // The tab bar's row, and /downloads' Remove this phone.
    let v = await b.open(limits.who, 390);
    ok('/downloads opens at 390', (await goto(v.page, '/downloads')) === 200);
    await v.page.waitForFunction(() => document.querySelectorAll('.tabbar-item').length >= 4, null, { timeout: 30000 });
    await v.page.locator('.tabbar-item', { hasText: 'Watch' }).click();
    // The row comes once the bar has read /api/site-settings.
    await v.page.waitForFunction((word) => { const a = document.querySelector('.tabbar-dropup-item'); return Boolean(a) && a.textContent.trim() === word; }, DOWNLOAD_WORDS.nav, { timeout: 30000 }).catch(() => {});
    const first = v.page.locator('.tabbar-dropup-item').first();
    ok('the tab bar’s Watch menu starts with Downloads, and the tab is lit', (await first.innerText()).trim() === DOWNLOAD_WORDS.nav && (await first.getAttribute('href')) === '/downloads' && (await v.page.locator('.tabbar-item.active', { hasText: 'Watch' }).count()) === 1, await first.innerText());
    await v.page.keyboard.press('Escape');
    await v.page.locator('main').click({ position: { x: 5, y: 5 } });
    ok('…the header is the Stream one', (await v.page.locator('header.channel-bar').innerText()).length > 0 && (await overflowPx(v.page)) <= 0, await overflowPx(v.page));
    const rowsBefore = await v.page.locator('[data-testid="downloads-phone"]').count();
    const target = v.page.locator('[data-testid="downloads-phone"]', { hasText: 'Phone C' });
    await target.getByRole('button', { name: 'Remove this phone' }).click();
    ok('Remove this phone asks first (Remove / Keep)', (await target.getByRole('button', { name: 'Remove', exact: true }).count()) === 1 && (await target.getByRole('button', { name: 'Keep' }).count()) === 1);
    await target.getByRole('button', { name: 'Remove', exact: true }).click();
    await v.page.waitForFunction((n) => document.querySelectorAll('[data-testid="downloads-phone"]').length === n - 1, rowsBefore, { timeout: 30000 });
    ok('…then the phone leaves the list, and the page says its downloads go at its next check-in', rowsBefore === 2 && (await v.page.locator('[data-testid="downloads-phones"]').innerText()).includes('Its downloads go the next time it connects'), rowsBefore);
    ok('…and it is removed on record', rows(`select removed_at from public.download_devices where user_id = ${q(limits.who.id)} and device_id = ${q(limits.C)}`)[0].removed_at !== null);
    const back = await limits.start(limits.who, LIMIT[4], limits.B);
    ok('a phone removed earlier can download again now that there is room, and is back on the list', back.status === 200 && rows(`select removed_at from public.download_devices where user_id = ${q(limits.who.id)} and device_id = ${q(limits.B)}`)[0].removed_at === null, brief(back));
    ok('no page errors on /downloads', v.errors.length === 0, v.errors);
    await v.ctx.close();

    // Admin → Downloads, a real click on the switch, the lock and UNLOCK.
    const boss = await teamAdmin('dlboss');
    for (const width of [1280, 390]) {
      v = await b.open(boss, width);
      ok(`/admin/downloads opens at ${width}`, (await goto(v.page, '/admin/downloads')) === 200);
      const sw = v.page.getByRole('switch', { name: 'Downloads in the app' });
      ok(`…the switch is on, with its words (${width})`, (await sw.getAttribute('aria-checked')) === 'true' && (await v.page.locator('[data-testid="downloads-words"]').innerText()) === ADMIN_DOWNLOAD_WORDS.on);
      ok(`…four tiles, no sideways scroll (${width})`, (await v.page.locator('.sec-tile').count()) === 4 && (await overflowPx(v.page)) <= 0, await overflowPx(v.page));
      await sw.click();
      await v.page.waitForFunction(() => document.querySelector('[role="switch"]').getAttribute('aria-checked') === 'false', null, { timeout: 30000 });
      ok(`a click turns it off, and the words change (${width})`, settingsNow().enabled === false && (await v.page.locator('[data-testid="downloads-words"]').innerText()) === ADMIN_DOWNLOAD_WORDS.off);
      await sw.click();
      await v.page.waitForFunction(() => document.querySelector('[role="switch"]').getAttribute('aria-checked') === 'true', null, { timeout: 30000 });
      ok(`…and back on (${width})`, settingsNow().enabled === true);
      await v.page.getByRole('button', { name: ADMIN_DOWNLOAD_WORDS.lock }).click();
      await v.page.waitForSelector('[data-testid="downloads-locked-line"]', { timeout: 30000 });
      const line = await v.page.locator('[data-testid="downloads-locked-line"]').innerText();
      ok(`“Lock this switch” locks it: the line names the day and who, the switch is greyed (${width})`, settingsNow().locked === true && /^Locked on [A-Z][a-z]{2} \d{1,2}, \d{4} by dlboss/.test(line) && line.endsWith('Nobody can change it until a full admin unlocks it.') && (await sw.isDisabled()), line);
      await v.page.getByRole('button', { name: ADMIN_DOWNLOAD_WORDS.unlock }).click();
      const unlock = v.page.getByRole('button', { name: 'Unlock', exact: true });
      ok(`“Unlock…” asks for the word, and waits for it (${width})`, (await v.page.locator('#dl-unlock-word').count()) === 1 && (await unlock.isDisabled()));
      await v.page.locator('#dl-unlock-word').fill('unlock please');
      ok(`…another word leaves the button greyed (${width})`, await unlock.isDisabled());
      await v.page.locator('#dl-unlock-word').fill(UNLOCK_WORD);
      await unlock.click();
      await v.page.getByRole('button', { name: ADMIN_DOWNLOAD_WORDS.lock }).waitFor({ timeout: 30000 });
      ok(`…${UNLOCK_WORD} unlocks it (${width})`, settingsNow().locked === false && !(await sw.isDisabled()) && (await overflowPx(v.page)) <= 0);
      ok(`no page errors on /admin/downloads (${width})`, v.errors.length === 0, v.errors);
      await v.ctx.close();
    }

    // The editor's checkbox.
    v = await b.open(MARA, 390);
    const status = await goto(v.page, `/creator/show/${ID.show}/episode/${ID.showEp}`);
    const tab = v.page.getByRole('tab', { name: /More info/ });
    await tab.waitFor({ timeout: 30000 }).catch(() => {});
    if (await tab.count()) await tab.click();
    const box = v.page.locator('#ep-downloads');
    await box.waitFor({ timeout: 30000 }).catch(() => {});
    ok('the episode editor’s More info has the checkbox, ticked, with its words', status === 200 && (await box.isChecked()) && !(await box.isDisabled()) && (await v.page.locator('label[for="ep-downloads"]').innerText()).includes(DOWNLOADS_ALLOWED_LABEL), status);
    await v.ctx.close();

    // Your work's two edit boxes: a film or a short has the switch there too.
    const titleOf = (id) => rows(`select title from public.episodes where id = ${q(id)}`)[0].title;
    const allowedNow = (id) => rows(`select downloads_allowed as a from public.episodes where id = ${q(id)}`)[0].a;
    v = await b.open(MARA, 1280);
    const workStatus = await goto(v.page, '/creator/my-work');
    const reviewRow = v.page.locator('.work-episode-row', { hasText: titleOf(ID.review) });
    await reviewRow.waitFor({ timeout: 60000 }).catch(() => {});
    await reviewRow.locator('button[title="Edit"]').click();
    const inReview = v.page.locator('#edit-submission-downloads');
    await inReview.waitFor({ timeout: 30000 }).catch(() => {});
    ok('Your work, a short still in review: its edit box has “Allow downloads in the app”, ticked', workStatus === 200 && (await inReview.count()) === 1 && (await inReview.isChecked()) && !(await inReview.isDisabled()) && (await v.page.locator('label[for="edit-submission-downloads"]').innerText()).includes(DOWNLOADS_ALLOWED_LABEL), workStatus);
    await inReview.uncheck();
    await v.page.getByRole('button', { name: 'Save changes' }).click();
    await v.page.waitForFunction(() => !document.querySelector('#edit-submission-downloads'), null, { timeout: 30000 }).catch(() => {});
    ok('…unticking it and saving switches downloads off for the title', allowedNow(ID.review) === false, allowedNow(ID.review));
    const openMenu = async (id) => {
      await v.page.getByRole('button', { name: `Options for ${titleOf(id)}` }).click();
      await v.page.getByRole('menuitem', { name: /Edit title/ }).click();
    };
    await openMenu(ID.teen);
    const live = v.page.locator('#req-edit-downloads');
    await live.waitFor({ timeout: 30000 }).catch(() => {});
    ok('Your work, a live film: its edit box has the switch too, ticked', (await live.count()) === 1 && (await live.isChecked()) && !(await live.isDisabled()));
    await live.uncheck();
    const save = v.page.locator('.modal-card button[type="submit"]');
    ok('…the Save button says it applies at once (nothing goes to review)', /applies at once/.test(await save.innerText()), await save.innerText());
    await save.click();
    await v.page.getByText('Saved: the downloads switch.').waitFor({ timeout: 30000 }).catch(() => {});
    ok('…and saving switches downloads off for the live title, at once', allowedNow(ID.teen) === false && (await v.page.getByText('Saved: the downloads switch.').count()) === 1, allowedNow(ID.teen));
    await v.page.getByRole('button', { name: 'Close', exact: true }).click();
    await openMenu(ID.pod);
    await v.page.locator('#req-edit-title').waitFor({ timeout: 30000 }).catch(() => {});
    ok('…a podcast’s edit box has no such switch', (await v.page.locator('#req-edit-title').count()) === 1 && (await v.page.locator('#req-edit-downloads').count()) === 0);
    ok('no page errors on Your work', v.errors.length === 0, v.errors);
    await v.ctx.close();

    // The Library's modal. (On a dev server compiling the page for the
    // first time, Next can reload the page under the modal: asked twice.)
    const openModal = async (pg, id) => {
      const any = pg.locator('label.admin-checkbox', { hasText: 'Tapa Original' });
      for (let attempt = 0; attempt < 2 && (await any.count()) === 0; attempt += 1) {
        await goto(pg, `/admin/library?edit=${encodeURIComponent(id)}`);
        await any.waitFor({ timeout: 25000 }).catch(() => {});
      }
      return (await any.count()) === 1;
    };
    v = await b.open(admin, 1280);
    const opened = await openModal(v.page, ID.off);
    const tick = v.page.locator('label.admin-checkbox', { hasText: DOWNLOADS_ALLOWED_LABEL }).locator('input[type="checkbox"]');
    ok('the Library’s modal has the checkbox, unticked for a title switched off', opened && (await tick.count()) === 1 && !(await tick.isChecked()), opened);
    await tick.check({ timeout: 10000 });
    await v.page.locator('button[type="submit"]', { hasText: /Save/ }).first().click();
    await v.page.waitForFunction(() => !document.querySelector('label.admin-checkbox input[type="checkbox"]'), null, { timeout: 30000 }).catch(() => {});
    await sleep(1500);
    ok('…ticking it and saving switches downloads on for the title', rows(`select downloads_allowed as a from public.episodes where id = ${q(ID.off)}`)[0].a === true);
    ok('no page errors in the Library', v.errors.length === 0, v.errors);
    await v.ctx.close();
    v = await b.open(admin, 1280);
    const podOpened = await openModal(v.page, ID.pod);
    ok('…and a podcast episode has no such checkbox', podOpened && (await v.page.locator('label.admin-checkbox', { hasText: DOWNLOADS_ALLOWED_LABEL }).count()) === 0, podOpened);
    await v.ctx.close();
  } finally {
    await b.close();
  }

  await setSwitch(admin, false);
  r = await eventually(() => html('/ai-policy', SIGNED_OUT), (x) => !x.text.includes(sentence));
  ok('the switch off: the AI policy’s downloads sentence is gone (within half a minute)', r.status === 200 && !r.text.includes(sentence), r.status);
  r = await eventually(() => html('/downloads', viewer), (x) => x.text.includes(DOWNLOAD_WORDS.off));
  ok('…and /downloads says downloads are switched off for now', r.status === 200 && r.text.includes(DOWNLOAD_WORDS.off), r.status);
  r = await get('/api/site-settings', viewer);
  ok('…and /api/site-settings says off', r.json.downloadsEnabled === false);
}

// ---- before 123 ------------------------------------------------------------------------------
async function before123() {
  section('Before migration 123');
  const admin = await teamAdmin('dladmin');
  const sub = await subAdmin('dlsub', ALL_CAPS);
  const P = phone('b');
  const is503 = (r) => r.status === 503 && r.json && r.json.code === 'migration-123' && r.json.error === MIGRATION_123_MSG;
  insert('episodes', film(ID.film, { src: `https://customer-test.cloudflarestream.com/${crypto.randomBytes(16).toString('hex')}/manifest/video.m3u8` }));

  let r = await get('/api/site-settings', admin);
  ok('/api/site-settings: downloadsEnabled false', r.status === 200 && r.json.downloadsEnabled === false, r.json && r.json.downloadsEnabled);
  ok('/api/episode-page: the Download button hidden (off)', JSON.stringify(await offer(admin, ID.film)) === JSON.stringify({ state: 'hidden', reason: 'off' }));
  r = await get(`/api/downloads?deviceId=${P}`, admin);
  ok('GET /api/downloads: 503 migration-123', is503(r), brief(r));
  r = await start(admin, ID.film, P);
  ok('POST /api/downloads/start: 503 migration-123', is503(r), brief(r));
  r = await sync(admin, P, [ID.film]);
  ok('POST /api/downloads/sync: 503 migration-123', is503(r), brief(r));
  r = await post('/api/downloads/remove', admin, { deviceId: P, episodeId: ID.film });
  ok('POST /api/downloads/remove: 503 migration-123', is503(r), brief(r));
  r = await get('/api/downloads/devices', admin);
  const rm = await post('/api/downloads/devices', admin, { remove: P });
  ok('GET and POST /api/downloads/devices: 503 migration-123', is503(r) && is503(rm), `${brief(r)} | ${brief(rm)}`);
  r = await get('/api/admin/downloads', admin);
  const flip = await adminPost(admin, { enabled: true });
  const lock = await adminPost(admin, { locked: true });
  ok('the admin route: 503 migration-123 on the read, the flip and the lock', is503(r) && is503(flip) && is503(lock), `${brief(r)} | ${brief(flip)} | ${brief(lock)}`);
  r = await get('/api/admin/downloads', sub);
  ok('…a sub-admin is still refused first (403)', r.status === 403, brief(r));
  r = await get('/api/downloads', SIGNED_OUT);
  ok('…and signed out is still 401', r.status === 401, brief(r));

  r = await call(`/api/show/episode/${encodeURIComponent(ID.film)}`, web(MARA));
  ok('the editor’s read: allowed, the box greyed with the migration’s line', r.status === 200 && r.json.episode.downloadsAllowed === true && r.json.policy.downloadsAllowed.mode === 'locked' && r.json.policy.downloadsAllowed.line === MIGRATION_123_MSG && r.json.migration.episodes123 === false, r.json && r.json.policy && r.json.policy.downloadsAllowed);
  r = await call(`/api/show/episode/${encodeURIComponent(ID.film)}`, { ...web(MARA), method: 'PATCH', body: { downloadsAllowed: false } });
  ok('the creator’s switch: 503 migration-123', r.status === 503 && r.json.code === 'migration-123' && r.json.field === 'downloadsAllowed', brief(r));
  r = await call('/api/admin/edit-episode', { ...web(admin), method: 'POST', body: { episodeId: ID.film, downloadsAllowed: false } });
  ok('…and through the Library’s save', r.status === 503 && r.json.code === 'migration-123', brief(r));
  r = await call(`/api/admin/library?id=${encodeURIComponent(ID.film)}`, web(admin));
  ok('the Library’s row: no such column yet (the modal leaves the checkbox out)', r.status === 200 && r.json.episodes[0].downloadsAllowedReady === false && r.json.episodes[0].downloadsAllowed === true, r.json && r.json.episodes && r.json.episodes[0] && r.json.episodes[0].downloadsAllowedReady);
  r = await call(`/api/show/episode/${encodeURIComponent(ID.film)}`, { ...web(MARA), method: 'PATCH', body: { genre: 'Mystery' } });
  ok('every other save of the editor works as before', r.status === 200 && r.json.applied.includes('genre'), brief(r));
  r = await call('/api/creator/my-submissions', web(MARA));
  const mineRow = ((r.json && r.json.submissions) || []).find((x) => x.id === ID.film) || null;
  ok('Your work’s row: allowed, no such column yet (its edit boxes grey the switch with the migration’s line)', r.status === 200 && mineRow && mineRow.downloadsAllowed === true && mineRow.downloadsAllowedReady === false, mineRow && { a: mineRow.downloadsAllowed, ready: mineRow.downloadsAllowedReady });
  r = await call('/api/downloads/start', { ...web(admin), method: 'POST', body: { episodeId: ID.film, deviceId: P, terms: 1 } });
  ok('a browser’s session is refused by the app’s routes before 123 too (403 app-only)', r.status === 403 && r.json.code === 'app-only', brief(r));

  const html = (path, who) => call(path, { ...web(who), accept: 'text/html,application/xhtml+xml' });
  r = await html('/admin/downloads', admin);
  ok('/admin/downloads shows the “needs a database update (migration 123)” banner, the switch off', r.status === 200 && r.text.includes('run migration 123') && r.text.includes('needs a database update first (migration 123)') && r.text.includes(ADMIN_DOWNLOAD_WORDS.off.slice(0, 40)), r.status);
  r = await html('/downloads', admin);
  ok('/downloads still opens', r.status === 200 && r.text.includes('Downloads live in the Studio Tapa TV app'), r.status);
  r = await html(`/episode/${ID.film}?autoplay=1`, admin);
  ok('a title’s page still opens', r.status === 200 && r.text.includes('"download":{"state":"hidden","reason":"off"}'), r.status);
  r = await html('/ai-policy', SIGNED_OUT);
  ok('the AI policy has no downloads sentence', r.status === 200 && !r.text.includes('keep a title in the app to watch offline'), r.status);
}

await runCheck(`downloads (${HAS123 ? 'after' : 'before'} 123)`, async () => {
  try {
    if (!HAS123) {
      await before123();
      return;
    }
    before = settingsNow();
    sql('update public.site_settings set downloads_enabled = false, downloads_locked = false where id = 1');
    await seed();
    const ctx = {
      admin: await teamAdmin('dladmin'),
      sub: await subAdmin('dlsub', ALL_CAPS),
      viewer: await person('dlbasic'),
      standard: await person('dlstd'),
      premium: await person('dlprem'),
      sponsor: await person('dlspon'),
      buyer: await person('dlbuyer')
    };
    // The cached copy of the settings in the app follows the route's own
    // flips at once; a row changed in SQL (above) is read fresh by the
    // admin route before anything else.
    await get('/api/admin/downloads', ctx.admin);
    ok('a Standard member subscribes through Checkout', await subscribe(ctx.standard, 'standard'));
    ok('a Premium member subscribes through Checkout', await subscribe(ctx.premium, 'premium'));
    ok('a Sponsor member subscribes through Checkout', await subscribe(ctx.sponsor, 'sponsor'));
    ctx.subscribedAt = Date.now();
    buy(ctx.buyer, 'episode', ID.bought);
    await theSwitch(ctx);
    await whoMayDownload(ctx);
    await theLink(ctx);
    await theDates(ctx);
    await theLimits(ctx);
    await askingAgain(ctx);
    await theCheckIn(ctx);
    await creatorSwitch(ctx);
    await firstAsk(ctx);
    await racing(ctx);
    await onlyTheApp(ctx);
    await neverOnAGuess(ctx);
    await thePages(ctx);
  } finally {
    await cleanup().catch((err) => ok('cleanup', false, String(err && err.message)));
  }
});
