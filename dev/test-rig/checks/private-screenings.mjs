#!/usr/bin/env node
// Private screening links (migration 128; mockups/private-screenings-contract.md),
// end to end through the API and the viewer's page:
//   the creator's side  list a film's and a show's links (the target, its
//                       seasons and the episodes a link can play, a password
//                       suggestion), make links (a film; a show's season; picked
//                       episodes), the password route, one link's own data,
//                       edit, a new password, end, discard, run again; the
//                       errors (400 field, 401, 403 not-yours — a stranger, and
//                       an uploader of one episode in another person's show —,
//                       404, 409 ended / not-ended / unavailable)
//   the viewer          the page's states over HTTP (password, legacy, not_yet,
//                       ended, stopped, country, signin, named, named_other,
//                       gone, unavailable); wrong passwords ×5 → locked there,
//                       the right one elsewhere → a visit and a signed address;
//                       play; the beat recording how far; one screen at a
//                       time; each person's cap; the total cap; a new password
//                       ending the visits from before it; a visit past its
//                       hours; a country limit read from x-vercel-ip-country;
//                       signed-in-only and named (by account and by verified
//                       email); a 109 screener opening with no password; the
//                       owner told per `notify`; 20 wrong passwords in a day →
//                       told once; turned-away tries on the dashboard
//   elsewhere           the Distribution page's screenings, its old POST (410)
//                       and DELETE; the daily step (ended notice, a daily
//                       summary, a year-old link's viewer rows deleted); and
//                       nothing in watch history; the page in a browser at 320,
//                       390 and 1280 (the form, a wrong password, the player
//                       with its watermark, a show's episodes, a reload
//                       picking the visit up without a new open, nothing
//                       off the side).
//   Before 128 (RIG_MIGRATE_TO=127): every creator route answers 503
//   migration-128, an old screener's page says it isn't available and its
//   open 503, the Distribution page still lists it, the daily step reads
//   { ready: false }.
//   node dev/test-rig/checks/private-screenings.mjs [--no-browser]
import crypto from 'node:crypto';
import { BASE, RUN, USERS, ok, section, runCheck, call, sql, rows, q, insert, session, newUser, removeUser, uidFor, IDS, ago, hasColumn, browser, goto, overflowPx } from './lib.mjs';
import { pacificParts, pacificToMs } from '../../../lib/screeningRules.js';

const ORIGIN = { Origin: BASE };
const cf = (u) => `https://customer-test.cloudflarestream.com/${u}/manifest/video.m3u8`;
const inDays = (d) => new Date(Date.now() + d * 86400000).toISOString();
const PASSWORD = 'tide-lantern-42';
const ID = {
  film: `ck-ps-film-${RUN}`,
  show: `ck-ps-show-${RUN}`,
  s1e1: `ck-ps-s1e1-${RUN}`,
  s1e2: `ck-ps-s1e2-${RUN}`,
  s1held: `ck-ps-s1held-${RUN}`,
  s2e1: `ck-ps-s2e1-${RUN}`,
  extra: `ck-ps-extra-${RUN}`,
  pulled: `ck-ps-pulled-${RUN}`
};
const PRODUCTION = crypto.randomUUID();
const LEGACY_TOKEN = crypto.randomBytes(18).toString('base64url');
const ADMIN = session(USERS.admin);
let ipN = 0;
const ip = () => `203.0.113.${(ipN += 1) % 250}`;

const ep = (id, extra = {}) => ({
  id, title: `Check ps ${id.slice(6, 14)} ${RUN}`, description: 'A screening check title.', tier: 'premium', genre: 'Drama', main_genre: 'Drama', content_type: 'movie',
  artist: 'Olga Owner', runtime: '24:00', rating: 'TV-14', release_year: 2026, src: cf(uidFor(IDS.film)), video_type: 'html5', video_provider: 'cloudflare',
  ads_enabled: true, deletion_requested: false, moderation_hold: false, status: 'approved', reviewed_at: ago(3), released_at: ago(3), created_at: ago(5), poster: null, thumbnail: null, ...extra
});

// The rig's own guest browser: the dev-browser cookie, a guest cookie of its own once one is set.
const guest = (cookie = null) => ({ cookie: `__clerk_db_jwt=dvb_rig_signed_out${cookie ? `; tapa_scr=${cookie}` : ''}` });
const geo = (country, city = null, region = null) => ({ ...(country ? { 'x-vercel-ip-country': country } : {}), ...(city ? { 'x-vercel-ip-city': encodeURIComponent(city) } : {}), ...(region ? { 'x-vercel-ip-country-region': region } : {}) });
const cookieOf = (r) => {
  const m = /tapa_scr=([A-Za-z0-9_-]+)/.exec(r.headers.get('set-cookie') || '');
  return m ? m[1] : null;
};
const open = (token, { who = guest(), password = PASSWORD, from = ip(), place = geo('US', 'Los Angeles', 'CA') } = {}) => call(`/api/screener/${token}/open`, { who, method: 'POST', body: { password }, headers: { ...ORIGIN, 'X-Forwarded-For': from, ...place } });
const play = (token, sessionKey, episodeId, who = guest()) => call(`/api/screener/${token}/play`, { who, method: 'POST', body: { session: sessionKey, episodeId }, headers: { ...ORIGIN, 'X-Forwarded-For': ip() } });
const beat = (token, sessionKey, { episodeId = null, position = 0, duration = 0, playing = true, who = guest() } = {}) => call(`/api/screener/${token}/beat`, { who, method: 'POST', body: { session: sessionKey, episodeId, position, duration, playing }, headers: { ...ORIGIN, 'X-Forwarded-For': ip() } });
async function pageOf(token, who = guest(), place = geo('US')) {
  const r = await call(`/screener/${token}`, { who, accept: 'text/html,application/xhtml+xml', headers: { ...place, 'X-Forwarded-For': ip() } });
  const m = /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/.exec(r.text);
  let data = null;
  try { data = m ? JSON.parse(m[1]) : null; } catch (err) { data = null; }
  return { status: r.status, headers: r.headers, text: r.text, page: data && data.props && data.props.pageProps ? data.props.pageProps.page : null };
}
const make = (who, target, extra = {}) => call('/api/screenings', { who, method: 'POST', headers: ORIGIN, body: { target, label: `Check ps ${RUN}`, endsAt: inDays(7), password: PASSWORD, maxViews: 10, perPerson: 3, oneScreen: false, notify: 'first', ...extra } });
const patch = (who, id, body) => call(`/api/screenings/${id}`, { who, method: 'PATCH', headers: ORIGIN, body });
const linkRow = (id) => rows(`select * from public.screeners where id = ${q(id)}`)[0];
const notes = (userId, type) => rows(`select message, href from public.notifications where user_id = ${q(userId)} and type = ${q(type)} order by created_at`);

