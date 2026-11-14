#!/usr/bin/env node
// The rig's smoke check, with the rig up (start.sh):
//   1. HTTP: the main pages and their JSON routes, signed out, as Mara (a
//      creator) and as the admin; prints each status (and where a redirect
//      goes) and fails on any 5xx or a request that never answers.
//   2. Browser: a handful of pages in Chromium at 390 and 1280 wide,
//      reporting page errors (uncaught exceptions) and console errors.
//      Every request that isn't to the rig is aborted, so nothing reaches a
//      live service (Clerk's frontend script, fonts, Google's ad SDK).
//   node dev/test-rig/smoke.mjs [--http-only|--browser-only] [--base=http://127.0.0.1:3100]
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { PATHS, urls } from './lib/config.mjs';
import { loadKeys } from './lib/keys.mjs';
import { IDS, USERS } from './seed/catalogue.mjs';

const args = process.argv.slice(2);
const BASE = (args.find((a) => a.startsWith('--base=')) || `--base=${urls().next}`).slice(7);
const only = args.includes('--http-only') ? 'http' : args.includes('--browser-only') ? 'browser' : null;
const MINT = path.join(path.dirname(new URL(import.meta.url).pathname), 'mint-session.mjs');

const mint = (who) => JSON.parse(execFileSync(process.execPath, [MINT, ...(who ? [who] : ['--signed-out']), '--json'], { encoding: 'utf8' }));
const ROLES = { signedOut: mint(null), mara: mint(USERS.mara), admin: mint(USERS.admin) };

const PAGES = [
  '/',
  '/stream',
  `/series/${IDS.nightBus}`,
  `/episode/${IDS.film}`,
  `/episode/${IDS.nbS1E1}`,
  `/podcasts/${IDS.podcast}`,
  '/creator/dashboard',
  `/creator/show/${IDS.nightBus}`,
  '/admin',
  '/admin/shows',
  `/admin/shows/${IDS.nightBus}`,
  '/account',
  '/artist-support',
  '/profile/mara'
];

const APIS = [
  '/api/site-settings',
  '/api/my-role',
  '/api/home-feed',
  '/api/stream-feed',
  `/api/series-hub?id=${IDS.nightBus}`,
  `/api/episode-page?id=${IDS.film}`,
  `/api/episode-page?id=${IDS.nbS1E1}`,
  `/api/podcast-show?id=${IDS.podcast}`,
  '/api/creator/my-submissions',
  `/api/show/${IDS.nightBus}`,
  '/api/admin/review-queue',
  '/api/admin/shows',
  `/api/admin/show/${IDS.nightBus}`,
  '/api/account/dashboard-info',
  '/api/artist-support',
  '/api/profile?userId=mara',
  '/api/notifications'
];

async function hit(pathname, cookie, { page }) {
  const t0 = Date.now();
  try {
    const res = await fetch(`${BASE}${pathname}`, {
      redirect: 'manual',
      headers: { Cookie: cookie, Accept: page ? 'text/html,application/xhtml+xml' : 'application/json', 'User-Agent': 'studio-tapa-rig-smoke' },
      signal: AbortSignal.timeout(240000)
    });
    await res.arrayBuffer();
    const loc = res.headers.get('location');
    return { status: res.status, ms: Date.now() - t0, loc: loc ? loc.replace(BASE, '') : '' };
  } catch (err) {
    return { status: 0, ms: Date.now() - t0, loc: err.message };
  }
}

async function httpPass() {
  const rows = [];
  let bad = 0;
  for (const [kind, list] of [['page', PAGES], ['api', APIS]]) {
    for (const p of list) {
      const row = { path: p };
      for (const [role, s] of Object.entries(ROLES)) {
        const r = await hit(p, s.cookie, { page: kind === 'page' });
        row[role] = r;
        if (r.status === 0 || r.status >= 500) bad++;
      }
      rows.push(row);
      const cell = (r) => `${r.status || 'ERR'}${r.loc ? `→${r.loc.slice(0, 40)}` : ''}`.padEnd(28);
      console.log(`${p.padEnd(44)} ${cell(row.signedOut)} ${cell(row.mara)} ${cell(row.admin)}`);
    }
  }
  return { rows, bad };
}

function loadPlaywright() {
  const req = createRequire(import.meta.url);
  try {
    return req('playwright');
  } catch (err) {
    const root = execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim();
    return req(path.join(root, 'playwright'));
  }
}

const BROWSER_PAGES = [
  ['signedOut', '/'],
  ['signedOut', '/stream'],
  ['signedOut', `/series/${IDS.nightBus}`],
  ['signedOut', `/episode/${IDS.film}`],
  ['mara', '/creator/dashboard'],
  ['mara', `/creator/show/${IDS.nightBus}`],
  ['admin', '/admin/shows'],
  ['admin', `/admin/shows/${IDS.nightBus}`]
];

