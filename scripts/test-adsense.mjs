// node scripts/test-adsense.mjs — where Google's display-ads script loads
// (lib/adsenseRules.js): public pages only, and never for a viewer whose
// plan is ad-free (Jose, 2026-11-13: "Premium members should not have the
// Google banner").
import assert from 'node:assert/strict';
import { adsenseAllowedOn, adsenseShown } from '../lib/adsenseRules.js';

let n = 0;
const t = (name, fn) => { fn(); n += 1; console.log('ok', name); };

t('public pages carry it, private ones never', () => {
  for (const p of ['/', '/stream', '/episode/[id]', '/series/[id]', '/podcasts/[id]', '/live', '/terms', '/privacy', '/profile/[userId]', '/pitches', '/crew', '/locations', '/locations/[id]']) {
    assert.equal(adsenseAllowedOn(p), true, p);
  }
  for (const p of ['/admin', '/admin/money', '/account', '/account/membership', '/creator/money', '/messages/[threadId]', '/screener/[token]', '/ad-plan/[episodeId]', '/locations/mine', '/productions/[id]/edit', '/welcome']) {
    assert.equal(adsenseAllowedOn(p), false, p);
  }
  assert.equal(adsenseAllowedOn(''), false);
  assert.equal(adsenseAllowedOn(undefined), false);
  assert.equal(adsenseAllowedOn('/administrator'), true, 'a prefix is a whole segment');
});

t('the error pages never carry it', () => {
  for (const p of ['/404', '/500', '/_error']) assert.equal(adsenseAllowedOn(p), false, p);
});

t('an ad-free plan never gets it, anyone else on a public page does', () => {
  assert.equal(adsenseShown({ pathname: '/stream' }), true, 'signed out');
  assert.equal(adsenseShown({ pathname: '/stream', adFree: false }), true, 'Basic or Standard');
  assert.equal(adsenseShown({ pathname: '/stream', adFree: true }), false, 'Premium, Sponsor, the team, comped, promo');
  assert.equal(adsenseShown({ pathname: '/episode/[id]', adFree: true }), false);
  assert.equal(adsenseShown({ pathname: '/account', adFree: false }), false, 'a private page stays private');
  assert.equal(adsenseShown({ pathname: '/404', adFree: false }), false);
  assert.equal(adsenseShown({}), false);
  assert.equal(adsenseShown({ pathname: '/stream', adFree: 'yes' }), true, 'only a real true counts as ad-free');
});

console.log(`\n${n} checks passed`);
