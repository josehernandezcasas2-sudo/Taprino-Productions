#!/usr/bin/env node
// The round of 2026-11-14 (Jose): the menus are their own scroll areas
// hanging from under the nav bar, Your work's two edit boxes are styled,
// and two stale texts are gone.
//
//   1. The words: the signed-out account card no longer says "Real email +
//      password now", the Pitch Room intro no longer says Studio Tapa
//      doesn't handle the funding.
//   2. The account menu at a tablet held sideways (Jose's screenshot,
//      1000×695), a laptop, a short laptop window, a phone and a phone held
//      sideways: its top edge is the bar's bottom edge, it ends on screen
//      (above the phone's tab bar), its last row (Sign Out) can be scrolled
//      into view, and neither a wheel nor a finger on it moves the page —
//      at the list's ends too.
//   3. The browse panel and the notifications panel hang the same way.
//   4. The tab bar's own menu on a phone held sideways: on screen, under
//      the header, its first and last rows reachable.
//   5. Your work's "Edit submission" and "Title & description" boxes: the
//      fields carry the show editor's look (not the browser's white boxes),
//      the short fields pair up on a laptop and stack on a phone, the Save
//      row stays in view, nothing overflows; a save still works.
//
//   node dev/test-rig/checks/menus-and-boxes.mjs [--shots <dir>]
// Rig up, any migration from 118 on. --shots writes a picture of each
// state into <dir>.
import fs from 'node:fs';
import path from 'node:path';
import { IDS, USERS, RUN, ok, section, runCheck, page, sql, rows, q, insert, session, SIGNED_OUT, browser, goto, overflowPx, uidFor, ago } from './lib.mjs';

const MARA = session(USERS.mara);
const ADMIN = session(USERS.admin);

const shotsAt = process.argv.indexOf('--shots');
const SHOTS = shotsAt > -1 ? process.argv[shotsAt + 1] : null;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const shot = async (pg, name) => { if (SHOTS) await pg.screenshot({ path: path.join(SHOTS, `${name}.png`) }); };

const ID = { pending: `ck-box-pending-${RUN}`, live: `ck-box-live-${RUN}` };
const src = (key) => `https://customer-test.cloudflarestream.com/${uidFor(key)}/manifest/video.m3u8`;
const film = (id, extra) => ({
  id, title: `Check box ${id.slice(7, 16)}`, description: `The description of ${id}.`, tier: 'free', genre: 'Drama', main_genre: 'Drama', content_type: 'movie',
  artist: 'Mara Reyes', runtime: '1:20:00', rating: 'TV-PG', release_year: 2026, src: src(IDS.film), video_type: 'html5', video_provider: 'cloudflare',
  ads_enabled: true, deletion_requested: false, moderation_hold: false, submitted_by: USERS.mara, status: 'approved', reviewed_at: ago(3), released_at: ago(3), created_at: ago(5),
  thumbnail: null, poster: null, ...extra
});
function seed() {
  insert('episodes', film(ID.pending, { status: 'pending', reviewed_at: null, released_at: null, title: 'Check box film in review' }));
  insert('episodes', film(ID.live, { title: 'Check box film live', description: 'Before the edit.' }));
}
function cleanup() {
  const ids = Object.values(ID).map(q).join(', ');
  sql(`delete from public.notifications where episode_id in (${ids}) or message like '%Check box film%'`);
  sql(`delete from public.audit_log where target_id in (${ids})`);
  sql(`delete from public.episodes where id in (${ids})`);
}

