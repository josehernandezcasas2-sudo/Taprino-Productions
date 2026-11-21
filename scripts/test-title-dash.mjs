// node scripts/test-title-dash.mjs — a title's dashboard and a show's
// Overview (lib/titleDashRules.js, 2026-11-15): the four numbers, the
// chart, the money from the year's lines, the checklist, the history and
// the tabs' contents, from the shapes the creator routes answer with. The
// app's copy is checked word for word.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as R from '../lib/titleDashRules.js';

let n = 0;
const t = (name, fn) => { fn(); n += 1; console.log('ok', name); };
const NOW = Date.parse('2026-11-15T18:00:00Z');

const film = {
  id: 'long-way-b1', title: 'The Long Way Home', contentType: 'movie', status: 'approved', runtime: '1:28:10', mainGenre: 'Drama', genre: 'Road', rating: 'TV-14', tier: 'premium',
  poster: 'p.jpg', thumbnail: 't.jpg', captionsUrl: null, captionsStale: false, channelOptIn: false, canPrice: true, hasVideo: true, cloudflareState: 'ready',
  createdAt: '2026-09-10T00:00:00Z', reviewedAt: '2026-09-12T00:00:00Z', description: 'Two brothers.', releaseYear: 2025, downloadsAllowed: true, downloadsAllowedReady: true
};
const days = (count, f) => Array.from({ length: count }, (_, i) => ({ date: `2026-10-${String((i % 28) + 1).padStart(2, '0')}`, views: f(i), watchSeconds: f(i) * 60 }));
const detail = { tracking: true, totals: { views: 3410, avgWatchSeconds: 3120, watchThroughPct: 59 }, trend: [...days(30, () => 10), ...days(30, () => 11)] };
const money = { history: [
  { at: '2026-11-10T00:00:00Z', lane: 'sales', kind: 'sale', titleType: 'episode', titleId: 'long-way-b1', cents: 364 },
  { at: '2026-10-10T00:00:00Z', lane: 'sales', kind: 'sale', titleType: 'episode', titleId: 'long-way-b1', cents: 364 },
  { at: '2026-10-11T00:00:00Z', lane: 'sales', kind: 'sale', titleType: 'episode', titleId: 'other-c1', cents: 999 },
  { at: '2026-11-01T00:00:00Z', lane: 'ad_share', kind: 'ad_share', episodeId: 'long-way-b1', cents: 620 },
  { at: '2026-11-02T00:00:00Z', lane: 'tips', kind: 'tip', cents: 500 }
] };

