// Keeping creators' work off the open web (2026-10-25): the robots.txt
// builder, the X-Robots-Tag value, the TDM file, the beta door's open
// paths, and the public-read rate limit. Run: node scripts/test-harvest.mjs
import assert from 'node:assert/strict';
import { buildRobotsTxt, robotsTag, tdmrepJson, AI_TRAINING_AGENTS, AI_SEARCH_AGENTS, ALLOWED_AGENTS, CONTENT_SIGNAL } from '../lib/robotsRules.js';
import { isOpenPath } from '../lib/privateBetaRules.js';
import { limitPublicRead } from '../lib/rateLimit.js';
import { corsOriginAllowed, applyCors } from '../lib/cors.js';

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log('ok', name);
}
async function testAsync(name, fn) {
  await fn();
  passed += 1;
  console.log('ok', name);
}

const origin = 'https://www.studiotapatv.site';
const beta = buildRobotsTxt({ privateBeta: true, origin });
const open = buildRobotsTxt({ privateBeta: false, origin });
const groups = (txt) => {
  const out = {};
  let current = null;
  for (const line of txt.split('\n')) {
    const m = /^User-agent: (.+)$/.exec(line);
    if (m) { current = m[1]; out[current] = []; continue; }
    if (current && /^(Allow|Disallow): /.test(line)) out[current].push(line);
  }
  return out;
};

test('beta: every AI crawler and everyone else is kept out', () => {
  const g = groups(beta);
  for (const agent of [...AI_TRAINING_AGENTS, ...AI_SEARCH_AGENTS]) assert.deepEqual(g[agent], ['Disallow: /'], agent);
  assert.deepEqual(g['*'], ['Disallow: /']);
  assert.ok(!beta.includes('Sitemap:'), 'no sitemap while shut');
  assert.ok(beta.includes(`Content-Signal: ${CONTENT_SIGNAL}`));
});

test('launch: AI crawlers still out, search and ad crawlers in, podcast feeds reachable', () => {
  const g = groups(open);
  for (const agent of ['GPTBot', 'ClaudeBot', 'CCBot', 'Google-Extended', 'Bytespider', 'PerplexityBot']) assert.deepEqual(g[agent], ['Disallow: /'], agent);
  for (const agent of ALLOWED_AGENTS) {
    assert.ok(g[agent], `${agent} has a group`);
    assert.ok(g[agent].includes('Allow: /api/podcasts/'), `${agent} may read the podcast RSS`);
    assert.ok(g[agent].includes('Disallow: /api/'), `${agent} stays off the JSON`);
    assert.ok(g[agent].includes('Disallow: /admin'), `${agent} stays off admin`);
    assert.ok(!g[agent].includes('Disallow: /'), `${agent} may crawl the site`);
  }
  assert.ok(g['*'].includes('Disallow: /api/') && !g['*'].includes('Disallow: /'));
  assert.ok(open.includes(`Sitemap: ${origin}/sitemap.xml`));
});

test('the AI groups come before the catch-all and name the ad crawlers Google reads separately', () => {
  assert.ok(open.indexOf('User-agent: GPTBot') < open.indexOf('User-agent: *'));
  assert.ok(ALLOWED_AGENTS.includes('Mediapartners-Google') && ALLOWED_AGENTS.includes('AdsBot-Google'));
});

test('X-Robots-Tag: noai always, noindex only while the door is shut', () => {
  assert.equal(robotsTag({ privateBeta: true }), 'noindex, nofollow, noai, noimageai');
  assert.equal(robotsTag({ privateBeta: false }), 'noai, noimageai');
});

test('tdmrep.json reserves the whole site and points at the policy', () => {
  assert.deepEqual(tdmrepJson(`${origin}/terms`), [{ location: '/', 'tdm-reservation': 1, 'tdm-policy': `${origin}/terms` }]);
});

test('the TDM file is reachable while the beta door is shut', () => {
  assert.equal(isOpenPath('/.well-known/tdmrep.json'), true);
  assert.equal(isOpenPath('/robots.txt'), true);
  assert.equal(isOpenPath('/sitemap.xml'), false);
  assert.equal(isOpenPath('/api/home-feed'), false);
});

