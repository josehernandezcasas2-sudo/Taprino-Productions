#!/usr/bin/env node
// The admin side nav stays put while the page scrolls and scrolls only
// when it is scrolled itself (Jose, 2026-11-14, from a screenshot of the
// nav cut off at "Money": "it seems to stop right before reaching the end
// and the top until you keep scrolling. The goal is that when you scroll
// down the page, this stays the same until we scroll down on it").
//
//   1. A laptop (1280×700), where the nav has more rows than fit: its top
//      edge is the header's bottom edge and its bottom edge the bottom of
//      the screen, before and after the page is scrolled; scrolling the
//      page leaves the nav exactly where it was; a wheel on the nav scrolls
//      the nav and never the page, past both ends too; the last row can be
//      reached by scrolling the nav alone.
//   2. Its place is kept from one admin page to the next, and after a
//      reload; the page you are on is always in view.
//   3. A tall window where the nav fits whole: a wheel over it scrolls the
//      page, as anywhere else.
//   4. A narrow window and a phone: the chip strip is as it was (not
//      pinned), and the chip of the page you are on is in view.
//
//   node dev/test-rig/checks/admin-nav.mjs [--shots <dir>]
// Rig up, any migration.
import fs from 'node:fs';
import path from 'node:path';
import { USERS, ok, section, runCheck, session, browser, goto, overflowPx } from './lib.mjs';

const ADMIN = session(USERS.admin);
const shotsAt = process.argv.indexOf('--shots');
const SHOTS = shotsAt > -1 ? process.argv[shotsAt + 1] : null;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const shot = async (pg, name) => { if (SHOTS) await pg.screenshot({ path: path.join(SHOTS, `${name}.png`) }); };

const measure = (pg) => pg.evaluate(() => {
  const nav = document.querySelector('.adm-nav');
  const header = document.querySelector('header.channel-bar');
  const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { top: b.top, bottom: b.bottom, left: b.left, right: b.right, height: b.height }; };
  const links = [...nav.querySelectorAll('.adm-link')];
  const active = nav.querySelector('.adm-link.is-active');
  const first = nav.firstElementChild;
  const last = links[links.length - 1];
  const inside = (el) => { if (!el) return null; const a = el.getBoundingClientRect(); const n = nav.getBoundingClientRect(); return a.top >= n.top - 1 && a.bottom <= n.bottom + 1 && a.left >= n.left - 1 && a.right <= n.right + 1; };
  const onTop = (el) => { if (!el) return null; const a = el.getBoundingClientRect(); const hit = document.elementFromPoint(a.left + a.width / 2, a.top + a.height / 2); return Boolean(hit && (hit === el || el.contains(hit))); };
  return {
    nav: r(nav), header: r(header), viewH: window.innerHeight, viewW: window.innerWidth,
    position: getComputedStyle(nav).position, display: getComputedStyle(nav).display,
    scrolls: nav.hasAttribute('data-scrolls'), scrollTop: nav.scrollTop, scrollLeft: nav.scrollLeft,
    scrollMax: nav.scrollHeight - nav.clientHeight, scrollMaxX: nav.scrollWidth - nav.clientWidth,
    pageY: window.scrollY, pageRoom: document.documentElement.scrollHeight - window.innerHeight,
    rows: links.length, activeText: active ? active.textContent.trim() : null, activeInside: inside(active), activeOnTop: onTop(active),
    firstInside: inside(first), firstTop: first ? first.getBoundingClientRect().top : null,
    lastText: last ? last.textContent.trim() : null, lastInside: inside(last), lastOnTop: onTop(last)
  };
});

// Pinned under the header and ending at the bottom of the screen.
function pinned(label, m) {
  ok(`${label}: the nav's top edge is the header's bottom edge`, Math.abs(m.nav.top - m.header.bottom) <= 1, { navTop: m.nav.top, headerBottom: m.header.bottom });
  ok(`${label}: the nav ends on screen`, m.nav.bottom <= m.viewH + 1, { navBottom: m.nav.bottom, viewH: m.viewH });
}

