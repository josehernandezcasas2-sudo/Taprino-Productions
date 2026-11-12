// node scripts/test-ad-share.mjs — ad share (lib/adShareRules.js).
import assert from 'node:assert/strict';
import { adShareLines, normalizeAdSharePercent, periodDays, periodLabel, normalizeSurface, AD_SHARE_LOOKBACK_MONTHS, lookbackPeriods, adShareMonthWords, adShareAuditWords } from '../lib/adShareRules.js';
import { isTitleId } from '../lib/titleIds.js';

let n = 0;
const t = (name, fn) => { fn(); n += 1; console.log('ok', name); };

const EPISODES = {
  e1: { id: 'e1', title: 'Night Shift', creatorId: 'user_mara', contentType: 'series' },
  e2: { id: 'e2', title: 'The Salt Hours', creatorId: 'user_mara', contentType: 'short' },
  e3: { id: 'e3', title: 'Night Radio 1', creatorId: 'user_mara', contentType: 'podcast' },
  e4: { id: 'e4', title: 'House Reel', creatorId: 'user_admin', contentType: 'movie' },
  e5: { id: 'e5', title: 'Orphan', creatorId: null, contentType: 'short' }
};

t('percent: whole numbers 0–100, else the default', () => {
  assert.equal(normalizeAdSharePercent(50), 50);
  assert.equal(normalizeAdSharePercent('40.6'), 41);
  assert.equal(normalizeAdSharePercent(101), 50);
  assert.equal(normalizeAdSharePercent(-1), 50);
  assert.equal(normalizeAdSharePercent('x', 30), 30);
});

t('period helpers', () => {
  assert.deepEqual(periodDays('2026-10'), { from: '2026-10-01', to: '2026-11-01' });
  assert.deepEqual(periodDays('2026-12'), { from: '2026-12-01', to: '2027-01-01' });
  assert.throws(() => periodDays('2026-13'));
  assert.equal(periodLabel('2026-10'), 'October 2026');
  assert.equal(normalizeSurface('live'), 'live');
  assert.equal(normalizeSurface('reel'), 'preroll');
});

t('one line per title, summed across ads, surfaces and days, floored at the percent', () => {
  const rows = [
    { episode_id: 'e1', impressions: 600, credit_cents: 360 },   // $3.60 across a day
    { episode_id: 'e1', impressions: 640, credit_cents: 384.6 }, // fractional cents from a per-impression rate
    { episode_id: 'e2', impressions: 100, credit_cents: 60 },
    { episode_id: 'e2', impressions: 1, credit_cents: 0 }        // a house ad: no credit
  ];
  const out = adShareLines({ rows, episodes: EPISODES, percent: 50, period: '2026-10', createdBy: 'cron' });
  assert.equal(out.lines.length, 2);
  const [a, b] = out.lines;
  assert.equal(a.episode_id, 'e1');
  assert.equal(a.cents, 372, '50% of 744.6, floored');
  assert.equal(a.units, 1240);
  assert.equal(a.note, 'Night Shift · 1,240 ads · October 2026');
  assert.equal(a.kind, 'ad_share');
  assert.equal(a.lane, 'earnings');
  assert.equal(a.period, '2026-10');
  assert.equal(a.basis, null);
  assert.equal(b.episode_id, 'e2');
  assert.equal(b.cents, 30);
  assert.equal(b.units, 101);
  assert.equal(out.totalCents, 402);
  assert.equal(out.impressions, 1341);
  assert.equal(out.creditCents, 805);
  assert.equal(out.percent, 50);
});

t('podcasts, unknown titles, titles with no creator and excluded creators earn nothing', () => {
  const rows = [
    { episode_id: 'e3', impressions: 50, credit_cents: 30 },
    { episode_id: 'e4', impressions: 50, credit_cents: 30 },
    { episode_id: 'e5', impressions: 50, credit_cents: 30 },
    { episode_id: 'e9', impressions: 50, credit_cents: 30 },
    { episode_id: 'e2', impressions: 3, credit_cents: 1.8 }      // 50% of 1.8 = 0.9 → under a cent
  ];
  const out = adShareLines({ rows, episodes: EPISODES, percent: 50, period: '2026-10' }, { excludeCreators: new Set(['user_admin']) });
  assert.equal(out.lines.length, 0);
  assert.deepEqual(out.skipped.map((s) => [s.episodeId, s.reason]), [['e2', 'under a cent'], ['e3', 'podcast'], ['e4', 'creator excluded'], ['e5', 'no creator'], ['e9', 'no such title']]);
  assert.equal(out.impressions, 203);
});

t('a different percent and an empty month', () => {
  const out = adShareLines({ rows: [{ episode_id: 'e1', impressions: 1000, credit_cents: 600 }], episodes: EPISODES, percent: 30, period: '2026-09' });
  assert.equal(out.lines[0].cents, 180);
  const empty = adShareLines({ rows: [], episodes: EPISODES, percent: 50, period: '2026-09' });
  assert.deepEqual(empty, { lines: [], skipped: [], percent: 50, impressions: 0, creditCents: 0, totalCents: 0 });
});

