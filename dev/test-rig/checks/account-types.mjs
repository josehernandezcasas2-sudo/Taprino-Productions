// Account types, the website (2026-11-18, Jose on the canvas
// https://claude.ai/artifact/GxAa8Qj57oQRuBF7c5xo4q: "have them have
// multiple", "have the question skippable, this will default to a normal
// user/watch user"; migration 126; the agreement is mockups/account-types-
// contract.md). What it checks:
//   - /start: signed out → /account; a fresh account gets the question with
//     the four cards (what it already has ticked to begin with); ticking two
//     brings the Main chips, an arrow key moves the main, Continue saves and
//     goes on to ?next=, a second visit goes straight on; Skip (the bar's and
//     the long one) saves a viewer; a database before 126 (a 503
//     migration-126) goes on silently; any other failure says so and stays;
//   - /signed-in sends someone who never answered to /start with where they
//     were going, and someone who did straight on;
//   - the account hub's nudge: there for someone who never answered, Skip
//     answers it and the card goes, Pick goes to /start;
//   - Account → Profile: the Your types row and the sheet at 390 (a sheet
//     from the bottom) and 1280 (a dialog): focus to the title, tick, the
//     creator note for someone without the role, Make main, Save → the row
//     and the ☰ menu change with no reload, Escape and × close with the
//     focus back on Change, the page behind never moves; #types opens it;
//   - the ☰ menu's you card: the line, the main chips (switching saves and
//     follows at once; a failed save puts the main back and says so),
//     "+ Add a type" to the sheet; a viewer with no type has the add chip
//     alone; signed out none of it;
//   - the public profile: the line under the name, and the main's sections
//     right after About in the jump list and in the page (creator, crew,
//     studio), nothing for a viewer;
//   - no sideways scroll at 320 / 390 / 1280, no page errors.
// Seeds its own accounts; resets the seed accounts' types when done.
//
//   node dev/test-rig/checks/account-types.mjs   (the rig must be up)
//   SHOTS=<dir> keeps screenshots.
import { USERS, SIGNED_OUT, ok, section, runCheck, browser, goto, overflowPx, rows, sql, q, call, page, session, newUser, removeUser } from './lib.mjs';
import { TYPE_WORDS, TYPE_LABELS, TYPE_BLURBS, typesLine } from '../../../lib/accountTypeRules.js';

const shot = async (pg, name) => { if (process.env.SHOTS) await pg.screenshot({ path: `${process.env.SHOTS}/${name}.png` }).catch(() => {}); };
const stateOf = (id) => {
  const r = rows(`select coalesce(array_to_string(account_types, ','), '') as types, coalesce(main_type, '') as main, (account_type_asked_at is not null)::text as asked from public.user_profiles where user_id = ${q(id)}`)[0];
  return r ? { types: r.types ? r.types.split(',') : [], main: r.main || null, asked: r.asked === 'true' } : null;
};
const setTypes = (id, types, main, asked = true) => sql(`update public.user_profiles set account_types = array[${types.map(q).join(', ')}]::text[], main_type = ${q(main)}, account_type_asked_at = ${asked ? 'now()' : 'null'} where user_id = ${q(id)}`);
const clearTypes = (id) => sql(`update public.user_profiles set account_types = '{}', main_type = null, account_type_asked_at = null where user_id = ${q(id)}`);
const location = (r) => { const l = r.headers.get('location'); if (!l) return null; const u = new URL(l, 'http://x'); return `${u.pathname}${u.search}`; };
async function until(fn, ms = 15000) {
  const end = Date.now() + ms;
  let v = await fn();
  while (!v && Date.now() < end) { await new Promise((r) => setTimeout(r, 200)); v = await fn(); }
  return v;
}
const pathOf = (pg) => { const u = new URL(pg.url()); return `${u.pathname}${u.search}${u.hash}`; };
const openMenu = async (pg) => {
  await pg.locator('button.nav-hamburger').click();
  await pg.locator('.site-menu').waitFor({ timeout: 10000 });
  await pg.waitForTimeout(400);
};
const jumpList = (pg) => pg.$$eval('.profile-side-nav .profile-side-nav-link', (els) => els.map((e) => e.getAttribute('href').slice(1)));
const pageSections = (pg) => pg.$$eval('.profile-content > section.profile-section', (els) => els.map((e) => e.id));
const pageIds = (html) => [...html.matchAll(/<section id="(profile-[a-z]+)" class="profile-section"/g)].map((m) => m[1]);
const jumpIds = (html) => [...html.matchAll(/class="profile-side-nav-link"[^>]*href="#(profile-[a-z]+)"|href="#(profile-[a-z]+)"[^>]*class="profile-side-nav-link"/g)].map((m) => m[1] || m[2]);

