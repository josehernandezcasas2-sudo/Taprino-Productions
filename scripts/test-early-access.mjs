// node scripts/test-early-access.mjs — early screenings (lib/earlyAccess.js).
import assert from 'node:assert/strict';
import { earlyAccessState, releaseTime, formatOpensAt, appliesTo, EARLY_ACCESS_HOURS } from '../lib/earlyAccess.js';

let n = 0;
const t = (name, fn) => { fn(); n += 1; console.log('ok', name); };
const H = 60 * 60 * 1000;
const now = Date.parse('2026-10-23T18:00:00Z');
const ago = (hours) => new Date(now - hours * H).toISOString();
const prem = (extra) => ({ tier: 'premium', contentType: 'movie', ...extra });

t('release time: the later of released_at and available_from, else created_at, else nothing', () => {
  assert.equal(releaseTime({ releasedAt: ago(5), availableFrom: ago(2) }), now - 2 * H);
  assert.equal(releaseTime({ releasedAt: ago(2), availableFrom: ago(5) }), now - 2 * H);
  assert.equal(releaseTime({ createdAt: ago(3) }), now - 3 * H);
  assert.equal(releaseTime({ releasedAt: 'garbage', createdAt: ago(3) }), now - 3 * H);
  assert.equal(releaseTime({}), null);
  assert.equal(releaseTime(null), null);
});

t('only premium-tier, non-podcast titles get an early screening (Jose, 2026-10-23)', () => {
  assert.equal(appliesTo(prem()), true);
  assert.equal(appliesTo({ tier: 'free', contentType: 'movie' }), false);
  assert.equal(appliesTo({ tier: 'premium', contentType: 'podcast' }), false);
  assert.equal(appliesTo(null), false);
  assert.equal(earlyAccessState({ tier: 'free', contentType: 'short', releasedAt: ago(1) }, { tier: 'basic', now }).locked, false);
  assert.equal(earlyAccessState({ tier: 'free', contentType: 'short', releasedAt: ago(1) }, { tier: 'basic', now }).early, false);
  assert.equal(earlyAccessState({ tier: 'premium', contentType: 'podcast', releasedAt: ago(1) }, { tier: 'basic', now }).locked, false);
});

t('inside the window: Premium and Sponsor play, Standard and Basic wait', () => {
  const ep = prem({ releasedAt: ago(3) });
  assert.equal(earlyAccessState(ep, { tier: 'premium', now }).locked, false);
  assert.equal(earlyAccessState(ep, { tier: 'sponsor', now }).locked, false);
  assert.equal(earlyAccessState(ep, { tier: 'standard', now }).locked, true);
  assert.equal(earlyAccessState(ep, { tier: 'basic', now }).locked, true);
  assert.equal(earlyAccessState(ep, { now }).locked, true);
  const s = earlyAccessState(ep, { tier: 'standard', now });
  assert.equal(s.early, true);
  assert.equal(s.opensAt, new Date(now + (EARLY_ACCESS_HOURS - 3) * H).toISOString());
});

t('exempt: admins, the creator, buyers', () => {
  const ep = prem({ releasedAt: ago(1) });
  assert.equal(earlyAccessState(ep, { tier: 'basic', isAdmin: true, now }).locked, false);
  assert.equal(earlyAccessState(ep, { tier: 'basic', isCreator: true, now }).locked, false);
  assert.equal(earlyAccessState(ep, { tier: 'standard', owned: true, now }).locked, false);
  assert.equal(earlyAccessState(ep, { tier: 'basic', isAdmin: true, now }).early, true);
});

t('after the window, and before a scheduled release, nothing is locked here', () => {
  assert.deepEqual(earlyAccessState(prem({ releasedAt: ago(25) }), { tier: 'basic', now }), { early: false, locked: false, opensAt: null, releasedAt: ago(25) });
  assert.equal(earlyAccessState(prem({ releasedAt: ago(EARLY_ACCESS_HOURS) }), { tier: 'basic', now }).locked, false);
  assert.equal(earlyAccessState(prem({ releasedAt: ago(-2) }), { tier: 'basic', now }).locked, false);
  assert.equal(earlyAccessState(prem(), { tier: 'basic', now }).locked, false);
});

t('a scheduled window that opened an hour ago is an early screening even for an old row', () => {
  const ep = prem({ releasedAt: ago(200), availableFrom: ago(1), createdAt: ago(300) });
  assert.equal(earlyAccessState(ep, { tier: 'standard', now }).locked, true);
  assert.equal(earlyAccessState(ep, { tier: 'premium', now }).locked, false);
});

t('opens-at text is fixed to the studio clock', () => {
  assert.equal(formatOpensAt('2026-10-24T22:00:00Z'), 'Oct 24 at 3:00 PM PT');
  assert.equal(formatOpensAt(null), '');
});

console.log(`${n} passed`);
