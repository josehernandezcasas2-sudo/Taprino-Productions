// Shared helpers for the rig's checks (dev/test-rig/checks/*.mjs): the app's
// address, signed-in sessions, JSON calls the way the website and the app
// make them, the database through psql, the fakes' hooks, a browser with
// every non-rig request aborted, and the ok/FAIL tally.
//
// Every check seeds what it needs with ids of its own (an `ck…` suffix) and
// removes it again in `finally`, so the seed the smoke check reads is left
// as it was.
import crypto from 'node:crypto';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { FAKE_KEYS, PORTS, HOST, urls } from '../lib/config.mjs';
import { loadKeys } from '../lib/keys.mjs';
import { signRS256 } from '../lib/jwt.mjs';
import { psqlExec, psqlRows } from '../lib/pg.mjs';

export { IDS, USERS, uidFor } from '../seed/catalogue.mjs';

// `localhost`, not 127.0.0.1: the app's allow-lists (lib/cors.js, Stripe's
// return addresses) know localhost outside production.
export const BASE = process.env.RIG_BASE || `http://localhost:${PORTS.next}`;
export const FAKES = urls();
export const RUN = crypto.randomBytes(3).toString('hex');

// ---- the tally ----------------------------------------------------------------
let passed = 0;
let failed = 0;
const failures = [];
export function ok(name, cond, detail = '') {
  if (cond) {
    passed += 1;
    console.log(`ok   ${name}`);
  } else {
    failed += 1;
    failures.push(name);
    console.log(`FAIL ${name}${detail ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 600)}` : ''}`);
  }
  return Boolean(cond);
}
export function section(title) {
  console.log(`\n# ${title}`);
}
export function finish(label) {
  console.log(`\n${label}: ${passed} ok, ${failed} FAIL${failures.length ? `\n  failed: ${failures.join('\n          ')}` : ''}`);
  process.exitCode = failed ? 1 : 0;
  return failed;
}
export async function runCheck(label, body) {
  try {
    await body();
  } catch (err) {
    ok(`${label} ran to the end`, false, err && err.stack ? err.stack.split('\n').slice(0, 4).join(' | ') : String(err));
  } finally {
    finish(label);
  }
}

// ---- sessions -------------------------------------------------------------------
// Every session carries the viewing terms (tapa_terms=1, lib/viewingTerms.js):
// a viewer with no age on file otherwise gets the "Confirm and watch" card
// in place of a rated title. `{ terms: false }` leaves it out.
export function session(userId, minutes = 60, { terms = true } = {}) {
  const keys = loadKeys();
  const now = Math.floor(Date.now() / 1000);
  const token = signRS256({ sub: userId, sid: `sess_rig_${userId}`, iat: now - 5, nbf: now - 10, exp: now + minutes * 60, iss: 'https://clerk.example.com', azp: `http://${HOST}:${PORTS.next}` }, keys.clerkPrivatePem, FAKE_KEYS.clerkKid);
  const devBrowser = `dvb_rig_${userId}`;
  return {
    userId,
    token,
    cookie: `__session=${token}; __client_uat=1700000000; __clerk_db_jwt=${devBrowser}${terms ? '; tapa_terms=1' : ''}`,
    cookies: [
      { name: '__session', value: token },
      { name: '__client_uat', value: '1700000000' },
      { name: '__clerk_db_jwt', value: devBrowser },
      ...(terms ? [{ name: 'tapa_terms', value: '1' }] : [])
    ]
  };
}
export const SIGNED_OUT = { userId: null, token: null, cookie: '__clerk_db_jwt=dvb_rig_signed_out; tapa_terms=1', cookies: [{ name: '__clerk_db_jwt', value: 'dvb_rig_signed_out' }, { name: 'tapa_terms', value: '1' }] };
export const SIGNED_OUT_NO_TERMS = { userId: null, token: null, cookie: '__clerk_db_jwt=dvb_rig_signed_out', cookies: [{ name: '__clerk_db_jwt', value: 'dvb_rig_signed_out' }] };

// ---- calling the app --------------------------------------------------------------
// who: a session (cookie, as the website sends it) or { bearer: session }
// (the app: Authorization: Bearer, no Origin, no cookie).
export async function call(pathname, { who = SIGNED_OUT, method = 'GET', body, bearer = false, headers = {}, accept = 'application/json', redirect = 'manual', timeout = 240000 } = {}) {
  const h = { Accept: accept, 'User-Agent': 'studio-tapa-rig-check', ...headers };
  if (bearer && who && who.token) h.Authorization = `Bearer ${who.token}`;
  else if (who && who.cookie) h.Cookie = who.cookie;
  if (body !== undefined) h['Content-Type'] = 'application/json';
  const res = await fetch(`${BASE}${pathname}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), redirect, signal: AbortSignal.timeout(timeout) });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (err) { json = null; }
  return { status: res.status, headers: res.headers, text, json };
}
export const page = (pathname, who = SIGNED_OUT) => call(pathname, { who, accept: 'text/html,application/xhtml+xml' });

// ---- the database ---------------------------------------------------------------------
export const sql = (text) => {
  const r = psqlExec(text);
  if (!r.ok) throw new Error(`psql: ${(r.stderr || '').trim().slice(0, 400)}`);
  return r;
};
export const rows = (text) => psqlRows(text);
export const q = (v) => (v === null || v === undefined ? 'null' : typeof v === 'number' || typeof v === 'boolean' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
export const qj = (v) => `${q(JSON.stringify(v))}::jsonb`;
export function insert(table, row) {
  const cols = Object.keys(row);
  const vals = cols.map((c) => {
    const v = row[c];
    if (v && typeof v === 'object' && !Array.isArray(v)) return qj(v);
    if (Array.isArray(v)) return table === 'episodes' && c === 'ad_break_seconds' ? `array[${v.map(Number).join(',')}]::int[]` : qj(v);
    return q(v);
  });
  sql(`insert into public.${table} (${cols.join(', ')}) values (${vals.join(', ')})`);
}
export const hasColumn = (table, column) => rows(`select 1 from information_schema.columns where table_schema = 'public' and table_name = ${q(table)} and column_name = ${q(column)}`).length > 0;
export const ago = (days) => new Date(Date.now() - days * 86400000).toISOString();

// ---- the fakes ------------------------------------------------------------------------
async function fakeJson(url, { method = 'GET', body, headers = {} } = {}) {
  const res = await fetch(url, { method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  try { return { status: res.status, json: JSON.parse(text) }; } catch (err) { return { status: res.status, json: null, text }; }
}
export const clerk = (p, opts) => fakeJson(`${FAKES.clerk}${p}`, opts);
export const stripeHook = (p, opts) => fakeJson(`${FAKES.stripe}${p}`, opts);
export const cloudflare = (p, opts) => fakeJson(`${FAKES.cloudflare}${p}`, opts);
// The fake Stripe's API, form-encoded like Stripe's.
export async function stripeApi(p, { method = 'GET', params = null } = {}) {
  const enc = (obj, prefix = '') => Object.entries(obj).flatMap(([k, v]) => {
    const key = prefix ? `${prefix}[${k}]` : k;
    if (v && typeof v === 'object') return enc(v, key);
    return [`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`];
  });
  const body = params && method !== 'GET' ? enc(params).join('&') : undefined;
  const res = await fetch(`${FAKES.stripe}/v1${p}${params && method === 'GET' ? `?${enc(params).join('&')}` : ''}`, { method, headers: { Authorization: `Bearer ${FAKE_KEYS.stripeSecret}`, ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) }, body });
  return { status: res.status, json: await res.json().catch(() => null) };
}

// The daily Stripe catch-up (lib/stripeCatchup.js, run by
// /api/cron/creator-reminders and Admin → Creator Share payouts' "Retry
// now") records every paid membership invoice in the fake's events list
// that member_payments lacks, once its event is an hour old. A check that
// deletes the rows its members' invoices made must make the fake forget
// those invoices' events too, or a later check's cron run records them
// again (for accounts that no longer exist, with pool lines for the seed's
// creators). `members`: account ids whose subscriptions' or customers'
// invoices go; `invoices`: invoice ids to add. → how many events went.
export async function forgetInvoiceEvents({ members = [], invoices = [] } = {}) {
  const who = new Set((members || []).filter(Boolean));
  const inv = new Set((invoices || []).filter(Boolean));
  const state = await stripeHook('/__state');
  const objs = (state.json && state.json.objects) || [];
  const subs = new Set(objs.filter((o) => o.object === 'subscription' && o.metadata && who.has(o.metadata.member)).map((o) => o.id));
  const custs = new Set(objs.filter((o) => o.object === 'customer' && o.metadata && who.has(o.metadata.clerkUserId)).map((o) => o.id));
  for (const o of objs) {
    if (o.object === 'invoice' && (subs.has(o.subscription) || custs.has(o.customer))) inv.add(o.id);
    // An event whose invoice lives only inside it (a check's /__event).
    if (o.object === 'event' && o.type === 'invoice.paid' && o.data && o.data.object) {
      const x = o.data.object;
      if (subs.has(x.subscription) || custs.has(x.customer) || (x.subscription_details && x.subscription_details.metadata && who.has(x.subscription_details.metadata.member))) inv.add(x.id);
    }
  }
  if (!inv.size) return 0;
  const r = await stripeHook('/__events/forget', { method: 'POST', body: { invoices: [...inv] } });
  return (r.json && r.json.forgotten) || 0;
}

// A fresh account of this run (the fake Clerk + its profile row), so a
// check's money, limits and lineups never meet another run's.
export async function newUser(tag, { role = null, firstName = null, createdDaysAgo = 60, displayName = null, handle = null } = {}) {
  const id = `user_rigck${tag}${RUN}`;
  const email = `${tag}-${RUN}@rig.example.com`;
  const r = await clerk('/__users', { method: 'POST', body: { id, email, firstName: firstName || tag, lastName: 'Check', username: `${tag}${RUN}`, role, createdDaysAgo } });
  if (r.status !== 200) throw new Error(`fake Clerk refused ${id}: ${r.status}`);
  insert('user_profiles', { user_id: id, display_name: displayName || `${firstName || tag} Check`, handle: handle || `${tag}${RUN}` });
  return { id, email, ...session(id) };
}
export async function removeUser(id) {
  sql(`delete from public.user_profiles where user_id = ${q(id)}`);
  await fetch(`${FAKES.clerk}/v1/users/${encodeURIComponent(id)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${FAKE_KEYS.clerkSecret}` } }).catch(() => {});
}

// ---- the browser -------------------------------------------------------------------------
export function playwright() {
  const req = createRequire(import.meta.url);
  try {
    return req('playwright');
  } catch (err) {
    const root = execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim();
    return req(path.join(root, 'playwright'));
  }
}
const local = (u) => {
  try {
    const h = new URL(u).hostname;
    return h === '127.0.0.1' || h === 'localhost' || u.startsWith('data:') || u.startsWith('blob:');
  } catch (err) {
    return true;
  }
};
// → { browser, open(who, width) → { ctx, page, errors } }
export async function browser() {
  const { chromium } = playwright();
  const keys = loadKeys();
  const b = await chromium.launch({ args: [`--ignore-certificate-errors-spki-list=${keys.tls.spki}`] });
  async function open(who = SIGNED_OUT, width = 1280) {
    const phone = width < 700;
    const ctx = await b.newContext({ viewport: { width, height: phone ? 844 : 900 }, ...(phone ? { isMobile: true, hasTouch: true } : {}) });
    await ctx.addCookies((who || SIGNED_OUT).cookies.map((c) => ({ name: c.name, value: c.value, url: BASE })));
    await ctx.route('**/*', (route) => (local(route.request().url()) ? route.continue() : route.abort()));
    const pg = await ctx.newPage();
    const errors = [];
    // Clerk's frontend script lives on clerk.example.com, which the rig
    // aborts (README: "Not covered: Clerk's frontend"); a page that waits on
    // Clerk logs that as an uncaught rejection. Anything else counts.
    pg.on('pageerror', (e) => {
      const line = String(e.message || e).split('\n')[0];
      if (/Clerk: Failed to load Clerk/.test(line)) return;
      errors.push(line);
    });
    return { ctx, page: pg, errors };
  }
  return { browser: b, open, close: () => b.close() };
}
export async function goto(pg, pathname) {
  const res = await pg.goto(`${BASE}${pathname}`, { waitUntil: 'load', timeout: 180000 });
  await pg.waitForTimeout(800);
  return res ? res.status() : 0;
}
export const overflowPx = (pg) => pg.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
