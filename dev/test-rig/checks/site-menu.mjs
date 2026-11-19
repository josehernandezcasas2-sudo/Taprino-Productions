// The ☰ menu and option B (2026-11-18, Jose: "make something like how
// Facebook or Threads opens up to reveal more info … we do B and we move
// what is missing to there"; components/SiteMenu.js, lib/siteMenuRules.js).
//
// The header: the ☰ on every width, Messages and the bell, no photo and no
// Tapa + pill; signed out, a Sign in pill. The menu: full screen on a phone,
// a 440px drawer on a laptop, focus moved in and back, Escape and the
// backdrop close it, it opens on the half of the site the page is on, six
// tiles and See more, the live lines from /api/menu-counts, the sections for
// each kind of account, a section kept open when the menu opens again, a row
// that navigates and closes the menu, Log out, and the page behind never
// moving. The tab bar's Account tab draws the person's photo. Admin pages
// (no tab bar) reach the menu too.
//
// node dev/test-rig/checks/site-menu.mjs   (the rig must be up)
import { USERS, ok, section, runCheck, rows, sql, q, session, SIGNED_OUT, browser, goto, overflowPx, call } from './lib.mjs';

const MARA = session(USERS.mara);
const VIEWER = session(USERS.viewer);
const ADMIN = session(USERS.admin);
const SUB = session(USERS.sub);

const PHOTO = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='40' height='40'><rect width='40' height='40' fill='%2393d0a4'/></svg>";

const open = async (pg, touch) => {
  const btn = pg.locator('button.nav-hamburger');
  if (touch) await btn.tap(); else await btn.click();
  await pg.locator('.site-menu').waitFor({ timeout: 10000 });
  await pg.waitForTimeout(400);
};
const sectionsOf = (pg) => pg.$$eval('.site-menu .sm-section', (els) => els.map((e) => e.getAttribute('data-section')));
const tilesOf = (pg) => pg.$$eval('.site-menu .sm-tile', (els) => els.map((e) => e.getAttribute('data-tile')));
const box = (pg, sel) => pg.evaluate((s) => { const el = document.querySelector(s); if (!el) return null; const b = el.getBoundingClientRect(); return { top: b.top, bottom: b.bottom, left: b.left, right: b.right, width: b.width, height: b.height, viewW: window.innerWidth, viewH: window.innerHeight }; }, sel);