// ---- 1. the words ---------------------------------------------------------------------
async function words() {
  section('The two stale texts');
  const acct = await page('/account', SIGNED_OUT);
  ok('/account signed out: 200', acct.status === 200, acct.status);
  ok('…the card no longer says "Real email + password"', !/Real email/i.test(acct.text));
  ok('…and still says to sign in or create a free account', /Sign in if you(&#x27;|’|')ve been here before, or create a free account/.test(acct.text), acct.text.match(/Sign in if[^<]{0,80}/));

  const was = rows('select elevator_pitch_enabled from public.site_settings where id = 1')[0];
  sql('update public.site_settings set elevator_pitch_enabled = true where id = 1');
  try {
    // The page is CDN-cached for a signed-out visitor; a creator's read is private.
    const pitches = await page('/pitches', MARA);
    ok('/pitches: 200', pitches.status === 200, pitches.status);
    ok('…the intro no longer says Studio Tapa doesn’t handle the funding', !/handle any of this funding/i.test(pitches.text) && !/links straight to the creator/i.test(pitches.text));
    ok('…it says backing goes through Stripe to the creator', /Where backing is open you can back a project from its\s+page/.test(pitches.text) && /through Stripe straight to the creator/.test(pitches.text));
  } finally {
    sql(`update public.site_settings set elevator_pitch_enabled = ${was && was.elevator_pitch_enabled === true ? 'true' : 'false'} where id = 1`);
  }
}

// ---- the browser's helpers ------------------------------------------------------------
// What the open panel and the things around it measure.
const measure = (pg, selector) => pg.evaluate((sel) => {
  const panel = document.querySelector(sel);
  const bar = document.querySelector('header.channel-bar');
  const tab = document.querySelector('.tabbar');
  const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { top: b.top, bottom: b.bottom, left: b.left, right: b.right, width: b.width, height: b.height }; };
  const tabRect = r(tab);
  return {
    panel: r(panel),
    bar: r(bar),
    tab: tabRect && tabRect.height > 0 ? tabRect : null,
    tabAtBottom: Boolean(tabRect && tabRect.height > 0 && tabRect.width > tabRect.height),
    scrollTop: panel ? panel.scrollTop : null,
    scrollHeight: panel ? panel.scrollHeight : null,
    clientHeight: panel ? panel.clientHeight : null,
    viewH: window.innerHeight,
    viewW: window.innerWidth,
    pageY: window.scrollY,
    pageRoom: document.documentElement.scrollHeight - window.innerHeight
  };
}, selector);

// One finger dragging from (x, y1) to (x, y2) on a touch screen.
async function drag(pg, x, y1, y2) {
  const cdp = await pg.context().newCDPSession(pg);
  const pt = (y) => [{ x, y, id: 1, radiusX: 4, radiusY: 4, force: 1 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(y1) });
  const steps = 8;
  for (let i = 1; i <= steps; i += 1) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pt(y1 + ((y2 - y1) * i) / steps) });
    await pg.waitForTimeout(16);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
  await pg.waitForTimeout(350);
}

const SIZES = [
  { name: 'a tablet held sideways (1000×695)', key: 'tablet', width: 1000, height: 695, touch: false },
  { name: 'a laptop (1280×800)', key: 'laptop', width: 1280, height: 800, touch: false },
  { name: 'a short laptop window (1280×460)', key: 'short', width: 1280, height: 460, touch: false },
  { name: 'a phone (390×844)', key: 'phone', width: 390, height: 844, touch: true },
  { name: 'a phone held sideways (844×390)', key: 'sideways', width: 844, height: 390, touch: true }
];

// The panel hangs from the bar and ends on screen.
function hangs(label, m) {
  ok(`${label}: its top edge is the bar's bottom edge`, m.panel && m.bar && Math.abs(m.panel.top - m.bar.bottom) <= 1, m.panel && m.bar ? { panelTop: m.panel.top, barBottom: m.bar.bottom } : m);
  ok(`${label}: it ends on screen`, m.panel && m.panel.bottom <= m.viewH - 4, m.panel ? { bottom: m.panel.bottom, viewH: m.viewH } : m);
  if (m.tabAtBottom && m.tab) ok(`${label}: it stops above the tab bar`, m.panel.bottom <= m.tab.top - 4, { bottom: m.panel.bottom, tabTop: m.tab.top });
  ok(`${label}: it is inside the screen's width`, m.panel && m.panel.left >= 0 && m.panel.right <= m.viewW + 1, m.panel);
}