async function laptop(b) {
  section('A laptop (1280×700): more rows than fit');
  const { ctx, page: pg, errors } = await b.open(ADMIN, 1280);
  await pg.setViewportSize({ width: 1280, height: 700 });
  await goto(pg, '/admin');
  await pg.locator('.adm-nav .adm-link').first().waitFor({ timeout: 30000 });
  // The rig's dashboard is nearly empty, so the page is only a little
  // taller than the nav and the nav would leave with it once the footer
  // came up. A real admin page (a library, a queue) is long: make it so.
  await pg.evaluate(() => { document.querySelector('.adm-main').style.minHeight = '3200px'; });
  await pg.waitForTimeout(400);
  let m = await measure(pg);
  ok('the nav is pinned (sticky) and lists the admin pages', m.position === 'sticky' && m.rows >= 20, { position: m.position, rows: m.rows });
  pinned('at the top of the page', m);
  ok('it has more rows than fit, and says so', m.scrolls && m.scrollMax > 100, { scrolls: m.scrolls, scrollMax: m.scrollMax });
  ok('its first row is in view, not under the header', m.firstInside && m.firstTop >= m.header.bottom - 1, { firstTop: m.firstTop, headerBottom: m.header.bottom });
  ok('the page behind is long enough to scroll', m.pageRoom > 200, m.pageRoom);
  await shot(pg, 'admin-nav-top');

  // Scrolling the page leaves the nav where it was.
  await pg.mouse.move(800, 420);
  await pg.mouse.wheel(0, 500);
  await pg.waitForTimeout(350);
  m = await measure(pg);
  ok('a wheel on the page scrolls the page', m.pageY > 100, m.pageY);
  pinned('with the page scrolled', m);
  ok('…and the nav has not moved a row', m.scrollTop === 0 && m.firstInside, { scrollTop: m.scrollTop, firstInside: m.firstInside });
  const pageY = m.pageY;
  await shot(pg, 'admin-nav-page-scrolled');

  // A wheel on the nav scrolls the nav, never the page.
  await pg.mouse.move(m.nav.left + 110, m.nav.top + 200);
  await pg.mouse.wheel(0, 240);
  await pg.waitForTimeout(300);
  m = await measure(pg);
  ok('a wheel on the nav scrolls the nav', m.scrollTop > 100, m.scrollTop);
  ok('…and the page stays where it was', m.pageY === pageY, { before: pageY, after: m.pageY });
  for (let i = 0; i < 14; i += 1) await pg.mouse.wheel(0, 500);
  await pg.waitForTimeout(350);
  m = await measure(pg);
  ok('past the end of the nav the page still does not move', m.pageY === pageY && Math.abs(m.scrollTop - m.scrollMax) <= 1, { pageY: m.pageY, scrollTop: m.scrollTop, scrollMax: m.scrollMax });
  ok(`the last row (${m.lastText}) is in view by scrolling the nav alone`, m.lastInside && m.lastOnTop, { lastInside: m.lastInside, lastOnTop: m.lastOnTop });
  pinned('with the nav at its end', m);
  await shot(pg, 'admin-nav-end');
  for (let i = 0; i < 14; i += 1) await pg.mouse.wheel(0, -500);
  await pg.waitForTimeout(350);
  m = await measure(pg);
  ok('past the top of the nav the page still does not move', m.pageY === pageY && m.scrollTop === 0, { pageY: m.pageY, scrollTop: m.scrollTop });

  // Its place is kept from one admin page to the next.
  section('The nav keeps its place between admin pages');
  await pg.evaluate(() => window.scrollTo(0, 0));
  await pg.mouse.move(m.nav.left + 110, m.nav.top + 200);
  for (let i = 0; i < 14; i += 1) await pg.mouse.wheel(0, 500);
  await pg.waitForTimeout(300);
  const before = await measure(pg);
  const lastHref = await pg.evaluate(() => { const l = [...document.querySelectorAll('.adm-nav .adm-link:not([target])')].filter((a) => !a.querySelector('.adm-ext')); return l[l.length - 1].getAttribute('href'); });
  await pg.locator(`.adm-nav .adm-link[href="${lastHref}"]`).click();
  await pg.waitForURL(`**${lastHref}`, { timeout: 60000 });
  await pg.locator('.adm-nav .adm-link.is-active').first().waitFor({ timeout: 30000 });
  await pg.waitForTimeout(500);
  m = await measure(pg);
  // (A few pixels either way: the badges load again and can change a row's height.)
  ok(`after opening ${lastHref} the nav is where it was scrolled to`, Math.abs(m.scrollTop - before.scrollTop) <= 24 && m.scrollTop > 100, { before: before.scrollTop, after: m.scrollTop });
  ok('…with that page’s row lit and in view', m.activeInside === true && m.activeOnTop === true, { active: m.activeText, inside: m.activeInside, onTop: m.activeOnTop });
  pinned('on the next page', m);
  await shot(pg, 'admin-nav-next-page');

  // After a reload too.
  await pg.reload({ waitUntil: 'load' });
  await pg.locator('.adm-nav .adm-link.is-active').first().waitFor({ timeout: 30000 });
  await pg.waitForTimeout(500);
  m = await measure(pg);
  ok('after a reload the page’s row is still in view', m.activeInside === true && m.scrollTop > 100, { active: m.activeText, inside: m.activeInside, scrollTop: m.scrollTop });

  // Opened cold from the top of the list: the nav is at its top again only
  // if that shows the row; a far row is brought into view.
  const ctx2 = await b.open(ADMIN, 1280);
  await ctx2.page.setViewportSize({ width: 1280, height: 700 });
  await goto(ctx2.page, lastHref);
  await ctx2.page.locator('.adm-nav .adm-link.is-active').first().waitFor({ timeout: 30000 });
  await ctx2.page.waitForTimeout(400);
  const cold = await measure(ctx2.page);
  ok('opened cold on a far page, its row is brought into view', cold.activeInside === true && cold.activeOnTop === true, { active: cold.activeText, inside: cold.activeInside, scrollTop: cold.scrollTop });
  ok('no page errors (cold)', ctx2.errors.length === 0, ctx2.errors);
  await ctx2.ctx.close();

  ok('no sideways scroll', (await overflowPx(pg)) <= 0, await overflowPx(pg));
  ok('no page errors', errors.length === 0, errors);
  await ctx.close();
}

