#!/usr/bin/env node
// Your work revamped, a title's dashboard and a show's Overview (Jose,
// 2026-11-14/15, the canvas https://claude.ai/artifact/6LuuNpyuaKTS5PkCij8Nfc;
// the agreement is mockups/work-revamp-contract.md).
//
//   1. Your work at 1280: the work tabs carry the counts the rules give for
//      the routes' own answers; Shows, Films, Shorts and a folded Vertical
//      in that order; a section folds and stays folded after a reload; a
//      show opens to its seasons and a season to its episodes; one row
//      design with its next step; the ⋯ menu closes on a click away and on
//      Escape (focus back to its button), and only one is open; Channels
//      from the menu and Cancel the request change the database; the tabs,
//      a deep link and the search narrow the page.
//   2. Your work at 390: nothing runs off the side, the buttons are at
//      least 44px tall.
//   3. A film's dashboard: the head, the tabs, the four numbers, the
//      checklist with its fixes (Add captions opens the captions box), the
//      tabs' cards, the Channels switch against the database, ?tab=, a
//      show's episode sent to its editor, a title that isn't theirs, a
//      viewer sent away; 390 with nothing off the side.
//   4. A show: the Overview · Episodes row; Episodes is the room as before
//      (the default), ?tab=overview the numbers, the episode table, Who's
//      on it.
//   5. The Dashboard's film row opens the film's dashboard.
//
//   node dev/test-rig/checks/work-revamp.mjs [--shots <dir>]
// Rig up. It seeds its own rows and removes them.
import fs from 'node:fs';
import path from 'node:path';
import { IDS, USERS, RUN, ok, section, runCheck, session, call, insert, sql, rows, q, ago, browser, goto, overflowPx } from './lib.mjs';
import { buildWorkList } from '../../../lib/workListRules.js';

const MARA = session(USERS.mara);
const VIEWER = session(USERS.viewer);
const shotsAt = process.argv.indexOf('--shots');
const SHOTS = shotsAt > -1 ? process.argv[shotsAt + 1] : null;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const shot = async (pg, name) => { if (SHOTS) await pg.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true }); };

const ID = {
  review: `ck-wk-review-${RUN}`,
  declined: `ck-wk-declined-${RUN}`,
  noArt: `ck-wk-noart-${RUN}`,
  removal: `ck-wk-removal-${RUN}`,
  vertical: `ck-wk-vert-${RUN}`,
  nbPending: `ck-wk-nb-pending-${RUN}`,
  dees: `ck-wk-dee-${RUN}`
};
const ALL = Object.values(ID);
const src = 'https://customer-rig.cloudflarestream.com/rig-video/manifest/video.m3u8';
const episode = (id, extra) => ({
  id, title: 'x', description: 'A check row.', tier: 'free', genre: 'Drama', main_genre: 'Drama', content_type: 'movie', artist: 'Mara Reyes', runtime: '24:00', rating: 'TV-PG', release_year: 2026,
  src, video_type: 'html5', video_provider: 'cloudflare', ads_enabled: true, deletion_requested: false, moderation_hold: false, submitted_by: USERS.mara, status: 'approved', reviewed_at: ago(2), released_at: ago(2), created_at: ago(3),
  thumbnail: 'https://127.0.0.1:54331/storage/v1/object/public/episode-art/rig/the-long-quiet-lx3k9a-thumb.jpg', poster: 'https://127.0.0.1:54331/storage/v1/object/public/episode-art/rig/the-long-quiet-lx3k9a-poster.jpg', captions_url: null, channel_opt_in: false, ...extra
});

function cleanup() {
  sql(`delete from public.audit_log where target_id in (${ALL.map(q).join(', ')})`);
  sql(`delete from public.notifications where message like ${q(`%ck-wk-%${RUN}%`)}`);
  sql(`delete from public.episodes where id in (${ALL.map(q).join(', ')})`);
  sql(`update public.episodes set channel_opt_in = false where id = ${q(IDS.film)}`);
}