async function browserPass() {
  const { chromium } = loadPlaywright();
  const keys = loadKeys();
  // Trust exactly the Supabase stand-in's certificate (by its key), for
  // the few <img> tags that load Storage addresses directly.
  const browser = await chromium.launch({ args: [`--ignore-certificate-errors-spki-list=${keys.tls.spki}`] });
  const results = [];
  let bad = 0;
  const host = new URL(BASE).host;
  const local = (u) => {
    try {
      const h = new URL(u).hostname;
      return h === '127.0.0.1' || h === 'localhost' || u.startsWith('data:') || u.startsWith('blob:');
    } catch (err) {
      return true;
    }
  };
  for (const width of [390, 1280]) {
    for (const [role, p] of BROWSER_PAGES) {
      const ctx = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 800 }, ...(width === 390 ? { isMobile: true, hasTouch: true } : {}) });
      await ctx.addCookies(ROLES[role].cookies.map((c) => ({ name: c.name, value: c.value, url: `http://${host}` })));
      await ctx.route('**/*', (route) => (local(route.request().url()) ? route.continue() : route.abort()));
      const page = await ctx.newPage();
      const pageErrors = [];
      const consoleErrors = [];
      const resourceErrors = [];
      page.on('pageerror', (e) => pageErrors.push(String(e.message || e).split('\n')[0]));
      page.on('console', (m) => {
        if (m.type() !== 'error') return;
        const text = m.text();
        // A failed load logs a bare "Failed to load resource"; the response
        // and requestfailed listeners below say which, for the rig's own
        // hosts (the aborted non-rig requests are left out on purpose).
        if (/Failed to load resource|Clerk: Failed to load Clerk|clerk\.example\.com/i.test(text)) return;
        consoleErrors.push(text.split('\n')[0].slice(0, 200));
      });
      page.on('response', (r) => {
        if (r.status() >= 500 && local(r.url())) resourceErrors.push(`${r.status()} ${r.url().replace(BASE, '').slice(0, 120)}`);
      });
      page.on('requestfailed', (r) => {
        if (local(r.url())) resourceErrors.push(`failed ${r.url().replace(BASE, '').slice(0, 120)}: ${(r.failure() || {}).errorText || ''}`);
      });
      let status = 0;
      try {
        const res = await page.goto(`${BASE}${p}`, { waitUntil: 'load', timeout: 180000 });
        status = res ? res.status() : 0;
        await page.waitForTimeout(1500);
      } catch (err) {
        pageErrors.push(`navigation: ${err.message.split('\n')[0]}`);
      }
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth).catch(() => null);
      if (pageErrors.length || status >= 500 || status === 0) bad++;
      results.push({ width, role, path: p, status, pageErrors, consoleErrors, resourceErrors, overflow });
      console.log(`${String(width).padEnd(5)} ${role.padEnd(10)} ${p.padEnd(40)} ${String(status).padEnd(4)} page errors: ${pageErrors.length}${pageErrors.length ? ` (${pageErrors.slice(0, 2).join(' | ')})` : ''} · console errors: ${consoleErrors.length}${consoleErrors.length ? ` (${consoleErrors.slice(0, 2).join(' | ')})` : ''} · rig 5xx/failed loads: ${resourceErrors.length}${resourceErrors.length ? ` (${resourceErrors.slice(0, 2).join(' | ')})` : ''}${overflow > 0 ? ` · ${overflow}px horizontal overflow` : ''}`);
      await ctx.close();
    }
  }
  await browser.close();
  return { results, bad };
}

const report = { at: new Date().toISOString(), base: BASE };
let failed = 0;
if (only !== 'browser') {
  console.log(`\nHTTP (${BASE})${' '.repeat(Math.max(1, 30 - BASE.length))}signed out                   Mara                         admin`);
  const h = await httpPass();
  report.http = h.rows;
  failed += h.bad;
  console.log(h.bad ? `\nHTTP: ${h.bad} request(s) answered 5xx or not at all` : '\nHTTP: no 5xx');
}
if (only !== 'http') {
  console.log('\nBrowser (Chromium, non-rig hosts aborted)');
  const b = await browserPass();
  report.browser = b.results;
  failed += b.bad;
  console.log(b.bad ? `\nBrowser: ${b.bad} page(s) with page errors or a 5xx` : '\nBrowser: no page errors');
}
fs.mkdirSync(PATHS.state, { recursive: true });
const out = path.join(PATHS.state, 'smoke.json');
fs.writeFileSync(out, JSON.stringify(report, null, 2));
console.log(`\nfull report: ${out}`);
process.exit(failed ? 1 : 0);