// Before migration 128: the creator's side answers 503, an old screener
// waits for it, the Distribution page and the daily step carry on.
async function before128(O) {
  section('Before migration 128');
  let r = await call(`/api/screenings?target=episode:${ID.film}`, { who: O });
  ok('the list: 503 migration-128', r.status === 503 && r.json && r.json.code === 'migration-128', r.text.slice(0, 200));
  r = await make(O, { type: 'episode', id: ID.film });
  ok('making a link: 503 migration-128', r.status === 503 && r.json && r.json.code === 'migration-128', r.text.slice(0, 200));
  r = await call(`/api/screenings/${crypto.randomUUID()}`, { who: O });
  ok('one link: 503 migration-128', r.status === 503 && r.json.code === 'migration-128', r.status);
  const pg = await pageOf(LEGACY_TOKEN);
  ok('an old screener’s page: 200, not available (not a 500)', pg.status === 200 && pg.page && pg.page.state === 'unavailable', [pg.status, pg.page && pg.page.state]);
  r = await open(LEGACY_TOKEN, { password: '' });
  ok('…its open: 503 migration-128', r.status === 503 && r.json.code === 'migration-128', r.status);
  r = await call(`/api/productions/${PRODUCTION}/distribution`, { who: O });
  ok('the Distribution page lists it, legacy (and screeners: [] for older app builds)', r.status === 200 && r.json.screenings && r.json.screenings.links.some((l) => l.token === LEGACY_TOKEN && l.legacy === true) && r.json.checklist.screenersLive === 1 && Array.isArray(r.json.screeners) && Array.isArray(r.json.episodes), r.text.slice(0, 300));
  const cron = await call('/api/cron/expire-content', { method: 'POST', headers: { Authorization: 'Bearer rig-cron-secret' } });
  ok('the daily step: { ready: false }', cron.status === 200 && cron.json.screenings && cron.json.screenings.ready === false, cron.text.slice(0, 300));
}

// The page in a browser: the form, the player, a show's episodes, a reload.
async function inBrowser(O) {
  section('The page in a browser');
  const made = await make(O, { type: 'series', id: ID.show }, { label: `Browser ${RUN}`, maxViews: 20, perPerson: null });
  const L = made.json && made.json.link;
  if (!ok('a link for the browser', made.status === 201 && L, made.text.slice(0, 200))) return;
  const b = await browser();
  try {
    for (const width of [390, 1280, 320]) {
      const { ctx, page: pg, errors } = await b.open(null, width);
      await ctx.setExtraHTTPHeaders({ 'x-vercel-ip-country': 'US', 'x-vercel-ip-city': 'Portland', 'x-vercel-ip-country-region': 'OR' });
      await goto(pg, `/screener/${L.token}`);
      ok(`${width}: the form`, await pg.locator('.scr-form input[type="password"]').isVisible(), width);
      ok(`${width}: nothing off the side`, (await overflowPx(pg)) <= 0, await overflowPx(pg));
      const box = await pg.locator('.scr-form button[type="submit"]').boundingBox();
      ok(`${width}: Watch is a 44px target`, box && box.height >= 44, box);
      await pg.fill('.scr-form input[type="password"]', 'wrong-pass-browser');
      await pg.click('.scr-form button[type="submit"]');
      await pg.waitForSelector('.scr-error', { timeout: 30000 });
      ok(`${width}: a wrong password says so`, /That password isn’t right/.test(await pg.locator('.scr-error').innerText()));
      const before = linkRow(L.id).views;
      await pg.fill('.scr-form input[type="password"]', PASSWORD);
      await pg.click('.scr-form button[type="submit"]');
      await pg.waitForSelector('.scr-player', { timeout: 60000 });
      ok(`${width}: the right one: the player, one open counted`, await pg.locator('.scr-player video.tp-video').count() === 1 && linkRow(L.id).views === before + 1);
      ok(`${width}: the watermark over it`, (await pg.locator('.scr-player .scr-mark').first().innerText()).includes(`Browser ${RUN}`));
      const eps = pg.locator('.scr-ep');
      ok(`${width}: the show’s three episodes, the first playing`, (await eps.count()) === 3 && (await pg.locator('.scr-ep.on').innerText()).includes('S1 E1'));
      await eps.nth(1).click();
      await pg.waitForFunction(() => { const on = document.querySelector('.scr-ep.on'); return on && on.innerText.includes('S1 E2'); }, null, { timeout: 30000 });
      ok(`${width}: another episode, no other open`, linkRow(L.id).views === before + 1);
      ok(`${width}: nothing off the side while watching`, (await overflowPx(pg)) <= 0, await overflowPx(pg));
      await pg.reload({ waitUntil: 'load' });
      await pg.waitForSelector('.scr-player', { timeout: 60000 });
      ok(`${width}: a reload picks the visit up (still S1 E2), no new open`, (await pg.locator('.scr-ep.on').innerText()).includes('S1 E2') && linkRow(L.id).views === before + 1);
      ok(`${width}: no page errors`, errors.filter((e) => !/hls|media|video|fetch|network|Failed to load/i.test(e)).length === 0, errors);
      await ctx.close();
    }
  } finally {
    await b.close();
  }
}

