// node scripts/test-app-return.mjs — the way back to the app after a
// Stripe page (lib/appReturn.js, 2026-11-13) and the app's copy
// (mobile/src/lib/appReturn.js): the copy is checked word for word, then
// every case runs on both. Then the route itself, /api/checkout-return,
// against a stand-in request and response.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as web from '../lib/appReturn.js';

const webSource = readFileSync(new URL('../lib/appReturn.js', import.meta.url), 'utf8');
const appSource = readFileSync(new URL('../mobile/src/lib/appReturn.js', import.meta.url), 'utf8');
const app = await import(`data:text/javascript;base64,${Buffer.from(appSource).toString('base64')}`);

let n = 0;
const t = (name, fn) => { fn(); n += 1; console.log('ok', name); };

t('the app copy is the website file word for word', () => {
  assert.equal(appSource, webSource);
});

const ORIGIN = 'https://www.studiotapatv.site';
const GOOD = [
  'studiotapatv://checkout-return',
  'studiotapatv:///checkout-return',
  'exp://192.168.1.20:8081/--/checkout-return',
  'exp://u.expo.dev/217f9775-b623-406f-bbfa-54fbe11eeefa/--/checkout-return',
  'exp://u.expo.dev/update/0a1b2c3d-1111-2222-3333-444455556666/--/checkout-return',
  'exps://abc-anonymous-8081.exp.direct/--/checkout-return',
  'exp://u.expo.dev/217f9775/--/checkout-return?runtime-version=1.1.0&channel-name=preview'
];
const BAD = [
  null, undefined, '', 42, {},
  'https://evil.example/--/checkout-return',
  'http://www.studiotapatv.site/checkout-return',
  'javascript:alert(1)//checkout-return',
  'studiotapatv://somewhere-else',
  'studiotapatv://checkout-return/../admin',
  'otherapp://checkout-return',
  'exp://192.168.1.20:8081/--/elsewhere',
  'exp://evil.example/--/checkout-return#frag',
  'exp://u.expo.dev/x/--/checkout-return?a=<script>',
  'exp://u.expo.dev/x/--/checkout-return?a=b c',
  'exp://user@host/--/checkout-return',
  `exp://u.expo.dev/${'a'.repeat(420)}/--/checkout-return`,
  'studiotapatv://checkout-return\nLocation: https://evil.example'
];

