// node scripts/test-ad-share.mjs — ad share (lib/adShareRules.js).
import assert from 'node:assert/strict';
import { adShareLines, normalizeAdSharePercent, periodDays, periodLabel, normalizeSurface } from '../lib/adShareRules.js';

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

console.log(`${n} passed`);
