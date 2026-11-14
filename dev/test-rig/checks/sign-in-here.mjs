#!/usr/bin/env node
// Signing in or signing up in the middle of something keeps the person
// where they were and picks the thing back up (Jose, 2026-11-14: "i want
// them to be able to sign up and sign in but maintain within what they
// were doing"; lib/resumeTaskRules.js, lib/resumeTask.js,
// components/SignInHere.js).
//
// The rig doesn't serve Clerk's frontend, so this check serves a stand-in
// at its address that only records what the site asks it to open. What
// Clerk then does with those props is its own code, read on 2026-11-14 in
// the library the site loads (@clerk/clerk-js major 5: 5.128.2) and in
// the next major (6.43.1): a force redirect given as a prop wins over
// everything, for the sign-in and for the sign-up outcome alike; with
// nothing given, a box opened over a page ends on that page unless a
// redirect is set in Clerk's own settings.
//
//   1. A button mid-task (Tip, Own, See plans, "Sign in to post a call")
//      hands Clerk the page the person is on for both outcomes, and Tip,
//      Own and the plans leave a mark.
//   2. Back on that page signed in, the task carries on once: the Tip
//      sheet opens, Checkout is asked for, the plans open. A reload does
//      not repeat it; a mark that is too old or for another page is
//      never taken.
//   3. The general ways in (the account page's card) still say where a
//      sign-in lands: /signed-in, which sends a creator to the Dashboard.
//
//   node dev/test-rig/checks/sign-in-here.mjs
import { IDS, USERS, SIGNED_OUT, BASE, ok, section, runCheck, session, browser, goto, rows, q, sql } from './lib.mjs';

const VIEWER = session(USERS.viewer);

// Clerk's browser library, as far as the site's provider needs it: it
// loads, says nobody is signed in, and writes down what it is asked to open.
const FAKE_CLERK = `
(() => {
  window.__clerkCalls = window.__clerkCalls || [];
  const nobody = { client: { sessions: [], signedInSessions: [], signIn: {}, signUp: {} }, session: null, user: null, organization: null };
  const base = {
    version: '5.0.0-rig', loaded: false, status: 'ready', telemetry: undefined, ...nobody,
    load: async function () { this.loaded = true; },
    addListener(cb) { try { cb(nobody); } catch (e) {} return () => {}; },
    on() {}, off() {},
    openSignIn(props) { window.__clerkCalls.push({ kind: 'openSignIn', props: props || {} }); },
    openSignUp(props) { window.__clerkCalls.push({ kind: 'openSignUp', props: props || {} }); },
    closeSignIn() {}, closeSignUp() {}
  };
  window.Clerk = new Proxy(base, { get(t, k) { if (k in t) return t[k]; if (k === 'then') return undefined; return () => undefined; } });
})();
`;

async function open(b, who, width = 1280) {
  const o = await b.open(who, width);
  await o.ctx.route('**/clerk.browser.js*', (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: FAKE_CLERK }));
  return o;
}
// The site's provider has taken the stand-in in (a click before that is
// kept and replayed, but the checks read the calls right after a click).
const clerkReady = (pg) => pg.waitForFunction(() => window.Clerk && window.Clerk.loaded === true, null, { timeout: 30000 });
const calls = (pg) => pg.evaluate(() => window.__clerkCalls || []);
const mark = (pg) => pg.evaluate(() => { try { return JSON.parse(window.sessionStorage.getItem('tapa_resume')); } catch { return null; } });
const signIn = (ctx, who) => ctx.addCookies(who.cookies.map((c) => ({ name: c.name, value: c.value, url: BASE })));
const pick = (props) => ({ forceRedirectUrl: props.forceRedirectUrl, signUpForceRedirectUrl: props.signUpForceRedirectUrl, signInForceRedirectUrl: props.signInForceRedirectUrl, redirectUrl: props.redirectUrl });
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

