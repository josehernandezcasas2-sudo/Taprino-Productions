// node scripts/test-safety.mjs — the safety batch's pure rules (2026-10-26):
// the cross-site write guard (lib/cors.js) and two-step for the team
// (lib/adminTwoFactor.js).
import assert from 'node:assert/strict';
import { crossSiteWriteRefused } from '../lib/cors.js';
import { twoFactorRequired, adminTwoFactorState } from '../lib/adminTwoFactor.js';

let n = 0;
const t = (name, fn) => { fn(); n += 1; console.log('ok', name); };
const prod = { production: true, env: {} };
const site = 'www.studiotapatv.site';

t('cross-site writes: another website is refused, reads are not', () => {
  assert.equal(crossSiteWriteRefused({ method: 'POST', pathname: '/api/messages', origin: 'https://evil.example', host: site }, prod), true);
  assert.equal(crossSiteWriteRefused({ method: 'DELETE', pathname: '/api/watch-progress', origin: 'https://evil.example', host: site }, prod), true);
  assert.equal(crossSiteWriteRefused({ method: 'GET', pathname: '/api/messages', origin: 'https://evil.example', host: site }, prod), false);
  assert.equal(crossSiteWriteRefused({ method: 'POST', pathname: '/api/messages', origin: 'null', host: site }, prod), true);
  assert.equal(crossSiteWriteRefused({ method: 'POST', pathname: '/api/messages', origin: null, secFetchSite: 'cross-site' }, prod), true);
});

t('cross-site writes: our own pages, the app and Stripe pass', () => {
  assert.equal(crossSiteWriteRefused({ method: 'POST', pathname: '/api/messages', origin: `https://${site}`, host: site }, prod), false);
  assert.equal(crossSiteWriteRefused({ method: 'POST', pathname: '/api/messages', origin: 'https://studiotapatv.site', host: site }, prod), false);
  assert.equal(crossSiteWriteRefused({ method: 'POST', pathname: '/api/messages', origin: null, host: site }, prod), false, 'the native app sends no Origin');
  assert.equal(crossSiteWriteRefused({ method: 'POST', pathname: '/api/webhook', origin: 'https://evil.example', host: site }, prod), false);
  assert.equal(crossSiteWriteRefused({ method: 'POST', pathname: '/api/cron/creator-payouts', origin: 'https://evil.example', host: site }, prod), false);
  assert.equal(crossSiteWriteRefused({ method: 'POST', pathname: '/api/x', origin: 'https://tapa-git-x.vercel.app', host: site }, { production: true, env: { VERCEL_BRANCH_URL: 'tapa-git-x.vercel.app' } }), false);
  assert.equal(crossSiteWriteRefused({ method: 'POST', pathname: '/api/x', origin: 'http://localhost:3000', host: 'localhost:3000' }, { production: false, env: {} }), false);
});

t('two-step: off unless switched on; then a team role without it is blocked', () => {
  assert.equal(twoFactorRequired({}), false);
  assert.equal(twoFactorRequired({ ADMIN_REQUIRE_2FA: 'on' }), true);
  assert.equal(twoFactorRequired({ ADMIN_REQUIRE_2FA: 'off' }), false);
  assert.deepEqual(adminTwoFactorState({ twoFactorEnabled: false }, true, {}), { twoFactor: false, blocked: false });
  assert.deepEqual(adminTwoFactorState({ twoFactorEnabled: false }, true, { ADMIN_REQUIRE_2FA: 'on' }), { twoFactor: false, blocked: true });
  assert.deepEqual(adminTwoFactorState({ twoFactorEnabled: true }, true, { ADMIN_REQUIRE_2FA: 'on' }), { twoFactor: true, blocked: false });
  assert.deepEqual(adminTwoFactorState({ twoFactorEnabled: false }, false, { ADMIN_REQUIRE_2FA: 'on' }), { twoFactor: false, blocked: false }, 'a viewer is never blocked');
});

console.log(`${n} passed`);
