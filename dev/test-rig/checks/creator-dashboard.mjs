#!/usr/bin/env node
// The creator's Dashboard (Jose, 2026-11-14: "add a dashboard to the tab
// bar … creators land there to view everything from the films and shows
// they add and also see their income"; mockups/creator-dashboard-contract.md).
//
//   1. Who gets in: a creator, an admin and a sub-admin get the page; a
//      viewer is sent to /stream, a signed-out visitor to /account.
//   2. Where a sign-in lands (/signed-in): a creator or a team member on
//      the Dashboard unless they were headed somewhere; everyone else
//      where they were headed; never off the site.
//   3. The routes' additions: the money route's `dashboard` block (six
//      months, the month before, what each title earned, the newest
//      lines) and the numbers route's compare=1, windowViews and spark;
//      the same six routes asked the way the app asks (a token, no cookie).
//   4. The page for a creator at 1280: the tab on the rail, the row of
//      tabs, the four numbers, Your titles (a show adds up its episodes,
//      a film its own; an episode in review, a draft), Needs you, the
//      money card adding up to the money page's own total, the charts,
//      Latest, the pitch and the link; the month picker; Make it public.
//   5. A phone (390): nothing runs off the side, Needs you comes before
//      Your titles, the tab bar has the Dashboard tab and every label
//      fits (six items for an admin, down to a 320px screen).
//   6. The other creator pages carry the row of tabs, Creator Studio and
//      Your work now have the tab bar, and the Account menu no longer
//      lists My Work, Your Numbers or Money for people with the tab.
//   7. A sub-admin who is not a creator: the page says so and draws no
//      section as zeros. A viewer has no Dashboard tab.
//
// View counts: the rig runs with Upstash blank, so views read zero and
// the page says counting isn't switched on. To check real numbers, run
// the stand-in and point the app at it before starting the rig:
//   node dev/test-rig/bin/upstash.mjs &
//   RIG_APP_ENV_UPSTASH_REDIS_REST_URL=http://127.0.0.1:54327 \
//   RIG_APP_ENV_UPSTASH_REDIS_REST_TOKEN=rig bash dev/test-rig/start.sh
// This check seeds it when it is there and checks whichever it finds.
//
//   node dev/test-rig/checks/creator-dashboard.mjs [--shots <dir>]
// Rig up, any migration from 118 on. It seeds its own rows and removes them.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { IDS, USERS, RUN, SIGNED_OUT, ok, section, runCheck, session, call, page, insert, sql, rows, q, ago, newUser, removeUser, browser, goto, overflowPx } from './lib.mjs';

const MARA = session(USERS.mara);
const ADMIN = session(USERS.admin);
const VIEWER = session(USERS.viewer);
const shotsAt = process.argv.indexOf('--shots');
const SHOTS = shotsAt > -1 ? process.argv[shotsAt + 1] : null;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const shot = async (pg, name, opts = {}) => { if (SHOTS) await pg.screenshot({ path: path.join(SHOTS, `${name}.png`), ...opts }); };

const UPSTASH = process.env.RIG_UPSTASH_URL || 'http://127.0.0.1:54327';
const TAG = `check-dash-${RUN}`;
const PITCH = crypto.randomUUID();
const ID = { review: `ck-dash-review-${RUN}`, show: `ck-dash-show-${RUN}`, showEp: `ck-dash-show-e1-${RUN}` };
const DAY = 86400000;
const now = new Date();
const monthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
// i hours ago, never before this month began.
const thisMonth = (i) => new Date(Math.max(monthStart + 60000, Date.now() - i * 3600000)).toISOString();
// The 15th, `back` months before this one.
const monthsBack = (back) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 15, 12)).toISOString();
const periodKey = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
const PERIOD = periodKey(now);
const PREV = periodKey(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 15)));
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const dollars = (cents) => `$${Math.floor(cents / 100).toLocaleString('en-US')}.${String(cents % 100).padStart(2, '0')}`;

// What this check adds to Mara's month, lane by lane.
const ADDED = { member_support: 14800, ad_share: 3050, tips: 9200, sales: 7273, backing: 6937 };
const ADDED_TOTAL = Object.values(ADDED).reduce((a, b) => a + b, 0);
const EARLIER = [31660, 25100, 20300, 16400, 11800]; // one, two … five months back

// Views: 60 days for each of Mara's titles. `i` is days ago (0 = today).
const VIEW_IDS = { [IDS.nbS1E1]: (i) => 40 + (59 - i), [IDS.nbS1E2]: (i) => 12 + (i % 5), [IDS.nbS1E3]: () => 9, [IDS.nbS2E1]: (i) => (i < 20 ? 30 : 4), [IDS.film]: (i) => 20 + (i % 7), [IDS.nbExtraShow]: () => 1 };
const NIGHT_BUS = [IDS.nbS1E1, IDS.nbS1E2, IDS.nbS1E3, IDS.nbS2E1, IDS.nbExtraShow];
const sumDays = (ids, from, to) => ids.reduce((s, id) => { let t = 0; for (let i = from; i < to; i += 1) t += VIEW_IDS[id](i); return s + t; }, 0);
const dayKey = (i) => new Date(Date.now() - i * DAY).toISOString().slice(0, 10);