// ---- 2. the account menu ----------------------------------------------------------------
async function accountMenu(b) {
  for (const size of SIZES) {
    section(`The account menu on ${size.name}`);
    // The admin's menu is the longest (every creator and admin row).
    const { ctx, page: pg, errors } = await b.open(ADMIN, size.touch ? 390 : 1280);
    await pg.setViewportSize({ width: size.width, height: size.height });
    await goto(pg, '/stream');
    const room = await pg.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
    ok('the page behind is long enough to scroll', room > 200, room);

    await pg.locator('button[aria-label="Account menu"]').click();
    const sel = '.account-dropdown';
    await pg.locator(sel).waitFor({ timeout: 10000 });
    await pg.locator(`${sel} >> text=Sign Out`).waitFor({ timeout: 15000 }).catch(() => {});
    await pg.waitForTimeout(250);
    let m = await measure(pg, sel);
    hangs('the menu', m);
    await shot(pg, `menu-${size.key}`);

    const scrolls = m.scrollHeight > m.clientHeight + 1;
    const mustScroll = size.height < 700;
    ok(mustScroll ? 'it has more rows than fit, so it scrolls' : `it ${scrolls ? 'scrolls' : 'fits whole'}`, mustScroll ? scrolls : true, { scrollHeight: m.scrollHeight, clientHeight: m.clientHeight });

    const cx = m.panel.left + m.panel.width / 2;
    const cy = m.panel.top + Math.min(m.panel.height / 2, 120);
    if (size.touch) {
      // A finger moving up scrolls the list.
      if (scrolls) {
        await drag(pg, cx, m.panel.top + m.panel.height - 30, m.panel.top + 30);
        const after = await measure(pg, sel);
        ok('a finger on the menu scrolls the menu', after.scrollTop > 0, after.scrollTop);
        ok('…and the page behind stays where it was', after.pageY === 0, after.pageY);
      }
      // At the list's end (or on a list that fits) the same finger moves nothing.
      await pg.evaluate((s) => { const p = document.querySelector(s); p.scrollTop = p.scrollHeight; }, sel);
      await drag(pg, cx, m.panel.top + m.panel.height - 30, m.panel.top + 30);
      let after = await measure(pg, sel);
      ok('at the end of the list a finger does not move the page', after.pageY === 0, after.pageY);
      await pg.evaluate((s) => { document.querySelector(s).scrollTop = 0; }, sel);
      await drag(pg, cx, m.panel.top + 30, m.panel.top + m.panel.height - 30);
      after = await measure(pg, sel);
      ok('at the top of the list a finger pulling down does not move the page', after.pageY === 0, after.pageY);
    } else {
      await pg.mouse.move(cx, cy);
      if (scrolls) {
        await pg.mouse.wheel(0, 160);
        await pg.waitForTimeout(250);
        const after = await measure(pg, sel);
        ok('a wheel on the menu scrolls the menu', after.scrollTop > 0, after.scrollTop);
        ok('…and the page behind stays where it was', after.pageY === 0, after.pageY);
      }
      // Far more wheel than the list has: it stops at the end, the page still doesn't move.
      for (let i = 0; i < 12; i += 1) await pg.mouse.wheel(0, 400);
      await pg.waitForTimeout(300);
      let after = await measure(pg, sel);
      ok('past the end of the list the page still does not move', after.pageY === 0, after.pageY);
      for (let i = 0; i < 12; i += 1) await pg.mouse.wheel(0, -400);
      await pg.waitForTimeout(300);
      after = await measure(pg, sel);
      ok('past the top of the list the page still does not move', after.pageY === 0 && after.scrollTop === 0, { pageY: after.pageY, scrollTop: after.scrollTop });
    }

    // Every row can be reached: the last one comes into view inside the panel.
    await pg.evaluate((s) => { const p = document.querySelector(s); p.scrollTop = p.scrollHeight; }, sel);
    await pg.waitForTimeout(150);
    const last = await pg.evaluate((s) => {
      const p = document.querySelector(s);
      const items = [...p.querySelectorAll('.dropdown-item')];
      const el = items[items.length - 1];
      const b = el.getBoundingClientRect();
      const pr = p.getBoundingClientRect();
      const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
      return { text: el.textContent.trim(), top: b.top, bottom: b.bottom, panelTop: pr.top, panelBottom: pr.bottom, onTop: Boolean(hit && (hit === el || el.contains(hit))), viewH: window.innerHeight };
    }, sel);
    ok('the last row is Sign Out', last.text === 'Sign Out', last.text);
    ok('…and it can be scrolled into view', last.top >= last.panelTop - 1 && last.bottom <= last.panelBottom + 1 && last.bottom <= last.viewH, last);
    ok('…with nothing lying over it', last.onTop, last);
    await shot(pg, `menu-${size.key}-end`);
    // …and the first again.
    await pg.evaluate((s) => { document.querySelector(s).scrollTop = 0; }, sel);
    const first = await pg.evaluate((s) => { const p = document.querySelector(s); const el = p.firstElementChild; const b = el.getBoundingClientRect(); return { top: b.top, panelTop: p.getBoundingClientRect().top }; }, sel);
    ok('back at the top the first row sits under the bar', first.top >= first.panelTop - 1, first);

    // Outside the menu the page scrolls as it always did (a mouse).
    if (!size.touch) {
      await pg.mouse.move(Math.max(40, m.panel.left - 200), Math.min(size.height - 40, m.panel.top + 200));
      await pg.mouse.wheel(0, 240);
      await pg.waitForTimeout(300);
      const after = await measure(pg, sel);
      ok('a wheel outside the menu scrolls the page', after.pageY > 0, after.pageY);
      ok('…and the menu stays under the bar', after.panel && Math.abs(after.panel.top - after.bar.bottom) <= 1, after.panel ? { panelTop: after.panel.top, barBottom: after.bar.bottom } : null);
      await pg.evaluate(() => window.scrollTo(0, 0));
    }

    // The window changes while it is open: the room is measured again.
    await pg.setViewportSize({ width: size.width, height: Math.max(320, size.height - 120) });
    await pg.waitForTimeout(300);
    m = await measure(pg, sel);
    hangs('after the window got shorter, the menu', m);
    await pg.setViewportSize({ width: size.width, height: size.height });

    ok('no sideways scroll', (await overflowPx(pg)) <= 0, await overflowPx(pg));
    ok('no page errors', errors.length === 0, errors);
    await ctx.close();
  }
}