await runCheck('account-types', async () => {
  const A = await newUser('atA', { displayName: 'Ana Types' });
  const B = await newUser('atB', { displayName: 'Bo Types' });
  const C = await newUser('atC', { displayName: 'Cy Types' });
  const D = await newUser('atD', { displayName: 'Di Types' });
  const E = await newUser('atE', { displayName: 'Ed Types' });
  const ALL = [A, B, C, D, E];
  const b = await browser();
  try {
    section('/start and /signed-in, over HTTP');
    {
      const out = await page('/start?next=/stream');
      ok('/start signed out is a 307 to /account', out.status === 307 && location(out) === '/account', `${out.status} ${location(out)}`);
      const fresh = await page('/start?next=%2Faccount', A);
      ok('a fresh account gets the question', fresh.status === 200 && fresh.text.includes(TYPE_WORDS.askTitle), fresh.status);
      ok('…the four cards with their words', ['creator', 'crew', 'cast', 'studio'].every((t) => fresh.text.includes(`data-type="${t}"`)) && fresh.text.includes(TYPE_BLURBS.studio), '');
      ok('…nothing ticked for someone with nothing on the site', !/aria-pressed="true"/.test(fresh.text));
      ok('…not for search engines (its own meta tag, the middleware’s no-AI header kept) and never cached', /<meta name="robots" content="noindex, nofollow"/.test(fresh.text) && /noai/.test(fresh.headers.get('x-robots-tag') || '') && /no-store/.test(fresh.headers.get('cache-control') || ''), `${fresh.headers.get('x-robots-tag')} ${fresh.headers.get('cache-control')}`);
      const bad = await page('/start?next=//evil.example', A);
      ok('an outside ?next= is refused (the door’s safeNext)', bad.status === 200 && bad.text.includes('"pageProps":{"next":"/"'), (bad.text.match(/"pageProps":\{[^}]*\}/) || [])[0]);
      // Someone with a working card has Crew ticked to begin with.
      sql(`insert into public.crew_cards (user_id, roles, place_label) values (${q(B.id)}, array['Gaffer']::text[], 'Echo Park, Los Angeles')`);
      const withCard = await page('/start', B);
      ok('a working card ticks Crew to begin with, as the main', /data-type="crew"[^>]*aria-pressed="true"|aria-pressed="true"[^>]*data-type="crew"/.test(withCard.text) && withCard.text.includes(TYPE_WORDS.mainChip) && withCard.text.includes('Continue as Crew'), '');
      const api = await call('/api/account/types', { who: B });
      ok('/api/account/types suggests it too and says it hasn’t been asked', api.status === 200 && api.json.asked === false && JSON.stringify(api.json.suggested) === '["crew"]', api.json);

      const si = await page('/signed-in?next=%2Faccount', A);
      ok('/signed-in sends someone who never answered to /start with where they were going', si.status === 307 && location(si) === '/start?next=%2Faccount', `${si.status} ${location(si)}`);
      const viewer = session(USERS.viewer);
      clearTypes(USERS.viewer);
      const sv = await page('/signed-in?next=%2Fstream', viewer);
      ok('…the seed viewer too', sv.status === 307 && location(sv) === '/start?next=%2Fstream', `${sv.status} ${location(sv)}`);
      const sMara = await page('/signed-in', session(USERS.mara));
      clearTypes(USERS.mara);
      const sMara2 = await page('/signed-in', session(USERS.mara));
      ok('…a creator on the way to the Dashboard', sMara2.status === 307 && location(sMara2) === `/start?next=${encodeURIComponent('/creator/dashboard')}`, `${location(sMara)} ${location(sMara2)}`);
    }

    section('/start in the browser, a phone');
    {
      const { ctx, page: pg, errors } = await b.open(A, 390);
      const st = await goto(pg, '/start?next=%2Faccount');
      ok('the page opens', st === 200, st);
      const chrome = await pg.evaluate(() => ({ header: Boolean(document.querySelector('header.channel-bar')), tabbar: Boolean(document.querySelector('.tabbar')), bar: Boolean(document.querySelector('.welcome-bar')), skip: (document.querySelector('.welcome-bar .atp-start-skip') || {}).textContent }));
      ok('no site header and no tab bar; the brand strip with Skip at its right', !chrome.header && !chrome.tabbar && chrome.bar && chrome.skip === TYPE_WORDS.skip, chrome);
      const btn = () => pg.$eval('.atp-continue', (e) => ({ text: e.textContent.trim(), disabled: e.disabled }));
      ok('Continue is off while nothing is ticked, and says so', JSON.stringify(await btn()) === JSON.stringify({ text: TYPE_WORDS.pickOne, disabled: true }), await btn());
      const sizes = await pg.$$eval('.atp-start button', (els) => els.map((e) => Math.round(e.getBoundingClientRect().height)));
      ok('every button is at least 44px tall', sizes.every((h) => h >= 44), sizes);
      await pg.click('.atp-card[data-type="crew"]');
      await pg.click('.atp-card[data-type="cast"]');
      const pressed = await pg.$$eval('.atp-card', (els) => els.map((e) => `${e.dataset.type}:${e.getAttribute('aria-pressed')}`));
      ok('the cards are toggle buttons', pressed.join(' ') === 'creator:false crew:true cast:true studio:false', pressed);
      const mainPill = await pg.$$eval('.atp-card .atp-main-pill', (els) => els.map((e) => e.closest('.atp-card').dataset.type));
      ok('the first one ticked is the main, with the MAIN pill', mainPill.join() === 'crew', mainPill);
      ok('the button reads Continue as Crew + Cast', (await btn()).text === 'Continue as Crew + Cast', await btn());
      const radios = await pg.$$eval('.atp-start-main-row [role="radiogroup"] [role="radio"]', (els) => els.map((e) => `${e.textContent}:${e.getAttribute('aria-checked')}:${e.tabIndex}`));
      ok('two ticked: the Main chips as a radio group, Crew chosen and the only Tab stop', radios.join(' ') === 'Crew:true:0 Cast:false:-1', radios);
      await pg.focus('.atp-start-main-row [role="radio"][aria-checked="true"]');
      await pg.keyboard.press('ArrowRight');
      await pg.waitForTimeout(200);
      const afterArrow = await pg.evaluate(() => ({ checked: (document.querySelector('.atp-start-main-row [aria-checked="true"]') || {}).textContent, focus: document.activeElement && document.activeElement.textContent, pill: (document.querySelector('.atp-card .atp-main-pill') || { closest: () => ({}) }).closest('.atp-card').dataset.type }));
      ok('an arrow key makes Cast the main and keeps the focus on it', afterArrow.checked === 'Cast' && afterArrow.focus === 'Cast' && afterArrow.pill === 'cast', afterArrow);
      ok('…and the button reads Continue as Cast + Crew', (await btn()).text === 'Continue as Cast + Crew', await btn());
      ok('no sideways scroll', (await overflowPx(pg)) <= 0, await overflowPx(pg));
      await shot(pg, 'start-390');
      // A failure that isn't "before 126" says so and stays.
      await pg.route('**/api/account/types', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"x"}' }));
      await pg.click('.atp-continue');
      await pg.waitForSelector('.atp-error', { timeout: 10000 }).catch(() => {});
      ok('a failed save says so and stays', (await pg.$eval('.atp-error', (e) => e.textContent).catch(() => '')) === TYPE_WORDS.failed && pathOf(pg).startsWith('/start'), pathOf(pg));
      ok('…nothing was saved', stateOf(A.id).asked === false, stateOf(A.id));
      await pg.unroute('**/api/account/types');
      await pg.click('.atp-continue');
      await pg.waitForURL((u) => u.pathname === '/account', { timeout: 60000 }).catch(() => {});
      ok('Continue saves and goes on to ?next=', pathOf(pg) === '/account', pathOf(pg));
      const saved = stateOf(A.id);
      ok('…saved as Cast + Crew, Cast the main, asked', saved && saved.types.join() === 'cast,crew' && saved.main === 'cast' && saved.asked, saved);
      ok('…and the hub has no nudge for them', !(await pg.$('.acct-types-nudge')));
      ok('no page errors', errors.length === 0, errors);
      await ctx.close();
      const again = await page('/start?next=%2Fstream', A);
      ok('a second visit goes straight on to ?next=', again.status === 307 && location(again) === '/stream', `${again.status} ${location(again)}`);
      const si = await page('/signed-in?next=%2Fstream', A);
      ok('…and /signed-in no longer asks', si.status === 307 && location(si) === '/stream', location(si));
      const role = await call('/api/my-role', { who: A });
      ok('/api/my-role carries the types', role.json && role.json.accountTypes && role.json.accountTypes.main === 'cast' && role.json.accountTypes.types.join() === 'cast,crew' && role.json.accountTypes.asked === true, role.json && role.json.accountTypes);
    }

    section('Skip');
    {
      const { ctx, page: pg, errors } = await b.open(C, 1280);
      await goto(pg, '/start?next=%2Fstream');
      const col = await pg.$eval('.atp-start-main', (e) => { const r = e.getBoundingClientRect(); return { width: r.width, left: r.left, right: window.innerWidth - r.right }; });
      ok('on a laptop the same column, centred, 520px at most', col.width <= 520 && Math.abs(col.left - col.right) <= 2, col);
      await shot(pg, 'start-1280');
      await pg.click('.welcome-bar .atp-start-skip');
      await pg.waitForURL((u) => u.pathname === '/stream', { timeout: 60000 }).catch(() => {});
      ok('the bar’s Skip goes on to ?next=', pathOf(pg) === '/stream', pathOf(pg));
      const s = stateOf(C.id);
      ok('…and saves a viewer who was asked', s && s.types.length === 0 && s.main === null && s.asked, s);
      ok('no page errors', errors.length === 0, errors);
      await ctx.close();

      const d = await b.open(D, 390);
      // A database before 126 answers 503 migration-126: go on silently.
      await goto(d.page, '/start?next=%2Fcrew');
      await d.page.route('**/api/account/types', (r) => r.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: TYPE_WORDS.notReady, code: 'migration-126' }) }));
      await d.page.click('.atp-start-skip-long');
      await d.page.waitForURL((u) => u.pathname === '/crew', { timeout: 60000 }).catch(() => {});
      ok('before 126 the long Skip goes on to ?next= silently', pathOf(d.page) === '/crew' && !(await d.page.$('.atp-error')), pathOf(d.page));
      await d.page.unroute('**/api/account/types');
      ok('no page errors', d.errors.length === 0, d.errors);
      await d.ctx.close();
    }

    section('The account hub’s nudge');
    {
      const html = await page('/account', D);
      ok('someone who never answered has the nudge above the tiles', html.status === 200 && html.text.includes('acct-types-nudge') && html.text.indexOf('acct-types-nudge') < html.text.indexOf('acct-tiles') && html.text.includes(`href="/start?next=%2Faccount"`), html.status);
      const answered = await page('/account', A);
      ok('someone who answered has none', answered.status === 200 && !answered.text.includes('acct-types-nudge'));
      const { ctx, page: pg, errors } = await b.open(D, 390);
      await goto(pg, '/account');
      const words = await pg.$eval('.acct-types-nudge', (e) => ({ h: e.querySelector('h2').textContent, p: e.querySelector('p').textContent }));
      ok('…in the rules’ words', words.h === TYPE_WORDS.askTitle && words.p === TYPE_WORDS.askSkipNote, words);
      ok('no sideways scroll with the nudge', (await overflowPx(pg)) <= 0, await overflowPx(pg));
      await shot(pg, 'hub-390');
      await pg.click('.acct-types-nudge-skip');
      await until(async () => !(await pg.$('.acct-types-nudge')));
      ok('Skip answers it and the card goes', !(await pg.$('.acct-types-nudge')) && stateOf(D.id).asked === true, stateOf(D.id));
      ok('no page errors', errors.length === 0, errors);
      await ctx.close();
      const e = await b.open(E, 390);
      await goto(e.page, '/account');
      await e.page.click('.acct-types-nudge-pick');
      await e.page.waitForURL((u) => u.pathname === '/start', { timeout: 60000 }).catch(() => {});
      ok('Pick goes to the question, coming back to the hub', pathOf(e.page) === '/start?next=%2Faccount', pathOf(e.page));
      ok('no page errors', e.errors.length === 0, e.errors);
      await e.ctx.close();
    }

    section('Account → Profile: the row and the sheet, a phone');
    {
      // E has never answered and isn't a creator: the creator note shows.
      const { ctx, page: pg, errors } = await b.open(E, 390);
      await goto(pg, '/account/profile');
      await pg.waitForSelector('#types .atp-rowcard-change', { timeout: 20000 });
      const row = await pg.$eval('#types', (e) => ({ label: e.querySelector('.atp-rowcard-label').textContent, value: e.querySelector('.atp-rowcard-value').textContent, action: e.querySelector('.atp-rowcard-change').textContent, top: e.closest('.account-card') && e.closest('.account-card').querySelector('#types') === e }));
      ok('the Your types row at the top of the public card: Here to watch · Change', row.label === TYPE_WORDS.rowLabel && row.value === TYPE_WORDS.watcher && row.action === TYPE_WORDS.change && row.top, row);
      const startY = await pg.evaluate(() => { window.scrollTo(0, 200); return window.scrollY; });
      await pg.click('#types .atp-rowcard-change');
      await pg.waitForSelector('.atp-sheet', { timeout: 10000 });
      await pg.waitForTimeout(300);
      const sh = await pg.evaluate(() => { const s = document.querySelector('.atp-sheet'); const r = s.getBoundingClientRect(); return { role: s.getAttribute('role'), modal: s.getAttribute('aria-modal'), bottom: Math.round(r.bottom), viewH: window.innerHeight, width: Math.round(r.width), viewW: window.innerWidth, focus: document.activeElement && document.activeElement.textContent, inBody: s.closest('form') === null }; });
      ok('Change opens a sheet from the bottom, as wide as the screen', sh.role === 'dialog' && sh.modal === 'true' && Math.abs(sh.bottom - sh.viewH) <= 1 && sh.width === sh.viewW, sh);
      ok('…the focus on its title, outside the profile’s form', sh.focus === TYPE_WORDS.sheetTitle && sh.inBody, sh);
      const rowsNow = await pg.$$eval('.atp-row', (els) => els.map((e) => `${e.dataset.type}:${e.querySelector('input').checked}`));
      ok('four rows, none ticked', rowsNow.join(' ') === 'creator:false crew:false cast:false studio:false', rowsNow);
      await pg.click('.atp-row[data-type="creator"] input');
      await pg.click('.atp-row[data-type="studio"] input');
      const note = await pg.$eval('.atp-row[data-type="creator"] .atp-row-note', (e) => ({ text: e.textContent, href: e.querySelector('a').getAttribute('href') })).catch(() => null);
      ok('Creator ticked by someone without the role: the note with the way to apply', note && note.text.startsWith(TYPE_WORDS.creatorNeedsApply) && note.href === '/apply', note);
      const mains = await pg.$$eval('.atp-row', (els) => els.map((e) => `${e.dataset.type}:${e.querySelector('.atp-main-pill') ? 'MAIN' : e.querySelector('.atp-makemain') ? 'make' : '-'}`));
      ok('the first ticked is MAIN, the other can be made main', mains.join(' ') === 'creator:MAIN crew:- cast:- studio:make', mains);
      await pg.click('.atp-row[data-type="studio"] .atp-makemain');
      ok('Make main moves the MAIN pill', (await pg.$$eval('.atp-row .atp-main-pill', (els) => els.map((e) => e.closest('.atp-row').dataset.type))).join() === 'studio');
      // The page behind never moves: a wheel over the backdrop and past the list's end.
      await pg.mouse.move(195, 40);
      await pg.mouse.wheel(0, 600);
      await pg.waitForTimeout(300);
      ok('a wheel over the backdrop leaves the page where it was', (await pg.evaluate(() => window.scrollY)) === startY, await pg.evaluate(() => window.scrollY));
      ok('no sideways scroll with the sheet open', (await overflowPx(pg)) <= 0, await overflowPx(pg));
      await shot(pg, 'sheet-390');
      await pg.click('.atp-sheet .atp-continue');
      await until(async () => !(await pg.$('.atp-sheet')));
      const after = await pg.evaluate(() => ({ value: document.querySelector('#types .atp-rowcard-value').textContent, focus: document.activeElement && document.activeElement.classList.contains('atp-rowcard-change') }));
      ok('Save closes the sheet and the row says Studio · also Creator', !(await pg.$('.atp-sheet')) && after.value === typesLine(['studio', 'creator'], 'studio') && after.value === 'Studio · also Creator', after);
      ok('…the focus back on Change', after.focus);
      ok('…saved in the database', JSON.stringify(stateOf(E.id)) === JSON.stringify({ types: ['studio', 'creator'], main: 'studio', asked: true }), stateOf(E.id));
      // The ☰ menu follows without a reload.
      await openMenu(pg);
      await pg.waitForSelector('.sm-you-types', { timeout: 10000 }).catch(() => {});
      const card = await pg.evaluate(() => ({ line: (document.querySelector('.sm-you-typeline') || {}).textContent, chips: [...document.querySelectorAll('.sm-you-radios [role="radio"]')].map((e) => `${e.textContent}:${e.getAttribute('aria-checked')}`) }));
      ok('the ☰ menu’s you card has the new line and chips', card.line === 'Studio · also Creator' && card.chips.join(' ') === 'Creator:false Studio:true', card);
      await pg.keyboard.press('Escape');
      await pg.waitForTimeout(300);
      // Escape and × close, and change nothing.
      await pg.click('#types .atp-rowcard-change');
      await pg.waitForSelector('.atp-sheet');
      await pg.click('.atp-row[data-type="cast"] input');
      await pg.keyboard.press('Escape');
      await pg.waitForTimeout(300);
      ok('Escape closes the sheet, nothing saved, the focus back on Change', !(await pg.$('.atp-sheet')) && JSON.stringify(stateOf(E.id).types) === '["studio","creator"]' && (await pg.evaluate(() => document.activeElement && document.activeElement.classList.contains('atp-rowcard-change'))));
      await pg.click('#types .atp-rowcard-change');
      await pg.waitForSelector('.atp-sheet');
      ok('…and opens again as it was saved', (await pg.$$eval('.atp-row input', (els) => els.map((e) => e.checked))).join() === 'true,false,false,true');
      await pg.click('.atp-sheet .atp-x');
      await pg.waitForTimeout(300);
      ok('× closes it', !(await pg.$('.atp-sheet')));
      ok('no page errors', errors.length === 0, errors);
      await ctx.close();
    }

    section('Account → Profile: the dialog on a laptop, #types');
    {
      const { ctx, page: pg, errors } = await b.open(A, 1280);
      await goto(pg, '/account/profile#types');
      await pg.waitForSelector('.atp-sheet', { timeout: 20000 }).catch(() => {});
      const dlg = await pg.evaluate(() => { const s = document.querySelector('.atp-sheet'); if (!s) return null; const r = s.getBoundingClientRect(); return { width: Math.round(r.width), mid: Math.round(r.left + r.width / 2), viewMid: Math.round(window.innerWidth / 2), top: r.top, bottom: window.innerHeight - r.bottom, focus: document.activeElement && document.activeElement.textContent, grab: getComputedStyle(document.querySelector('.atp-grab')).display }; });
      ok('/account/profile#types opens the sheet once the page has loaded', Boolean(dlg), dlg);
      ok('…a dialog in the middle from 900px, no grab handle', dlg && dlg.width === 480 && Math.abs(dlg.mid - dlg.viewMid) <= 1 && dlg.top > 20 && dlg.bottom > 20 && dlg.grab === 'none', dlg);
      ok('…with the focus on its title', dlg && dlg.focus === TYPE_WORDS.sheetTitle, dlg);
      const ticks = await pg.$$eval('.atp-row input', (els) => els.map((e) => e.checked));
      ok('…the saved types ticked, Cast the main', ticks.join() === 'false,true,true,false' && (await pg.$$eval('.atp-row .atp-main-pill', (els) => els.map((e) => e.closest('.atp-row').dataset.type))).join() === 'cast', ticks);
      // Tab stays inside.
      for (let i = 0; i < 14; i += 1) await pg.keyboard.press('Tab');
      ok('Tab stays inside the dialog', await pg.evaluate(() => Boolean(document.activeElement && document.activeElement.closest('.atp-sheet'))));
      await shot(pg, 'sheet-1280');
      await pg.keyboard.press('Escape');
      await pg.waitForTimeout(300);
      ok('Escape closes it and drops #types from the address', !(await pg.$('.atp-sheet')) && !pg.url().includes('#types'), pg.url());
      ok('no sideways scroll', (await overflowPx(pg)) <= 0, await overflowPx(pg));
      ok('no page errors', errors.length === 0, errors);
      await ctx.close();
    }

    section('The ☰ menu’s you card');
    {
      const { ctx, page: pg, errors } = await b.open(A, 390);
      await goto(pg, '/account/profile');
      await pg.waitForSelector('#types .atp-rowcard-value', { timeout: 20000 });
      await openMenu(pg);
      await pg.waitForSelector('.sm-you-types', { timeout: 10000 }).catch(() => {});
      const card = await pg.evaluate(() => ({
        line: (document.querySelector('.sm-you-typeline') || {}).textContent,
        label: (document.querySelector('.sm-you-main-label') || {}).textContent,
        group: (document.querySelector('.sm-you-radios') || {}).getAttribute && document.querySelector('.sm-you-radios').getAttribute('role'),
        chips: [...document.querySelectorAll('.sm-you-radios [role="radio"]')].map((e) => `${e.textContent}:${e.getAttribute('aria-checked')}`),
        add: (document.querySelector('.sm-type-add') || {}).getAttribute && [document.querySelector('.sm-type-add').textContent, document.querySelector('.sm-type-add').getAttribute('href')],
        note: (document.querySelector('.sm-you-note') || {}).textContent,
        afterName: (() => { const t = document.querySelector('.sm-you-types'); return Boolean(t && t.previousElementSibling && t.previousElementSibling.classList.contains('sm-you-row')); })()
      }));
      ok('under the name: the line Cast · also Crew', card.line === 'Cast · also Crew' && card.afterName, card);
      ok('…Your main and the chips as a radio group, Cast chosen', card.label === TYPE_WORDS.menuMain && card.group === 'radiogroup' && card.chips.join(' ') === 'Crew:false Cast:true', card);
      ok('…the dashed + Add a type to the sheet, and the note', card.add && card.add[0] === TYPE_WORDS.addType && card.add[1] === '/account/profile#types' && card.note === TYPE_WORDS.menuSwitchNote, card);
      ok('no sideways scroll with the menu open', (await overflowPx(pg)) <= 0, await overflowPx(pg));
      await shot(pg, 'menu-390');
      await pg.click('.sm-you-radios [role="radio"][data-type="crew"]');
      const at = await pg.evaluate(() => ({ chips: [...document.querySelectorAll('.sm-you-radios [role="radio"]')].map((e) => `${e.textContent}:${e.getAttribute('aria-checked')}`), line: document.querySelector('.sm-you-typeline').textContent }));
      ok('choosing Crew moves the main at once', at.chips.join(' ') === 'Crew:true Cast:false' && at.line === 'Crew · also Cast', at);
      ok('…and saves it', await until(() => stateOf(A.id).main === 'crew'), stateOf(A.id));
      await pg.waitForTimeout(400);
      ok('…the profile’s row on the page follows', (await pg.$eval('#types .atp-rowcard-value', (e) => e.textContent)) === 'Crew · also Cast');
      // A failed save puts the main back and says so.
      await pg.route('**/api/account/types', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"x"}' }));
      await pg.click('.sm-you-radios [role="radio"][data-type="cast"]');
      await pg.waitForSelector('.sm-you-err', { timeout: 10000 }).catch(() => {});
      const back = await pg.evaluate(() => ({ err: (document.querySelector('.sm-you-err') || {}).textContent, chips: [...document.querySelectorAll('.sm-you-radios [role="radio"]')].map((e) => `${e.textContent}:${e.getAttribute('aria-checked')}`) }));
      ok('a failed save puts Crew back and says so', back.err === TYPE_WORDS.failed && back.chips.join(' ') === 'Crew:true Cast:false', back);
      ok('…nothing changed in the database', stateOf(A.id).main === 'crew');
      await pg.unroute('**/api/account/types');
      await pg.click('.sm-type-add');
      await pg.waitForSelector('.atp-sheet', { timeout: 15000 }).catch(() => {});
      ok('+ Add a type closes the menu and opens the sheet on the same page', !(await pg.$('.site-menu')) && Boolean(await pg.$('.atp-sheet')), pathOf(pg));
      await pg.keyboard.press('Escape');
      ok('no page errors', errors.length === 0, errors);
      await ctx.close();

      // From another page, + Add a type goes to Account → Profile with the sheet open.
      const o = await b.open(A, 1280);
      await goto(o.page, '/crew');
      await openMenu(o.page);
      await o.page.waitForSelector('.sm-type-add', { timeout: 10000 });
      await o.page.click('.sm-type-add');
      await o.page.waitForSelector('.atp-sheet', { timeout: 60000 }).catch(() => {});
      ok('from another page it goes to Account → Profile with the sheet open', new URL(o.page.url()).pathname === '/account/profile' && Boolean(await o.page.$('.atp-sheet')), o.page.url());
      ok('no page errors', o.errors.length === 0, o.errors);
      await o.ctx.close();

      // A viewer with no type: the add chip alone; signed out: none of it.
      const v = await b.open(C, 390);
      await goto(v.page, '/stream');
      await openMenu(v.page);
      await v.page.waitForSelector('.sm-you-types', { timeout: 10000 }).catch(() => {});
      const vc = await v.page.evaluate(() => ({ line: Boolean(document.querySelector('.sm-you-typeline')), radios: document.querySelectorAll('.sm-you-radios [role="radio"]').length, add: Boolean(document.querySelector('.sm-type-add')), note: Boolean(document.querySelector('.sm-you-note')) }));
      ok('someone here to watch: + Add a type alone', !vc.line && vc.radios === 0 && vc.add && !vc.note, vc);
      ok('no page errors', v.errors.length === 0, v.errors);
      await v.ctx.close();
      const s = await b.open(SIGNED_OUT, 390);
      await goto(s.page, '/stream');
      await openMenu(s.page);
      ok('signed out: none of it', !(await s.page.$('.sm-you-types')) && Boolean(await s.page.$('.sm-out')));
      ok('no page errors', s.errors.length === 0, s.errors);
      await s.ctx.close();
    }

    section('The public profile');
    {
      // B has a working card; with Crew as the main it comes right after About.
      setTypes(B.id, ['crew', 'cast'], 'crew');
      const crew = await page(`/profile/${B.id}`, SIGNED_OUT);
      ok('the line under the name: Crew · also Cast', crew.status === 200 && /class="profile-types">Crew · also Cast</.test(crew.text), crew.status);
      ok('Crew main: the working card right after About, in the page and the jump list', pageIds(crew.text)[1] === 'profile-crew' && jumpIds(crew.text)[1] === 'profile-crew' && pageIds(crew.text).join() === jumpIds(crew.text).join(), { page: pageIds(crew.text), jump: jumpIds(crew.text) });
      // Creator main: Tagged in moves up to right after About.
      setTypes(B.id, ['crew', 'creator'], 'creator');
      const cr = await page(`/profile/${B.id}`, SIGNED_OUT);
      ok('Creator main: Tagged in right after About, then the rest in their order', pageIds(cr.text).slice(0, 3).join() === 'profile-about,profile-tagged,profile-crew' && jumpIds(cr.text).join() === pageIds(cr.text).join(), { page: pageIds(cr.text), jump: jumpIds(cr.text) });
      ok('…the line says Creator · also Crew', /class="profile-types">Creator · also Crew</.test(cr.text));
      // A watcher: no line, the usual order.
      setTypes(B.id, [], null);
      const w = await page(`/profile/${B.id}`, SIGNED_OUT);
      ok('here to watch: no line, About then the working card as before', !w.text.includes('class="profile-types"') && pageIds(w.text).slice(0, 2).join() === 'profile-about,profile-crew', pageIds(w.text));
      setTypes(B.id, ['crew', 'creator'], 'creator');
      for (const width of [320, 390, 1280]) {
        const { ctx, page: pg, errors } = await b.open(SIGNED_OUT, width);
        await goto(pg, `/profile/${B.id}`);
        const order = { page: await pageSections(pg), jump: await jumpList(pg) };
        ok(`${width}: the page and the jump list in the same order, in the DOM`, order.page.join() === order.jump.join() && order.page[1] === 'profile-tagged', order);
        ok(`${width}: no sideways scroll`, (await overflowPx(pg)) <= 0, await overflowPx(pg));
        if (width === 390) await shot(pg, 'profile-390');
        ok(`${width}: no page errors`, errors.length === 0, errors);
        await ctx.close();
      }
    }

    section('No sideways scroll at 320 / 390 / 1280');
    {
      clearTypes(E.id);
      for (const width of [320, 390, 1280]) {
        for (const [who, path, open] of [[E, '/start', null], [E, '/account', null], [A, '/account/profile', '#types .atp-rowcard-change']]) {
          const { ctx, page: pg, errors } = await b.open(who, width);
          await goto(pg, path);
          if (open) { await pg.waitForSelector(open, { timeout: 20000 }); await pg.click(open); await pg.waitForSelector('.atp-sheet'); await pg.waitForTimeout(300); }
          ok(`${width} ${path}${open ? ' (sheet open)' : ''}: no sideways scroll`, (await overflowPx(pg)) <= 0, await overflowPx(pg));
          if (path === '/start' && width === 320) {
            const foot = await pg.$eval('.atp-continue', (e) => { const r = e.getBoundingClientRect(); return { bottom: r.bottom, viewH: window.innerHeight }; });
            ok('320: the button stays on screen (the foot sticks)', foot.bottom <= foot.viewH, foot);
          }
          ok(`${width} ${path}: no page errors`, errors.length === 0, errors);
          await ctx.close();
        }
      }
    }
    void TYPE_LABELS;
  } finally {
    await b.close();
    sql(`delete from public.crew_cards where user_id = ${q(B.id)}`);
    for (const u of ALL) await removeUser(u.id);
    // The seed accounts start as they were seeded: never asked, no types.
    sql(`update public.user_profiles set account_types = '{}', main_type = null, account_type_asked_at = null where user_id in (${Object.values(USERS).map(q).join(', ')})`);
  }
});