async function upstashUp() {
  try {
    const r = await fetch(`${UPSTASH}/__state`, { signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch {
    return false;
  }
}
async function seedViews() {
  const zViews = {};
  const zSeconds = {};
  for (const id of Object.keys(VIEW_IDS)) {
    const all = sumDays([id], 0, 60) + 1000;
    zViews[id] = all;
    zSeconds[id] = all * (id === IDS.film ? 600 : 900);
  }
  const hashes = {};
  for (let i = 0; i < 60; i += 1) hashes[`episode_views:${dayKey(i)}`] = Object.fromEntries(Object.entries(VIEW_IDS).map(([id, f]) => [id, f(i)]));
  await fetch(`${UPSTASH}/__seed`, { method: 'POST', body: JSON.stringify({ zsets: { episode_views: zViews, episode_watch_seconds: zSeconds }, hashes }) });
}

const src = `https://customer-test.cloudflarestream.com/${crypto.randomBytes(16).toString('hex')}/manifest/video.m3u8`;
const episode = (id, extra) => ({
  id, title: 'x', description: 'A check row.', tier: 'free', genre: 'Drama', main_genre: 'Drama', content_type: 'series', artist: 'Mara Reyes', runtime: '24:00', rating: 'TV-PG', release_year: 2026,
  src, video_type: 'html5', video_provider: 'cloudflare', ads_enabled: true, deletion_requested: false, moderation_hold: false, submitted_by: USERS.mara, status: 'approved', reviewed_at: ago(2), released_at: ago(2), created_at: ago(3), thumbnail: null, poster: null, ...extra
});

function cleanup() {
  sql(`delete from public.creator_ledger where created_by = ${q(TAG)}`);
  sql(`delete from public.creator_tips where stripe_payment_intent_id like ${q(`pi_${TAG}_%`)}`);
  sql(`delete from public.purchases where stripe_payment_intent_id like ${q(`pi_${TAG}_%`)}`);
  sql(`delete from public.pitch_donations where pitch_id = ${q(PITCH)}`);
  sql(`delete from public.pitches where id = ${q(PITCH)}`);
  sql(`delete from public.creator_drafts where form->>'checkTag' = ${q(TAG)}`);
  sql(`delete from public.episodes where id in (${[ID.review, ID.showEp].map(q).join(', ')})`);
  sql(`delete from public.series where id = ${q(ID.show)}`);
}

function seed() {
  const ledger = (row) => insert('creator_ledger', { creator_id: USERS.mara, lane: 'earnings', moves_money: true, created_by: TAG, ...row });
  ledger({ kind: 'member_share', cents: 6000, basis: 'picks', created_at: thisMonth(30) });
  ledger({ kind: 'member_share', cents: 5000, basis: 'picks', created_at: thisMonth(50) });
  ledger({ kind: 'member_share', cents: 3800, basis: 'watched', created_at: thisMonth(70) });
  // Ad share for last month's plays, credited this month, a line per title.
  ledger({ kind: 'ad_share', cents: 2140, episode_id: IDS.nbS1E1, units: 1240, period: PREV, note: 'First Stop · 1,240 ads · last month', created_at: thisMonth(90) });
  ledger({ kind: 'ad_share', cents: 310, episode_id: IDS.nbS1E2, units: 180, period: PREV, note: 'The Transfer · 180 ads · last month', created_at: thisMonth(90) });
  ledger({ kind: 'ad_share', cents: 600, episode_id: IDS.film, units: 350, period: PREV, note: 'The Long Quiet · 350 ads · last month', created_at: thisMonth(90) });

  const tip = (i, amount, payout, at, extra = {}) => insert('creator_tips', { creator_id: USERS.mara, tipper_id: USERS.viewer, amount_cents: amount, platform_cut_percent: 5, platform_cut_cents: amount - payout, creator_payout_cents: payout, status: 'completed', completed_at: at, created_at: at, show_name: false, stripe_payment_intent_id: `pi_${TAG}_t${i}`, ...extra });
  tip(1, 500, 475, thisMonth(2), { note: 'Loved the ending.' });
  tip(2, 2500, 2375, thisMonth(26));
  tip(3, 4000, 3800, thisMonth(60));
  tip(4, 2685, 2550, thisMonth(80));
  // The five months before: a tip each, so the six-month bars have something to draw.
  EARLIER.forEach((cents, k) => tip(10 + k, cents + 500, cents, monthsBack(k + 1)));

  const sale = (i, buyer, type, id, title, cents, at) => insert('purchases', { buyer_id: buyer, target_type: type, target_id: id, creator_id: USERS.mara, title, price_cents: cents + 400, paid_cents: cents + 400, creator_cents: cents, fee_cents: 44, platform_cents: 400, status: 'completed', completed_at: at, stripe_payment_intent_id: `pi_${TAG}_s${i}` });
  sale(1, USERS.viewer, 'episode', IDS.nbS1E1, 'First Stop', 1680, thisMonth(20));
  sale(2, USERS.dee, 'series', IDS.nightBus, 'Night Bus', 2000, thisMonth(40));
  sale(3, USERS.dee, 'episode', IDS.film, 'The Long Quiet', 3593, thisMonth(28));

  insert('pitches', { id: PITCH, title: `Dash check pitch ${RUN}`, logline: 'A pitch for the dashboard check.', status: 'approved', created_by: USERS.mara, funding_enabled: true, platform_cut_percent: 5, funding_goal: 5000 });
  insert('pitch_donations', { pitch_id: PITCH, donor_user_id: USERS.dee, amount_cents: 7300, platform_cut_cents: 363, creator_payout_cents: 6937, status: 'completed', completed_at: thisMonth(100), created_at: thisMonth(100), stripe_payment_intent_id: `pi_${TAG}_d1` });
  insert('pitch_donations', { pitch_id: PITCH, donor_user_id: USERS.viewer, amount_cents: 116700, platform_cut_cents: 5835, creator_payout_cents: 110865, status: 'completed', completed_at: monthsBack(8), created_at: monthsBack(8), stripe_payment_intent_id: `pi_${TAG}_d2` });

  // An episode in review, a loose draft, and a private show with one
  // approved episode (ready to go public) for the Make it public button.
  insert('episodes', episode(ID.review, { title: 'The Depot', status: 'pending', reviewed_at: null, released_at: null, series_id: IDS.nightBus, season: 2, series_order: 7, created_at: ago(2) }));
  insert('creator_drafts', { user_id: USERS.mara, form: { title: `Dash check draft ${RUN}`, checkTag: TAG } });
  insert('series', { id: ID.show, name: `Dash Check Show ${RUN}`, description: 'A show for the dashboard check.', creator_id: USERS.mara, status: 'pending', kind: 'series', submitted_by_user_id: USERS.mara, created_at: ago(4), deletion_requested: false, moderation_hold: false });
  insert('episodes', episode(ID.showEp, { title: 'Pilot', series_id: ID.show, season: 1, series_order: 1 }));
}

const json = async (pathname, who) => {
  const r = await call(pathname, { who });
  return { status: r.status, body: r.json || {} };
};

await runCheck('creator-dashboard', async () => {
  cleanup();
  // Real view numbers need both: the stand-in running, and the app
  // started pointed at it (the numbers route says whether it counts).
  const counting = (await json('/api/creator/analytics?days=30', MARA)).body.tracking === true;
  const tracked = counting && (await upstashUp());
  const before = (await json('/api/creator/money', MARA)).body;
  const baseline = Object.fromEntries(Object.keys(ADDED).map((k) => [k, before.lanes ? before.lanes[k].monthCents : 0]));
  const baseTotal = before.top ? before.top.monthCents : 0;
  let sub = null;

  try {
    seed();
    if (tracked) await seedViews();
    // ---- 1. who gets in ---------------------------------------------------------
    section('1. who gets in');
    sub = await newUser('dashsub', { role: 'sub_admin', firstName: 'Sam' });
    const roleOf = async (who) => (await json('/api/my-role', who)).body;
    const subRole = await roleOf(sub);
    ok('the check’s sub-admin is on the team and not a creator', subRole.canAccessAdmin === true && subRole.isCreator === false, JSON.stringify(subRole));
    for (const [name, who] of [['a creator', MARA], ['an admin', ADMIN], ['a sub-admin', sub]]) {
      const r = await page('/creator/dashboard', who);
      ok(`${name} gets the page`, r.status === 200, `status ${r.status}`);
    }
    const asViewer = await page('/creator/dashboard', VIEWER);
    ok('a viewer is sent to Stream', asViewer.status === 307 && /\/stream$/.test(asViewer.headers.get('location') || ''), `${asViewer.status} ${asViewer.headers.get('location')}`);
    const out = await page('/creator/dashboard', SIGNED_OUT);
    ok('signed out is sent to the account page', out.status === 307 && /\/account$/.test(out.headers.get('location') || ''), `${out.status} ${out.headers.get('location')}`);

    // ---- 2. where a sign-in lands -----------------------------------------------
    section('2. where a sign-in lands');
    const lands = async (who, next) => {
      const r = await page(`/signed-in${next == null ? '' : `?next=${encodeURIComponent(next)}`}`, who);
      return `${r.status} ${r.headers.get('location')}`;
    };
    ok('a creator from the account card → the Dashboard', (await lands(MARA, '/account')) === '307 /creator/dashboard', await lands(MARA, '/account'));
    ok('an admin from the door → the Dashboard', (await lands(ADMIN, '/')) === '307 /creator/dashboard', await lands(ADMIN, '/'));
    ok('a sub-admin with no ?next= → the Dashboard', (await lands(sub, null)) === '307 /creator/dashboard', await lands(sub, null));
    ok('a creator on their way to a pitch goes on to it', (await lands(MARA, '/pitches/abc')) === '307 /pitches/abc', await lands(MARA, '/pitches/abc'));
    ok('a viewer from the account card → the account page', (await lands(VIEWER, '/account')) === '307 /account', await lands(VIEWER, '/account'));
    ok('a viewer from the door → home', (await lands(VIEWER, '/')) === '307 /', await lands(VIEWER, '/'));
    ok('a viewer on their way to an episode goes on to it', (await lands(VIEWER, `/episode/${IDS.film}`)) === `307 /episode/${IDS.film}`, await lands(VIEWER, `/episode/${IDS.film}`));
    for (const bad of ['//evil.example', '/\\evil.example', 'https://evil.example/x']) {
      const got = await lands(MARA, bad);
      ok(`never off the site: ${bad}`, got === '307 /creator/dashboard', got);
    }
    ok('no session → the account page', (await lands(SIGNED_OUT, '/account')) === '307 /account', await lands(SIGNED_OUT, '/account'));

    // ---- 3. what the routes add ---------------------------------------------------
    section('3. the routes');
    const money = (await json('/api/creator/money', MARA)).body;
    const d = money.dashboard || {};
    ok('money: this month went up by exactly what was added', money.top.monthCents - baseTotal === ADDED_TOTAL, `${money.top.monthCents} − ${baseTotal}`);
    for (const lane of Object.keys(ADDED)) ok(`money: ${lane} went up by ${dollars(ADDED[lane])}`, money.lanes[lane].monthCents - baseline[lane] === ADDED[lane], `${money.lanes[lane].monthCents} − ${baseline[lane]}`);
    ok('dashboard: six months, oldest first, ending with this one', Array.isArray(d.months) && d.months.length === 6 && d.months[5].period === PERIOD && d.months[5].current === true && d.months[4].period === PREV, JSON.stringify(d.months));
    ok('dashboard: this month’s bar is the money page’s total', d.months && d.months[5].cents === money.top.monthCents);
    ok('dashboard: the month before', d.previous && d.previous.period === PREV && d.previous.cents === d.months[4].cents && d.previous.cents >= EARLIER[0], JSON.stringify(d.previous));
    ok('dashboard: the earlier months carry what was seeded', EARLIER.every((cents, k) => d.months[4 - k].cents >= cents), JSON.stringify(d.months));
    const by = d.byTitle || {};
    ok('dashboard: an episode’s sales and ad share', by[`episode:${IDS.nbS1E1}`] && by[`episode:${IDS.nbS1E1}`].salesCents === 1680 && by[`episode:${IDS.nbS1E1}`].adsCents === 2140, JSON.stringify(by[`episode:${IDS.nbS1E1}`]));
    ok('dashboard: a whole-series sale is against the show', by[`series:${IDS.nightBus}`] && by[`series:${IDS.nightBus}`].salesCents === 2000, JSON.stringify(by[`series:${IDS.nightBus}`]));
    ok('dashboard: the film', by[`episode:${IDS.film}`] && by[`episode:${IDS.film}`].salesCents === 3593 && by[`episode:${IDS.film}`].adsCents === 600, JSON.stringify(by[`episode:${IDS.film}`]));
    ok('dashboard: the newest lines, newest first, the tip on top', Array.isArray(d.latest) && d.latest.length === 8 && d.latest[0].kind === 'tip' && d.latest[0].amountCents === 500 && d.latest.every((l, i) => i === 0 || d.latest[i - 1].at >= l.at), JSON.stringify((d.latest || []).map((l) => l.kind)));
    const lastMonth = (await json(`/api/creator/money?period=${PREV}`, MARA)).body;
    ok('dashboard: another month ends its six months with that month', lastMonth.dashboard.months[5].period === PREV && lastMonth.dashboard.months[5].current === false && !lastMonth.dashboard.byTitle[`series:${IDS.nightBus}`]);
    const asViewerMoney = await json('/api/creator/money', VIEWER);
    ok('the money route still refuses a viewer', asViewerMoney.status === 403, `status ${asViewerMoney.status}`);

    const numbers = (await json('/api/creator/analytics?days=30&compare=1', MARA)).body;
    const plain = (await json('/api/creator/analytics?days=30', MARA)).body;
    ok('numbers: compare=1 says what it compares with', numbers.comparedTo === 'previous' && plain.comparedTo === 'halves', `${numbers.comparedTo} / ${plain.comparedTo}`);
    ok('numbers: the trend is still the 30 days asked for', numbers.tracking === tracked && (tracked ? numbers.trend.length === 30 : numbers.trend.length === 0), `${numbers.trend.length} days, tracking ${numbers.tracking}`);
    ok('numbers: every title carries its window and its line', numbers.perEpisode.length > 0 && numbers.perEpisode.every((e) => typeof e.windowViews === 'number' && Array.isArray(e.spark)));
    const allIds = Object.keys(VIEW_IDS);
    const expectWindow = sumDays(allIds, 0, 30);
    const expectBefore = sumDays(allIds, 30, 60);
    if (tracked) {
      const e1 = numbers.perEpisode.find((e) => e.id === IDS.nbS1E1);
      ok('numbers: a title’s 30 days', e1 && e1.windowViews === sumDays([IDS.nbS1E1], 0, 30) && e1.spark.length === 10 && e1.spark.reduce((a, b) => a + b, 0) === e1.windowViews, JSON.stringify(e1 && { w: e1.windowViews, s: e1.spark }));
      ok('numbers: the window total', numbers.totals.windowViews === expectWindow, `${numbers.totals.windowViews} vs ${expectWindow}`);
      ok('numbers: the change is against the 30 days before', numbers.totals.changePct === Math.round(((expectWindow - expectBefore) / expectBefore) * 100), `${numbers.totals.changePct}`);
      ok('numbers: without compare the window is the same', plain.totals.windowViews === expectWindow);
    } else {
      ok('numbers: no counting, so no views and no change (run the Upstash stand-in for real numbers)', numbers.totals.windowViews === 0 && numbers.totals.changePct === null);
    }

    // The app asks the same six routes with a token and no cookie.
    const viaApp = async (pathname) => { const r = await call(pathname, { who: MARA, bearer: true }); return { status: r.status, body: r.json || {} }; };
    const appMoney = await viaApp('/api/creator/money');
    const appNumbers = await viaApp('/api/creator/analytics?days=30&compare=1');
    ok('the app’s calls: the money route’s dashboard block', appMoney.status === 200 && appMoney.body.dashboard && appMoney.body.dashboard.months.length === 6 && appMoney.body.top.monthCents === money.top.monthCents, `status ${appMoney.status}`);
    ok('the app’s calls: the numbers route with compare=1', appNumbers.status === 200 && appNumbers.body.comparedTo === 'previous' && appNumbers.body.totals.windowViews === numbers.totals.windowViews, `status ${appNumbers.status}`);
    for (const [pathname, key] of [['/api/creator/my-submissions', 'submissions'], ['/api/show?mine=1', 'shows'], ['/api/creator/drafts', 'drafts'], ['/api/payees/mine', 'invites']]) {
      const r = await viaApp(pathname);
      ok(`the app’s calls: ${pathname}`, r.status === 200 && Array.isArray(r.body[key]), `status ${r.status}`);
    }
    const subApp = await call('/api/creator/money', { who: sub, bearer: true });
    ok('the app’s calls: a sub-admin who is not a creator is refused the money, not handed zeros', subApp.status === 403, `status ${subApp.status}`);

    // ---- 4. the page at 1280 ------------------------------------------------------
    const b = await browser();
    try {
      section('4. a creator at 1280');
      const wide = await b.open(MARA, 1280);
      const pg = wide.page;
      ok('the page loads', (await goto(pg, '/creator/dashboard')) === 200);
      await pg.locator('.dash-row.state-live').first().waitFor({ timeout: 30000 });
      await pg.waitForFunction(() => !document.querySelector('.dash-tile .dash-skel') && document.querySelector('.dash-lane'), null, { timeout: 30000 });
      await pg.waitForTimeout(600);
      ok('nothing runs off the side', (await overflowPx(pg)) <= 0, `${await overflowPx(pg)}px`);
      const cols = await pg.evaluate(() => { const box = (s) => { const r = document.querySelector(s).getBoundingClientRect(); return { l: Math.round(r.left), t: Math.round(r.top + window.scrollY), b: Math.round(r.bottom + window.scrollY) }; }; return { titles: box('.dash-titles'), views: box('.dash-views-card'), latest: box('.dash-latest'), needs: box('.dash-needs'), money: box('.dash-money'), months: box('.dash-months-card') }; });
      ok('two columns: titles, views and Latest on the left; Needs you, money and the six months on the right', cols.titles.l === cols.views.l && cols.views.l === cols.latest.l && cols.needs.l === cols.money.l && cols.money.l === cols.months.l && cols.needs.l > cols.titles.l && cols.views.t - cols.titles.b < 40 && cols.money.t - cols.needs.b < 40 && Math.abs(cols.titles.t - cols.needs.t) < 2, JSON.stringify(cols));
      ok('the head', (await pg.locator('.dash-h1').innerText()) === 'Your work and what it earns.' && /^CREATOR DASHBOARD · /i.test(await pg.locator('.dash-kicker').innerText()));
      const rail = await pg.evaluate(() => {
        const items = [...document.querySelectorAll('.tabbar .tabbar-item')].map((el) => ({ text: el.innerText.trim().toUpperCase(), active: el.classList.contains('active'), tag: el.tagName, href: el.getAttribute('href') }));
        return items;
      });
      ok('the rail: Home, Discover, Watch, Dashboard, Account', rail.map((x) => x.text.replace(/\s+/g, ' ')).join('|') === 'HOME|DISCOVER|WATCH|DASHBOARD|ACCOUNT', JSON.stringify(rail.map((x) => x.text)));
      const dashTab = rail.find((x) => x.text === 'DASHBOARD');
      ok('the Dashboard tab is a link to the page, and the lit one', dashTab && dashTab.tag === 'A' && dashTab.href === '/creator/dashboard' && dashTab.active && rail.filter((x) => x.active).length === 1, JSON.stringify(dashTab));
      const tabs = await pg.locator('.dash-tabs .dash-tab').allInnerTexts();
      ok('the row of tabs', tabs.join('|') === 'Overview|Your work|Numbers|Money|Pitches|Creator Studio', tabs.join('|'));
      ok('Overview is the current tab', (await pg.locator('.dash-tab.on').innerText()) === 'Overview' && (await pg.locator('.dash-tab[aria-current="page"]').count()) === 1);

      const tiles = await pg.evaluate(() => [...document.querySelectorAll('.dash-tile')].map((el) => ({ k: el.querySelector('.dash-tile-k').innerText, v: el.querySelector('.dash-tile-v').innerText, sub: el.querySelector('.dash-tile-sub').innerText })));
      ok('four numbers', tiles.length === 4, JSON.stringify(tiles));
      ok('earned this month is the money page’s total', tiles[0].v === dollars(money.top.monthCents) && /^EARNED THIS MONTH$/i.test(tiles[0].k), JSON.stringify(tiles[0]));
      const diff = money.top.monthCents - d.previous.cents;
      ok('…and says how it compares with last month', tiles[0].sub === (diff > 0 ? `${dollars(diff)} more than ${MONTHS[Number(PREV.slice(5)) - 1]}` : diff < 0 ? `${dollars(-diff)} less than ${MONTHS[Number(PREV.slice(5)) - 1]}` : tiles[0].sub), tiles[0].sub);
      ok('owed to you is the money page’s owed', tiles[1].v === dollars(money.top.owedCents) && /^Next transfer [A-Z][a-z]{2} 1$/.test(tiles[1].sub), JSON.stringify(tiles[1]));
      ok('views', tracked ? tiles[2].v === expectWindow.toLocaleString('en-US') && / the 30 days before$/.test(tiles[2].sub) : tiles[2].v === '0' && tiles[2].sub === 'View counting isn’t switched on yet', JSON.stringify(tiles[2]));
      ok('supporters', tiles[3].v === String(money.supporters.picked + money.supporters.watching) && / picked you · /.test(tiles[3].sub), JSON.stringify(tiles[3]));

      const titleRows = await pg.evaluate(() => [...document.querySelectorAll('.dash-rows .dash-row')].map((el) => ({
        title: el.querySelector('.dash-row-title').innerText,
        chip: el.querySelector('.dash-chip').innerText.trim(),
        meta: el.querySelector('.dash-row-meta').innerText.replace(/\s+/g, ' ').trim(),
        views: el.querySelector('.dash-views .dash-num') ? el.querySelector('.dash-views .dash-num').innerText : null,
        watched: el.querySelector('.dash-watched') ? el.querySelector('.dash-watched').innerText : null,
        earned: el.querySelector('.dash-earned .dash-num') ? el.querySelector('.dash-earned .dash-num').innerText : null,
        detail: el.querySelector('.dash-detail') ? el.querySelector('.dash-detail').innerText : null,
        note: el.querySelector('.dash-note') ? el.querySelector('.dash-note').innerText.replace(/\s+/g, ' ').trim() : null,
        href: el.querySelector('.dash-row-main').getAttribute('href'),
        spark: Boolean(el.querySelector('.dash-spark'))
      })));
      const find = (t) => titleRows.find((r) => r.title === t);
      const nb = find('Night Bus');
      ok('Night Bus is one row, live, opening its show page', nb && nb.chip.toUpperCase() === 'LIVE' && nb.href === `/creator/show/${IDS.nightBus}` && /^LIVE Series · /i.test(nb.meta), JSON.stringify(nb));
      ok('…earning its episodes’ sales and ad share plus the whole-series sale', nb && nb.earned === dollars(1680 + 2140 + 310 + 2000) && nb.detail === 'sales 36.80 · ads 24.50', JSON.stringify(nb));
      ok('…with its episodes’ views added up', nb && (tracked ? nb.views === sumDays(NIGHT_BUS, 0, 30).toLocaleString('en-US') && nb.spark && /^\d+%$/.test(nb.watched) : nb.views === '0' && !nb.spark), JSON.stringify(nb));
      const film = find('The Long Quiet');
      ok('the film is its own row with its own money', film && film.earned === dollars(3593 + 600) && film.detail === 'sales 35.93 · ads 6.00' && /Film · 1 h 32/.test(film.meta) && film.href === '/creator/my-work', JSON.stringify(film));
      ok('…and its own views', film && (tracked ? film.views === sumDays([IDS.film], 0, 30).toLocaleString('en-US') && film.watched === '11%' : film.views === '0'), JSON.stringify(film));
      ok('a live show’s episodes are not rows of their own', !find('First Stop') && !titleRows.some((r) => /Night Bus · S1 E/.test(r.title)));
      const review = find('Night Bus · S2 E7 · The Depot');
      ok('an episode in review is its own row and says where it stands', review && review.chip.toUpperCase() === 'IN REVIEW' && /^Sent [A-Z][a-z]{2} \d+\. With the team now; it goes live when approved\.$/.test(review.note) && review.views === null && review.href === `/creator/show/${IDS.nightBus}#ep-${ID.review}`, JSON.stringify(review));
      const ready = find(`Dash Check Show ${RUN}`);
      ok('a show ready to go public says so and offers the button', ready && ready.chip.toUpperCase() === 'READY TO GO PUBLIC' && /^Private until you say so\. Make it public$/.test(ready.note), JSON.stringify(ready));
      await pg.locator('.dash-filter', { hasText: 'Drafts' }).click();
      const draftTitles = await pg.locator('.dash-rows .dash-row-title').allInnerTexts();
      ok('the Drafts filter shows the draft, with Continue', draftTitles.includes(`Dash check draft ${RUN}`) && (await pg.locator('.dash-rows .dash-row', { hasText: `Dash check draft ${RUN}` }).locator('a.dash-btn').getAttribute('href') || '').startsWith('/creator/submit?draft='), draftTitles.join('|'));
      await pg.locator('.dash-filter', { hasText: 'All' }).click();
      const filters = await pg.locator('.dash-filter').allInnerTexts();
      ok('the filters carry their counts', filters.length === 5 && filters.every((f) => /^(All|Live|In review|Drafts|Needs you) \d+$/.test(f.trim())), filters.join('|'));
      ok('the note under the list says what "earned" is', /its title sales plus its ad share/.test(await pg.locator('.dash-foot').innerText()));

      const needs = await pg.locator('.dash-need-title').allInnerTexts();
      ok('Needs you lists the show that is ready, with the button', needs.includes(`Dash Check Show ${RUN} is ready to go public`) && (await pg.locator('.dash-need', { hasText: `Dash Check Show ${RUN}` }).locator('button.dash-need-act').innerText()) === 'Make it public', needs.join('|'));
      ok('…at most five, and says how many more', needs.length <= 5 && ((await pg.locator('.dash-more-link').count()) === 0 || /^\d+ more in Your work →$/.test(await pg.locator('.dash-more-link').innerText())));

      const card = await pg.evaluate(() => ({
        k: document.querySelector('#dash-money-h').innerText,
        total: document.querySelector('.dash-total').innerText,
        lanes: [...document.querySelectorAll('.dash-lane')].map((el) => [el.querySelector('.dash-lane-name').innerText, el.querySelector('.dash-lane-value').innerText, Math.round(el.querySelector('.dash-lane-bar').getBoundingClientRect().width)]),
        moves: [...document.querySelectorAll('.dash-move')].map((el) => [el.querySelector('.dash-move-title').innerText, el.querySelector('.dash-move-value').innerText])
      }));
      const cents = (s) => Math.round(Number(s.replace(/[$,]/g, '')) * 100);
      ok('the money card: this month’s total', /^MONEY THIS MONTH$/i.test(card.k) && card.total === dollars(money.top.monthCents), JSON.stringify(card));
      ok('…its lanes add up to that total', card.lanes.reduce((s, l) => s + cents(l[1]), 0) === money.top.monthCents, JSON.stringify(card.lanes));
      ok('…biggest first, the longest bar on top', card.lanes.every((l, i) => i === 0 || cents(card.lanes[i - 1][1]) >= cents(l[1])) && card.lanes.every((l) => l[2] <= card.lanes[0][2]), JSON.stringify(card.lanes));
      ok('…and when it moves: the 1st, and what is in Stripe', card.moves.length === 2 && /^On [A-Z][a-z]{2} 1$/.test(card.moves[0][0]) && card.moves[0][1] === dollars(money.top.owedCents) && card.moves[1][0] === 'In Stripe now', JSON.stringify(card.moves));

      const months = await pg.evaluate(() => [...document.querySelectorAll('.dash-month')].map((el) => ({ name: el.querySelector('.dash-month-name').innerText, value: el.querySelector('.dash-month-value').innerText, h: Math.round(el.querySelector('.dash-month-bar').getBoundingClientRect().height), current: el.classList.contains('current') })));
      ok('six months of bars, this month last and marked', months.length === 6 && months[5].current && months[5].value === dollars(money.top.monthCents) && months[5].name.toUpperCase() === MONTHS[now.getUTCMonth()].slice(0, 3).toUpperCase(), JSON.stringify(months));
      ok('…a bigger month is a taller bar', months.every((m, i) => i === 0 || (cents(m.value) >= cents(months[i - 1].value)) === (m.h >= months[i - 1].h)), JSON.stringify(months.map((m) => [m.value, m.h])));
      if (tracked) {
        ok('the views chart is drawn, with the best day called out', (await pg.locator('.dash-chart .dash-line').count()) === 1 && / views$/.test(await pg.locator('.dash-callout').textContent()));
        await pg.locator('.dash-chart').scrollIntoViewIfNeeded();
        const box = await pg.locator('.dash-chart').boundingBox();
        await pg.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.5);
        await pg.waitForTimeout(200);
        ok('pointing at a day reads it out', /^[A-Z][a-z]{2} \d+ · [\d,]+ views?$/.test(await pg.locator('.dash-readout').innerText()), await pg.locator('.dash-readout').innerText());
        await pg.mouse.move(5, 5);
      } else {
        ok('with no counting the views card says so instead of drawing an empty chart', /isn’t switched on/.test(await pg.locator('.dash-views-card').innerText()) && (await pg.locator('.dash-chart').count()) === 0);
      }
      const latest = await pg.locator('.dash-latest-text').allInnerTexts();
      ok('Latest starts with the newest thing, the tip', latest.length >= 3 && /^A fan tipped you \$5\.00$/.test(latest[0]), latest.join(' | '));
      ok('the pitch card: raised so far of the goal', /\$1,240 raised of \$5,000/.test(await pg.locator('.dash-pitch').innerText()), await pg.locator('.dash-pitch').innerText());
      ok('the link card', (await pg.locator('.dash-link-url').innerText()).endsWith('/@' + ((await roleOf(MARA)).profileHref || '').split('/').pop()) || (await pg.locator('.dash-yourlink').count()) === 1);
      await shot(pg, 'dashboard-1280', { fullPage: true });

      // The month picker: last month's money, the same titles.
      await pg.locator('.dash-period select').selectOption(PREV);
      await pg.waitForFunction((name) => new RegExp(`MONEY IN ${name}`, 'i').test(document.querySelector('#dash-money-h').innerText), MONTHS[Number(PREV.slice(5)) - 1], { timeout: 30000 });
      const prevTile = await pg.locator('.dash-tile').first().innerText();
      ok('the month picker shows that month', new RegExp(`EARNED IN ${MONTHS[Number(PREV.slice(5)) - 1]}`, 'i').test(prevTile) && prevTile.includes(dollars(lastMonth.top.monthCents)), prevTile.replace(/\n/g, ' '));
      ok('…and the Earned column is headed with it', new RegExp(`EARNED · ${MONTHS[Number(PREV.slice(5)) - 1].slice(0, 3)}`, 'i').test(await pg.locator('.dash-row-head .dash-earned').innerText()));
      await pg.locator('.dash-period select').selectOption(PERIOD);
      await pg.waitForFunction(() => /MONEY THIS MONTH/i.test(document.querySelector('#dash-money-h').innerText), null, { timeout: 30000 });

      // Make it public: asks first; No leaves it; Yes makes the show live.
      let asked = '';
      pg.once('dialog', (dlg) => { asked = dlg.message(); dlg.dismiss(); });
      await pg.locator('.dash-rows .dash-row', { hasText: `Dash Check Show ${RUN}` }).locator('button.dash-btn').click();
      await pg.waitForTimeout(400);
      ok('Make it public asks first, in the site’s words', asked.startsWith(`Make Dash Check Show ${RUN} public?`) && /one-way/.test(asked), asked.slice(0, 80));
      ok('…and No changes nothing', rows(`select status from public.series where id = ${q(ID.show)}`)[0].status === 'pending');
      pg.once('dialog', (dlg) => dlg.accept());
      await pg.locator('.dash-rows .dash-row', { hasText: `Dash Check Show ${RUN}` }).locator('button.dash-btn').click();
      await pg.locator('.dash-flash').waitFor({ timeout: 30000 });
      ok('Yes makes it public and says so', rows(`select status from public.series where id = ${q(ID.show)}`)[0].status === 'approved' && (await pg.locator('.dash-flash').innerText()).startsWith(`Dash Check Show ${RUN} is public.`), await pg.locator('.dash-flash').innerText());
      await pg.waitForFunction((name) => { const r = [...document.querySelectorAll('.dash-rows .dash-row')].find((el) => el.innerText.includes(name)); return r && r.classList.contains('state-live'); }, `Dash Check Show ${RUN}`, { timeout: 30000 });
      ok('…its row turns live and leaves Needs you', !(await pg.locator('.dash-need-title').allInnerTexts()).some((t) => t.includes(`Dash Check Show ${RUN}`)));
      ok('no page errors at 1280', wide.errors.length === 0, wide.errors.join(' | '));
      await wide.ctx.close();

      // ---- 5. a phone ---------------------------------------------------------------
      section('5. a phone');
      const phone = await b.open(MARA, 390);
      const pp = phone.page;
      await goto(pp, '/creator/dashboard');
      await pp.locator('.dash-row.state-live').first().waitFor({ timeout: 30000 });
      await pp.waitForFunction(() => !document.querySelector('.dash-tile .dash-skel') && document.querySelector('.dash-lane'), null, { timeout: 30000 });
      await pp.waitForTimeout(600);
      ok('nothing runs off the side at 390', (await overflowPx(pp)) <= 0, `${await overflowPx(pp)}px`);
      const order = await pp.evaluate(() => ['.dash-tiles', '.dash-needs', '.dash-titles', '.dash-money', '.dash-views-card', '.dash-latest'].map((s) => Math.round(document.querySelector(s).getBoundingClientRect().top + window.scrollY)));
      ok('the order: numbers, Needs you, Your titles, Money, Views, Latest', order.every((y, i) => i === 0 || y > order[i - 1]), order.join(' < '));
      ok('the numbers are two across', await pp.evaluate(() => { const t = [...document.querySelectorAll('.dash-tile')].map((el) => el.getBoundingClientRect()); return Math.abs(t[0].top - t[1].top) < 2 && t[2].top > t[0].bottom - 2 && Math.abs(t[2].top - t[3].top) < 2; }));
      ok('a live row keeps its money and its views; the detail and the small line make way', await pp.evaluate(() => {
        const row = [...document.querySelectorAll('.dash-rows .dash-row.state-live')].find((el) => el.querySelector('.dash-row-title').innerText === 'Night Bus');
        const vis = (sel) => { const el = row.querySelector(sel); return Boolean(el && el.getBoundingClientRect().width > 0); };
        return vis('.dash-earned .dash-num') && vis('.dash-views .dash-num') && vis('.dash-unit') && !vis('.dash-detail') && !vis('.dash-watched') && !vis('.dash-open');
      }));
      const tapTargets = await pp.evaluate(() => ['.dash-filter', '.dash-need-act', '.dash-tab', '.dash-period select', '.dash-head-btn'].map((s) => [s, Math.round(Math.min(...[...document.querySelectorAll(s)].map((el) => el.getBoundingClientRect().height)))]));
      ok('everything to tap is at least 44px tall', tapTargets.every(([, h]) => h >= 44), JSON.stringify(tapTargets));
      const bar = async (pgX) => pgX.evaluate(() => {
        const nav = document.querySelector('.tabbar').getBoundingClientRect();
        const items = [...document.querySelectorAll('.tabbar .tabbar-item')];
        return {
          names: items.map((el) => (el.innerText.trim() || el.getAttribute('aria-label') || '').toUpperCase().replace(/\s+/g, ' ')),
          inside: items.every((el) => { const r = el.getBoundingClientRect(); return r.left >= nav.left - 0.5 && r.right <= nav.right + 0.5; }),
          fits: items.every((el) => { const l = el.querySelector('.tabbar-label'); if (!l) return true; const r = l.getBoundingClientRect(); const p = el.getBoundingClientRect(); return r.left >= p.left - 0.5 && r.right <= p.right + 0.5; }),
          apart: items.every((el, i) => { if (i === 0) return true; const a = items[i - 1].querySelector('.tabbar-label'); const c = el.querySelector('.tabbar-label'); if (!a || !c) return true; return c.getBoundingClientRect().left >= a.getBoundingClientRect().right - 0.5; }),
          lit: items.filter((el) => el.classList.contains('active')).map((el) => el.innerText.trim().toUpperCase())
        };
      });
      const creatorBar = await bar(pp);
      ok('the phone bar: Home, Discover, Watch, Dashboard, Account, with Dashboard lit', creatorBar.names.join('|') === 'HOME|DISCOVER|WATCH|DASHBOARD|ACCOUNT' && creatorBar.lit.join('|') === 'DASHBOARD', JSON.stringify(creatorBar));
      ok('…every label inside its own tab, none touching the next', creatorBar.inside && creatorBar.fits && creatorBar.apart, JSON.stringify(creatorBar));
      await shot(pp, 'dashboard-390', { fullPage: true });
      // The Account menu no longer lists the creator pages.
      await pp.locator('.tabbar .tabbar-item', { hasText: 'Account' }).tap();
      await pp.locator('.tabbar-dropup').waitFor({ timeout: 10000 });
      const acct = await pp.locator('.tabbar-dropup-item').allInnerTexts();
      ok('the Account menu no longer lists My Work, Your Numbers or Money', acct.length > 3 && !acct.some((t) => /^(My Work|Your Numbers|Money)$/.test(t.trim())), acct.join('|'));
      ok('no page errors at 390', phone.errors.length === 0, phone.errors.join(' | '));
      await phone.ctx.close();

      for (const width of [360, 320]) {
        const c = await b.open(MARA, width);
        await goto(c.page, '/creator/dashboard');
        await c.page.locator('.tabbar .tabbar-item', { hasText: 'Dashboard' }).waitFor({ timeout: 30000 });
        await c.page.waitForTimeout(400);
        const small = await bar(c.page);
        ok(`a creator’s five tabs fit at ${width}px`, small.names.length === 5 && small.inside && small.fits && small.apart, JSON.stringify(small));
        ok(`…and the page doesn’t run off the side at ${width}px`, (await overflowPx(c.page)) <= 0, `${await overflowPx(c.page)}px`);
        await c.ctx.close();
      }
      for (const width of [390, 360, 320]) {
        const a = await b.open(ADMIN, width);
        await goto(a.page, '/creator/dashboard');
        await a.page.locator('.tabbar .tabbar-item', { hasText: 'Dashboard' }).waitFor({ timeout: 30000 });
        await a.page.waitForTimeout(400);
        const adminBar = await bar(a.page);
        ok(`an admin’s six items fit at ${width}px`, adminBar.names.length === 6 && adminBar.names.includes('DASHBOARD') && adminBar.inside && adminBar.fits && adminBar.apart, JSON.stringify(adminBar));
        ok(`…and the page doesn’t run off the side at ${width}px`, (await overflowPx(a.page)) <= 0, `${await overflowPx(a.page)}px`);
        if (width === 320) await shot(a.page, 'tabbar-admin-320');
        await a.ctx.close();
      }

      // ---- 6. the other creator pages -------------------------------------------------
      section('6. the other creator pages');
      const other = await b.open(MARA, 1280);
      for (const [href, current, hadBar] of [['/creator', 'Creator Studio', false], ['/creator/my-work', 'Your work', false], ['/creator/analytics', 'Numbers', true], ['/creator/money', 'Money', true], ['/creator/pitch/dashboard', 'Pitches', false]]) {
        await goto(other.page, href);
        await other.page.locator('.dash-tabs').waitFor({ timeout: 30000 });
        const cur = await other.page.locator('.dash-tab.on').innerText();
        const count = await other.page.locator('.dash-tab').count();
        ok(`${href} carries the tabs with ${current} current`, cur === current && count === 6, `${cur} of ${count}`);
        const lit = await other.page.evaluate(() => [...document.querySelectorAll('.tabbar .tabbar-item.active')].map((el) => el.innerText.trim().toUpperCase()));
        ok(`${href} has the tab bar${hadBar ? '' : ' (it had none)'}, with Dashboard lit`, lit.join('|') === 'DASHBOARD', lit.join('|'));
        ok(`${href} doesn’t run off the side`, (await overflowPx(other.page)) <= 0, `${await overflowPx(other.page)}px`);
      }
      await other.page.locator('.dash-tab', { hasText: 'Overview' }).click();
      await other.page.waitForURL('**/creator/dashboard', { timeout: 30000 });
      ok('a tab goes where it says', true);
      await other.ctx.close();
      const otherPhone = await b.open(MARA, 390);
      for (const href of ['/creator', '/creator/my-work', '/creator/money']) {
        await goto(otherPhone.page, href);
        await otherPhone.page.locator('.dash-tabs').waitFor({ timeout: 30000 });
        ok(`${href} at 390: the tabs scroll inside their own row, the page doesn’t`, (await overflowPx(otherPhone.page)) <= 0 && (await otherPhone.page.evaluate(() => getComputedStyle(document.querySelector('.dash-tabs')).overflowX)) === 'auto', `${await overflowPx(otherPhone.page)}px`);
      }
      await otherPhone.ctx.close();

      // ---- 7. a sub-admin and a viewer ---------------------------------------------------
      section('7. a sub-admin, a viewer');
      const team = await b.open(sub, 1280);
      await goto(team.page, '/creator/dashboard');
      await team.page.locator('.dash-flash.quiet').waitFor({ timeout: 30000 });
      await team.page.waitForTimeout(1500);
      ok('a sub-admin is told the account has no titles of its own', /isn’t a creator account/.test(await team.page.locator('.dash-flash.quiet').innerText()));
      ok('…with no Submit button and no section drawn as zeros', (await team.page.locator('.dash-head-acts').count()) === 0 && (await team.page.locator('.dash-titles, .dash-money, .dash-needs, .dash-latest').count()) === 0 && !(await team.page.locator('.dash').innerText()).includes('$0.00'));
      ok('…and no row of tabs: the other creator pages would send them away', (await team.page.locator('.dash-tabs').count()) === 0);
      ok('…and the tab bar has the Dashboard tab', (await team.page.locator('.tabbar .tabbar-dash').count()) === 1);
      ok('no page errors for a sub-admin', team.errors.length === 0, team.errors.join(' | '));
      await team.ctx.close();
      const fan = await b.open(VIEWER, 390);
      await goto(fan.page, '/stream');
      await fan.page.locator('.tabbar').waitFor({ timeout: 30000 });
      await fan.page.waitForTimeout(1200);
      ok('a viewer has no Dashboard tab', (await fan.page.locator('.tabbar .tabbar-dash').count()) === 0 && (await fan.page.locator('.tabbar .tabbar-item').count()) === 4);
      await fan.ctx.close();
    } finally {
      await b.close();
    }
  } finally {
    cleanup();
    if (sub) await removeUser(sub.id);
    if (tracked) await fetch(`${UPSTASH}/__reset`, { method: 'POST' }).catch(() => {});
  }
});