// A short admin page: the nav stays inside the admin area and goes up
// with it when the footer comes; it never lies over the footer.
async function shortPage(b) {
  section('A short admin page: the nav leaves with the page, never over the footer');
  const { ctx, page: pg, errors } = await b.open(ADMIN, 1280);
  await pg.setViewportSize({ width: 1280, height: 700 });
  await goto(pg, '/admin');
  await pg.locator('.adm-nav .adm-link').first().waitFor({ timeout: 30000 });
  await pg.waitForTimeout(300);
  await pg.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await pg.waitForTimeout(300);
  const m = await pg.evaluate(() => {
    const nav = document.querySelector('.adm-nav').getBoundingClientRect();
    const shell = document.querySelector('.adm-shell').getBoundingClientRect();
    const footer = document.querySelector('footer');
    return { navBottom: nav.bottom, shellBottom: shell.bottom, footerTop: footer ? footer.getBoundingClientRect().top : null };
  });
  ok('at the bottom of the page the nav ends where the admin area ends', m.navBottom <= m.shellBottom + 1, m);
  ok('…and never over the footer', m.footerTop === null || m.navBottom <= m.footerTop + 1, m);
  ok('no page errors', errors.length === 0, errors);
  await ctx.close();
}

async function tall(b) {
  section('A tall window (1280×2400): the nav fits whole');
  const { ctx, page: pg, errors } = await b.open(ADMIN, 1280);
  await pg.setViewportSize({ width: 1280, height: 2400 });
  await goto(pg, '/admin');
  await pg.locator('.adm-nav .adm-link').first().waitFor({ timeout: 30000 });
  await pg.waitForTimeout(400);
  let m = await measure(pg);
  ok('nothing to scroll in the nav, and it says so', !m.scrolls && m.scrollMax <= 1, { scrolls: m.scrolls, scrollMax: m.scrollMax });
  pinned('in a tall window', m);
  ok('the last row is in view without scrolling', m.lastInside === true);
  if (m.pageRoom > 60) {
    await pg.mouse.move(m.nav.left + 110, m.nav.top + 200);
    await pg.mouse.wheel(0, 200);
    await pg.waitForTimeout(300);
    m = await measure(pg);
    ok('a wheel over a nav that fits scrolls the page, as anywhere else', m.pageY > 0, m.pageY);
  } else {
    ok('the page is shorter than the window here, so there is nothing to scroll', true);
  }
  ok('no page errors', errors.length === 0, errors);
  await ctx.close();
}

async function strip(b) {
  for (const size of [{ name: 'a narrow window (820×700)', key: 'narrow', width: 820, height: 700, touch: false }, { name: 'a phone (390×844)', key: 'phone', width: 390, height: 844, touch: true }]) {
    section(`The chip strip on ${size.name}`);
    const { ctx, page: pg, errors } = await b.open(ADMIN, size.touch ? 390 : 1280);
    await pg.setViewportSize({ width: size.width, height: size.height });
    // A page far along the strip.
    await goto(pg, '/admin/audit-log');
    await pg.locator('.adm-nav .adm-link.is-active').first().waitFor({ timeout: 30000 });
    await pg.waitForTimeout(400);
    const m = await measure(pg);
    ok('the nav is the strip under the header, not pinned', m.position === 'static' && m.display === 'flex', { position: m.position, display: m.display });
    ok('it scrolls sideways, not down', m.scrollMaxX > 100 && m.scrollMax <= 1 && !m.scrolls, { x: m.scrollMaxX, y: m.scrollMax, scrolls: m.scrolls });
    ok(`the chip of this page (${m.activeText}) is in view`, m.activeInside === true && m.scrollLeft > 0, { inside: m.activeInside, scrollLeft: m.scrollLeft });
    await shot(pg, `admin-nav-strip-${size.key}`);
    ok('no sideways scroll on the page', (await overflowPx(pg)) <= 0, await overflowPx(pg));
    ok('no page errors', errors.length === 0, errors);
    await ctx.close();
  }
}

await runCheck('admin-nav', async () => {
  const b = await browser();
  try {
    await laptop(b);
    await shortPage(b);
    await tall(b);
    await strip(b);
  } finally {
    await b.close();
  }
});
