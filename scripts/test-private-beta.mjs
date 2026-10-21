// node scripts/test-private-beta.mjs — the door's pure rules (lib/privateBetaRules.js).
import assert from 'node:assert/strict';
import { privateBetaOn, isOpenPath, doorPath, safeNext } from '../lib/privateBetaRules.js';

let n = 0;
const t = (name, fn) => { fn(); n += 1; console.log('ok', name); };

t('the switch', () => {
  assert.equal(privateBetaOn({}), false);
  assert.equal(privateBetaOn({ PRIVATE_BETA: '' }), false);
  assert.equal(privateBetaOn({ PRIVATE_BETA: 'off' }), false);
  assert.equal(privateBetaOn({ PRIVATE_BETA: 'on' }), true);
  assert.equal(privateBetaOn({ PRIVATE_BETA: ' ON ' }), true);
  assert.equal(privateBetaOn({ PRIVATE_BETA: '1' }), true);
});

t('open pages and API routes', () => {
  for (const p of ['/welcome', '/apply', '/terms', '/privacy', '/cookies', '/about', '/contact', '/robots.txt']) assert.equal(isOpenPath(p), true, p);
  for (const p of ['/', '/stream', '/episode/x', '/profile/mara', '/admin', '/admin/invites', '/account', '/sitemap.xml', '/welcome2', '/applyx']) assert.equal(isOpenPath(p), false, p);
  for (const p of ['/api/webhook', '/api/cron/creator-payouts', '/api/site-settings', '/api/manifest', '/api/beta/request', '/api/apply', '/api/newsletter-signup', '/api/my-role', '/api/ratings', '/api/player-icons']) assert.equal(isOpenPath(p), true, p);
  for (const p of ['/api/home-feed', '/api/stream-token', '/api/admin/invites', '/api/webhooks', '/api/cron', '/api/applyx', '/api/beta/other']) assert.equal(isOpenPath(p), false, p);
});

t('the door keeps the page wanted, never an outside one', () => {
  assert.equal(doorPath('/', ''), '/welcome');
  assert.equal(doorPath('/welcome', '?x=1'), '/welcome');
  assert.equal(doorPath('/stream', ''), '/welcome?next=%2Fstream');
  assert.equal(doorPath('/profile/mara', '?via=mara'), '/welcome?next=%2Fprofile%2Fmara%3Fvia%3Dmara');
  assert.equal(safeNext('/stream'), '/stream');
  assert.equal(safeNext('/profile/mara?via=mara'), '/profile/mara?via=mara');
  assert.equal(safeNext('//evil.example'), '/');
  assert.equal(safeNext('https://evil.example'), '/');
  assert.equal(safeNext('/welcome?next=%2Fstream'), '/');
  assert.equal(safeNext(undefined), '/');
  assert.equal(safeNext(['/a']), '/');
});

console.log(`${n} passed`);