// ---- 3. the browse, notification and search panels -----------------------------------
async function otherPanels(b) {
  for (const size of [{ name: 'a short tablet window (1000×520)', key: 'tablet', width: 1000, height: 520, touch: false }, { name: 'a phone (390×844)', key: 'phone', width: 390, height: 844, touch: true }, { name: 'a small phone (320×640)', key: 'small', width: 320, height: 640, touch: true }]) {
    section(`The browse, notifications and search panels on ${size.name}`);
    const { ctx, page: pg, errors } = await b.open(MARA, size.touch ? 390 : 1280);
    await pg.setViewportSize({ width: size.width, height: size.height });
    await goto(pg, '/stream');
    const press = (sel) => (size.touch ? pg.locator(sel).first().tap() : pg.locator(sel).first().click());

    await press('button[aria-label="Browse by type and genre"]');
    await pg.locator('.hamburger-dropdown').waitFor({ timeout: 10000 });
    await pg.waitForTimeout(600);
    let m = await measure(pg, '.hamburger-dropdown');
    hangs('the browse panel', m);
    await shot(pg, `browse-${size.key}`);
    if (!size.touch) {
      await pg.mouse.move(m.panel.left + 80, m.panel.top + 80);
      for (let i = 0; i < 10; i += 1) await pg.mouse.wheel(0, 400);
      await pg.waitForTimeout(300);
      m = await measure(pg, '.hamburger-dropdown');
      ok('a wheel on the browse panel never moves the page', m.pageY === 0, m.pageY);
    }
    await pg.keyboard.press('Escape');

    await press('button[aria-label^="Notifications"]');
    await pg.locator('.notification-dropdown').waitFor({ timeout: 10000 });
    await pg.waitForTimeout(300);
    m = await measure(pg, '.notification-dropdown');
    hangs('the notifications panel', m);
    ok('the notifications panel is never taller than 360px', m.panel.height <= 361, m.panel.height);
    await shot(pg, `bell-${size.key}`);
    await pg.keyboard.press('Escape');

    await press('button[aria-label="Search"]');
    await pg.locator('.search-dropdown').waitFor({ timeout: 10000 });
    await pg.waitForTimeout(250);
    m = await measure(pg, '.search-dropdown');
    hangs('the search panel', m);
    ok('the search box can be typed in', await pg.locator('.header-search-input').isVisible());
    await shot(pg, `search-${size.key}`);
    await pg.keyboard.press('Escape');

    ok('no sideways scroll', (await overflowPx(pg)) <= 0, await overflowPx(pg));
    ok('no page errors', errors.length === 0, errors);
    await ctx.close();
  }
}

