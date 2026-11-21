#!/usr/bin/env node
// Private screening links (migration 128): the website's creator side in a
// browser, against the real routes — a film's Private screenings tab (empty,
// + New link, the box, a quick window, the suggested password, the ready
// card, the new card), a link's own page (the tiles, a guest's open showing
// up with its city, Edit settings, End it now, Run it again), discarding the
// ended one from the tab, a show's link for one season, the Distribution
// page's card, and the tab, the box and a link's page on a phone with
// nothing off the side; no page errors anywhere.
//   node dev/test-rig/checks/screenings-creator.mjs
import crypto from 'node:crypto';
import { BASE, RUN, USERS, IDS, ok, section, runCheck, call, sql, rows, q, session, browser, goto, overflowPx } from './lib.mjs';

const MARA = session(USERS.mara);
const LABEL = `Rig festival ${RUN}`;
const SHOW_LABEL = `Rig cinetic ${RUN}`;
const PRODUCTION = crypto.randomUUID();

await runCheck('screenings-creator', async () => {
  const b = await browser();
  const errorsAll = [];
  try {
    sql(`insert into public.productions (id, owner_id, title, release_type, release_id, release_title) values (${q(PRODUCTION)}, ${q(USERS.mara)}, ${q(`Rig production ${RUN}`)}, 'episode', ${q(IDS.film)}, 'The Long Quiet')`);

    section('A film’s Private screenings tab, and a new link through the box');
    const { page: pg, errors } = await b.open(MARA, 1280);
    errorsAll.push(errors);
    let status = await goto(pg, `/creator/title/${IDS.film}?tab=screenings`);
    ok('the tab opens (200)', status === 200, status);
    await pg.getByRole('button', { name: '+ New link' }).first().waitFor({ timeout: 60000 });
    ok('+ New link is there', await pg.getByRole('button', { name: '+ New link' }).count() > 0);
    await pg.getByRole('button', { name: '+ New link' }).first().click();
    const dlg = pg.getByRole('dialog');
    await dlg.waitFor({ timeout: 20000 });
    ok('the box opens', await dlg.isVisible());
    await pg.locator('#scn-f-label').fill(LABEL);
    await dlg.getByRole('button', { name: 'A week' }).click();
    const suggested = await pg.locator('#scn-f-password').inputValue();
    ok('a password is suggested (two words and a number)', /^[a-z]+-[a-z]+-\d{2}$/.test(suggested), suggested);
    const bodyBehind = await pg.evaluate(() => window.scrollY);
    await pg.mouse.wheel(0, 600);
    await pg.waitForTimeout(300);
    ok('the page behind the box doesn’t scroll', (await pg.evaluate(() => window.scrollY)) === bodyBehind);
    await dlg.getByRole('button', { name: 'Make the link' }).click();
    await pg.getByText('Your link is ready').waitFor({ timeout: 30000 });
    ok('the ready card shows the link and the password', (await pg.getByText(suggested).count()) > 0 && (await pg.getByText('/screener/').count()) > 0);
    const made = rows(`select id, token, owner_id, password_hash, expires_at, starts_at, scope from public.screeners where label = ${q(LABEL)}`)[0];
    ok('the row: Mara’s, a password kept as a hash, the film', made && made.owner_id === USERS.mara && /^scrypt/.test(made.password_hash || '') && made.scope === 'title', made);
    const days = made ? (Date.parse(made.expires_at) - Date.parse(made.starts_at)) / 86400000 : 0;
    ok('“A week” ends about seven days out', days > 6.5 && days < 8, days);
    await dlg.getByRole('button', { name: 'Done' }).click();
    await pg.waitForTimeout(800);
    ok('the new card is in the list', (await pg.getByText(LABEL).count()) > 0);
    ok('…and says Live', (await pg.locator('.scn-card', { hasText: LABEL }).getByText('Live').count()) > 0);

    section('A link’s own page');
    await pg.locator('.scn-card', { hasText: LABEL }).getByRole('link', { name: /Open/ }).click();
    await pg.waitForURL(/\/creator\/screenings\//, { timeout: 60000 });
    await pg.getByText('Who watched').first().waitFor({ timeout: 60000 });
    ok('it opens on /creator/screenings/<id>', pg.url().includes(`/creator/screenings/${made.id}`), pg.url());
    await pg.getByText('Watched through', { exact: true }).first().waitFor({ timeout: 30000 }).catch(() => {});
    const pageText = await pg.evaluate(() => document.body.innerText);
    for (const w of ['Opens', 'People', 'Watched through', 'Where', 'Settings', 'Copy the invite']) ok(`it shows “${w}”`, (await pg.getByText(w, { exact: true }).count()) > 0, pageText.slice(0, 400));
    // A guest opens it from Austin.
    const opened = await call(`/api/screener/${made.token}/open`, { method: 'POST', body: { password: suggested }, headers: { Origin: BASE, 'x-forwarded-for': '198.51.100.7', 'x-vercel-ip-city': 'Austin', 'x-vercel-ip-country-region': 'TX', 'x-vercel-ip-country': 'US', 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15' } });
    ok('a guest opens it with the password', opened.status === 200 && opened.json && opened.json.session, opened.text.slice(0, 160));
    await pg.reload({ waitUntil: 'load' });
    await pg.getByText('Who watched').first().waitFor({ timeout: 60000 });
    ok('the page lists the guest from Austin, TX', (await pg.getByText('Guest', { exact: true }).count()) > 0 && (await pg.getByText('Austin, TX').count()) > 0);

    await pg.getByRole('button', { name: 'Edit settings' }).click();
    await dlg.waitFor({ timeout: 20000 });
    await pg.locator('#scn-f-maxViews').fill('30');
    await dlg.getByRole('button', { name: 'Save' }).click();
    await pg.waitForTimeout(1500);
    ok('Edit settings saves the total (30 opens)', rows(`select max_views from public.screeners where id = ${q(made.id)}`)[0].max_views === 30);
    ok('…and the page says so', (await pg.getByText(/30 opens/).count()) > 0);

    await pg.getByRole('button', { name: 'End it now…' }).click();
    await pg.getByRole('dialog').getByRole('button', { name: 'End it now' }).click();
    await pg.waitForTimeout(1500);
    ok('End it now ends it', Boolean(rows(`select revoked_at from public.screeners where id = ${q(made.id)}`)[0].revoked_at));
    ok('…and the page says Stopped by you', (await pg.getByText(/Stopped by you/).count()) > 0);
    ok('…and offers Run it again', (await pg.getByRole('button', { name: 'Run it again' }).count()) > 0);

    await pg.getByRole('button', { name: 'Run it again' }).first().click();
    await pg.getByText('A new link with the same settings').waitFor({ timeout: 20000 });
    await pg.getByRole('button', { name: 'Make the new link' }).click();
    await pg.waitForTimeout(2500);
    const again = rows(`select id, token, run_from, max_views from public.screeners where run_from = ${q(made.id)}`)[0];
    ok('Run it again makes a new link from the old one, with its settings', again && again.max_views === 30 && again.token !== made.token, again);

    section('Discard the ended one from the tab');
    await goto(pg, `/creator/title/${IDS.film}?tab=screenings`);
    await pg.getByText('Ended', { exact: true }).first().waitFor({ timeout: 60000 });
    const endedCard = pg.locator('.scn-card', { hasText: LABEL }).filter({ has: pg.getByRole('button', { name: 'Discard…' }) });
    ok('the ended link is under Ended with Discard…', (await endedCard.count()) > 0);
    await endedCard.first().getByRole('button', { name: 'Discard…' }).click();
    await pg.getByRole('dialog').getByRole('button', { name: 'Discard it' }).click();
    await pg.waitForTimeout(1500);
    ok('Discard removes it for good', rows(`select id from public.screeners where id = ${q(made.id)}`).length === 0);
    ok('…and the run-again link stays', rows(`select id from public.screeners where id = ${q(again.id)}`).length === 1);

    section('A show’s link for one season');
    status = await goto(pg, `/creator/show/${IDS.nightBus}?tab=screenings`);
    ok('the show’s tab opens (200)', status === 200, status);
    await pg.getByRole('button', { name: '+ New link' }).first().waitFor({ timeout: 60000 });
    await pg.getByRole('button', { name: '+ New link' }).first().click();
    await dlg.waitFor({ timeout: 20000 });
    await pg.locator('#scn-f-label').fill(SHOW_LABEL);
    // The show's seasons are chips of their own beside Whole show and Pick episodes….
    ok('the box offers Whole show, the seasons and Pick episodes…', (await dlg.getByRole('button', { name: 'Whole show' }).count()) === 1 && (await dlg.getByRole('button', { name: 'Pick episodes…' }).count()) === 1);
    await dlg.locator('#scn-f-scope').getByRole('button', { name: /Season 1/ }).first().click();
    await dlg.getByRole('button', { name: 'Make the link' }).click();
    await pg.getByText('Your link is ready').waitFor({ timeout: 30000 });
    const showLink = rows(`select scope, season, target_type, array_length(episode_ids, 1) as n from public.screeners where label = ${q(SHOW_LABEL)}`)[0];
    ok('a season link: the show, season 1, its episodes kept', showLink && showLink.target_type === 'series' && showLink.scope === 'season' && Number(showLink.season) === 1 && Number(showLink.n) >= 1, showLink);
    await dlg.getByRole('button', { name: 'Done' }).click();

    section('The Distribution page');
    status = await goto(pg, `/productions/${PRODUCTION}/distribution`);
    ok('it opens (200)', status === 200, status);
    await pg.waitForTimeout(1500);
    ok('its card is Private screenings, linking to the title’s tab', (await pg.getByText('Private screenings').count()) > 0 && (await pg.locator(`a[href*="/creator/title/${IDS.film}"][href*="tab=screenings"]`).count()) > 0);
    ok('…listing the film’s live link', (await pg.getByText(LABEL).count()) > 0);
    ok('no page errors at 1280', errors.length === 0, errors.slice(0, 3));
    await pg.context().close();

    section('On a phone (390)');
    const phone = await b.open(MARA, 390);
    errorsAll.push(phone.errors);
    await goto(phone.page, `/creator/title/${IDS.film}?tab=screenings`);
    await phone.page.getByRole('button', { name: '+ New link' }).first().waitFor({ timeout: 60000 });
    ok('the tab: nothing off the side', (await overflowPx(phone.page)) <= 0, await overflowPx(phone.page));
    await phone.page.getByRole('button', { name: '+ New link' }).first().click();
    const pdlg = phone.page.getByRole('dialog');
    await pdlg.waitFor({ timeout: 20000 });
    const box = await pdlg.boundingBox();
    ok('the box is a full-width sheet', box && box.width >= 380, box);
    ok('…nothing off the side', (await overflowPx(phone.page)) <= 0);
    const fieldSize = await phone.page.locator('#scn-f-label').evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    ok('fields are 16px or more (no zoom on tap)', fieldSize >= 16, fieldSize);
    await phone.page.keyboard.press('Escape');
    await goto(phone.page, `/creator/screenings/${again.id}`);
    await phone.page.getByText('Who watched').first().waitFor({ timeout: 60000 });
    ok('a link’s page: nothing off the side', (await overflowPx(phone.page)) <= 0, await overflowPx(phone.page));
    ok('no page errors at 390', phone.errors.length === 0, phone.errors.slice(0, 3));
    await phone.ctx.close();
  } finally {
    try {
      sql(`delete from public.screeners where label in (${q(LABEL)}, ${q(SHOW_LABEL)})`);
      sql(`delete from public.productions where id = ${q(PRODUCTION)}`);
      sql(`delete from public.notifications where user_id = ${q(USERS.mara)} and type like 'screening_%'`);
    } catch (err) {
      console.log('cleanup:', err.message);
    }
    await b.close();
  }
});