t('the app copy is the website file word for word', () => {
  const web = readFileSync(new URL('../lib/titleDashRules.js', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../mobile/src/lib/titleDashRules.js', import.meta.url), 'utf8');
  assert.equal(app, web);
});

t('the head and the four numbers', () => {
  const d = R.titleDashboard({ title: film, detail, money, price: null, now: NOW });
  assert.equal(d.head.title, 'The Long Way Home');
  assert.equal(d.head.typeWord, 'Film');
  assert.equal(d.head.pill.label, 'Live');
  assert.equal(d.head.meta, '1 h 28 min · Drama · TV-14 · Tapa + members · live since Sep 12');
  assert.deepEqual(d.tiles.map((x) => x.value), ['3,410', '52 min', '59%', '$13.48']);
  assert.equal(d.tiles[0].note, '+10% on the 30 days before');
  assert.equal(d.tiles[3].note, '2 copies bought');
});

t('money counts this title only: its sales and its ad share, never tips', () => {
  const m = R.moneyOf(money.history, { ids: ['long-way-b1'], now: NOW });
  assert.deepEqual(m, { salesCents: 728, adsCents: 620, bought: 2, monthCents: 984 });
  const d = R.titleDashboard({ title: film, detail, money, now: NOW });
  assert.equal(d.money.total, '$13.48');
  assert.equal(d.money.month, '$9.84 of it this month');
  assert.deepEqual(d.money.rows.map((r) => r.label), ['Title sales', 'Ad share']);
});

t('the chart: the last 30 days, views or watch minutes', () => {
  const v = R.titleDashboard({ title: film, detail, now: NOW }).chart;
  assert.equal(v.list.length, 30);
  assert.equal(v.max, 11);
  const w = R.titleDashboard({ title: film, detail, chartMode: 'watch', now: NOW }).chart;
  assert.equal(w.max, 11);
  assert.equal(w.unit, 'min');
});

t('the checklist says what is missing and offers the fix', () => {
  const d = R.titleDashboard({ title: film, detail, money, price: null, now: NOW });
  assert.deepEqual(d.checklist.map((c) => [c.key, c.done, c.action && c.action.key]), [['artwork', true, null], ['captions', false, 'captions'], ['selling', false, 'sell'], ['channels', false, 'channels']]);
  const priced = R.titleDashboard({ title: { ...film, captionsUrl: '/c', channelOptIn: true }, price: { status: 'on', price_cents: 499, pending_cents: null }, now: NOW });
  assert.ok(priced.checklist.every((c) => c.done));
  assert.equal(priced.checklist[2].note, 'on sale at $4.99');
});

t('history, newest first, from the dates the row knows', () => {
  const d = R.titleDashboard({ title: { ...film, deletionRequestedAt: '2026-11-01T00:00:00Z', deletionRequested: true, deletionReason: 'Recut' }, now: NOW });
  assert.deepEqual(d.history.map((h) => h.when), ['Nov 1', 'Sep 12', 'Sep 10']);
  assert.match(d.history[0].what, /Recut/);
  assert.equal(d.removal.key, 'cancel_removal');
});

t('the tabs and their cards; an extra has no Selling or Channels', () => {
  const d = R.titleDashboard({ title: film, now: NOW });
  assert.deepEqual(d.tabs.map((x) => x.key), ['overview', 'details', 'artwork', 'video', 'selling', 'channels', 'screenings']);
  assert.equal(d.details.action.key, 'edit_words');
  assert.equal(d.video.captions.action.label, 'Add captions');
  assert.equal(d.selling.action.label, 'Sell it');
  const extra = R.titleDashboard({ title: { ...film, contentType: 'bonus' }, now: NOW });
  assert.deepEqual(extra.tabs.map((x) => x.key), ['overview', 'details', 'artwork', 'video', 'screenings']);
  const pending = R.titleDashboard({ title: { ...film, status: 'pending' }, now: NOW });
  assert.equal(pending.details.action.key, 'edit_submission');
  assert.equal(pending.selling.note, 'Selling opens once it is live.');
});

t('missing answers read as dashes, never zeros', () => {
  const d = R.titleDashboard({ title: film, detail: null, money: null, now: NOW });
  assert.deepEqual(d.tiles.map((x) => x.value), ['—', '—', '—', '—']);
  assert.equal(d.money.available, false);
  const off = R.titleDashboard({ title: film, detail: { tracking: false, totals: { views: 0 }, trend: [] }, now: NOW });
  assert.equal(off.trackingOff, true);
});

const show = {
  show: { id: 'night-bus-lx3k9a', name: 'Night Bus', staged: { name: null, titleImageUrl: null, titleImageRemoval: false, seasonArt: [] }, creditLines: [{ key: 'maker', label: 'Made by', name: 'Mara Reyes' }] },
  viewer: { seesWhoIsPaid: true },
  payee: { runsIt: { name: 'Mara Reyes' }, paidTo: { name: 'Mara Reyes' } },
  problems: [{ code: 'captions', level: 'review', words: '1 live episode has no captions' }, { code: 'delay', level: 'info', words: 'Changes reach visitors within a few minutes' }],
  seasons: [
    { number: 1, rows: [
      { kind: 'episode', id: 'nb-e2-a2', code: 'S1 E2', displayTitle: 'The Transfer', season: 1, seriesOrder: 2, status: 'approved', staged: { title: 'New name' } },
      { kind: 'episode', id: 'nb-e1-a1', code: 'S1 E1', displayTitle: 'First Stop', season: 1, seriesOrder: 1, status: 'approved', staged: {} }
    ] },
    { number: 2, rows: [{ kind: 'episode', id: 'nb-e3-a3', code: 'S2 E1', displayTitle: 'Episode 1', season: 2, seriesOrder: 1, status: 'pending', staged: {} }] }
  ],
  extras: [{ kind: 'extra', id: 'nb-x-a5', displayTitle: 'Making of', status: 'approved' }]
};
const numbers = { tracking: true, totals: { views: 3000 }, perEpisode: [
  { id: 'nb-e1-a1', views: 1000, windowViews: 300, watchThroughPct: 80, spark: [1, 2, 3], avgWatchSeconds: 1000 },
  { id: 'nb-e2-a2', views: 700, windowViews: 200, watchThroughPct: 70, spark: [1, 1, 1], avgWatchSeconds: 900 },
  { id: 'other-c1', views: 5000, windowViews: 5000, watchThroughPct: 10, spark: [9, 9, 9] }
] };

t('a show: the numbers add up its episodes and extras only', () => {
  const o = R.showOverview({ show, numbers, money: { history: [{ at: '2026-11-10T00:00:00Z', lane: 'sales', kind: 'sale', titleType: 'series', titleId: 'night-bus-lx3k9a', cents: 900 }, { at: '2026-11-03T00:00:00Z', lane: 'ad_share', episodeId: 'nb-e1-a1', cents: 100 }] }, now: NOW });
  assert.deepEqual(o.tiles.map((x) => x.value), ['500', '76%', '70%', '$10.00']);
  assert.equal(o.tiles[2].note, 'S1 E2 views next to S1 E1’s');
  assert.deepEqual(o.chart.list.map((b) => b.value), [2, 3, 4]);
});

t('a show: episodes in play order with extras last, needs, waiting and people', () => {
  const o = R.showOverview({ show, numbers, now: NOW });
  assert.deepEqual(o.episodes.map((e) => e.code), ['S1 E1', 'S1 E2', 'S2 E1', 'Extra']);
  assert.equal(o.episodes[2].pill.label, 'In review');
  assert.equal(o.episodes[2].views, '—');
  assert.equal(o.episodes[0].avg, '17 min');
  assert.deepEqual(o.needs.map((x) => x.text), ['1 live episode has no captions']);
  assert.deepEqual(o.waiting.map((x) => x.text), ['S1 E2 The Transfer: a new title', 'S2 E1 Episode 1: in review']);
  assert.deepEqual(o.people.map((p) => `${p.label}: ${p.value}`), ['Runs it: Mara Reyes', 'Earnings go to: Mara Reyes', 'Made by: Mara Reyes']);
  const staged = R.showOverview({ show: { ...show, show: { ...show.show, staged: { seasonArt: [{ season: 2 }] } } }, now: NOW });
  assert.equal(staged.waiting[staged.waiting.length - 1].text, 'A change to the show itself');
  const noNumbers = R.showOverview({ show, numbers: null, money: null, now: NOW });
  assert.deepEqual(noNumbers.tiles.map((x) => x.value), ['—', '—', '—', '—']);
});

t('watch time in words', () => {
  assert.equal(R.watchWords(45), '45 s');
  assert.equal(R.watchWords(3120), '52 min');
  assert.equal(R.watchWords(3840), '1 h 4 min');
  assert.equal(R.watchWords(null), '—');
});

console.log(`\n${n} checks passed`);