function seed() {
  insert('episodes', episode(ID.review, { title: `Salt ${RUN}`, status: 'pending', reviewed_at: null, released_at: null, created_at: ago(1) }));
  insert('episodes', episode(ID.declined, { title: `Static ${RUN}`, content_type: 'short', status: 'rejected', rejection_reason: 'Uses a commercial track we can’t clear.' }));
  insert('episodes', episode(ID.noArt, { title: `Paper Boats ${RUN}`, content_type: 'short', thumbnail: null, poster: null, captions_url: 'private:captions/x.vtt' }));
  insert('episodes', episode(ID.removal, { title: `Echo Park ${RUN}`, deletion_requested: true, deletion_reason: `Recutting it ${RUN}`, deletion_requested_at: ago(1) }));
  insert('episodes', episode(ID.vertical, { title: `Rooftop ${RUN}`, content_type: 'vertical', runtime: '0:48' }));
  insert('episodes', episode(ID.nbPending, { title: `The Depot ${RUN}`, content_type: 'series', series_id: IDS.nightBus, season: 2, series_order: 8, status: 'pending', reviewed_at: null, released_at: null, created_at: ago(1) }));
  insert('episodes', episode(ID.dees, { title: `Dee film ${RUN}`, submitted_by: USERS.dee, artist: 'Dee Park' }));
}

const json = async (pathname, who) => {
  const r = await call(pathname, { who });
  return { status: r.status, body: r.json || {} };
};
const db = (id, col) => {
  const r = rows(`select ${col} from public.episodes where id = ${q(id)}`);
  if (!r.length) return null;
  const v = r[0][col];
  return v === true ? 't' : v === false ? 'f' : v;
};