// ---- 4. the tab bar's own menu -------------------------------------------------------
async function tabBarMenu(b) {
  section('The tab bar’s Account menu on a phone held sideways (844×390)');
  const { ctx, page: pg, errors } = await b.open(ADMIN, 390);
  await pg.setViewportSize({ width: 844, height: 390 });
  await goto(pg, '/stream');
  const btn = pg.locator('.tabbar .tabbar-item', { hasText: 'Account' });
  ok('the tab bar has Account', (await btn.count()) === 1);
  await btn.tap();
  await pg.locator('.tabbar-dropup').waitFor({ timeout: 10000 });
  await pg.waitForTimeout(300);
  const m = await pg.evaluate(() => {
    const menu = document.querySelector('.tabbar-dropup');
    const header = document.querySelector('header.channel-bar');
    const bar = document.querySelector('.tabbar');
    const r = menu.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, headerBottom: header.getBoundingClientRect().bottom, barTop: bar.getBoundingClientRect().top, scrollHeight: menu.scrollHeight, clientHeight: menu.clientHeight, rows: menu.querySelectorAll('.tabbar-dropup-item').length };
  });
  ok('the menu starts on screen, under the header', m.top >= m.headerBottom - 1 && m.top >= 0, m);
  ok('…and ends above the bar', m.bottom <= m.barTop, m);
  ok('it has more rows than fit, so it scrolls', m.scrollHeight > m.clientHeight + 1 && m.rows >= 6, m);
  await shot(pg, 'tabbar-sideways');
  const ends = await pg.evaluate(() => {
    const menu = document.querySelector('.tabbar-dropup');
    const items = [...menu.querySelectorAll('.tabbar-dropup-item')];
    const inside = (el) => { const b = el.getBoundingClientRect(); const p = menu.getBoundingClientRect(); return b.top >= p.top - 1 && b.bottom <= p.bottom + 1; };
    menu.scrollTop = 0;
    const first = inside(items[0]);
    menu.scrollTop = menu.scrollHeight;
    const last = inside(items[items.length - 1]);
    return { first, last };
  });
  ok('its first and last rows can both be reached', ends.first && ends.last, ends);
  ok('the page behind did not move', (await pg.evaluate(() => window.scrollY)) === 0);
  ok('no page errors', errors.length === 0, errors);
  await ctx.close();
}