function fakeRes() {
  const r = { statusCode: 200, headers: {}, body: null };
  r.setHeader = (k, v) => { r.headers[k] = v; };
  r.status = (code) => { r.statusCode = code; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
}

await testAsync('limitPublicRead: the budget is per user when signed in, per IP otherwise, and the 429 carries Retry-After', async () => {
  const req = { headers: { 'x-forwarded-for': '203.0.113.9, 10.0.0.1' }, socket: {} };
  const scope = `t${Date.now()}`;
  let res = fakeRes();
  assert.equal(await limitPublicRead(req, res, scope, { max: 2, windowSeconds: 60 }), true);
  assert.equal(await limitPublicRead(req, res, scope, { max: 2, windowSeconds: 60 }), true);
  res = fakeRes();
  assert.equal(await limitPublicRead(req, res, scope, { max: 2, windowSeconds: 60 }), false);
  assert.equal(res.statusCode, 429);
  assert.equal(res.headers['Retry-After'], '60');
  assert.match(res.body.error, /Slow down/);
  // A signed-in member on the same IP has their own budget.
  res = fakeRes();
  assert.equal(await limitPublicRead(req, res, scope, { max: 2, windowSeconds: 60, userId: 'user_a' }), true);
  // Another scope is another budget.
  res = fakeRes();
  assert.equal(await limitPublicRead(req, res, `${scope}-b`, { max: 1, windowSeconds: 60 }), true);
});

test('CORS: the site, this deployment, named extras and (outside production) localhost may read the API; nobody else', () => {
  const prod = { production: true, env: {} };
  assert.equal(corsOriginAllowed('https://www.studiotapatv.site', prod), true);
  assert.equal(corsOriginAllowed('https://studiotapatv.site', prod), true);
  assert.equal(corsOriginAllowed('https://evil.example', prod), false);
  assert.equal(corsOriginAllowed('https://www.studiotapatv.site.evil.example', prod), false);
  assert.equal(corsOriginAllowed('http://www.studiotapatv.site', prod), false, 'http is not the site');
  assert.equal(corsOriginAllowed(undefined, prod), false);
  assert.equal(corsOriginAllowed('null', prod), false);
  assert.equal(corsOriginAllowed('http://localhost:8081', prod), false, 'localhost only while developing');
  assert.equal(corsOriginAllowed('http://localhost:8081', { production: false, env: {} }), true);
  assert.equal(corsOriginAllowed('http://127.0.0.1:3000', { production: false, env: {} }), true);
  assert.equal(corsOriginAllowed('https://taprino-abc123-jose.vercel.app', prod), false, 'another Vercel app is not us');
  assert.equal(corsOriginAllowed('https://taprino-abc123-jose.vercel.app', { production: true, env: { VERCEL_URL: 'taprino-abc123-jose.vercel.app' } }), true, 'this deployment is');
  assert.equal(corsOriginAllowed('https://partner.example', { production: true, env: { CORS_EXTRA_ORIGINS: 'https://partner.example, https://two.example' } }), true);
  assert.equal(corsOriginAllowed('https://two.example', { production: true, env: { CORS_EXTRA_ORIGINS: 'https://partner.example, https://two.example' } }), true);
});

test('applyCors echoes an allowed origin with Vary and sets nothing otherwise', () => {
  let res = fakeRes();
  applyCors({ headers: { origin: 'https://www.studiotapatv.site' } }, res);
  assert.equal(res.headers['Access-Control-Allow-Origin'], 'https://www.studiotapatv.site');
  assert.equal(res.headers.Vary, 'Origin');
  res = fakeRes();
  applyCors({ headers: { origin: 'https://evil.example' } }, res);
  assert.deepEqual(res.headers, {});
  res = fakeRes();
  applyCors({ headers: {} }, res);
  assert.deepEqual(res.headers, {}, 'the native app sends no Origin and needs no header');
});

console.log(`${passed} passed`);