await runCheck('private-screenings', async () => {
  const O = await newUser('pso', { role: 'creator', displayName: `Olga Owner ${RUN}`, handle: `pso${RUN}` });
  const U = await newUser('psu', { role: 'creator', displayName: `Uma Uploader ${RUN}`, handle: `psu${RUN}` });
  const X = await newUser('psx', { displayName: `Xavi Viewer ${RUN}`, handle: `psx${RUN}` });
  const N = await newUser('psn', { displayName: `Nia Named ${RUN}`, handle: `psn${RUN}` });
  const people = [O, U, X, N];
  try {
    insert('episodes', ep(ID.film, { submitted_by: O.id }));
    insert('series', { id: ID.show, name: `Check ps show ${RUN}`, description: 'A private show.', creator_id: O.id, status: 'pending', kind: 'series', defaults: {}, seasons: [{ number: 1, name: 'Opening' }], credits: {}, deletion_requested: false, moderation_hold: false, created_at: ago(10) });
    insert('episodes', ep(ID.s1e1, { submitted_by: O.id, content_type: 'series', series_id: ID.show, season: 1, series_order: 1 }));
    insert('episodes', ep(ID.s1e2, { submitted_by: U.id, content_type: 'series', series_id: ID.show, season: 1, series_order: 2, status: 'pending', reviewed_at: null, released_at: null }));
    insert('episodes', ep(ID.s1held, { submitted_by: O.id, content_type: 'series', series_id: ID.show, season: 1, series_order: 3, moderation_hold: true }));
    insert('episodes', ep(ID.s2e1, { submitted_by: O.id, content_type: 'series', series_id: ID.show, season: 2, series_order: 1 }));
    insert('episodes', ep(ID.extra, { submitted_by: O.id, content_type: 'bonus', series_id: ID.show, bonus_parent_type: 'series', bonus_parent_id: ID.show }));
    insert('episodes', ep(ID.pulled, { submitted_by: O.id, moderation_hold: true }));
    insert('productions', { id: PRODUCTION, owner_id: O.id, title: `Check ps production ${RUN}`, status: 'post', release_type: 'episode', release_id: ID.film, release_title: `Check ps release ${RUN}` });
    // A 109 screener (no password) for the film.
    const AFTER = hasColumn('screeners', 'target_id');
    insert('screeners', { production_id: PRODUCTION, episode_id: ID.film, token: LEGACY_TOKEN, label: `Old festival ${RUN}`, expires_at: inDays(5), max_views: 5, created_by: O.id, created_at: ago(1), ...(AFTER ? { owner_id: O.id, target_id: ID.film, starts_at: ago(1) } : {}) });
    if (!AFTER) {
      await before128(O);
      return;
    }

    section('The list, the target and the suggestion');
    let r = await call(`/api/screenings?target=episode:${ID.film}`, { who: O });
    ok('a film: 200 with its target', r.status === 200 && r.json && r.json.target && r.json.target.type === 'episode' && r.json.target.id === ID.film && r.json.target.ownerName === `Olga Owner ${RUN}`, r.text.slice(0, 300));
    ok('…the old screener is in the list, legacy, with no password', r.json && r.json.links.length === 1 && r.json.links[0].legacy === true && r.json.links[0].password === null && r.json.links[0].productionId === PRODUCTION, r.json && r.json.links);
    ok('…a suggestion like "tide-lantern-42"', r.json && /^[a-z]+-[a-z]+-\d{2}$/.test(r.json.suggestion), r.json && r.json.suggestion);
    ok('…private, no-store', /private/.test(r.headers.get('cache-control') || '') && /no-store/.test(r.headers.get('cache-control') || ''));
    const l0 = r.json.links[0];
    const keys = ['id', 'token', 'path', 'url', 'code', 'label', 'recipientEmail', 'target', 'scope', 'season', 'episodeIds', 'startsAt', 'endsAt', 'endedAt', 'access', 'named', 'maxViews', 'views', 'perPerson', 'oneScreen', 'countries', 'notify', 'legacy', 'password', 'productionId', 'runFrom', 'createdAt', 'updatedAt', 'lastViewedAt', 'stats'];
    ok('a link carries every key of the contract', keys.every((k) => k in l0) && ['people', 'refused', 'watchingNow', 'watchedPercent', 'twoCities'].every((k) => k in l0.stats), keys.filter((k) => !(k in l0)));
    ok('…its url is the request’s origin + /screener/<token>, its code the token’s last six', l0.url === `${BASE}/screener/${LEGACY_TOKEN}` && l0.code === LEGACY_TOKEN.slice(-6).toUpperCase(), [l0.url, l0.code]);
    r = await call(`/api/screenings?target=series:${ID.show}`, { who: O });
    const t = r.json && r.json.target;
    ok('a private show: its seasons with labels and counts', r.status === 200 && t && JSON.stringify(t.seasons) === JSON.stringify([{ number: 1, label: 'Season 1 · Opening', count: 2 }, { number: 2, label: 'Season 2', count: 1 }]), t && t.seasons);
    ok('…the episodes a link can play: not the held one, not the extra, the one in review included, in play order', t && t.episodes.map((e) => e.id).join(',') === [ID.s1e1, ID.s1e2, ID.s2e1].join(',') && t.episodes[1].status === 'pending' && t.episodes[0].code === 'S1 E1', t && t.episodes);
    ok('…not public: no public address', t && t.publicHref === null);
    r = await call('/api/screenings/password', { who: O });
    ok('the password route: a fresh suggestion', r.status === 200 && /^[a-z]+-[a-z]+-\d{2}$/.test(r.json && r.json.password), r.text);
    r = await call(`/api/screenings?target=episode:${ID.film}`);
    ok('signed out: 401', r.status === 401, r.status);
    r = await call(`/api/screenings?target=episode:${ID.film}`, { who: X });
    ok('a stranger: 403 not-yours', r.status === 403 && r.json && r.json.code === 'not-yours', r.text.slice(0, 200));
    r = await call(`/api/screenings?target=series:${ID.show}`, { who: U });
    ok('an uploader of one episode in the show: 403 for the show', r.status === 403 && r.json.code === 'not-yours', r.status);
    r = await call(`/api/screenings?target=episode:${ID.s1e2}`, { who: U });
    ok('…and for her own episode in it (the show’s runner makes its links)', r.status === 403 && r.json.code === 'not-yours', r.status);
    r = await call(`/api/screenings?target=episode:${ID.film}`, { who: ADMIN });
    ok('a full admin: 200', r.status === 200, r.status);
    r = await call(`/api/screenings?target=episode:ck-ps-nothing-${RUN}`, { who: O });
    ok('an unknown title: 404', r.status === 404, r.status);
    r = await call('/api/screenings?target=film', { who: O });
    ok('a target that isn’t one: 400', r.status === 400 && r.json.field === 'target', r.status);

    section('Making links');
    r = await make(O, { type: 'episode', id: ID.film }, { label: 'x' });
    ok('a label under two letters: 400 field label', r.status === 400 && r.json.field === 'label', r.text.slice(0, 200));
    r = await make(O, { type: 'episode', id: ID.film }, { password: 'short' });
    ok('a short password: 400 field password', r.status === 400 && r.json.field === 'password', r.text.slice(0, 200));
    r = await make(U, { type: 'series', id: ID.show });
    ok('the uploader making one on the show: 403', r.status === 403 && r.json.code === 'not-yours', r.status);
    r = await make(O, { type: 'episode', id: ID.pulled });
    ok('a pulled title: 409 unavailable', r.status === 409 && r.json.code === 'unavailable', r.text.slice(0, 200));
    r = await make(O, { type: 'episode', id: ID.film }, { label: `Programmers ${RUN}`, recipientEmail: 'jo@festival.example.com', maxViews: 3, perPerson: 2, oneScreen: true, notify: 'first' });
    const A = r.json && r.json.link;
    ok('a film’s link: 201 with the contract’s link', r.status === 201 && A && A.scope === 'title' && A.legacy === false && A.password === PASSWORD && A.maxViews === 3 && A.perPerson === 2 && A.oneScreen === true && A.views === 0, r.text.slice(0, 300));
    ok('…stored: a scrypt hash and an encrypted copy, never the password itself', (() => { const row = linkRow(A.id); return row && /^scrypt\$/.test(row.password_hash) && /^v1\./.test(row.password_enc) && !JSON.stringify(row).includes(PASSWORD) && row.owner_id === O.id; })());
    r = await make(O, { type: 'series', id: ID.show }, { scope: 'season', season: 1, label: `Season one ${RUN}` });
    const S = r.json && r.json.link;
    ok('a show’s season: the season’s episodes kept as picked', r.status === 201 && S && S.scope === 'season' && S.season === 1 && JSON.stringify(S.episodeIds) === JSON.stringify([ID.s1e1, ID.s1e2]), r.text.slice(0, 300));
    r = await make(O, { type: 'series', id: ID.show }, { scope: 'season', season: 4 });
    ok('…a season it doesn’t have: 400 field season', r.status === 400 && r.json.field === 'season', r.text.slice(0, 200));
    r = await make(O, { type: 'series', id: ID.show }, { scope: 'episodes', episodeIds: [ID.s2e1, ID.s1held, ID.extra], label: `Picked ${RUN}` });
    const E = r.json && r.json.link;
    ok('picked episodes: only those the show can screen', r.status === 201 && E && JSON.stringify(E.episodeIds) === JSON.stringify([ID.s2e1]), r.text.slice(0, 300));
    r = await make(O, { type: 'series', id: ID.show }, { label: `Whole show ${RUN}`, maxViews: 20 });
    const W = r.json && r.json.link;
    ok('the whole show: scope show, no ids kept', r.status === 201 && W && W.scope === 'show' && W.episodeIds === null, r.text.slice(0, 200));

    section('One link’s own data, edits');
    r = await call(`/api/screenings/${A.id}`, { who: O });
    ok('GET: { link, target, views: [], refusals: [] }', r.status === 200 && r.json.link.id === A.id && r.json.target.id === ID.film && Array.isArray(r.json.views) && r.json.views.length === 0 && Array.isArray(r.json.refusals), r.text.slice(0, 200));
    r = await call(`/api/screenings/${A.id}`, { who: X });
    ok('…a stranger: 403', r.status === 403 && r.json.code === 'not-yours', r.status);
    r = await call(`/api/screenings/${crypto.randomUUID()}`, { who: O });
    ok('…an unknown link: 404', r.status === 404, r.status);
    r = await patch(O, A.id, { action: 'update', label: `Programmers, edited ${RUN}`, maxViews: 4 });
    ok('update: the label and the total change, the password stays', r.status === 200 && r.json.link.label === `Programmers, edited ${RUN}` && r.json.link.maxViews === 4 && r.json.link.password === PASSWORD, r.text.slice(0, 300));
    r = await patch(O, A.id, { action: 'update', perPerson: 40 });
    ok('…out of range: 400 field perPerson', r.status === 400 && r.json.field === 'perPerson', r.text.slice(0, 200));
    r = await patch(O, A.id, { action: 'nope' });
    ok('…an action that isn’t one: 400', r.status === 400, r.status);
    r = await patch(X, A.id, { action: 'end' });
    ok('…a stranger ending it: 403', r.status === 403, r.status);

    section('The viewer: the page and the wrong-password lock');
    let pg = await pageOf(A.token);
    ok('the page: 200, state password, not indexed, not cached', pg.status === 200 && pg.page && pg.page.state === 'password' && /noindex/.test(pg.headers.get('x-robots-tag') || '') && /no-store/.test(pg.headers.get('cache-control') || ''), [pg.status, pg.page && pg.page.state]);
    ok('…with the title, the owner, the code, kind film', pg.page && pg.page.title === `Check ps ${ID.film.slice(6, 14)} ${RUN}` && pg.page.ownerName === `Olga Owner ${RUN}` && pg.page.code === A.code && pg.page.kind === 'film' && pg.page.legacy === false && pg.page.oneScreen === true, pg.page);
    ok('…the page counted nothing', linkRow(A.id).views === 0);
    const LOCK_IP = ip();
    let last = null;
    for (let i = 1; i <= 5; i += 1) last = await open(A.token, { password: `wrong-pass-${i}`, from: LOCK_IP });
    ok('five wrong passwords from one address: the fifth answers locked with a time', last.status === 429 && last.json.reason === 'locked' && Boolean(last.json.retryAt), last.text.slice(0, 200));
    r = await open(A.token, { password: 'wrong-pass-x', from: ip() });
    ok('a wrong one from elsewhere: 403 password, 4 tries left', r.status === 403 && r.json.reason === 'password' && r.json.triesLeft === 4, r.text.slice(0, 200));
    r = await open(A.token, { password: PASSWORD, from: LOCK_IP });
    ok('the right one from the locked address: still locked', r.status === 429 && r.json.reason === 'locked', r.status);
    ok('…six password refusals and one locked written, nothing counted', rows(`select reason from public.screener_refusals where screener_id = ${q(A.id)}`).filter((x) => x.reason === 'password').length === 6 && rows(`select reason from public.screener_refusals where screener_id = ${q(A.id)} and reason = 'locked'`).length === 1 && linkRow(A.id).views === 0);

    section('The viewer: a visit, play and the beat');
    r = await open(A.token, { password: PASSWORD, place: geo('US', 'Los Angeles', 'CA') });
    const g1 = cookieOf(r);
    const v1 = r.json || {};
    ok('the right password: 200 with a visit, a signed address, the watermark', r.status === 200 && typeof v1.session === 'string' && v1.current && v1.current.signed === true && v1.current.id === ID.film && /\/manifest\/video\.m3u8$/.test(v1.current.src) && v1.watermark === `Guest · Programmers, edited ${RUN} · jo•••@festival.example.com · ${A.code}`, r.text.slice(0, 400));
    ok('…the link part: opens left, your opens, one screen', v1.link && v1.link.opensLeft === 3 && v1.link.yourOpens === 1 && v1.link.perPerson === 2 && v1.link.oneScreen === true && v1.viewer && v1.viewer.signedIn === false, v1.link);
    ok('…a guest cookie set (httpOnly, a year)', Boolean(g1) && /HttpOnly/i.test(r.headers.get('set-cookie')) && /Max-Age=31536000/.test(r.headers.get('set-cookie')), r.headers.get('set-cookie'));
    const view1 = rows(`select * from public.screener_views where screener_id = ${q(A.id)}`);
    ok('…one open counted, one visit row with the place and the device, never the address', linkRow(A.id).views === 1 && view1.length === 1 && view1[0].city === 'Los Angeles' && view1[0].region === 'CA' && view1[0].country === 'US' && view1[0].device && view1[0].device_key && view1[0].session_key && view1[0].session_key !== v1.session && !JSON.stringify(view1[0]).includes('203.0.113'), view1[0]);
    r = await play(A.token, v1.session, ID.film, guest(g1));
    ok('play: a fresh address, no open counted', r.status === 200 && r.json.current && r.json.current.signed === true && linkRow(A.id).views === 1, r.text.slice(0, 200));
    r = await play(A.token, 'not-a-visit-key-at-all-xx', ID.film);
    ok('play with a visit that isn’t one: 401 session', r.status === 401 && r.json.reason === 'session', r.text.slice(0, 200));
    r = await beat(A.token, v1.session, { episodeId: ID.film, position: 95, duration: 600, playing: true, who: guest(g1) });
    ok('the beat: ok, how far recorded, the screen held', r.status === 200 && r.json.ok === true && (() => { const v = rows(`select * from public.screener_views where screener_id = ${q(A.id)}`)[0]; return v.position === 95 && JSON.stringify(v.watched) === JSON.stringify({ [ID.film]: [95, 600] }) && v.watched_seconds === 95 && v.last_play_at; })(), r.text.slice(0, 200));
    r = await beat(A.token, v1.session, { episodeId: ID.film, position: 60, duration: 600, playing: false, who: guest(g1) });
    ok('…a later beat further back keeps the furthest point', r.json.ok === true && JSON.stringify(rows(`select watched from public.screener_views where screener_id = ${q(A.id)}`)[0].watched) === JSON.stringify({ [ID.film]: [95, 600] }));

    section('The viewer: one screen, each person’s cap, the total');
    sql(`update public.screener_views set last_play_at = now() where screener_id = ${q(A.id)}`);
    r = await open(A.token, { who: guest(g1) });
    ok('the same guest opening it again while it plays: 409 screen', r.status === 409 && r.json.reason === 'screen', r.text.slice(0, 200));
    sql(`update public.screener_views set last_play_at = now() - interval '5 minutes' where screener_id = ${q(A.id)}`);
    r = await open(A.token, { who: guest(g1) });
    const v2 = r.json || {};
    ok('…two minutes after it stopped: a second visit, your opens 2 of 2', r.status === 200 && v2.link && v2.link.yourOpens === 2, r.text.slice(0, 200));
    r = await open(A.token, { who: guest(g1) });
    ok('…a third: 409 person_opens', r.status === 409 && r.json.reason === 'person_opens', r.text.slice(0, 200));
    r = await beat(A.token, v2.session, { episodeId: ID.film, position: 10, duration: 600, playing: true, who: guest(g1) });
    ok('the second visit plays', r.json && r.json.ok === true, r.text.slice(0, 200));
    r = await beat(A.token, v1.session, { episodeId: ID.film, position: 100, duration: 600, playing: true, who: guest(g1) });
    ok('…the first visit pressing play again is stopped: screen', r.json && r.json.stop === true && r.json.reason === 'screen', r.text.slice(0, 200));
    r = await play(A.token, v1.session, ID.film, guest(g1));
    ok('…and asking for an address: 409 screen', r.status === 409 && r.json.reason === 'screen', r.status);
    sql(`update public.screener_views set last_play_at = null where screener_id = ${q(A.id)}`);
    r = await open(A.token);
    ok('another guest: the third open, one left', r.status === 200 && r.json.link.opensLeft === 1 && Boolean(cookieOf(r)), r.text.slice(0, 200));
    r = await open(A.token);
    ok('a third guest: the fourth open of four', r.status === 200 && r.json.link.opensLeft === 0, r.text.slice(0, 200));
    r = await open(A.token);
    ok('a fourth guest: 409 opens', r.status === 409 && r.json.reason === 'opens', r.text.slice(0, 200));
    ok('…four opens, four visits, never more than the total', linkRow(A.id).views === 4 && rows(`select id from public.screener_views where screener_id = ${q(A.id)}`).length === 4);
    r = await patch(O, A.id, { action: 'update', maxViews: 2 });
    ok('the total can’t go under what’s been opened: 400 field maxViews', r.status === 400 && r.json.field === 'maxViews', r.text.slice(0, 200));
    r = await call(`/api/screenings/${A.id}`, { who: O });
    ok('the dashboard: four visits by three guests, refusals with reasons', r.status === 200 && r.json.views.length === 4 && r.json.link.stats.people === 3 && ['password', 'locked', 'screen', 'person_opens', 'opens'].every((x) => r.json.refusals.some((f) => f.reason === x)), r.json && r.json.link && r.json.link.stats);
    const vr = r.json.views[0];
    ok('…a view row in the contract’s shape', ['id', 'userId', 'name', 'handle', 'avatar', 'deviceKey', 'city', 'region', 'country', 'device', 'openedAt', 'lastPlayAt', 'lastBeatAt', 'episodeId', 'position', 'watched'].every((k) => k in vr), Object.keys(vr));
    const nOpened = notes(O.id, 'screening_opened');
    ok('notify "first": the owner told once per person (three guests, four opens → three notices)', nOpened.length === 3 && nOpened.every((n) => n.href === `/creator/screenings/${A.id}`) && /was opened by a guest in Los Angeles, CA/.test(nOpened[0].message), nOpened);

    section('A new password ends the visits from before it');
    r = await patch(O, A.id, { action: 'password' });
    const newPw = r.json && r.json.link && r.json.link.password;
    ok('password with none sent: a suggestion is set', r.status === 200 && newPw && newPw !== PASSWORD && /^[a-z]+-[a-z]+-\d{2}$/.test(newPw), r.text.slice(0, 200));
    r = await beat(A.token, v2.session, { episodeId: ID.film, position: 20, duration: 600, playing: true, who: guest(g1) });
    ok('…the open visit’s next beat: stop password_changed', r.json && r.json.stop === true && r.json.reason === 'password_changed', r.text.slice(0, 200));
    r = await play(A.token, v2.session, ID.film, guest(g1));
    ok('…and its next address: 401 password_changed', r.status === 401 && r.json.reason === 'password_changed', r.status);
    r = await patch(O, A.id, { action: 'password', password: 'my own pass' });
    ok('a password with a space: 400', r.status === 400 && r.json.field === 'password', r.status);

    section('A show’s visit: moving between episodes uses no other open');
    r = await open(S.token);
    const vs = r.json || {};
    const gs = guest(cookieOf(r));
    ok('a season link: the season’s episodes, in order, the first playing', r.status === 200 && vs.episodes && vs.episodes.map((e) => e.id).join(',') === [ID.s1e1, ID.s1e2].join(',') && vs.current.id === ID.s1e1 && vs.episodes[0].code === 'S1 E1', r.text.slice(0, 300));
    r = await play(S.token, vs.session, ID.s1e2, gs);
    ok('…the next episode: an address, still one open', r.status === 200 && r.json.current.id === ID.s1e2 && linkRow(S.id).views === 1, r.text.slice(0, 200));
    r = await play(S.token, vs.session, ID.s2e1, gs);
    ok('…an episode not on the link: 404', r.status === 404, r.status);
    r = await beat(S.token, vs.session, { episodeId: ID.s1e2, position: 300, duration: 1440, playing: true, who: gs });
    ok('…its beat counts the episode now playing', r.json.ok === true && JSON.stringify(rows(`select watched from public.screener_views where screener_id = ${q(S.id)}`)[0].watched) === JSON.stringify({ [ID.s1e2]: [300, 1440] }));
    pg = await pageOf(S.token);
    ok('…the page: kind show, two episodes', pg.page && pg.page.kind === 'show' && pg.page.episodesCount === 2, pg.page);
    sql(`update public.screener_views set viewed_at = now() - interval '13 hours' where screener_id = ${q(S.id)}`);
    r = await play(S.token, vs.session, ID.s1e1, gs);
    ok('a visit past its twelve hours: 401 session', r.status === 401 && r.json.reason === 'session', r.status);

    section('Country, signed in, named');
    r = await make(O, { type: 'episode', id: ID.film }, { label: `Canada only ${RUN}`, countries: ['CA'] });
    const C = r.json && r.json.link;
    ok('a link only for Canada', r.status === 201 && C && JSON.stringify(C.countries) === '["CA"]', r.text.slice(0, 200));
    pg = await pageOf(C.token, guest(), geo('US'));
    ok('…the page from the United States: state country', pg.page && pg.page.state === 'country', pg.page && pg.page.state);
    pg = await pageOf(C.token, guest(), geo('CA'));
    ok('…from Canada: state password', pg.page && pg.page.state === 'password', pg.page && pg.page.state);
    r = await open(C.token, { place: geo('US', 'Seattle', 'WA') });
    ok('…open from the United States: 403 country, written down', r.status === 403 && r.json.reason === 'country' && rows(`select country from public.screener_refusals where screener_id = ${q(C.id)} and reason = 'country'`).some((x) => x.country === 'US'), r.text.slice(0, 200));
    r = await open(C.token, { place: {} });
    ok('…from nowhere we can tell: 403 country', r.status === 403 && r.json.reason === 'country', r.status);
    r = await open(C.token, { place: geo('CA', 'Toronto', 'ON') });
    ok('…from Canada: 200', r.status === 200 && r.json.session, r.text.slice(0, 200));
    r = await make(O, { type: 'episode', id: ID.film }, { label: `Members ${RUN}`, access: 'signed_in', notify: 'every' });
    const SI = r.json && r.json.link;
    pg = await pageOf(SI.token);
    ok('signed in only, signed out: state signin', pg.page && pg.page.state === 'signin', pg.page && pg.page.state);
    r = await open(SI.token);
    ok('…open signed out: 401 signin', r.status === 401 && r.json.reason === 'signin', r.status);
    pg = await pageOf(SI.token, X);
    ok('…signed in: state password, the viewer named', pg.page && pg.page.state === 'password' && pg.page.viewer.signedIn === true && pg.page.viewer.name === `Xavi Viewer ${RUN}`, pg.page && pg.page.viewer);
    r = await open(SI.token, { who: X });
    const vx = r.json || {};
    ok('…open signed in: 200, the watermark names them, the visit is theirs', r.status === 200 && vx.viewer.signedIn === true && vx.watermark.startsWith(`Xavi Viewer ${RUN} · `) && rows(`select user_id from public.screener_views where screener_id = ${q(SI.id)}`)[0].user_id === X.id, r.text.slice(0, 200));
    await beat(SI.token, vx.session, { episodeId: ID.film, position: 600, duration: 600, playing: true, who: X });
    const nEvery = notes(O.id, 'screening_opened').filter((n) => n.message.includes(`Members ${RUN}`));
    ok('…notify "every": told, by name', nEvery.length === 1 && nEvery[0].message.includes(`Xavi Viewer ${RUN}`), nEvery);
    r = await make(O, { type: 'episode', id: ID.film }, { label: `Named ${RUN}`, access: 'named', named: { userIds: [N.id], emails: ['someone@else.example.com'] } });
    const NM = r.json && r.json.link;
    ok('a link for named people', r.status === 201 && NM && NM.access === 'named' && NM.named.userIds[0] === N.id, r.text.slice(0, 200));
    ok('…named.people: each named account’s public name and @handle (never an email)', NM && JSON.stringify(NM.named.people) === JSON.stringify([{ userId: N.id, name: `Nia Named ${RUN}`, handle: `psn${RUN}` }]) && JSON.stringify(NM.named.emails) === '["someone@else.example.com"]', NM && NM.named);
    r = await call(`/api/screenings?target=episode:${ID.film}`, { who: O });
    ok('…in the list too; a link naming nobody has people []', r.json && r.json.links.find((l) => l.id === NM.id).named.people.length === 1 && r.json.links.find((l) => l.id === A.id).named.people.length === 0, r.status);
    pg = await pageOf(NM.token);
    ok('…signed out: state named', pg.page && pg.page.state === 'named', pg.page && pg.page.state);
    pg = await pageOf(NM.token, X);
    ok('…someone else signed in: state named_other', pg.page && pg.page.state === 'named_other', pg.page && pg.page.state);
    r = await open(NM.token, { who: X });
    ok('…their open: 403 named_other, written down as named', r.status === 403 && r.json.reason === 'named_other' && rows(`select reason from public.screener_refusals where screener_id = ${q(NM.id)}`).some((x) => x.reason === 'named'), r.text.slice(0, 200));
    r = await open(NM.token, { who: N });
    ok('…the named account: 200', r.status === 200 && r.json.session, r.text.slice(0, 200));
    r = await make(O, { type: 'episode', id: ID.film }, { label: `By email ${RUN}`, access: 'named', named: { emails: [X.email] } });
    const NE = r.json && r.json.link;
    r = await open(NE.token, { who: X });
    ok('named by a verified email: that account opens it', r.status === 200 && r.json.session, r.text.slice(0, 200));

    section('Before the start, after the end, ended by its owner');
    r = await make(O, { type: 'episode', id: ID.film }, { label: `Later ${RUN}`, startsAt: inDays(1), endsAt: inDays(3) });
    const LT = r.json && r.json.link;
    pg = await pageOf(LT.token);
    ok('a link that opens tomorrow: state not_yet with its start', pg.page && pg.page.state === 'not_yet' && Boolean(pg.page.startsAt), pg.page && pg.page.state);
    r = await open(LT.token);
    ok('…open: 409 not_yet', r.status === 409 && r.json.reason === 'not_yet', r.status);
    r = await make(O, { type: 'episode', id: ID.film }, { label: `Over ${RUN}` });
    const OV = r.json && r.json.link;
    sql(`update public.screeners set starts_at = now() - interval '3 days', expires_at = now() - interval '1 hour' where id = ${q(OV.id)}`);
    pg = await pageOf(OV.token);
    ok('a link past its end: state ended', pg.page && pg.page.state === 'ended', pg.page && pg.page.state);
    r = await open(OV.token);
    ok('…open: 410 ended', r.status === 410 && r.json.reason === 'ended', r.status);
    r = await patch(O, OV.id, { action: 'update', label: 'Too late' });
    ok('…editing it: 409 ended', r.status === 409 && r.json.code === 'ended', r.status);
    r = await patch(O, C.id, { action: 'end' });
    ok('End it now: 200, ended at once', r.status === 200 && Boolean(r.json.link.endedAt) && Boolean(linkRow(C.id).ended_notified_at), r.text.slice(0, 200));
    pg = await pageOf(C.token, guest(), geo('CA'));
    ok('…its page: state stopped', pg.page && pg.page.state === 'stopped', pg.page && pg.page.state);
    r = await open(C.token, { place: geo('CA') });
    ok('…open: 410 stopped', r.status === 410 && r.json.reason === 'stopped', r.status);
    r = await patch(O, C.id, { action: 'end' });
    ok('…ending it again: 409 ended', r.status === 409 && r.json.code === 'ended', r.status);
    r = await patch(O, C.id, { action: 'password' });
    ok('…a new password on it: 409 ended', r.status === 409 && r.json.code === 'ended', r.status);

    section('Discard and run again');
    r = await call(`/api/screenings/${A.id}`, { who: O, method: 'DELETE', headers: ORIGIN });
    ok('discarding a live link: 409 not-ended', r.status === 409 && r.json.code === 'not-ended', r.status);
    r = await call(`/api/screenings/${A.id}/again`, { who: O, method: 'POST', headers: ORIGIN, body: {} });
    ok('running a live link again: 409 not-ended', r.status === 409 && r.json.code === 'not-ended', r.status);
    r = await call(`/api/screenings/${C.id}/again`, { who: O, method: 'POST', headers: ORIGIN, body: {} });
    const C2 = r.json && r.json.link;
    const len = (l) => Date.parse(l.endsAt) - Date.parse(l.startsAt);
    ok('running an ended one again: 201, a new address and password, the same settings, as long a window', r.status === 201 && C2 && C2.token !== C.token && C2.password && C2.password !== PASSWORD && C2.runFrom === C.id && C2.label === C.label && JSON.stringify(C2.countries) === '["CA"]' && Math.abs(len(C2) - len(C)) < 120000, r.text.slice(0, 300));
    r = await call(`/api/screenings/${C.id}/again`, { who: X, method: 'POST', headers: ORIGIN, body: {} });
    ok('…a stranger: 403', r.status === 403, r.status);
    const cViews = rows(`select id from public.screener_views where screener_id = ${q(C.id)}`).length;
    r = await call(`/api/screenings/${C.id}`, { who: O, method: 'DELETE', headers: ORIGIN });
    ok('discarding the ended one: { ok: true }, its viewer list gone with it', r.status === 200 && r.json.ok === true && cViews > 0 && !linkRow(C.id) && rows(`select id from public.screener_views where screener_id = ${q(C.id)}`).length === 0 && rows(`select id from public.screener_refusals where screener_id = ${q(C.id)}`).length === 0, r.status);

    section('A 109 screener keeps working without a password');
    pg = await pageOf(LEGACY_TOKEN);
    ok('its page: state password, legacy', pg.page && pg.page.state === 'password' && pg.page.legacy === true, pg.page);
    r = await open(LEGACY_TOKEN, { password: '' });
    ok('…open with no password: 200', r.status === 200 && r.json.session && r.json.current.signed === true, r.text.slice(0, 200));
    ok('…its owner told on every open', notes(O.id, 'screening_opened').some((n) => n.message.includes(`Old festival ${RUN}`)));

    section('Twenty wrong passwords in a day → the owner is told once');
    r = await make(O, { type: 'episode', id: ID.film }, { label: `Guessed ${RUN}` });
    const GS = r.json && r.json.link;
    for (let place = 0; place < 5; place += 1) {
      const from = ip();
      for (let i = 0; i < 4; i += 1) await open(GS.token, { password: `guess-${place}-${i}-xx`, from });
    }
    await open(GS.token, { password: 'guess-again-xx', from: ip() });
    const nGuess = notes(O.id, 'screening_guessing');
    ok('one notice after twenty wrong tries, none for the twenty-first', nGuess.length === 1 && /20 tries today/.test(nGuess[0].message) && nGuess[0].href === `/creator/screenings/${GS.id}`, nGuess);

    section('The Distribution page');
    r = await call(`/api/productions/${PRODUCTION}/distribution`, { who: O });
    const sc = r.json && r.json.screenings;
    ok('screenings in place of screeners: the release’s links and the old screener, the tab, can manage', r.status === 200 && sc && Array.isArray(sc.links) && sc.links.some((l) => l.token === LEGACY_TOKEN) && sc.links.some((l) => l.id === A.id) && sc.href === `/creator/title/${ID.film}?tab=screenings` && sc.canManage === true, r.text.slice(0, 300));
    ok('…and screeners: [] / episodes: [] for installed app builds', Array.isArray(r.json.screeners) && r.json.screeners.length === 0 && Array.isArray(r.json.episodes) && r.json.episodes.length === 0, [r.json.screeners, r.json.episodes]);
    ok('…the checklist counts the live links', r.json && r.json.checklist && r.json.checklist.screenersLive === sc.links.filter((l) => !l.endedAt && Date.parse(l.endsAt) > Date.now() && Date.parse(l.startsAt) <= Date.now() && l.views < l.maxViews).length, r.json && r.json.checklist);
    r = await call(`/api/productions/${PRODUCTION}/screeners`, { who: O, method: 'POST', headers: ORIGIN, body: { episodeId: ID.film, label: 'Old way', days: 7, maxViews: 5 } });
    ok('its old POST: 410 with the line', r.status === 410 && /title’s own page/.test(r.json.error), r.text.slice(0, 200));
    const legacyId = rows(`select id from public.screeners where token = ${q(LEGACY_TOKEN)}`)[0].id;
    r = await call(`/api/productions/${PRODUCTION}/screeners`, { who: O, method: 'DELETE', headers: ORIGIN, body: { screenerId: legacyId } });
    ok('its DELETE ends the link through the new code', r.status === 200 && r.json.ok === true && Boolean(linkRow(legacyId).revoked_at), r.text.slice(0, 200));

    section('The daily step');
    const DAILY = await make(O, { type: 'episode', id: ID.film }, { label: `Daily ${RUN}`, notify: 'daily' });
    const DL = DAILY.json.link;
    sql(`update public.screeners set starts_at = now() - interval '3 days' where id = ${q(DL.id)}`);
    // Two opens at noon yesterday on the Pacific clock, one today.
    const p = pacificParts(Date.now());
    const yesterdayNoon = pacificToMs(p.y, p.m, p.d, 12, 0) - 86400000;
    insert('screener_views', { screener_id: DL.id, viewed_at: new Date(yesterdayNoon).toISOString(), device_key: 'ckpsdailyguest0000000001', device: 'Mac · Safari', city: 'Austin', region: 'TX', country: 'US', watched: {} });
    insert('screener_views', { screener_id: DL.id, viewed_at: new Date(yesterdayNoon + 3600000).toISOString(), device_key: 'ckpsdailyguest0000000002', device: 'iPhone · Safari', city: 'Austin', region: 'TX', country: 'US', watched: {} });
    insert('screener_views', { screener_id: DL.id, viewed_at: new Date().toISOString(), device_key: 'ckpsdailyguest0000000003', watched: {} });
    const OLD = await make(O, { type: 'episode', id: ID.film }, { label: `Year old ${RUN}` });
    const OL = OLD.json.link;
    sql(`update public.screeners set starts_at = now() - interval '420 days', expires_at = now() - interval '400 days', ended_notified_at = now() - interval '400 days' where id = ${q(OL.id)}`);
    insert('screener_views', { screener_id: OL.id, viewed_at: new Date(Date.now() - 405 * 86400000).toISOString(), device_key: 'ckpsoldguest000000000001', watched: {} });
    insert('screener_refusals', { screener_id: OL.id, reason: 'password', at: new Date(Date.now() - 405 * 86400000).toISOString() });
    const cron = await call('/api/cron/expire-content', { method: 'POST', headers: { Authorization: 'Bearer rig-cron-secret' } });
    ok('the cron runs the step', cron.status === 200 && cron.json && cron.json.screenings && cron.json.screenings.ready === true, cron.text.slice(0, 300));
    const ended = notes(O.id, 'screening_ended');
    ok('…a link that ended is told once, to its tab, with its numbers', ended.some((n) => n.message.includes(`Over ${RUN}`) && n.href === `/creator/title/${ID.film}?tab=screenings`) && Boolean(linkRow(OV.id).ended_notified_at), ended);
    ok('…End it now’s own link isn’t told again', !ended.some((n) => n.message.includes(`Canada only ${RUN}`)));
    const daily = notes(O.id, 'screening_summary');
    const dailyLabel = `“Daily ${RUN}”`;
    ok('…a daily summary of yesterday’s opens on the Pacific clock (not today’s)', daily.length === 1 && daily[0].message.includes(dailyLabel) && /opened 2 times by 2 people/.test(daily[0].message) && daily[0].href === `/creator/screenings/${DL.id}` && Boolean(linkRow(DL.id).summary_sent_on), daily);
    ok('…a year-old link’s viewer rows deleted, the link kept', rows(`select id from public.screener_views where screener_id = ${q(OL.id)}`).length === 0 && rows(`select id from public.screener_refusals where screener_id = ${q(OL.id)}`).length === 0 && Boolean(linkRow(OL.id)));
    const again = await call('/api/cron/expire-content', { method: 'POST', headers: { Authorization: 'Bearer rig-cron-secret' } });
    ok('…a second run tells nobody twice', again.status === 200 && notes(O.id, 'screening_ended').length === ended.length && notes(O.id, 'screening_summary').length === daily.length);

    section('Gone and unavailable');
    let pgx = await pageOf(crypto.randomBytes(18).toString('base64url'));
    ok('a token nobody made: 200, state gone, no title', pgx.status === 200 && pgx.page && pgx.page.state === 'gone' && pgx.page.title === null, pgx.page && pgx.page.state);
    pgx = await pageOf('not a token');
    ok('…a token that isn’t one: state gone', pgx.page && pgx.page.state === 'gone', pgx.page && pgx.page.state);
    sql(`update public.series set moderation_hold = true where id = ${q(ID.show)}`);
    pgx = await pageOf(W.token);
    ok('the show pulled: its link’s page says unavailable, names nothing', pgx.page && pgx.page.state === 'unavailable' && pgx.page.title === null, pgx.page && pgx.page.state);
    r = await open(W.token);
    ok('…open: 409 unavailable', r.status === 409 && r.json.reason === 'unavailable', r.status);
    r = await call(`/api/screenings?target=series:${ID.show}`, { who: O });
    ok('…its runner still lists the links, with no episode to pick', r.status === 200 && r.json.target.episodes.length === 0 && r.json.links.length >= 3, r.status);
    r = await make(O, { type: 'series', id: ID.show });
    ok('…and can’t make a new one: 409 unavailable', r.status === 409 && r.json.code === 'unavailable', r.status);
    sql(`update public.series set moderation_hold = false where id = ${q(ID.show)}`);

    section('Nothing in watch history, no counts');
    ok('the signed-in viewers watched screenings: no watch history', rows(`select id from public.watch_history where user_id in (${q(X.id)}, ${q(N.id)})`).length === 0);

    if (!process.argv.includes('--no-browser')) await inBrowser(O);
  } finally {
    const ids = people.map((p) => q(p.id)).join(', ');
    const eps = Object.values(ID).map(q).join(', ');
    try {
      sql(`delete from public.screeners where created_by in (${ids}) or production_id = ${q(PRODUCTION)} or episode_id in (${eps})`);
      sql(`delete from public.productions where id = ${q(PRODUCTION)}`);
      sql(`delete from public.notifications where user_id in (${ids})`);
      sql(`delete from public.episodes where id in (${eps})`);
      sql(`delete from public.series where id = ${q(ID.show)}`);
    } catch (err) {
      console.log('cleanup:', err.message);
    }
    for (const p of people) await removeUser(p.id);
  }
});