await runCheck('site-menu', async () => {
  const was = rows("select avatar_url from public.user_profiles where user_id = 'user_rigMara'")[0];
  const b = await browser();
  try {
    section('The routes');
    {
      const r = await call('/api/menu-counts');
      ok('/api/menu-counts answers 200 with counts', r.status === 200 && r.json && r.json.counts && typeof r.json.counts === 'object', r.status);
      ok('…cached at the edge for a minute', /public/.test(r.headers.get('cache-control') || '') && /s-maxage=60/.test(r.headers.get('cache-control') || ''), r.headers.get('cache-control'));
      ok('…with numbers for calls, places and productions', ['openCalls', 'places', 'shooting'].every((k) => Number.isFinite(r.json.counts[k])), r.json.counts);
      sql(`update public.user_profiles set avatar_url = ${q(PHOTO)}, avatar_position = '30% 40%', avatar_zoom = 1.5 where user_id = 'user_rigMara'`);
      const me = await call('/api/my-role', { who: MARA });
      ok('/api/my-role carries the photo with its focal point and zoom', me.json && me.json.avatar && me.json.avatar.url === PHOTO && me.json.avatar.position === '30% 40%' && me.json.avatar.zoom === 1.5, me.json && me.json.avatar);
      ok('…and the name', me.json && me.json.displayName === 'Mara Reyes', me.json && me.json.displayName);
      const out = await call('/api/my-role');
      ok('signed out it carries neither', out.json && out.json.avatar === null && out.json.displayName === null, out.json);
    }

    section('The header on a phone, signed in (option B)');
    {
      const { ctx, page: pg, errors } = await b.open(MARA, 390);
      await goto(pg, '/');
      const h = await pg.evaluate(() => ({
        ham: Boolean(document.querySelector('header.channel-bar button.nav-hamburger')),
        messages: Boolean(document.querySelector('header.channel-bar a.header-messages[href="/messages"]')),
        bell: Boolean(document.querySelector('header.channel-bar button[aria-label^="Notifications"]')),
        photo: Boolean(document.querySelector('header.channel-bar .avatar-btn')),
        pill: Boolean(document.querySelector('header.channel-bar .tapa-plus-pill')),
        signin: Boolean(document.querySelector('header.channel-bar .header-signin-pill'))
      }));
      ok('the ☰, Messages and the bell are in the header', h.ham && h.messages && h.bell, h);
      ok('the photo and the Tapa + pill are not', !h.photo && !h.pill, h);
      ok('no Sign in pill when signed in', !h.signin, h);
      await pg.waitForFunction(() => document.querySelector('.tabbar .tabbar-avatar img'), null, { timeout: 15000 }).catch(() => {});
      const tabPhoto = await pg.evaluate(() => { const img = document.querySelector('.tabbar .tabbar-avatar img'); return img ? img.getAttribute('src') : null; });
      ok('the Account tab draws the photo', tabPhoto === PHOTO, tabPhoto);
      ok('no sideways scroll', (await overflowPx(pg)) <= 0, await overflowPx(pg));
      ok('no page errors', errors.length === 0, errors);
      await ctx.close();
    }

    section('The menu on a phone, signed in as a creator');
    {
      const { ctx, page: pg, errors } = await b.open(MARA, 390);
      await goto(pg, '/crew');
      const startY = await pg.evaluate(() => window.scrollY);
      await open(pg, true);
      const m = await box(pg, '.site-menu');
      ok('it covers the whole screen', m && m.left === 0 && m.top === 0 && Math.abs(m.width - m.viewW) <= 1 && Math.abs(m.bottom - m.viewH) <= 1, m);
      ok('the close button has the focus', await pg.evaluate(() => document.activeElement && document.activeElement.getAttribute('aria-label') === 'Close the menu'));
      const you = await pg.evaluate(() => ({ name: (document.querySelector('.sm-you-name') || {}).textContent, sub: (document.querySelector('.sm-you-sub') || {}).textContent, href: (document.querySelector('.sm-you-row') || {}).getAttribute && document.querySelector('.sm-you-row').getAttribute('href'), photo: Boolean(document.querySelector('.sm-you-photo img')) }));
      ok('you at the top: the name, See your profile, the photo', you.name === 'Mara Reyes' && you.sub === 'See your profile' && you.photo, you);
      ok('…linking to the public profile', you.href === '/profile/mara', you.href);
      const side = await pg.$eval('.sm-side.on', (e) => e.textContent.trim());
      ok('on a Connect page it opens on Connect', side === 'Connect', side);
      const tiles = await tilesOf(pg);
      ok('six tiles, Crew Call first', tiles.length === 6 && tiles[0] === 'crew', tiles);
      await pg.waitForFunction(() => { const el = document.querySelector('.sm-tile[data-tile="crew"] .sm-tile-line'); return el && /open|urgent/.test(el.textContent); }, null, { timeout: 15000 }).catch(() => {});
      const counts = (await call('/api/menu-counts')).json.counts;
      const crewLine = await pg.$eval('.sm-tile[data-tile="crew"] .sm-tile-line', (e) => e.textContent.trim());
      ok('the Crew Call tile has the live line when there are open calls', counts.openCalls > 0 ? /open/.test(crewLine) : crewLine === 'Find crew, post calls', { crewLine, counts });
      await pg.locator('.sm-more').tap();
      const more = await tilesOf(pg);
      ok('See more adds the rest', more.length > 6 && more.includes('swipe'), more);
      ok('…and says See less', (await pg.$eval('.sm-more', (e) => e.textContent.trim())) === 'See less');
      const secs = await sectionsOf(pg);
      ok('a creator has Your things, Creator, Settings & account and Help & legal', secs.join('|') === 'yours|creator|account|help', secs);
      ok('…and no Make films? card', !(await pg.$('.sm-apply')));
      const yours = pg.locator('.sm-section[data-section="yours"] .sm-section-head');
      await yours.tap();
      const rowsYours = await pg.$$eval('.sm-section[data-section="yours"] .sm-row', (els) => els.map((e) => e.textContent.trim()));
      ok('Your things opens in place with its rows', rowsYours.join('|') === 'My working card|My locations|Location requests|Your productions', rowsYours);
      ok('…and says it is open', (await yours.getAttribute('aria-expanded')) === 'true');
      const creatorRows = async () => { await pg.locator('.sm-section[data-section="creator"] .sm-section-head').tap(); return pg.$$eval('.sm-section[data-section="creator"] .sm-row', (els) => els.map((e) => e.textContent.trim())); };
      const cr = await creatorRows();
      ok('Creator: Dashboard, Your work, Submit, numbers, Money', cr.join('|') === 'Dashboard|Your work|Submit your work|Your numbers|Money', cr);
      // The list scrolls by itself; the page behind never moves.
      const body = await box(pg, '.sm-body');
      const sh = await pg.$eval('.sm-body', (e) => ({ sh: e.scrollHeight, ch: e.clientHeight }));
      ok('the list is longer than the screen, so it scrolls', sh.sh > sh.ch, sh);
      await pg.$eval('.sm-body', (e) => { e.scrollTop = e.scrollHeight; });
      await pg.waitForTimeout(200);
      const logout = await pg.evaluate(() => { const el = document.querySelector('.sm-logout'); const b = el.getBoundingClientRect(); const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return { text: el.textContent.trim(), bottom: b.bottom, viewH: window.innerHeight, onTop: Boolean(hit && (hit === el || el.contains(hit))) }; });
      ok('Log out is the last thing and can be reached', logout.text === 'Log out' && logout.bottom <= logout.viewH && logout.onTop, logout);
      ok('the page behind did not move', (await pg.evaluate(() => window.scrollY)) === startY);
      ok('no sideways scroll with the menu open', (await overflowPx(pg)) <= 0, await overflowPx(pg));
      // A row navigates and closes the menu.
      await pg.locator('.sm-section[data-section="yours"] .sm-row', { hasText: 'My locations' }).tap();
      await pg.waitForURL(/\/locations\/mine/, { timeout: 60000 });
      await pg.waitForTimeout(600);
      ok('a row goes to its page and the menu closes', !(await pg.$('.site-menu')), pg.url());
      // The sections opened stay open the next time.
      await open(pg, true);
      const kept = await pg.$$eval('.sm-section.open', (els) => els.map((e) => e.getAttribute('data-section')));
      ok('the sections opened stay open on the next page', kept.includes('yours') && kept.includes('creator'), kept);
      ok('no page errors', errors.length === 0, errors);
      await ctx.close();
      void body;
    }

    section('The menu on a Stream page, a viewer');
    {
      const { ctx, page: pg, errors } = await b.open(VIEWER, 390);
      await goto(pg, '/stream');
      await open(pg, true);
      const side = await pg.$eval('.sm-side.on', (e) => e.textContent.trim());
      ok('on Stream it opens on Stream', side === 'Stream', side);
      const tiles = await tilesOf(pg);
      ok('Series and Films first, My List and My Recs for someone signed in', tiles[0] === 'series' && tiles[1] === 'films' && tiles.includes('my-list') && tiles.includes('my-recs'), tiles);
      await pg.waitForSelector('.sm-genres .sm-chip', { timeout: 15000 }).catch(() => {});
      ok('Browse by genre has chips', (await pg.$$('.sm-genres .sm-chip')).length > 0);
      const secs = await sectionsOf(pg);
      ok('a viewer has Your things, Settings & account and Help & legal', secs.join('|') === 'yours|account|help', secs);
      ok('…and the Make films? card', Boolean(await pg.$('.sm-apply[href="/apply"]')));
      const plan = await pg.$eval('.sm-you-plan', (e) => e.textContent.trim());
      ok('the plan line and Join Tapa + for someone without a plan', /Free account/.test(plan) && /Join Tapa \+/.test(plan), plan);
      await pg.locator('.sm-side.connect').tap();
      ok('the switch moves to Connect tiles', (await tilesOf(pg))[0] === 'crew');
      ok('…and the home link follows it', (await pg.$eval('.sm-home', (e) => e.getAttribute('href'))) === '/');
      await pg.keyboard.press('Escape');
      await pg.waitForTimeout(300);
      ok('Escape closes it', !(await pg.$('.site-menu')));
      ok('…and the focus goes back to the ☰', await pg.evaluate(() => document.activeElement && document.activeElement.classList.contains('nav-hamburger')));
      ok('no page errors', errors.length === 0, errors);
      await ctx.close();
    }

    section('Signed out on a phone');
    {
      const { ctx, page: pg, errors } = await b.open(SIGNED_OUT, 390);
      await goto(pg, '/');
      const h = await pg.evaluate(() => ({ signin: Boolean(document.querySelector('header.channel-bar .header-signin-pill')), messages: Boolean(document.querySelector('header.channel-bar .header-messages')), bell: Boolean(document.querySelector('header.channel-bar button[aria-label^="Notifications"]')) }));
      ok('the header has Sign in, no Messages and no bell', h.signin && !h.messages && !h.bell, h);
      await open(pg, true);
      ok('the sign-in card, not a profile', Boolean(await pg.$('.sm-out')) && !(await pg.$('.sm-you')));
      ok('…with Sign in and Create account', (await pg.$$eval('.sm-out .sm-btn', (els) => els.map((e) => e.textContent.trim()))).join('|') === 'Sign in|Create account');
      const secs = await sectionsOf(pg);
      ok('only Help & legal', secs.join('|') === 'help', secs);
      ok('no Log out', !(await pg.$('.sm-logout')));
      ok('Make films? is there', Boolean(await pg.$('.sm-apply')));
      ok('no page errors', errors.length === 0, errors);
      await ctx.close();
    }

    section('On a laptop: a drawer, an admin');
    {
      const { ctx, page: pg, errors } = await b.open(ADMIN, 1280);
      await goto(pg, '/stream');
      ok('the ☰ shows on a laptop', await pg.locator('button.nav-hamburger').isVisible());
      const links = await pg.$$eval('header .nav-links .nav-link', (els) => els.map((e) => e.textContent.trim()));
      ok('Messages is no longer a text link', !links.some((t) => /^Messages/.test(t)), links);
      await open(pg, false);
      const m = await box(pg, '.site-menu');
      ok('a 440px drawer from the left, the screen tall', m && m.left === 0 && Math.abs(m.width - 440) <= 1 && Math.abs(m.bottom - m.viewH) <= 1, m);
      const secs = await sectionsOf(pg);
      ok('an admin has Creator and Team', secs.includes('creator') && secs.includes('team'), secs);
      await pg.locator('.sm-section[data-section="team"] .sm-section-head').click();
      const team = await pg.$$eval('.sm-section[data-section="team"] .sm-row', (els) => els.map((e) => e.textContent.trim()));
      ok('Team: Admin Portal and Channel scheduler', team.join('|') === 'Admin Portal|Channel scheduler', team);
      // A wheel on the backdrop or past the list's end never moves the page.
      await pg.mouse.move(900, 400);
      for (let i = 0; i < 6; i += 1) await pg.mouse.wheel(0, 400);
      await pg.waitForTimeout(300);
      ok('a wheel over the page behind does not scroll it', (await pg.evaluate(() => window.scrollY)) === 0);
      await pg.mouse.move(220, 500);
      for (let i = 0; i < 20; i += 1) await pg.mouse.wheel(0, 400);
      await pg.waitForTimeout(300);
      ok('a wheel on the menu scrolls the menu', (await pg.$eval('.sm-body', (e) => e.scrollTop)) > 0);
      ok('…and never the page', (await pg.evaluate(() => window.scrollY)) === 0);
      // Tab stays inside.
      await pg.locator('.sm-logout').focus();
      await pg.keyboard.press('Tab');
      ok('Tab from the last control wraps to the first', await pg.evaluate(() => document.activeElement && document.activeElement.closest('.site-menu') !== null && document.activeElement.getAttribute('aria-label') === 'Search'));
      await pg.mouse.click(1000, 300);
      await pg.waitForTimeout(300);
      ok('a click on the page behind closes it', !(await pg.$('.site-menu')));
      ok('no page errors', errors.length === 0, errors);
      await ctx.close();
    }

    section('An admin page (no tab bar) and a sub-admin');
    {
      const { ctx, page: pg, errors } = await b.open(SUB, 390);
      await goto(pg, '/admin');
      ok('there is no tab bar here', !(await pg.$('.tabbar')));
      await open(pg, true);
      const secs = await sectionsOf(pg);
      ok('a sub-admin: Creator (the Dashboard) and Team (Admin Portal)', secs.includes('creator') && secs.includes('team'), secs);
      await pg.locator('.sm-section[data-section="team"] .sm-section-head').tap();
      const team = await pg.$$eval('.sm-section[data-section="team"] .sm-row', (els) => els.map((e) => e.textContent.trim()));
      ok('…Team is Admin Portal only', team.join('|') === 'Admin Portal', team);
      ok('Log out is here, where there is no Account tab', Boolean(await pg.$('.sm-logout')));
      ok('no page errors', errors.length === 0, errors);
      await ctx.close();
    }
  } finally {
    sql(`update public.user_profiles set avatar_url = ${q(was ? was.avatar_url : null)}, avatar_position = null, avatar_zoom = null where user_id = 'user_rigMara'`);
    await b.close();
  }
});
