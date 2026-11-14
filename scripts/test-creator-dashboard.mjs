// node scripts/test-creator-dashboard.mjs — the creator's Dashboard rules
// (lib/creatorDashboardRules.js, 2026-11-14): who sees it and where a
// sign-in lands, the four numbers, Your titles, Needs you, the money
// card, the charts' numbers and the Latest list, from the shapes the
// creator routes answer with. The app's copy is checked word for word.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as R from '../lib/creatorDashboardRules.js';

let n = 0;
const t = (name, fn) => { fn(); n += 1; console.log('ok', name); };

const NOW = Date.parse('2026-11-14T18:00:00Z');

t('the app copy is the website file word for word, and imports only showRules', () => {
  const web = readFileSync(new URL('../lib/creatorDashboardRules.js', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../mobile/src/lib/creatorDashboardRules.js', import.meta.url), 'utf8');
  assert.equal(app, web);
  const imports = web.split('\n').filter((l) => /^import\s/.test(l));
  assert.deepEqual(imports, ["import { needsYou } from './showRules.js';"]);
});

t('who sees the tab: creators and the team', () => {
  assert.equal(R.seesDashboard({ isCreator: true }), true);
  assert.equal(R.seesDashboard({ isAdmin: true }), true);
  assert.equal(R.seesDashboard({ canAccessAdmin: true }), true);
  assert.equal(R.seesDashboard({ isSignedIn: true }), false);
  assert.equal(R.seesDashboard(null), false);
  assert.equal(R.canAddTitles({ canAccessAdmin: true }), false);
  assert.equal(R.canAddTitles({ isCreator: true }), true);
});

t('the tabs: a creator gets them all, a sub-admin Overview and Numbers', () => {
  assert.deepEqual(R.dashboardTabs({ isCreator: true }).map((x) => x.key), ['overview', 'work', 'numbers', 'money', 'pitches', 'studio']);
  assert.deepEqual(R.dashboardTabs({ isCreator: true }, { studio: false }).map((x) => x.key), ['overview', 'work', 'numbers', 'money', 'pitches']);
  assert.deepEqual(R.dashboardTabs({ canAccessAdmin: true }).map((x) => x.key), ['overview', 'numbers']);
  assert.equal(R.dashboardTabs({ isCreator: true })[0].href, '/creator/dashboard');
  assert.deepEqual(R.dashboardTabs({}).map((x) => x.key), ['overview']);
});

t('after signing in: a creator lands on the Dashboard unless they were on their way somewhere', () => {
  assert.equal(R.signInLanding({ isCreator: true }), '/creator/dashboard');
  assert.equal(R.signInLanding({ canAccessAdmin: true }, '/'), '/creator/dashboard');
  assert.equal(R.signInLanding({ isCreator: true }, '/account'), '/creator/dashboard');
  assert.equal(R.signInLanding({ isCreator: true }, '/pitches/abc'), '/pitches/abc');
  assert.equal(R.signInLanding({ isSignedIn: true }), null);
  assert.equal(R.signInLanding({ isSignedIn: true }, '/episode/x'), '/episode/x');
  // Never somewhere off the site.
  assert.equal(R.signInLanding({ isCreator: true }, '//evil.example'), '/creator/dashboard');
  assert.equal(R.signInLanding({ isCreator: true }, '/\\evil.example'), '/creator/dashboard');
  assert.equal(R.signInLanding({ isCreator: true }, 'https://evil.example'), '/creator/dashboard');
});

t('words for money, counts, days and runtimes', () => {
  assert.equal(R.dollars(41260), '$412.60');
  assert.equal(R.dollars(123456789), '$1,234,567.89');
  assert.equal(R.dollars(-226), '−$2.26');
  assert.equal(R.dollars(0), '$0.00');
  assert.equal(R.count(8214), '8,214');
  assert.equal(R.monthName('2026-11'), 'November');
  assert.equal(R.monthShort('2026-06'), 'Jun');
  assert.equal(R.monthLabel('2026-11'), 'November 2026');
  assert.equal(R.currentPeriod(NOW), '2026-11');
  assert.equal(R.dayLabel('2026-11-10T09:00:00Z'), 'Nov 10');
  assert.equal(R.dayLabel('nope'), '');
  assert.equal(R.whenLabel('2026-11-14T17:30:00Z', NOW), 'Just now');
  assert.equal(R.whenLabel('2026-11-14T15:10:00Z', NOW), '2 h ago');
  assert.equal(R.whenLabel('2026-11-13T15:00:00Z', NOW), 'Yesterday');
  assert.equal(R.whenLabel('2026-11-10T15:00:00Z', NOW), 'Nov 10');
  assert.equal(R.runtimeLabel('1:20:00'), '1 h 20');
  assert.equal(R.runtimeLabel('2:00:00'), '2 h');
  assert.equal(R.runtimeLabel('12:00'), '12 min');
  assert.equal(R.runtimeLabel('25 min'), '25 min');
  assert.equal(R.runtimeLabel(null), '');
});

// --- what the routes answer with -------------------------------------------------

const sub = (id, extra = {}) => ({ id, title: `T ${id}`, status: 'approved', contentType: 'movie', seriesId: null, seriesName: null, seriesStatus: null, seriesHeld: false, held: false, deletionRequested: false, missingArtwork: false, captionsUrl: '/api/captions/x', cloudflareState: 'ready', runtime: '1:20:00', poster: null, thumbnail: null, createdAt: '2026-10-01T10:00:00Z', reviewedAt: '2026-10-02T10:00:00Z', ...extra });
const submissions = [
  sub('last-fare', { title: 'The Last Fare', captionsUrl: null }),
  sub('first-stop', { title: 'First Stop', contentType: 'short', runtime: '12:00' }),
  sub('nb-e1', { title: 'Pilot', contentType: 'series', seriesId: 'night-bus', seriesName: 'Night Bus', seriesStatus: 'approved', season: 2, seriesOrder: 1, runtime: '24:00' }),
  sub('nb-e4', { title: 'Episode 4', contentType: 'series', seriesId: 'night-bus', seriesName: 'Night Bus', seriesStatus: 'approved', season: 2, seriesOrder: 4, reviewedAt: '2026-11-10T09:00:00Z' }),
  sub('nb-e5', { title: 'Transfer', status: 'pending', contentType: 'series', seriesId: 'night-bus', seriesName: 'Night Bus', seriesStatus: 'approved', season: 2, seriesOrder: 5, createdAt: '2026-11-12T08:00:00Z', reviewedAt: null }),
  sub('hl-e1', { title: 'Pilot', contentType: 'series', seriesId: 'harbor-lights', seriesName: 'Harbor Lights', seriesStatus: 'pending', season: 1, seriesOrder: 1 }),
  sub('old-cut', { title: 'Old Cut', status: 'rejected', rejectionReason: 'the audio drops out', reviewedAt: '2026-11-05T10:00:00Z' })
];
const shows = [
  { id: 'night-bus', name: 'Night Bus', kind: 'series', state: 'live', statusLabel: 'Live', headline: 'Live', countLine: 'S2 · 4 episodes', poster: '/p/nb.jpg', href: '/creator/show/night-bus', counts: { live: 4 }, problems: [{ code: 'gap', words: 'S2 E3 is missing' }], makePublic: null, createdAt: '2026-09-01T00:00:00Z' },
  { id: 'harbor-lights', name: 'Harbor Lights', kind: 'series', state: 'ready', statusLabel: 'Ready to go public', headline: 'Ready to go public', countLine: '1 episode', poster: null, thumbnail: '/t/hl.jpg', href: '/creator/show/harbor-lights', counts: { live: 1 }, problems: [], makePublic: { ok: true }, createdAt: '2026-10-20T00:00:00Z' },
  { id: 'reels', name: 'Studio reels', kind: 'vertical', state: 'live', countLine: '9 clips' }
];
const drafts = [
  { id: 'd1', form: { title: 'Untitled road film' }, video: { state: 'processing', name: 'road.mov' }, updatedAt: '2026-11-14T17:40:00Z' },
  { id: 'd2', form: { seriesId: 'harbor-lights', title: '' }, video: null, updatedAt: '2026-11-13T10:00:00Z' },
  { id: 'd3', form: { seriesId: 'harbor-lights' }, video: { state: 'uploading', name: 'e3.mov' }, updatedAt: '2026-11-14T09:00:00Z' }
];
const numbers = {
  tracking: true,
  totals: { views: 20000, windowViews: 8214, changePct: 18, published: 5, pending: 1 },
  trend: [{ date: '2026-11-09', views: 290 }, { date: '2026-11-10', views: 460 }, { date: '2026-11-11', views: 380 }],
  perEpisode: [
    { id: 'nb-e1', seriesId: 'night-bus', views: 9000, windowViews: 3000, spark: [1, 2, 3], watchThroughPct: 70 },
    { id: 'nb-e4', seriesId: 'night-bus', views: 3000, windowViews: 2120, spark: [0, 5, 9], watchThroughPct: 46 },
    { id: 'last-fare', seriesId: null, views: 6000, windowViews: 2310, spark: [4, 4, 4], watchThroughPct: 48 },
    { id: 'first-stop', seriesId: null, views: 2000, windowViews: 784, spark: [0, 0, 0], watchThroughPct: null }
  ]
};
const money = {
  period: '2026-11',
  periods: ['2026-11', '2026-10', '2026-09'],
  top: { monthCents: 41260, owedCents: 18740, minimumCents: 2500, studioKept: false, nextPayout: { on: '2026-12-01T00:00:00.000Z', cents: 18740, willPay: true, reason: null } },
  payouts: { state: 'ready', bank: { name: 'Test Bank', last4: '6789' }, availableCents: 20000, pendingCents: 3410, nextBankPayout: { amountCents: 20000, arrivalDate: '2026-11-16', estimate: true }, summaryError: null },
  lanes: {
    member_support: { monthCents: 14800 },
    ad_share: { monthCents: 3050 },
    tips: { monthCents: 9200 },
    sales: { monthCents: 7273 },
    backing: { monthCents: 6937, pitches: [{ id: 'p1', title: 'Harbor Lights: season one', allRaisedCents: 124000, goalCents: 500000 }, { id: 'p2', title: 'Small one', allRaisedCents: 5000, goalCents: null }] },
    bookings: { shows: false, monthCents: 0 }
  },
  supporters: { picked: 31, watching: 15 },
  link: { linkPath: '/@mara', joined: 12, active: 9, bonusMonthCents: 900 },
  dashboard: {
    months: [{ period: '2026-06', cents: 11800 }, { period: '2026-07', cents: 16400 }, { period: '2026-08', cents: 20300 }, { period: '2026-09', cents: 25100 }, { period: '2026-10', cents: 31660 }, { period: '2026-11', cents: 41260, current: true }],
    previous: { period: '2026-10', cents: 31660 },
    byTitle: { 'episode:nb-e1': { salesCents: 1680, adsCents: 1500 }, 'episode:nb-e4': { salesCents: 0, adsCents: 640 }, 'series:night-bus': { salesCents: 2000, adsCents: 0 }, 'episode:last-fare': { salesCents: 3593, adsCents: 600 }, 'episode:first-stop': { salesCents: 0, adsCents: 310 } },
    latest: [
      { id: 'tip:t1', at: '2026-11-14T16:00:00Z', lane: 'tips', kind: 'tip', label: 'A fan', detail: '“Loved the ending.”', cents: 475, amountCents: 500 },
      { id: 'sale:s1', at: '2026-11-13T12:00:00Z', lane: 'sales', kind: 'sale', label: 'The Last Fare', detail: '$4.99 · a buyer', cents: 357 },
      { id: 'backing:d1', at: '2026-11-08T12:00:00Z', lane: 'backing', kind: 'backing', label: 'Harbor Lights: season one', detail: 'Dee Park backed $25.00', cents: 2375 },
      { id: 'ledger:l1', at: '2026-11-07T12:00:00Z', lane: 'member_support', kind: 'member_share', label: 'Member share', detail: 'A member · picked you', cents: 200 },
      { id: 'sale-refund:s0', at: '2026-11-06T12:00:00Z', lane: 'sales', kind: 'refund', label: 'First Stop', detail: 'Refunded', cents: -150 }
    ]
  }
};

t('the four numbers', () => {
  const tiles = R.dashboardTiles({ money, numbers, period: '2026-11', now: NOW });
  assert.deepEqual(tiles.map((x) => x.key), ['earned', 'owed', 'views', 'supporters']);
  assert.deepEqual(tiles[0], { key: 'earned', label: 'Earned this month · all lanes', value: '$412.60', sub: '$96.00 more than October', tone: '' });
  assert.deepEqual(tiles[1], { key: 'owed', label: 'Owed to you', value: '$187.40', sub: 'Next transfer Dec 1', tone: 'accent' });
  assert.deepEqual(tiles[2], { key: 'views', label: 'Views · last 30 days', value: '8,214', sub: '18% more than the 30 days before', tone: '' });
  assert.deepEqual(tiles[3], { key: 'supporters', label: 'Supporters', value: '46', sub: '31 picked you · 15 by watching', tone: '' });
});

t('the numbers say what they can when something is missing or off', () => {
  const loading = R.dashboardTiles({});
  assert.deepEqual(loading.map((x) => x.value), [null, null, null, null]);
  const past = R.dashboardTiles({ money: { ...money, top: { ...money.top, monthCents: 20000 } }, numbers, period: '2026-10', now: NOW });
  assert.equal(past[0].label, 'Earned in October · all lanes');
  assert.equal(past[0].sub, '$116.60 less than October');
  const noPayouts = R.dashboardTiles({ money: { ...money, top: { ...money.top, nextPayout: { on: '2026-12-01', willPay: false, reason: 'set up payouts' } } }, numbers, now: NOW });
  assert.equal(noPayouts[1].sub, 'Set up payouts to receive it');
  const small = R.dashboardTiles({ money: { ...money, top: { ...money.top, owedCents: 900, nextPayout: { willPay: false, reason: 'under the minimum, carries over' } } }, numbers, now: NOW });
  assert.equal(small[1].sub, 'Under the $25.00 minimum · carries over');
  const studio = R.dashboardTiles({ money: { ...money, top: { ...money.top, owedCents: 0, studioKept: true } }, numbers, now: NOW });
  assert.equal(studio[1].sub, 'Kept by the studio');
  const off = R.dashboardTiles({ money, numbers: { tracking: false, totals: { windowViews: 0, changePct: null } }, now: NOW });
  assert.equal(off[2].sub, 'View counting isn’t switched on yet');
  const down = R.dashboardTiles({ money, numbers: { tracking: true, totals: { windowViews: 10, changePct: -40 } }, now: NOW });
  assert.equal(down[2].sub, '40% fewer than the 30 days before');
  const first = R.dashboardTiles({ money: { ...money, top: { ...money.top, monthCents: 0 }, dashboard: { ...money.dashboard, previous: { period: '2026-10', cents: 0 } } }, numbers, now: NOW });
  assert.equal(first[0].sub, 'Nothing in yet');
});

const built = R.dashboardTitles({ submissions, shows, drafts, numbers, money, now: NOW });
const row = (key) => built.rows.find((r) => r.key === key);

t('your titles: one row per show, per title in no show, per episode in review or turned down, per draft', () => {
  assert.deepEqual(built.rows.map((r) => r.key), [
    'show:night-bus', 'title:last-fare', 'title:first-stop',
    'title:nb-e5',
    'show:harbor-lights',
    'draft:d1', 'drafts:harbor-lights',
    'title:old-cut'
  ]);
  // The studio's vertical "show" is never a row; a listed show's live episodes are inside it.
  assert.equal(row('show:reels'), undefined);
  assert.equal(row('title:nb-e1'), undefined);
  assert.deepEqual(built.counts, { all: 8, live: 3, review: 1, drafts: 2, needs: 3 });
});

t('a live show adds up its episodes: views, how much is watched, sales and ad share', () => {
  const nb = row('show:night-bus');
  assert.equal(nb.title, 'Night Bus');
  assert.equal(nb.meta, 'Series · S2 · 4 episodes');
  assert.equal(nb.state, 'live');
  assert.equal(nb.stateLabel, 'Live');
  assert.equal(nb.href, '/creator/show/night-bus');
  assert.equal(nb.poster, '/p/nb.jpg');
  assert.equal(nb.views, 5120);
  assert.deepEqual(nb.spark, [1, 7, 12]);
  // Weighted by all-time views: (70 × 9000 + 46 × 3000) / 12000 = 64.
  assert.equal(nb.watchedPct, 64);
  // Its episodes' sales and ad share, plus whole-series sales.
  assert.equal(nb.earnedCents, 1680 + 1500 + 640 + 2000);
  assert.equal(nb.earnedDetail, 'sales 36.80 · ads 21.40');
  assert.equal(nb.action, null);
});

t('a title in no show carries its own numbers; a flat line is no line', () => {
  const lf = row('title:last-fare');
  assert.equal(lf.title, 'The Last Fare');
  assert.equal(lf.meta, 'Film · 1 h 20');
  assert.equal(lf.views, 2310);
  assert.equal(lf.watchedPct, 48);
  assert.equal(lf.earnedCents, 4193);
  assert.equal(lf.earnedDetail, 'sales 35.93 · ads 6.00');
  assert.equal(lf.href, '/creator/my-work');
  // Live, and it still needs captions.
  assert.equal(lf.state, 'live');
  assert.equal(lf.needs, true);
  assert.equal(lf.needsWhy, 'No captions yet');
  const fs = row('title:first-stop');
  assert.equal(fs.meta, 'Short · 12 min');
  assert.equal(fs.spark, null);
  assert.equal(fs.watchedPct, null);
  assert.equal(fs.earnedDetail, 'ads 3.10');
  assert.equal(fs.needs, false);
});

t('rows that are not live say where they stand instead of numbers', () => {
  const e5 = row('title:nb-e5');
  assert.equal(e5.title, 'Night Bus · S2 E5 · Transfer');
  assert.equal(e5.state, 'review');
  assert.equal(e5.stateLabel, 'In review');
  assert.equal(e5.note, 'Sent Nov 12. With the team now; it goes live when approved.');
  assert.equal(e5.views, null);
  assert.equal(e5.earnedCents, null);
  assert.equal(e5.href, '/creator/show/night-bus#ep-nb-e5');
  const hl = row('show:harbor-lights');
  assert.equal(hl.state, 'ready');
  assert.equal(hl.note, 'Private until you say so.');
  assert.deepEqual(hl.action, { kind: 'publish', label: 'Make it public', showId: 'harbor-lights', name: 'Harbor Lights' });
  assert.equal(hl.poster, '/t/hl.jpg');
  assert.equal(hl.views, null);
  const d1 = row('draft:d1');
  assert.equal(d1.title, 'Untitled road film');
  assert.equal(d1.meta, 'Saved just now');
  assert.equal(d1.note, 'The file is processing.');
  assert.deepEqual(d1.action, { kind: 'link', label: 'Continue', href: '/creator/submit?draft=d1' });
  const ds = row('drafts:harbor-lights');
  assert.equal(ds.title, 'Harbor Lights · 2 drafts');
  assert.equal(ds.action.href, '/creator/show/harbor-lights');
  const old = row('title:old-cut');
  assert.equal(old.state, 'declined');
  assert.equal(old.note, 'Not this time: the audio drops out');
});

t('an episode of a show the list does not have is its own row; a numbered title drops its number words', () => {
  const lone = R.dashboardTitles({ submissions: [sub('x-e2', { title: 'Episode 2', contentType: 'series', seriesId: 'someone-elses', seriesName: 'Someone Else’s Show', seriesStatus: 'approved', season: 1, seriesOrder: 2 })], shows: [], numbers, money, now: NOW });
  assert.equal(lone.rows.length, 1);
  assert.equal(lone.rows[0].title, 'Someone Else’s Show · S1 E2');
  assert.equal(lone.rows[0].state, 'live');
  assert.equal(lone.rows[0].kind, 'episode');
  // Approved inside a show that isn't public yet: ready, never live.
  const waiting = R.dashboardTitles({ submissions: [sub('y-e1', { contentType: 'series', seriesId: 'private-show', seriesName: 'Private', seriesStatus: 'pending', seriesOrder: 1 })], shows: [], now: NOW });
  assert.equal(waiting.rows[0].state, 'ready');
});

t('before the numbers or the money arrive, rows carry no numbers', () => {
  const early = R.dashboardTitles({ submissions, shows, drafts: [], numbers: null, money: null, now: NOW });
  const nb = early.rows.find((r) => r.key === 'show:night-bus');
  assert.equal(nb.views, null);
  assert.equal(nb.earnedCents, null);
  assert.equal(R.dashboardTitles({}).rows.length, 0);
  assert.deepEqual(R.dashboardTitles({}).counts, { all: 0, live: 0, review: 0, drafts: 0, needs: 0 });
});

t('the filters', () => {
  assert.equal(R.filterTitles(built.rows, 'all').length, 8);
  assert.deepEqual(R.filterTitles(built.rows, 'live').map((r) => r.key), ['show:night-bus', 'title:last-fare', 'title:first-stop']);
  assert.deepEqual(R.filterTitles(built.rows, 'review').map((r) => r.key), ['title:nb-e5']);
  assert.deepEqual(R.filterTitles(built.rows, 'drafts').map((r) => r.key), ['draft:d1', 'drafts:harbor-lights']);
  assert.deepEqual(R.filterTitles(built.rows, 'needs').map((r) => r.key), ['title:last-fare', 'show:harbor-lights', 'title:old-cut']);
  assert.deepEqual(R.TITLE_FILTERS.map((f) => f.key), ['all', 'live', 'review', 'drafts', 'needs']);
});

t('needs you: an invite, a show ready to go public, each title’s reason, numbering, payouts', () => {
  const invites = [{ id: 'inv1', headline: 'Get paid for Depot Stories?', inviterName: 'Pat Lee', sentLabel: 'Nov 12' }];
  const noPay = { ...money, top: { ...money.top, nextPayout: { willPay: false, reason: 'set up payouts' } } };
  const all = R.dashboardNeeds({ submissions, shows, invites, money: noPay, limit: 20 });
  assert.deepEqual(all.rows.map((r) => r.key), ['invite:inv1', 'ready:harbor-lights', 'title:last-fare', 'title:old-cut', 'numbering:night-bus:gap:S2 E3 is missing', 'payouts']);
  assert.deepEqual(all.rows[0], { key: 'invite:inv1', title: 'Get paid for Depot Stories?', sub: 'Pat Lee asked on Nov 12', action: { kind: 'link', label: 'Answer', href: '/creator#get-paid' } });
  assert.deepEqual(all.rows[1], { key: 'ready:harbor-lights', title: 'Harbor Lights is ready to go public', sub: '1 episode approved', action: { kind: 'publish', label: 'Make it public', showId: 'harbor-lights', name: 'Harbor Lights' } });
  assert.deepEqual(all.rows[2], { key: 'title:last-fare', title: 'The Last Fare', sub: 'No captions yet', action: { kind: 'link', label: 'Add captions', href: '/creator/my-work?attention=1' } });
  assert.equal(all.rows[3].action.label, 'See why');
  assert.deepEqual(all.rows[4].action, { kind: 'link', label: 'Open the show', href: '/creator/show/night-bus' });
  assert.equal(all.rows[4].title, 'Night Bus: S2 E3 is missing');
  assert.deepEqual(all.rows[5], { key: 'payouts', title: 'Set up payouts', sub: '$187.40 is waiting for a bank account', action: { kind: 'link', label: 'Set up payouts', href: '/creator/money#payouts' } });
  assert.equal(all.total, 6);
  assert.equal(all.more, 0);
  const capped = R.dashboardNeeds({ submissions, shows, invites, money: noPay });
  assert.equal(capped.rows.length, 5);
  assert.equal(capped.more, 1);
  assert.deepEqual(R.dashboardNeeds({}), { rows: [], total: 0, more: 0 });
  // A show someone else must open can't be made public from here.
  const locked = R.dashboardNeeds({ submissions: [], shows: [{ ...shows[1], makePublic: { ok: false } }] });
  assert.deepEqual(locked.rows[0].action, { kind: 'link', label: 'Open the show', href: '/creator/show/harbor-lights' });
  // An episode in a show: its row opens the show at that episode.
  const ep = R.dashboardNeeds({ submissions: [sub('nb-e2', { title: 'Episode 2', contentType: 'series', seriesId: 'night-bus', seriesName: 'Night Bus', seriesStatus: 'approved', season: 2, seriesOrder: 2, missingArtwork: true })], shows });
  const epRow = ep.rows.find((r) => r.key === 'title:nb-e2');
  assert.equal(epRow.title, 'Night Bus · S2 E2');
  assert.deepEqual(epRow.action, { kind: 'link', label: 'Add art', href: '/creator/show/night-bus#ep-nb-e2' });
});

t('money this month: the lanes biggest first, then when it moves', () => {
  const card = R.dashboardMoney(money, { period: '2026-11', now: NOW });
  assert.equal(card.label, 'Money this month');
  assert.equal(card.total, '$412.60');
  assert.deepEqual(card.lanes.map((l) => [l.label, l.cents]), [['Member support', 14800], ['Tips', 9200], ['Title sales', 7273], ['Backing', 6937], ['Ad share', 3050]]);
  assert.equal(card.lanes[0].share, 1);
  assert.equal(Math.round(card.lanes[1].share * 100), 62);
  // The lanes add up to the total the money page shows.
  assert.equal(card.lanes.reduce((s, l) => s + l.cents, 0), 41260);
  assert.deepEqual(card.onFirst, { title: 'On Dec 1', sub: 'Member support and ad share, sent to your Stripe account', value: '$187.40' });
  assert.deepEqual(card.stripe, { title: 'In Stripe now', sub: 'Tips, sales and backing. Next bank payout Nov 16 · ••6789', value: '$234.10' });
  assert.equal(card.payoutsReady, true);
  assert.equal(R.dashboardMoney(null), null);
  const host = R.dashboardMoney({ ...money, lanes: { ...money.lanes, bookings: { shows: true, monthCents: 61025 } } }, { now: NOW });
  assert.equal(host.lanes[0].label, 'Bookings');
  const past = R.dashboardMoney(money, { period: '2026-10', now: NOW });
  assert.equal(past.label, 'Money in October');
  const none = R.dashboardMoney({ ...money, payouts: { state: 'off', availableCents: null, pendingCents: null }, top: { ...money.top, nextPayout: { on: '2026-12-01', willPay: false, reason: 'set up payouts' } } }, { now: NOW });
  assert.equal(none.stripe, null);
  assert.equal(none.onFirst.sub, 'Member support and ad share · set up payouts to receive it');
  const small = R.dashboardMoney({ ...money, top: { ...money.top, nextPayout: { on: '2026-12-01', willPay: false, reason: 'under the minimum, carries over' } } }, { now: NOW });
  assert.equal(small.onFirst.sub, 'Member support and ad share · under the $25.00 minimum, it carries over');
  // A refund month never draws a bar backwards.
  const down = R.dashboardMoney({ ...money, lanes: { ...money.lanes, sales: { monthCents: -500 } } }, { now: NOW });
  assert.equal(down.lanes.find((l) => l.key === 'sales').share, 0);
});

t('the six months', () => {
  const m = R.dashboardMonths(money);
  assert.deepEqual(m.bars.map((b) => b.label), ['Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov']);
  assert.equal(m.bars[5].share, 1);
  assert.equal(m.bars[5].current, true);
  assert.equal(m.bars[4].value, '$316.60');
  assert.equal(m.note, 'November is the month so far.');
  assert.equal(m.summary, 'Earnings by month from $118.00 in June to $412.60 so far in November');
  assert.equal(m.empty, false);
  assert.equal(R.dashboardMonths(null), null);
  const flat = R.dashboardMonths({ dashboard: { months: [{ period: '2026-10', cents: 0 }, { period: '2026-11', cents: 0, current: true }] } });
  assert.equal(flat.empty, true);
  assert.deepEqual(flat.bars.map((b) => b.share), [0, 0]);
});

t('views a day', () => {
  const v = R.dashboardViews(numbers);
  assert.equal(v.max, 460);
  assert.equal(v.total, 1130);
  assert.deepEqual(v.peak, { date: '2026-11-10', views: 460, label: 'Nov 10 · 460 views' });
  assert.equal(v.firstLabel, 'Nov 9');
  assert.equal(v.lastLabel, 'Nov 11');
  assert.equal(v.summary, 'Views a day from Nov 9 to Nov 11, highest on Nov 10 with 460');
  assert.equal(v.tracking, true);
  const off = R.dashboardViews({ tracking: false, trend: [] });
  assert.equal(off.tracking, false);
  assert.equal(off.empty, true);
  assert.equal(off.peak, null);
  assert.equal(R.dashboardViews(null), null);
});

t('latest: money lines and titles going live, newest first', () => {
  const rows = R.dashboardLatest({ money, submissions, now: NOW });
  assert.deepEqual(rows.map((r) => [r.text, r.amount, r.when]), [
    ['A fan tipped you $5.00', '', '2 h ago'],
    ['The Last Fare sold', '$3.57', 'Yesterday'],
    ['Night Bus S2 E4 went live', '', 'Nov 10'],
    ['Dee Park backed $25.00 · Harbor Lights: season one', '$23.75', 'Nov 8'],
    ['Member support · Member share · A member · picked you', '$2.00', 'Nov 7'],
    ['Title sales · First Stop · refunded', '−$1.50', 'Nov 6']
  ]);
  assert.equal(rows[2].href, '/creator/show/night-bus#ep-nb-e4');
  assert.equal(rows[0].href, '/creator/money');
  assert.equal(R.dashboardLatest({ money, submissions, now: NOW, limit: 2 }).length, 2);
  assert.deepEqual(R.dashboardLatest({}), []);
  // A title turned down in the last 30 days; an approval inside a private show is not "live".
  const more = R.dashboardLatest({ submissions: [...submissions, sub('hl-e9', { title: 'Late', contentType: 'series', seriesId: 'harbor-lights', seriesName: 'Harbor Lights', seriesStatus: 'pending', seriesOrder: 9, reviewedAt: '2026-11-13T10:00:00Z' })], now: NOW, limit: 20 });
  assert.ok(more.some((r) => r.text === 'Old Cut: not this time'));
  assert.ok(more.some((r) => r.text === 'Harbor Lights S1 E9 Late was approved'));
});

t('also yours: the pitch that raised most, and the link', () => {
  assert.deepEqual(R.dashboardPitch(money), { title: 'Harbor Lights: season one', line: '$1,240 raised of $5,000', share: 0.248, href: '/creator/pitch/dashboard', action: 'Post an update' });
  assert.equal(R.dashboardPitch({ lanes: { backing: { pitches: [] } } }), null);
  assert.deepEqual(R.dashboardPitch({ lanes: { backing: { pitches: [{ title: 'No goal', allRaisedCents: 5050, goalCents: null }] } } }), { title: 'No goal', line: '$50.50 raised', share: null, href: '/creator/pitch/dashboard', action: 'Post an update' });
  assert.deepEqual(R.dashboardLink(money), { path: '/@mara', joined: '12 joined through it · 9 still members', bonus: 'Referral bonus this month: $9.00' });
  assert.equal(R.dashboardLink({ link: null }), null);
  assert.deepEqual(R.periodOptions(money), [{ value: '2026-11', label: 'November 2026' }, { value: '2026-10', label: 'October 2026' }, { value: '2026-09', label: 'September 2026' }]);
  assert.deepEqual(R.periodOptions(null, NOW), [{ value: '2026-11', label: 'November 2026' }]);
});

console.log(`${n} passed`);