// ---- 5. Your work's two boxes ----------------------------------------------------------
const SURFACE_2 = 'rgb(24, 36, 60)';
const fieldLook = (pg, selector) => pg.evaluate((sel) => {
  const el = document.querySelector(sel);
  if (!el) return null;
  const cs = getComputedStyle(el);
  const label = el.id ? document.querySelector(`label[for="${el.id}"]`) : null;
  const ls = label ? getComputedStyle(label) : null;
  const r = el.getBoundingClientRect();
  return {
    background: cs.backgroundColor, height: Math.round(r.height), radius: cs.borderTopLeftRadius, color: cs.color, width: Math.round(r.width),
    labelTransform: ls ? ls.textTransform : null, labelFont: ls ? ls.fontFamily : null
  };
}, selector);

async function boxes(b) {
  for (const width of [1280, 390]) {
    section(`Your work’s edit boxes at ${width}`);
    const { ctx, page: pg, errors } = await b.open(MARA, width);
    await goto(pg, '/creator/my-work');

    // --- Edit submission (a title still in review)
    const pencil = pg.locator('.submission-row, .yw-row, li, article, div', { has: pg.locator('button[title="Edit"]') }).filter({ hasText: 'Check box film in review' }).last().locator('button[title="Edit"]');
    await pencil.first().waitFor({ timeout: 30000 }).catch(() => {});
    ok('the title in review has its Edit button', (await pencil.count()) >= 1, await pencil.count());
    await pencil.first().click();
    const box = pg.locator('.modal-card.ebx');
    await box.waitFor({ timeout: 10000 });
    ok('"Edit submission" opens as a dialog', (await box.getAttribute('role')) === 'dialog' && ((await box.locator('.ebx-title').textContent()) || '').trim() === 'Edit submission');
    for (const [name, sel] of [['the title', '#ebx-sub-title'], ['the runtime', '#ebx-sub-runtime'], ['the type list', '#ebx-sub-type'], ['the rating list', '#ebx-sub-rating'], ['the tier list', '#ebx-sub-tier']]) {
      const look = await fieldLook(pg, sel);
      ok(`${name}: a 46px field on the editor's surface, not a white box`, look && look.background === SURFACE_2 && look.height === 46 && look.radius === '10px', look);
      ok(`${name}: its label is the editor's small capitals`, look && look.labelTransform === 'uppercase' && /Plex Mono|mono/i.test(look.labelFont || ''), look);
    }
    const area = await fieldLook(pg, '#ebx-sub-description');
    ok('the description: the same surface, taller', area && area.background === SURFACE_2 && area.height >= 90, area);
    const pair = await pg.evaluate(() => {
      const a = document.querySelector('#ebx-sub-runtime').getBoundingClientRect();
      const c = document.querySelector('#ebx-sub-year').getBoundingClientRect();
      return { sameRow: Math.abs(a.top - c.top) < 2, aLeft: a.left, cLeft: c.left };
    });
    ok(width >= 520 ? 'runtime and year sit side by side' : 'runtime and year stack', width >= 520 ? pair.sameRow && pair.cLeft > pair.aLeft : !pair.sameRow, pair);
    const fit = await pg.evaluate(() => {
      const card = document.querySelector('.modal-card.ebx');
      const r = card.getBoundingClientRect();
      const wide = [...card.querySelectorAll('*')].filter((el) => el.getBoundingClientRect().right > r.right + 1).length;
      return { left: r.left, right: r.right, viewW: window.innerWidth, wide };
    });
    ok('nothing sticks out of the box, and the box is on screen', fit.wide === 0 && fit.left >= 0 && fit.right <= fit.viewW, fit);
    // The box fits the screen: the heading and the Save row stay put and
    // the fields scroll between them, in the box.
    const frame = await pg.evaluate(() => {
      const r = (sel) => { const b = document.querySelector(sel).getBoundingClientRect(); return { top: b.top, bottom: b.bottom }; };
      const body = document.querySelector('.ebx-body');
      const back = document.querySelector('.modal-backdrop');
      return {
        card: r('.modal-card.ebx'), head: r('.ebx-head'), actions: r('.ebx-actions'), viewH: window.innerHeight,
        bodyHeight: body.clientHeight, bodyScrolls: body.scrollHeight > body.clientHeight + 1, backdropScrolls: back.scrollHeight > back.clientHeight + 1
      };
    });
    ok('the box fits the screen, heading at its top and the Save row at its bottom', frame.card.top >= 0 && frame.card.bottom <= frame.viewH && frame.head.top >= frame.card.top - 1 && Math.abs(frame.actions.bottom - frame.card.bottom) <= 2, frame);
    ok('the fields scroll inside the box, and the backdrop does not', frame.bodyScrolls && !frame.backdropScrolls && frame.bodyHeight >= 120, frame);
    await shot(pg, `box-submission-${width}`);
    // A wheel (or a finger) on the fields scrolls them; the page behind never
    // moves (it may not be at its top: reaching the row scrolled to it).
    const pageY0 = await pg.evaluate(() => window.scrollY);
    const bodyBox = await pg.locator('.ebx-body').boundingBox();
    if (width >= 700) {
      await pg.mouse.move(bodyBox.x + bodyBox.width / 2, bodyBox.y + bodyBox.height / 2);
      for (let i = 0; i < 20; i += 1) await pg.mouse.wheel(0, 400);
      await pg.waitForTimeout(300);
    } else {
      for (let i = 0; i < 6; i += 1) await drag(pg, bodyBox.x + bodyBox.width / 2, bodyBox.y + bodyBox.height - 20, bodyBox.y + 20);
    }
    const scrolled = await pg.evaluate(() => {
      const body = document.querySelector('.ebx-body');
      const tier = document.querySelector('#ebx-sub-tier').getBoundingClientRect();
      const actions = document.querySelector('.ebx-actions').getBoundingClientRect();
      const sw = document.querySelector('.ebx-switches').getBoundingClientRect();
      return { scrollTop: body.scrollTop, atEnd: body.scrollTop + body.clientHeight >= body.scrollHeight - 2, switchesBottom: sw.bottom, tierBottom: tier.bottom, actionsTop: actions.top, pageY: window.scrollY };
    });
    ok('scrolling the fields reaches the last of them, above the Save row', scrolled.scrollTop > 0 && scrolled.atEnd && scrolled.switchesBottom <= scrolled.actionsTop + 1, scrolled);
    ok('…and the page behind never moved', scrolled.pageY === pageY0, { before: pageY0, after: scrolled.pageY });
    await shot(pg, `box-submission-${width}-end`);
    await pg.evaluate(() => { document.querySelector('.ebx-body').scrollTop = 0; });
    // A save still works.
    await pg.locator('#ebx-sub-title').fill(`Check box film in review ${width}`);
    await pg.locator('.ebx-actions button[type="submit"]').click();
    await box.waitFor({ state: 'detached', timeout: 15000 }).catch(() => {});
    const saved = rows(`select title from public.episodes where id = ${q(ID.pending)}`)[0] || {};
    ok('Save changes saves and closes the box', saved.title === `Check box film in review ${width}` && (await box.count()) === 0, saved);
    sql(`update public.episodes set title = 'Check box film in review' where id = ${q(ID.pending)}`);

    // --- Title & description (a live title)
    await goto(pg, '/creator/my-work');
    const menu = pg.locator('button[aria-label="Options for Check box film live"]');
    await menu.first().waitFor({ timeout: 30000 }).catch(() => {});
    ok('the live title has its options', (await menu.count()) === 1, await menu.count());
    await menu.click();
    await pg.locator('[role="menuitem"]', { hasText: 'Edit title' }).click();
    await box.waitFor({ timeout: 10000 });
    const heading = ((await box.locator('.ebx-title').textContent()) || '').trim();
    ok('the live title’s box opens with its heading', /^Title(, description & notes| & description)$/.test(heading), heading);
    ok('…and says it is live', ((await box.locator('.ebx-kicker').textContent()) || '').includes('Live'));
    const t = await fieldLook(pg, '#req-edit-title');
    ok('its title: a 46px field on the editor’s surface', t && t.background === SURFACE_2 && t.height === 46, t);
    const d = await fieldLook(pg, '#req-edit-description');
    ok('its description: the same surface', d && d.background === SURFACE_2 && d.height >= 90, d);
    ok('the tick boxes sit together in a frame', (await box.locator('.ebx-switches .flash-check').count()) >= 1);
    const send = box.locator('.ebx-actions button[type="submit"]');
    ok('nothing changed yet, so the button is off', await send.isDisabled());
    await shot(pg, `box-live-${width}`);
    await pg.locator('#req-edit-description').fill(`After the edit at ${width}.`);
    ok('a change turns the button on, saying what goes to review', (await send.isEnabled()) && /review/.test((await send.textContent()) || ''), await send.textContent());
    await send.click();
    await box.locator('.ebx-done-line').waitFor({ timeout: 15000 }).catch(() => {});
    const said = ((await box.locator('.ebx-done-line').textContent().catch(() => '')) || '');
    ok('it says what was sent for review', said.includes('Sent for review: the description.'), said);
    await shot(pg, `box-live-${width}-sent`);
    const db = rows(`select description, pending_description from public.episodes where id = ${q(ID.live)}`)[0] || {};
    ok('the description waits for review, the live one unchanged', db.pending_description === `After the edit at ${width}.` && db.description === 'Before the edit.', db);
    await box.locator('.ebx-close').click();
    ok('the round close button closes it', (await box.count()) === 0);
    sql(`update public.episodes set pending_description = null where id = ${q(ID.live)}`);

    ok('no sideways scroll on the page', (await overflowPx(pg)) <= 0, await overflowPx(pg));
    ok('no page errors', errors.length === 0, errors);
    await ctx.close();
  }
}