await runCheck('sign-in-here', async () => {
  // The viewer starts with nothing bought, so Own is on offer.
  const owned = rows(`select id from public.purchases where buyer_id = ${q(USERS.viewer)} and target_id in (${q(IDS.nightBus)}, ${q(IDS.nbS1E3)}) and status = 'completed'`);
  const b = await browser();
  try {
    // ---- 1 + 2. Tip ----------------------------------------------------------------
    section('1. Tip: the box is told this page, and the sheet opens once signed in');
    const tipPath = `/episode/${IDS.nbS1E1}?autoplay=1`;
    const a = await open(b, SIGNED_OUT);
    await goto(a.page, tipPath);
    await clerkReady(a.page);
    const tipBtn = a.page.locator('.ep-action-tip');
    ok('a signed-out viewer sees the Tip action', (await tipBtn.count()) === 1);
    await tipBtn.click();
    await a.page.waitForFunction(() => (window.__clerkCalls || []).length > 0, null, { timeout: 10000 });
    const tipCalls = await calls(a.page);
    ok('Tip opens the sign-in box, once', tipCalls.length === 1 && tipCalls[0].kind === 'openSignIn', JSON.stringify(tipCalls));
    ok('…told to end on this page whether they sign in or create an account', same(pick(tipCalls[0].props), { forceRedirectUrl: tipPath, signUpForceRedirectUrl: tipPath }), JSON.stringify(tipCalls[0].props));
    const tipMark = await mark(a.page);
    ok('…and the tip is remembered for this page', tipMark && tipMark.task === `tip:${USERS.mara}` && tipMark.path === `/episode/${IDS.nbS1E1}` && Math.abs(Date.now() - tipMark.at) < 60000, JSON.stringify(tipMark));
    ok('no sheet yet', (await a.page.locator('.tip-modal').count()) === 0);

    // Clerk lands them on the page it was told, signed in.
    await signIn(a.ctx, VIEWER);
    await goto(a.page, tipPath);
    await a.page.waitForSelector('.tip-modal', { timeout: 20000 }).catch(() => {});
    ok('back on the page signed in, the Tip sheet opens by itself', await a.page.locator('.tip-modal').isVisible().catch(() => false));
    ok('…one sheet, though the page has more than one Tip button', (await a.page.locator('.tip-modal').count()) === 1);
    ok('…and the mark is used up', (await mark(a.page)) === null);
    await goto(a.page, tipPath);
    await a.page.waitForTimeout(1500);
    ok('a reload doesn’t open it again', (await a.page.locator('.tip-modal').count()) === 0);

    section('2. a mark that is old, or for another page, is never taken');
    await a.page.evaluate(([creator, path]) => window.sessionStorage.setItem('tapa_resume', JSON.stringify({ task: `tip:${creator}`, path, at: Date.now() - 16 * 60000 })), [USERS.mara, `/episode/${IDS.nbS1E1}`]);
    await goto(a.page, tipPath);
    await a.page.waitForTimeout(1500);
    ok('sixteen minutes old: no sheet, and the mark is thrown away', (await a.page.locator('.tip-modal').count()) === 0 && (await mark(a.page)) === null);
    await a.page.evaluate(([creator, path]) => window.sessionStorage.setItem('tapa_resume', JSON.stringify({ task: `tip:${creator}`, path, at: Date.now() })), [USERS.mara, `/episode/${IDS.nbS1E2}`]);
    await goto(a.page, tipPath);
    await a.page.waitForTimeout(1500);
    ok('left on another title: no sheet here, and it waits for its own page', (await a.page.locator('.tip-modal').count()) === 0 && ((await mark(a.page)) || {}).path === `/episode/${IDS.nbS1E2}`);
    await a.page.evaluate(() => window.sessionStorage.removeItem('tapa_resume'));
    ok('no page errors', a.errors.length === 0, a.errors.join(' | '));
    await a.ctx.close();

    // ---- Own ----------------------------------------------------------------------
    section('3. Own: Checkout starts once signed in');
    const ownPath = `/series/${IDS.nightBus}`;
    const o = await open(b, SIGNED_OUT);
    await goto(o.page, ownPath);
    await clerkReady(o.page);
    const ownBtn = o.page.locator('.own-compact-btn').first();
    ok('the series page offers the whole series', owned.length === 0 && (await ownBtn.count()) === 1, `${owned.length} owned already`);
    await ownBtn.click();
    await o.page.waitForFunction(() => (window.__clerkCalls || []).length > 0, null, { timeout: 10000 });
    const ownCalls = await calls(o.page);
    ok('Own opens the sign-in box told to end on this page either way', ownCalls.length === 1 && ownCalls[0].kind === 'openSignIn' && same(pick(ownCalls[0].props), { forceRedirectUrl: ownPath, signUpForceRedirectUrl: ownPath }), JSON.stringify(ownCalls));
    const ownMark = await mark(o.page);
    ok('…and the purchase is remembered', ownMark && ownMark.task === `buy:series:${IDS.nightBus}` && ownMark.path === ownPath, JSON.stringify(ownMark));
    await signIn(o.ctx, VIEWER);
    // Checkout is asked for, not opened: the answer is held back.
    let asked = null;
    await o.page.route('**/api/purchases/checkout', async (route) => {
      asked = route.request().postDataJSON();
      await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'Held by the check.' }) });
    });
    await goto(o.page, ownPath);
    await o.page.waitForFunction(() => window.sessionStorage.getItem('tapa_resume') === null, null, { timeout: 20000 }).catch(() => {});
    await o.page.waitForTimeout(800);
    ok('back on the page signed in, Checkout is asked for that title', asked && asked.type === 'series' && asked.id === IDS.nightBus && asked.returnTo === ownPath, JSON.stringify(asked));
    asked = null;
    await goto(o.page, ownPath);
    await o.page.waitForTimeout(1500);
    ok('a reload doesn’t ask again', asked === null, JSON.stringify(asked));
    await o.ctx.close();

    // ---- the paywall ----------------------------------------------------------------
    section('4. See plans: the plans open once signed in');
    const locked = rows(`select id from public.episodes where tier = 'premium' and status = 'approved' and moderation_hold = false and series_id = ${q(IDS.nightBus)} and withdrawn_at is null order by season, series_order limit 1`)[0];
    if (!locked) {
      ok('the seed has a Tapa + episode to check the paywall with', false);
    } else {
      const lockPath = `/episode/${locked.id}?autoplay=1`;
      const p = await open(b, SIGNED_OUT);
      await goto(p.page, lockPath);
      await clerkReady(p.page);
      const plans = p.page.locator('button.unlock-btn', { hasText: 'See plans' }).first();
      ok('a signed-out viewer of a Tapa + title sees See plans', (await plans.count()) === 1);
      await plans.click();
      await p.page.waitForFunction(() => (window.__clerkCalls || []).length > 0, null, { timeout: 10000 });
      const planCalls = await calls(p.page);
      ok('See plans opens the sign-in box told to end on this title either way', planCalls.length === 1 && planCalls[0].kind === 'openSignIn' && same(pick(planCalls[0].props), { forceRedirectUrl: lockPath, signUpForceRedirectUrl: lockPath }), JSON.stringify(planCalls));
      ok('…and the plans are remembered', ((await mark(p.page)) || {}).task === 'plans');
      await signIn(p.ctx, VIEWER);
      await goto(p.page, lockPath);
      await p.page.waitForURL('**/account/membership', { timeout: 30000 }).catch(() => {});
      ok('back on the title signed in and still locked, the plans open', new URL(p.page.url()).pathname === '/account/membership', p.page.url());
      await p.ctx.close();
    }

    // ---- SignInHere -------------------------------------------------------------------
    section('5. the other buttons mid-task');
    const s = await open(b, SIGNED_OUT);
    for (const [pathname, label] of [['/crew/calls?urgent=1', 'Sign in to post a call'], ['/locations', 'Sign in to list a place'], ['/productions', 'Sign in to start one']]) {
      await goto(s.page, pathname);
      await clerkReady(s.page);
      await s.page.evaluate(() => { window.__clerkCalls = []; });
      const btn = s.page.locator('button', { hasText: label }).first();
      if ((await btn.count()) === 0) { ok(`${pathname}: “${label}” is there`, false); continue; }
      await btn.click();
      await s.page.waitForFunction(() => (window.__clerkCalls || []).length > 0, null, { timeout: 10000 }).catch(() => {});
      const c = await calls(s.page);
      ok(`${pathname}: “${label}” ends on this page whether they sign in or create an account`, c.length === 1 && c[0].kind === 'openSignIn' && same(pick(c[0].props), { forceRedirectUrl: pathname, signUpForceRedirectUrl: pathname }), JSON.stringify(c.map((x) => pick(x.props))));
    }

    section('6. the general way in still lands a sign-in through /signed-in');
    await goto(s.page, '/account');
    await clerkReady(s.page);
    await s.page.evaluate(() => { window.__clerkCalls = []; });
    await s.page.locator('.account-btn-primary', { hasText: 'Sign in' }).click();
    await s.page.locator('.account-btn-secondary', { hasText: 'Create a free account' }).click();
    await s.page.waitForFunction(() => (window.__clerkCalls || []).length > 1, null, { timeout: 10000 }).catch(() => {});
    const acct = await calls(s.page);
    ok('Sign in: a sign-in goes through /signed-in, an account made from that box lands on the account page', acct[0] && acct[0].kind === 'openSignIn' && same(pick(acct[0].props), { forceRedirectUrl: '/signed-in?next=/account', signUpForceRedirectUrl: '/account' }), JSON.stringify(acct[0]));
    ok('Create a free account: the same two, the other way round', acct[1] && acct[1].kind === 'openSignUp' && same(pick(acct[1].props), { forceRedirectUrl: '/account', signInForceRedirectUrl: '/signed-in?next=/account' }), JSON.stringify(acct[1]));
    ok('no page errors', s.errors.length === 0, s.errors.join(' | '));
    await s.ctx.close();
  } finally {
    await b.close();
    sql('select 1');
  }
});