for (const [label, lib] of [['web', web], ['app', app]]) {
  t(`${label}: the app's own addresses are accepted`, () => {
    for (const u of GOOD) assert.equal(lib.appReturnUrl(u), u, u);
  });
  t(`${label}: anything else is refused`, () => {
    for (const u of BAD) assert.equal(lib.appReturnUrl(u), null, String(u));
  });
  t(`${label}: checkoutReturns sends Stripe to our own page, both ways`, () => {
    const app1 = 'exp://192.168.1.20:8081/--/checkout-return';
    const r = lib.checkoutReturns({ origin: ORIGIN, app: app1, kind: 'tip', id: 'b1d0c1e2-0000-4000-8000-000000000001' });
    assert.ok(r);
    for (const [which, status] of [['success', 'paid'], ['cancel', 'cancelled']]) {
      const u = new URL(r[which]);
      assert.equal(u.origin, ORIGIN);
      assert.equal(u.pathname, '/api/checkout-return');
      assert.equal(u.searchParams.get('app'), app1);
      assert.equal(u.searchParams.get('kind'), 'tip');
      assert.equal(u.searchParams.get('status'), status);
      assert.equal(u.searchParams.get('id'), 'b1d0c1e2-0000-4000-8000-000000000001');
    }
  });
  t(`${label}: no app address, a bad one, or a bad origin → null (the website pages stay)`, () => {
    assert.equal(lib.checkoutReturns({ origin: ORIGIN, app: null, kind: 'tip', id: 'x' }), null);
    assert.equal(lib.checkoutReturns({ origin: ORIGIN, app: 'https://evil.example/--/checkout-return', kind: 'tip' }), null);
    assert.equal(lib.checkoutReturns({ origin: 'javascript:', app: GOOD[0], kind: 'tip' }), null);
    assert.equal(lib.checkoutReturns({ origin: `${ORIGIN}/path`, app: GOOD[0], kind: 'tip' }), null);
  });
  t(`${label}: unknown kinds, statuses and odd ids are left out`, () => {
    const u = new URL(lib.bounceUrl(ORIGIN, GOOD[0], { kind: 'steal', status: 'owned', id: 'a b' }));
    assert.equal(u.searchParams.get('kind'), null);
    assert.equal(u.searchParams.get('status'), null);
    assert.equal(u.searchParams.get('id'), null);
    assert.equal(u.searchParams.get('app'), GOOD[0]);
  });
  t(`${label}: appReturnHref joins onto an address that already has a query`, () => {
    assert.equal(lib.appReturnHref(GOOD[0], { kind: 'tip', status: 'paid', id: 'abc' }), 'studiotapatv://checkout-return?kind=tip&status=paid&id=abc');
    assert.equal(lib.appReturnHref(GOOD[6], { kind: 'membership', status: 'paid' }), `${GOOD[6]}&kind=membership&status=paid`);
    assert.equal(lib.appReturnHref('https://evil.example', { kind: 'tip' }), null);
  });
  t(`${label}: the round trip reads back what happened`, () => {
    for (const base of GOOD) {
      const href = lib.appReturnHref(base, { kind: 'purchase', status: 'cancelled', id: 'p-1' });
      assert.deepEqual(lib.readCheckoutReturn(href), { kind: 'purchase', status: 'cancelled', id: 'p-1' }, base);
    }
    // Expo Go hands the router the path alone.
    assert.deepEqual(lib.readCheckoutReturn('/checkout-return?kind=tip&status=paid&id=t1'), { kind: 'tip', status: 'paid', id: 't1' });
    assert.deepEqual(lib.readCheckoutReturn('/checkout-return'), { kind: null, status: null, id: null });
    assert.equal(lib.readCheckoutReturn('exp://192.168.1.20:8081/--/somewhere?status=paid'), null);
    assert.equal(lib.readCheckoutReturn(null), null);
    // Odd values never come through.
    assert.deepEqual(lib.readCheckoutReturn('studiotapatv://checkout-return?status=%E0%A4%A&kind=tip'), { kind: 'tip', status: null, id: null });
  });
  t(`${label}: isCheckoutReturnPath knows the router's forms and nothing else`, () => {
    for (const p of ['/checkout-return', 'checkout-return', '/checkout-return?kind=tip', 'studiotapatv://checkout-return?x=1', 'exp://u.expo.dev/a/--/checkout-return?b=c', ...GOOD]) {
      assert.equal(lib.isCheckoutReturnPath(p), true, p);
    }
    for (const p of ['/', '/episode/abc', '/checkout-returns', '/x/checkout-return', 'hosted-auth-callback', 'exp://u.expo.dev/a/--/hosted-auth-callback', null]) {
      assert.equal(lib.isCheckoutReturnPath(p), false, String(p));
    }
  });
}

// The route: a stand-in request and response. Its import has no
// extension (Next resolves it); point it at the file for Node.
const routeSource = readFileSync(new URL('../pages/api/checkout-return.js', import.meta.url), 'utf8')
  .replace("'../../lib/appReturn'", `'${new URL('../lib/appReturn.js', import.meta.url).href}'`);
const { default: handler } = await import(`data:text/javascript;base64,${Buffer.from(routeSource).toString('base64')}`);
function run(method, query) {
  const res = {
    statusCode: 200, headers: {}, ended: false,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    writeHead(code, h) { this.statusCode = code; for (const [k, v] of Object.entries(h || {})) this.headers[k.toLowerCase()] = v; return this; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; this.ended = true; return this; },
    end() { this.ended = true; return this; }
  };
  handler({ method, query }, res);
  return res;
}
t('route: an app address is followed with what happened', () => {
  const r = run('GET', { app: GOOD[2], kind: 'tip', status: 'paid', id: 'abc' });
  assert.equal(r.statusCode, 302);
  assert.equal(r.headers.location, `${GOOD[2]}?kind=tip&status=paid&id=abc`);
  assert.equal(r.headers['cache-control'], 'private, no-store');
});
t('route: anything else goes home', () => {
  for (const app of ['https://evil.example/', '//evil.example', 'javascript:alert(1)', undefined]) {
    const r = run('GET', { app, kind: 'tip', status: 'paid' });
    assert.equal(r.statusCode, 302);
    assert.equal(r.headers.location, '/');
  }
  const twice = run('GET', { app: ['https://evil.example/', GOOD[0]] });
  assert.equal(twice.headers.location, '/');
});
t('route: only GET and HEAD', () => {
  assert.equal(run('POST', { app: GOOD[0] }).statusCode, 405);
  assert.equal(run('HEAD', { app: GOOD[0] }).statusCode, 302);
});

console.log(`\n${n} checks passed`);