// The same box on a phone held sideways: little height, still usable.
async function boxSideways(b) {
  section('“Edit submission” on a phone held sideways (844×390)');
  const { ctx, page: pg, errors } = await b.open(MARA, 390);
  await pg.setViewportSize({ width: 844, height: 390 });
  await goto(pg, '/creator/my-work');
  const pencil = pg.locator('div', { has: pg.locator('button[title="Edit"]') }).filter({ hasText: 'Check box film in review' }).last().locator('button[title="Edit"]');
  await pencil.first().waitFor({ timeout: 30000 }).catch(() => {});
  await pencil.first().tap();
  await pg.locator('.modal-card.ebx').waitFor({ timeout: 10000 });
  const frame = await pg.evaluate(() => {
    const r = (sel) => { const x = document.querySelector(sel).getBoundingClientRect(); return { top: x.top, bottom: x.bottom }; };
    const body = document.querySelector('.ebx-body');
    return { card: r('.modal-card.ebx'), head: r('.ebx-head'), actions: r('.ebx-actions'), viewH: window.innerHeight, bodyHeight: body.clientHeight, bodyScrolls: body.scrollHeight > body.clientHeight + 1 };
  });
  ok('the box fits the screen with its heading and its Save row in view', frame.card.top >= 0 && frame.card.bottom <= frame.viewH && frame.actions.bottom <= frame.viewH && frame.head.top >= 0, frame);
  ok('…and leaves room for the fields to scroll', frame.bodyScrolls && frame.bodyHeight >= 120, frame);
  await shot(pg, 'box-submission-sideways');
  ok('no page errors', errors.length === 0, errors);
  await ctx.close();
}

await runCheck('menus-and-boxes', async () => {
  cleanup();
  seed();
  let b = null;
  try {
    await words();
    b = await browser();
    await accountMenu(b);
    await otherPanels(b);
    await tabBarMenu(b);
    await boxes(b);
    await boxSideways(b);
  } finally {
    if (b) await b.close();
    cleanup();
  }
});