t('one account all month: one line, as before (slice 3b)', () => {
  const rows = [
    { episode_id: 'e1', day: '2026-10-02', impressions: 10, credit_cents: 6 },
    { episode_id: 'e1', day: '2026-10-25', impressions: 10, credit_cents: 6 }
  ];
  const out = adShareLines({ rows, episodes: EPISODES, percent: 50, period: '2026-10', payeeOn: () => 'user_pat' });
  assert.equal(out.lines.length, 1);
  assert.equal(out.lines[0].creator_id, 'user_pat', 'the paid account, not the uploader');
  assert.equal(out.lines[0].split, false);
  assert.equal(out.lines[0].segmentPayee, 'user_pat');
  assert.equal(out.lines[0].note, 'Night Shift · 20 ads · October 2026', 'no day range on a whole month');
});

t('a month that spans a change of paid account: one line per account, by the day the ad played', () => {
  // Oct 1–14 the uploader (the old rule), Oct 15–20 the show's owner, Oct 21–31 Pat.
  const who = (id, day) => (day < '2026-10-15' ? 'user_dee' : day <= '2026-10-20' ? 'user_mara' : 'user_pat');
  const rows = [
    { episode_id: 'e1', day: '2026-10-01', impressions: 100, credit_cents: 60 },
    { episode_id: 'e1', day: '2026-10-14', impressions: 100, credit_cents: 60 },
    { episode_id: 'e1', day: '2026-10-15', impressions: 50, credit_cents: 30 },
    { episode_id: 'e1', day: '2026-10-20', impressions: 50, credit_cents: 30 },
    { episode_id: 'e1', day: '2026-10-31', impressions: 10, credit_cents: 6 },
    { episode_id: 'e2', day: '2026-10-05', impressions: 10, credit_cents: 6 }
  ];
  const out = adShareLines({ rows, episodes: EPISODES, percent: 50, period: '2026-10', payeeOn: (id, day) => (id === 'e1' ? who(id, day) : 'user_mara') });
  const e1 = out.lines.filter((l) => l.episode_id === 'e1');
  assert.deepEqual(e1.map((l) => [l.creator_id, l.cents, l.units, l.split]), [['user_dee', 60, 200, true], ['user_mara', 30, 100, true], ['user_pat', 3, 10, true]]);
  assert.deepEqual(e1.map((l) => l.note), [
    'Night Shift · 200 ads · October 2026 (Oct 1–14)',
    'Night Shift · 100 ads · October 2026 (Oct 15–20)',
    'Night Shift · 10 ads · October 2026 (Oct 31)'
  ]);
  const e2 = out.lines.filter((l) => l.episode_id === 'e2');
  assert.equal(e2.length, 1);
  assert.equal(e2[0].split, false);
  assert.equal(out.totalCents, 96);
});

t('a payee paid twice in one month with someone else between: one line, the day ranges as runs', () => {
  // Mara Oct 15–19, Pat Oct 20–25 (then Pat steps down), Mara Oct 26–31.
  const who = (id, day) => (day >= '2026-10-20' && day <= '2026-10-25' ? 'user_pat' : 'user_mara');
  const rows = [
    { episode_id: 'e1', day: '2026-10-15', impressions: 10, credit_cents: 20 },
    { episode_id: 'e1', day: '2026-10-19', impressions: 10, credit_cents: 20 },
    { episode_id: 'e1', day: '2026-10-20', impressions: 10, credit_cents: 20 },
    { episode_id: 'e1', day: '2026-10-25', impressions: 10, credit_cents: 20 },
    { episode_id: 'e1', day: '2026-10-26', impressions: 10, credit_cents: 20 },
    { episode_id: 'e1', day: '2026-10-31', impressions: 10, credit_cents: 20 }
  ];
  const out = adShareLines({ rows, episodes: EPISODES, percent: 50, period: '2026-10', payeeOn: who });
  assert.deepEqual(out.lines.map((l) => [l.creator_id, l.cents, l.units]), [['user_mara', 40, 40], ['user_pat', 20, 20]]);
  assert.deepEqual(out.lines.map((l) => l.note), [
    'Night Shift · 40 ads · October 2026 (Oct 15–19, Oct 26–31)',
    'Night Shift · 20 ads · October 2026 (Oct 20–25)'
  ]);
});