await runCheck('work-revamp', async () => {
  cleanup();
  seed();
  const b = await browser();
  try {
    // ---------------------------------------------------------------- 1
    section('Your work at 1280');
    const [subs, shows, pricing] = await Promise.all([json('/api/creator/my-submissions', MARA), json('/api/show?mine=1', MARA), json('/api/creator/pricing', MARA)]);
    const model = buildWorkList({ submissions: subs.body.submissions, shows: shows.body.shows, prices: pricing.body.prices });
    const { page: pg, errors } = await b.open(MARA, 1280);
    ok('the page answers', (await goto(pg, '/creator/my-work')) === 200);
    await pg.waitForSelector('.wk-tab .wk-tab-n', { timeout: 60000 });
    await pg.waitForTimeout(1200);
    await shot(pg, 'work-1280');
    ok('the row of creator tabs, Your work current', (await pg.locator('.dash-tabs .dash-tab.on').innerText()).trim() === 'Your work');
    const tabs = await pg.$$eval('.wk-tab', (els) => els.map((e) => ({ text: e.innerText.replace(/\s+/g, ' ').trim(), pressed: e.getAttribute('aria-pressed') })));
    ok('five work tabs with the rules’ counts for the routes’ answers', tabs.length === 5 && tabs.every((t, i) => t.text === `${model.tabs[i].label} ${model.tabs[i].count}`), JSON.stringify({ tabs, want: model.tabs }));
    ok('All is pressed', tabs[0] && tabs[0].pressed === 'true');
    const secs = await pg.$$eval('.wk-sec-btn', (els) => els.map((e) => ({ text: e.innerText.replace(/\s+/g, ' ').trim(), open: e.getAttribute('aria-expanded') })));
    ok('Shows, Films, Shorts, then Vertical', secs.map((s) => s.text.replace(/\s*\d+$/, '')).join(',').toUpperCase() === 'SHOWS,FILMS,SHORTS,VERTICAL', JSON.stringify(secs));
    ok('Vertical starts folded, the rest open', secs.length === 4 && secs[3].open === 'false' && secs.slice(0, 3).every((s) => s.open === 'true'), JSON.stringify(secs));
    ok('no Snippet word on the page', !/snippet/i.test(await pg.locator('main').innerText()));
    await pg.locator('.wk-sec-btn', { hasText: /vertical/i }).click();
    await pg.waitForTimeout(300);
    ok('…opened, Vertical says where its titles are going', /profile/i.test(await pg.locator('.wk-sec', { has: pg.locator('.wk-sec-btn', { hasText: /vertical/i }) }).innerText()) && (await pg.locator('.wk-row', { hasText: `Rooftop ${RUN}` }).count()) === 1);
    await pg.locator('.wk-sec-btn', { hasText: /vertical/i }).click();
    const filmsText = await pg.locator('.wk-sec', { has: pg.locator('.wk-sec-btn', { hasText: /films/i }) }).innerText();
    ok('Films holds the films, not the shorts', filmsText.includes(`Salt ${RUN}`) && filmsText.includes(`Echo Park ${RUN}`) && !filmsText.includes(`Static ${RUN}`));
    ok('Dee’s film is not on Mara’s page', !(await pg.locator('main').innerText()).includes(`Dee film ${RUN}`));

    const removalRow = pg.locator('.wk-row', { hasText: `Echo Park ${RUN}` });
    ok('a removal request shows its reason', (await removalRow.innerText()).includes(`Recutting it ${RUN}`));
    const declinedRow = pg.locator('.wk-row', { hasText: `Static ${RUN}` });
    ok('a sent-back short says why and offers Replace the file', /commercial track/.test(await declinedRow.innerText()) && (await declinedRow.locator('button.wk-next').innerText()).includes('Replace the file'));
    const noArtRow = pg.locator('.wk-row', { hasText: `Paper Boats ${RUN}` });
    ok('a short with no artwork offers Add artwork', (await noArtRow.locator('button.wk-next').innerText()).includes('Add artwork'));
    const filmRow = pg.locator('.wk-row', { hasText: 'The Long Quiet' });
    ok('a film’s row opens its dashboard', (await filmRow.locator('a.wk-row-link').first().getAttribute('href')) === `/creator/title/${IDS.film}`);

    // Folding a section, remembered across a reload.
    await pg.locator('.wk-sec-btn', { hasText: /films/i }).click();
    await pg.waitForTimeout(300);
    ok('Films folds', (await pg.locator('.wk-sec-btn', { hasText: /films/i }).getAttribute('aria-expanded')) === 'false' && !(await pg.locator('.wk-row', { hasText: 'The Long Quiet' }).isVisible().catch(() => false)));
    await pg.reload({ waitUntil: 'load' });
    await pg.waitForSelector('.wk-tab .wk-tab-n', { timeout: 60000 });
    await pg.waitForTimeout(800);
    ok('…and stays folded after a reload', (await pg.locator('.wk-sec-btn', { hasText: /films/i }).getAttribute('aria-expanded')) === 'false');
    await pg.locator('.wk-sec-btn', { hasText: /films/i }).click();
    await pg.waitForTimeout(300);
    ok('…and opens again', (await pg.locator('.wk-sec-btn', { hasText: /films/i }).getAttribute('aria-expanded')) === 'true');

    // A show opens to its seasons, a season to its episodes.
    const nb = pg.locator('.wk-show', { hasText: 'Night Bus' });
    ok('a show starts folded', (await nb.locator('.wk-season').count()) === 0);
    const nbToggle = nb.locator('button', { hasText: /^Show .*season/ });
    ok('…with a button saying what opens', /Show 2 seasons and extras/.test(await nbToggle.innerText()));
    await nbToggle.click();
    await pg.waitForTimeout(300);
    const seasons = await nb.locator('.wk-season-btn').evaluateAll((els) => els.map((e) => ({ text: e.innerText.replace(/\s+/g, ' ').trim(), open: e.getAttribute('aria-expanded') })));
    ok('open, it lists Season 1, Season 2 and Extras, each folded', seasons.length === 3 && /Season 1/.test(seasons[0].text) && /Season 2/.test(seasons[1].text) && /Extras/.test(seasons[2].text) && seasons.every((s) => s.open === 'false'), JSON.stringify(seasons));
    ok('…Season 2 counts its episode in review', /1 in review/.test(seasons[1] && seasons[1].text), JSON.stringify(seasons[1]));
    await nb.locator('.wk-season-btn', { hasText: /Season 2/ }).click();
    await pg.waitForTimeout(300);
    const pendingRow = nb.locator('.wk-row', { hasText: `The Depot ${RUN}` });
    ok('a season opens to its episodes; the one in review says so', (await pendingRow.count()) === 1 && /In review/i.test(await pendingRow.innerText()));
    ok('…and opens its editor', (await pendingRow.locator('a.wk-row-link').first().getAttribute('href')) === `/creator/show/${IDS.nightBus}/episode/${ID.nbPending}`);
    ok('Season 1 stays folded', (await nb.locator('.wk-season-btn', { hasText: /Season 1/ }).getAttribute('aria-expanded')) === 'false');

    // The ⋯ menu.
    const more = filmRow.locator('button.wk-more');
    await more.click();
    await pg.waitForTimeout(250);
    const items = await pg.locator('[role="menu"] [role^="menuitem"]').evaluateAll((els) => els.map((e) => e.innerText.replace(/\s+/g, ' ').trim()));
    ok('the ⋯ menu has a word on every item', items.length >= 8 && items.every((t) => t.length > 2) && items[0].startsWith('Open its dashboard'), JSON.stringify(items));
    await pg.locator('h1').click();
    await pg.waitForTimeout(250);
    ok('…it closes on a click away', (await pg.locator('[role="menu"]').count()) === 0);
    await more.click();
    await pg.waitForTimeout(250);
    await pg.keyboard.press('Escape');
    await pg.waitForTimeout(250);
    ok('…and on Escape, with the focus back on its button', (await pg.locator('[role="menu"]').count()) === 0 && (await more.evaluate((el) => el === document.activeElement)));
    await more.click();
    await pg.waitForTimeout(250);
    await removalRow.locator('button.wk-more').click();
    await pg.waitForTimeout(250);
    ok('…only one is open at a time', (await pg.locator('[role="menu"]').count()) === 1);
    await pg.keyboard.press('Escape');

    // Channels from the menu, against the database.
    await more.click();
    await pg.waitForTimeout(250);
    await pg.locator('[role="menu"] [role^="menuitem"]', { hasText: 'Channels can air it' }).click();
    await pg.waitForTimeout(1500);
    ok('Channels from the menu turns it on in the database', db(IDS.film, 'channel_opt_in') === 't');
    await pg.keyboard.press('Escape');
    await pg.waitForTimeout(250);

    // Cancel a removal request from the row's button.
    await removalRow.locator('button.wk-next').click();
    await pg.waitForTimeout(2000);
    ok('Cancel the request clears it in the database', db(ID.removal, 'deletion_requested') === 'f');

    // Tabs, a deep link and the search.
    await pg.locator('.wk-tab', { hasText: 'Not this time' }).click();
    await pg.waitForTimeout(400);
    const declinedOnly = await pg.locator('main .wk-row').evaluateAll((els) => els.filter((e) => e.offsetParent !== null).map((e) => e.innerText));
    ok('Not this time shows only what was sent back', declinedOnly.length >= 1 && declinedOnly.every((t) => /Not this time/i.test(t)), JSON.stringify(declinedOnly.map((t) => t.slice(0, 40))));
    ok('…and says so in the address', /tab=declined/.test(pg.url()));
    await goto(pg, '/creator/my-work?status=pending');
    await pg.waitForSelector('.wk-tab .wk-tab-n', { timeout: 60000 });
    ok('?status=pending opens In review', (await pg.locator('.wk-tab[aria-pressed="true"]').innerText()).startsWith('In review'));
    await goto(pg, '/creator/my-work');
    await pg.waitForSelector('.wk-tab .wk-tab-n', { timeout: 60000 });
    await pg.locator('#wk-search').fill('night');
    await pg.waitForTimeout(400);
    const afterSearch = await pg.$$eval('.wk-sec-btn', (els) => els.map((e) => e.innerText.replace(/\s+/g, ' ').trim()));
    ok('the search finds the show by its name and nothing else', afterSearch.length === 1 && /shows/i.test(afterSearch[0]), JSON.stringify(afterSearch));
    await pg.locator('#wk-search').fill('zzzz-nothing');
    await pg.waitForTimeout(400);
    ok('…a search with no match says so and offers Show everything', /Nothing here matches/.test(await pg.locator('main').innerText()) && (await pg.locator('button', { hasText: 'Show everything' }).count()) === 1);
    ok('no page errors at 1280', errors.length === 0, JSON.stringify(errors));
    ok('nothing runs off the side at 1280', (await overflowPx(pg)) <= 0);

    // ---------------------------------------------------------------- 2
    section('Your work at 390');
    const phone = await b.open(MARA, 390);
    await goto(phone.page, '/creator/my-work');
    await phone.page.waitForSelector('.wk-tab .wk-tab-n', { timeout: 60000 });
    await phone.page.waitForTimeout(800);
    await shot(phone.page, 'work-390');
    ok('nothing runs off the side at 390', (await overflowPx(phone.page)) <= 0);
    const small = await phone.page.$$eval('.wk-tab, .wk-sec-btn, .wk-btn, button.wk-more, button.wk-next', (els) => els.filter((e) => e.offsetParent !== null).map((e) => ({ t: e.innerText.slice(0, 20), h: Math.round(e.getBoundingClientRect().height) })).filter((x) => x.h < 44));
    ok('the buttons are at least 44px tall on a phone', small.length === 0, JSON.stringify(small));
    ok('no page errors at 390', phone.errors.length === 0, JSON.stringify(phone.errors));

    // ---------------------------------------------------------------- 3
    section('A film’s dashboard');
    ok('Your work’s Channels change is undone for the dashboard', (sql(`update public.episodes set channel_opt_in = false where id = ${q(IDS.film)}`), db(IDS.film, 'channel_opt_in') === 'f'));
    const { page: tp, errors: terrs } = await b.open(MARA, 1280);
    ok('the page answers', (await goto(tp, `/creator/title/${IDS.film}`)) === 200);
    await tp.waitForSelector('.td-head h1', { timeout: 60000 });
    await tp.waitForTimeout(1500);
    await shot(tp, 'title-1280');
    ok('the head names the film, Film and Live', (await tp.locator('.td-head h1').innerText()).trim() === 'The Long Quiet' && /FILM/i.test(await tp.locator('.td-head').innerText()) && /LIVE/i.test(await tp.locator('.td-head').innerText()));
    const ttabs = await tp.$$eval('.td-tabs .td-tab', (els) => els.map((e) => e.innerText.trim()));
    ok('the title tabs', ttabs.join(',') === 'Overview,Details,Artwork,Video and captions,Selling,Channels', JSON.stringify(ttabs));
    ok('the four numbers', (await tp.locator('.dash-tile, .td-o .dash-tile').count()) >= 4);
    const checks = await tp.locator('.td-check').evaluateAll((els) => els.map((e) => e.innerText.replace(/\s+/g, ' ').trim()));
    ok('the checklist names what is missing', checks.some((c) => /Captions/.test(c) && /Add captions/.test(c)) && checks.some((c) => /Channels can air it/.test(c)), JSON.stringify(checks));
    await tp.locator('.td-check', { hasText: 'Captions' }).locator('button', { hasText: 'Add captions' }).click();
    await tp.waitForTimeout(800);
    ok('Add captions opens the captions box', (await tp.locator('.modal-backdrop, [role="dialog"]').count()) > 0);
    await tp.keyboard.press('Escape');
    await tp.waitForTimeout(300);
    if ((await tp.locator('.modal-backdrop').count()) > 0) await tp.locator('.modal-backdrop button', { hasText: /Cancel|Close|✕/ }).first().click().catch(() => {});
    await goto(tp, `/creator/title/${IDS.film}?tab=channels`);
    await tp.waitForSelector('[role="switch"]', { timeout: 60000 });
    ok('?tab=channels opens the Channels tab', (await tp.locator('.td-tab[aria-current="page"]').innerText()).trim() === 'Channels');
    const sw = tp.locator('[role="switch"]');
    ok('…a real switch, off', (await sw.getAttribute('aria-checked')) === 'false');
    await sw.click();
    await tp.waitForTimeout(1500);
    ok('…turning it on reaches the database', db(IDS.film, 'channel_opt_in') === 't' && (await sw.getAttribute('aria-checked')) === 'true');
    await sw.click();
    await tp.waitForTimeout(1500);
    ok('…and off again', db(IDS.film, 'channel_opt_in') === 'f');
    await goto(tp, `/creator/title/${IDS.film}?tab=details`);
    await tp.waitForTimeout(1200);
    ok('Details lists the facts and its edit button', /Who can watch/.test(await tp.locator('main').innerText()) && (await tp.locator('button', { hasText: /Edit title/ }).count()) >= 1);
    await goto(tp, `/creator/title/${IDS.nbS1E3}`);
    await tp.waitForTimeout(3000);
    ok('a show’s episode is sent to its editor', tp.url().includes(`/creator/show/${IDS.nightBus}/episode/${IDS.nbS1E3}`), tp.url());
    await goto(tp, `/creator/title/${ID.dees}`);
    await tp.waitForTimeout(2500);
    ok('a title that isn’t theirs says so', /isn’t one of yours/.test(await tp.locator('main').innerText()));
    ok('a bad id is a 404', (await call('/creator/title/no%20such', { who: MARA, accept: 'text/html' })).status === 404);
    ok('a viewer is sent away', [302, 307].includes((await call(`/creator/title/${IDS.film}`, { who: VIEWER, accept: 'text/html' })).status));
    ok('no page errors on the dashboard', terrs.length === 0, JSON.stringify(terrs));
    const tphone = await b.open(MARA, 390);
    await goto(tphone.page, `/creator/title/${IDS.film}`);
    await tphone.page.waitForSelector('.td-head h1', { timeout: 60000 });
    await tphone.page.waitForTimeout(1200);
    await shot(tphone.page, 'title-390');
    ok('nothing runs off the side at 390', (await overflowPx(tphone.page)) <= 0);

    // ---------------------------------------------------------------- 4
    section('A show’s Overview');
    const { page: sp, errors: serrs } = await b.open(MARA, 1280);
    await goto(sp, `/creator/show/${IDS.nightBus}`);
    await sp.waitForTimeout(2500);
    const stabs = await sp.$$eval('.td-show-tabs a, .td-show-tabs button', (els) => els.map((e) => ({ t: e.innerText.trim(), cur: e.getAttribute('aria-current') })));
    ok('the show page has Overview · Episodes', stabs.map((x) => x.t).join(',') === 'Overview,Episodes', JSON.stringify(stabs));
    ok('…and still opens on Episodes, the room as before', (stabs[1] && stabs[1].cur === 'page') && (await sp.locator('.show-room').count()) === 1);
    await goto(sp, `/creator/show/${IDS.nightBus}?tab=overview`);
    await sp.waitForTimeout(3000);
    await shot(sp, 'show-overview-1280');
    ok('?tab=overview draws the Overview in the room’s place', (await sp.locator('.show-room').count()) === 0 && /Episode by episode/.test(await sp.locator('main, body').first().innerText()));
    const epRows = await sp.locator('.td-table tbody tr').count();
    ok('…one table row per episode and extra', epRows === 7, String(epRows));
    ok('…Who’s on it names who runs it', /Runs it/.test(await sp.locator('body').innerText()));
    ok('…the episode in review says so', /in review/i.test(await sp.locator('.td-table').innerText()));
    ok('no page errors on the show', serrs.length === 0, JSON.stringify(serrs));

    // ---------------------------------------------------------------- 5
    section('The Dashboard');
    const { page: dp } = await b.open(MARA, 1280);
    await goto(dp, '/creator/dashboard');
    await dp.waitForTimeout(3000);
    const filmHref = await dp.locator('.dash-row-main', { hasText: 'The Long Quiet' }).first().getAttribute('href').catch(() => null);
    ok('the Dashboard’s film row opens the film’s dashboard', filmHref === `/creator/title/${IDS.film}`, String(filmHref));
  } finally {
    await b.close();
    cleanup();
  }
});