t('a split month: an excluded (studio) segment and a segment with nobody earn nothing, the rest is credited', () => {
  const rows = [
    { episode_id: 'e1', day: '2026-10-03', impressions: 100, credit_cents: 60 },
    { episode_id: 'e1', day: '2026-10-18', impressions: 100, credit_cents: 60 },
    { episode_id: 'e1', day: '2026-10-28', impressions: 100, credit_cents: 60 }
  ];
  const payeeOn = (id, day) => (day < '2026-10-10' ? 'user_admin' : day < '2026-10-25' ? null : 'user_pat');
  const out = adShareLines({ rows, episodes: EPISODES, percent: 50, period: '2026-10', payeeOn }, { excludeCreators: new Set(['user_admin']) });
  assert.deepEqual(out.lines.map((l) => [l.creator_id, l.cents, l.split]), [['user_pat', 30, true]]);
  assert.deepEqual(out.skipped.map((x) => [x.episodeId, x.reason]), [['e1', 'creator excluded'], ['e1', 'no creator']]);
});

t('a podcast is skipped whole, split or not', () => {
  const rows = [
    { episode_id: 'e3', day: '2026-10-03', impressions: 100, credit_cents: 60 },
    { episode_id: 'e3', day: '2026-10-28', impressions: 100, credit_cents: 60 }
  ];
  const out = adShareLines({ rows, episodes: EPISODES, percent: 50, period: '2026-10', payeeOn: (id, day) => (day < '2026-10-15' ? 'user_a' : 'user_b') });
  assert.deepEqual(out.lines, []);
  assert.deepEqual(out.skipped, [{ episodeId: 'e3', reason: 'podcast' }]);
});

t('title ids are text slugs, not uuids (migration 117)', () => {
  // Every id the site makes: a title slug plus a stamp, a placeholder, an
  // older catalogue id, and a uuid (which fits too) — and the ids minted
  // before slice 1 for a name the slugger emptied ("-lx3k9a"), which must
  // keep opening.
  for (const id of ['night-bus-last-stop-lx3k9a', 'placeholder-movie-lx3k9a', 'cipher-lore', 'show-mh2x1', '0b9f3c2e-5a61-4d0e-9a7b-1c2d3e4f5a6b', 'Legacy_ID_1', '-lx3k9a', '_lx3k9a', 'x'.repeat(200)]) {
    assert.equal(isTitleId(id), true, id);
  }
  for (const id of ['', 'has space', 'semi;colon', 'slash/path', 'has/slash', '..', '../up', 'dot.ted', '%2e%2e', "o'brien", 'a"b', 'a,b', 'f(x)', 'café', 'x'.repeat(201), null, undefined, 42, ['night-bus']]) {
    assert.equal(isTitleId(id), false, String(id));
  }
});

t('lookback: the last finished month and the five before it, oldest first, across a year', () => {
  assert.equal(AD_SHARE_LOOKBACK_MONTHS, 6);
  assert.deepEqual(lookbackPeriods('2026-10'), ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10']);
  assert.deepEqual(lookbackPeriods('2026-02'), ['2025-09', '2025-10', '2025-11', '2025-12', '2026-01', '2026-02']);
  assert.deepEqual(lookbackPeriods('2026-01', 1), ['2026-01']);
  assert.deepEqual(lookbackPeriods('2026-01', 0), ['2026-01']);
  assert.deepEqual(lookbackPeriods('2026-13'), []);
  assert.deepEqual(lookbackPeriods(null), []);
  assert.equal(lookbackPeriods('2026-10', 100).length, 24);
});

t('the audit line: each month’s result', () => {
  assert.equal(adShareMonthWords({ period: '2026-05', available: true, inserted: 3, totalCents: 1234, creators: 2 }), '2026-05 $12.34 to 2 creators');
  assert.equal(adShareMonthWords({ period: '2026-06', available: true, inserted: 1, totalCents: 5, creators: 1 }), '2026-06 $0.05 to 1 creator');
  assert.equal(adShareMonthWords({ period: '2026-07', available: true, inserted: 0, alreadyCredited: 4 }), '2026-07 nothing new');
  assert.equal(adShareMonthWords({ period: '2026-08', available: true, inserted: 0, alreadyCredited: 0 }), '2026-08 no ad plays');
  assert.equal(adShareMonthWords({ period: '2026-09', error: 'it couldn’t finish' }), '2026-09 failed');
  assert.equal(adShareMonthWords({ period: '2026-11', skipped: 'period not over' }), '2026-11 not over');
  assert.equal(adShareMonthWords({ period: '2026-04', available: false }), '2026-04 no ad plays table');
  assert.equal(adShareAuditWords({ months: [{ period: '2026-09', error: 'x' }, { period: '2026-10', available: true, inserted: 2, totalCents: 200, creators: 2 }] }), 'ad share 2026-09 failed · 2026-10 $2.00 to 2 creators');
  // One month's answer (an older caller) reads the same way.
  assert.equal(adShareAuditWords({ period: '2026-10', available: true, inserted: 0, alreadyCredited: 1 }), 'ad share 2026-10 nothing new');
  assert.equal(adShareAuditWords(null), '');
  assert.equal(adShareAuditWords({ months: [] }), '');
});

console.log(`${n} passed`);
