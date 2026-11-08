#!/usr/bin/env node
// Films and shorts on the own-page landing (pages/episode/[id].js, 2026-11-08)
// and the notes for a title's page (Your work's edit box, the Library's
// admin modal). Rig up, any migration from 118 on.
//   node dev/test-rig/checks/films-landing.mjs
import { IDS, USERS, RUN, ok, section, runCheck, call, page, sql, rows, q, insert, session, SIGNED_OUT, SIGNED_OUT_NO_TERMS, newUser, removeUser, browser, goto, overflowPx, stripeHook, uidFor, ago } from './lib.mjs';

const MARA = session(USERS.mara);
const DEE = session(USERS.dee);
const ADMIN = session(USERS.admin);
const VIEWER = session(USERS.viewer);

const ID = {
  notes: `ck-notes-film-${RUN}`,
  pending: `ck-pending-film-${RUN}`,
  nopage: `ck-nopage-film-${RUN}`,
  edit: `ck-edit-film-${RUN}`
};
const src = (key) => `https://customer-test.cloudflarestream.com/${uidFor(key)}/manifest/video.m3u8`;
const film = (id, extra) => ({
  id, title: `Check film ${id.slice(3, 12)}`, description: `The description of ${id}.`, tier: 'free', genre: 'Drama', main_genre: 'Drama', content_type: 'movie',
  artist: 'Mara Reyes', runtime: '1:20:00', rating: 'TV-PG', release_year: 2026, src: src(IDS.film), video_type: 'html5', video_provider: 'cloudflare',
  ads_enabled: true, deletion_requested: false, moderation_hold: false, submitted_by: USERS.mara, status: 'approved', reviewed_at: ago(3), released_at: ago(3), created_at: ago(5),
  thumbnail: null, poster: null, ...extra
});

function seed() {
  insert('episodes', film(ID.notes, { page_notes: 'We shot it in eleven nights.\n\nThe second paragraph of the notes.' }));
  insert('episodes', film(ID.pending, { status: 'pending', reviewed_at: null, released_at: null, title: 'Check pending film' }));
  insert('episodes', film(ID.nopage, { has_page: false, title: 'Check film without a page' }));
  insert('episodes', film(ID.edit, { title: 'Check film to edit', description: 'Before the edit.' }));
}
function cleanup() {
  const ids = Object.values(ID).map(q).join(', ');
  sql(`delete from public.notifications where episode_id in (${ids}) or message like '%Check film%'`);
  sql(`delete from public.audit_log where target_id in (${ids})`);
  sql(`delete from public.episodes where id in (${ids})`);
}

// The words on the landing's Play pill.
const playWord = (html) => {
  const m = /<button[^>]*class="epl-btn is-play"[^>]*>([\s\S]*?)<\/button>/.exec(html || '');
  return m ? m[1].replace(/<[^>]+>/g, '').replace(/<!-- -->/g, '').trim() : null;
};
const has = (html, cls) => new RegExp(`class="[^"]*\\b${cls}\\b`).test(html);

async function httpPart() {
  section('HTTP: who sees which view');
  // Signed out, the seed film (free, a trailer, its page on).
  let r = await page(`/episode/${IDS.film}`);
  ok('film signed out → 200', r.status === 200, r.status);
  ok('film signed out → the landing strip (.epl-strip)', has(r.text, 'epl-strip'));
  ok('film signed out → no old hero (.hero-carousel)', !has(r.text, 'hero-carousel'));
  const gate = await page(`/episode/${IDS.film}`, SIGNED_OUT_NO_TERMS);
  ok('film signed out without the viewing terms → the terms card, not the landing', gate.status === 200 && !has(gate.text, 'epl-strip') && /Confirm and watch|viewing terms/i.test(gate.text), gate.status);
  ok('film signed out → one h1.ep-title', (r.text.match(/<h1 class="ep-title"/g) || []).length === 1, (r.text.match(/<h1 class="ep-title"/g) || []).length);
  // ?autoplay=1 and ?trailer=1 open the player.
  for (const qs of ['autoplay=1', 'trailer=1']) {
    r = await page(`/episode/${IDS.film}?${qs}`);
    ok(`film ?${qs} → the player, no landing strip`, r.status === 200 && has(r.text, 'player-full-bleed') && !has(r.text, 'epl-strip'), r.status);
  }
  // A film whose page is switched off plays at once.
  r = await page(`/episode/${ID.nopage}`);
  ok('film with has_page false → plays at once (player, no strip)', r.status === 200 && has(r.text, 'player-full-bleed') && !has(r.text, 'epl-strip'), r.status);
  // A show's episode: with its page on, the landing (and its notes); without, it plays.
  r = await page(`/episode/${IDS.nbS1E2}`);
  ok('show episode with its own page → landing + "Notes from"', r.status === 200 && has(r.text, 'epl-strip') && /Notes from/.test(r.text), r.status);
  r = await page(`/episode/${IDS.nbS1E1}`);
  ok('show episode without its own page → plays at once', r.status === 200 && has(r.text, 'player-full-bleed') && !has(r.text, 'epl-strip'), r.status);
  // Notes on a film's page replace its description.
  r = await page(`/episode/${ID.notes}`);
  ok('film with notes → "Notes from Mara" and both paragraphs', r.status === 200 && /Notes from Mara/.test(r.text) && /eleven nights/.test(r.text) && /second paragraph/.test(r.text), r.status);
  ok('film with notes → the description is not shown under them', !r.text.includes(`The description of ${ID.notes}.</p>`));
  r = await page(`/episode/${IDS.film}`);
  ok('film without notes → its description', r.text.includes('find they disagree about where'));
  // The owner's private preview of a film still in review; a stranger gets 404.
  r = await page(`/episode/${ID.pending}?preview=1`, MARA);
  ok('pending film ?preview=1 as its owner → 200 with the preview bar', r.status === 200 && /pvbar/.test(r.text), r.status);
  ok('pending film preview → the landing too', has(r.text, 'epl-strip'));
  ok('pending film preview → noindex', /noindex/.test(r.text));
  r = await page(`/episode/${ID.pending}?preview=1`, VIEWER);
  ok('pending film ?preview=1 as a stranger → 404', r.status === 404, r.status);
  r = await page(`/episode/${ID.pending}?preview=1`, DEE);
  ok('pending film ?preview=1 as another creator → 404', r.status === 404, r.status);
  r = await page(`/episode/${ID.pending}`);
  ok('pending film without preview, signed out → 404', r.status === 404, r.status);
  // The app's payload says the same.
  r = await call(`/api/episode-page?id=${encodeURIComponent(IDS.film)}`);
  ok('/api/episode-page film → hasPage true', r.status === 200 && r.json && r.json.episode && r.json.episode.hasPage === true, r.status);
  r = await call(`/api/episode-page?id=${encodeURIComponent(ID.nopage)}`);
  ok('/api/episode-page film with its page off → hasPage false', r.status === 200 && r.json && r.json.episode && r.json.episode.hasPage === false, r.status);
}

// A member (Standard, through the fake Stripe's Checkout) with progress on
// the film reads "Continue" on its landing.
async function memberContinue(member) {
  section('A member with progress → Continue');
  const r = await call('/api/create-checkout-session', { who: member, method: 'POST', body: { tier: 'standard' } });
  ok('membership Checkout opens', r.status === 200 && r.json && /\/checkout\//.test(r.json.url || ''), r.text.slice(0, 200));
  const sid = r.json && r.json.url ? r.json.url.split('/checkout/')[1] : null;
  const done = sid ? await stripeHook(`/__checkout/${sid}/complete`, { method: 'POST' }) : null;
  ok('membership Checkout completes in the fake Stripe', done && done.status === 200, done && done.status);
  const role = await call('/api/account/dashboard-info', { who: member });
  ok('the member reads as a member', role.status === 200 && role.json && (role.json.isSubscriber === true || role.json.tier === 'standard'), role.text.slice(0, 200));
  const wp = await call('/api/watch-progress', { who: member, method: 'POST', body: { episodeId: IDS.film, position: 312 } });
  ok('progress saved (312 s)', wp.status === 200, wp.text.slice(0, 200));
  const html = await page(`/episode/${IDS.film}`, member);
  ok('landing Play reads "Continue" for the member', playWord(html.text) === 'Continue', `${html.status} ${playWord(html.text)}`);
  const fresh = await page(`/episode/${IDS.short}`, member);
  ok('another title without progress still reads "Play"', playWord(fresh.text) === 'Play', playWord(fresh.text));
  const out = await page(`/episode/${IDS.film}`);
  ok('signed out, the same film reads "Play"', playWord(out.text) === 'Play', playWord(out.text));
  // Cancel the membership again (the fake Stripe keeps the customer).
  const subs = (await stripeHook('/__state')).json.objects.filter((o) => o.object === 'subscription' && o.metadata && o.metadata.member === member.id);
  for (const s of subs) await fetch(`http://127.0.0.1:54322/v1/subscriptions/${s.id}`, { method: 'DELETE', headers: { Authorization: 'Bearer sk_test_rig' } });
}

async function browserPart(b) {
  for (const width of [390, 1280]) {
    section(`Browser at ${width}: the film landing, signed out`);
    const { ctx, page: pg, errors } = await b.open(SIGNED_OUT, width);
    const status = await goto(pg, `/episode/${IDS.film}`);
    ok(`${width}: 200`, status === 200, status);
    ok(`${width}: .epl-strip visible`, await pg.locator('.epl-strip').isVisible());
    ok(`${width}: "Trailer" tag on the strip`, (await pg.locator('.epl-strip-tag').textContent().catch(() => '')).trim() === 'Trailer');
    ok(`${width}: the round "Play the trailer" button`, await pg.locator('button[aria-label="Play the trailer"]').isVisible());
    ok(`${width}: exactly one h1.ep-title`, (await pg.locator('h1.ep-title').count()) === 1);
    ok(`${width}: a Play pill`, (await pg.locator('.epl-actions .epl-btn.is-play').textContent().catch(() => '')).includes('Play'));
    ok(`${width}: a Save pill`, (await pg.locator('.epl-actions .epl-btn', { hasText: 'Save' }).count()) === 1);
    ok(`${width}: the description (no notes on this film)`, (await pg.locator('.ep-desc').textContent().catch(() => '')).includes('disagree about where'));
    ok(`${width}: the credits (Made by Mara Reyes)`, /Made by\s*Mara Reyes/.test(await pg.locator('.ep-credits').innerText().catch(() => '')));
    const wn = pg.locator('section.ep-episodes[aria-label="Watch next"]');
    ok(`${width}: Watch next`, (await wn.count()) === 1);
    if (width === 1280) {
      const box = await wn.boundingBox();
      ok('1280: Watch next sits in the 400px right column', box && Math.abs(box.width - 400) <= 2 && box.x > 640, box);
    }
    ok(`${width}: no old hero`, (await pg.locator('.hero-carousel').count()) === 0);
    const over = await overflowPx(pg);
    ok(`${width}: no horizontal overflow`, over <= 0, `${over}px`);
    // The trailer button opens the player on the trailer.
    await pg.locator('button[aria-label="Play the trailer"]').click();
    await pg.waitForTimeout(700);
    ok(`${width}: Play the trailer → the player`, (await pg.locator('.player-full-bleed').count()) === 1 && (await pg.locator('.epl-strip').count()) === 0);
    ok(`${width}: the kicker says Trailer`, (await pg.locator('.ep-kicker-note').textContent().catch(() => '')).includes('Trailer'));
    ok(`${width}: no page errors`, errors.length === 0, errors);
    await ctx.close();

    // Play turns the landing into the player and puts ?autoplay=1 in the address.
    const two = await b.open(SIGNED_OUT, width);
    await goto(two.page, `/episode/${IDS.film}`);
    await two.page.locator('.epl-actions .epl-btn.is-play').click();
    await two.page.waitForTimeout(900);
    ok(`${width}: Play → the player in place`, (await two.page.locator('.player-full-bleed').count()) === 1 && (await two.page.locator('.epl-strip').count()) === 0);
    ok(`${width}: Play → ?autoplay=1 in the address`, /autoplay=1/.test(two.page.url()), two.page.url());
    ok(`${width}: no page errors after Play`, two.errors.length === 0, two.errors);
    await two.ctx.close();

    // Notes on a film: the heading and the paragraphs, at both widths.
    const three = await b.open(SIGNED_OUT, width);
    await goto(three.page, `/episode/${ID.notes}`);
    const heading = (await three.page.locator('.epl-notes-heading').textContent().catch(() => '')).trim();
    ok(`${width}: notes heading "Notes from Mara" (shown uppercase)`, heading === 'Notes from Mara', heading);
    const upper = await three.page.locator('.epl-notes-heading').evaluate((el) => getComputedStyle(el).textTransform).catch(() => '');
    ok(`${width}: the notes heading is set in capitals`, upper === 'uppercase', upper);
    ok(`${width}: two note paragraphs`, (await three.page.locator('.epl-notes p').count()) === 2);
    ok(`${width}: no overflow with notes`, (await overflowPx(three.page)) <= 0);
    ok(`${width}: no page errors with notes`, three.errors.length === 0, three.errors);
    await three.ctx.close();

    // A premium title for someone without a plan: the landing, and Play shows the lock.
    const four = await b.open(VIEWER, width);
    await goto(four.page, `/episode/${IDS.short}`);
    ok(`${width}: premium short, non-member → the landing`, (await four.page.locator('.epl-strip').count()) === 1);
    await four.page.locator('.epl-actions .epl-btn.is-play').click();
    await four.page.waitForTimeout(900);
    ok(`${width}: premium short, Play → the lock panel`, await four.page.locator('.lock-panel').first().isVisible().catch(() => false));
    ok(`${width}: no page errors on the lock`, four.errors.length === 0, four.errors);
    await four.ctx.close();

    // The owner's preview of a film in review.
    const five = await b.open(MARA, width);
    const st = await goto(five.page, `/episode/${ID.pending}?preview=1`);
    ok(`${width}: pending film preview → 200 + the preview bar + the landing`, st === 200 && (await five.page.locator('.pvbar').count()) > 0 && (await five.page.locator('.epl-strip').count()) === 1, st);
    ok(`${width}: the preview has no Save pill`, (await five.page.locator('.epl-actions .epl-btn', { hasText: 'Save' }).count()) === 0);
    ok(`${width}: preview: no overflow, no page errors`, (await overflowPx(five.page)) <= 0 && five.errors.length === 0, five.errors);
    await five.ctx.close();
  }
}

async function notesEditing(b) {
  section('Notes: Your work (creator) and the Library modal (admin)');
  // The creator's row has the notes and the switch (migration 118).
  const mine = await call('/api/creator/my-submissions', { who: MARA });
  const row = mine.json && (mine.json.submissions || mine.json.items || []).find ? (mine.json.submissions || mine.json.items || []).find((s) => s.id === ID.edit) : null;
  ok('my-submissions carries pageNotesReady + hasPage for a film', row && row.pageNotesReady === true && row.hasPage === true, row);

  const { ctx, page: pg, errors } = await b.open(MARA, 1280);
  await goto(pg, '/creator/my-work');
  const menu = pg.locator(`button[aria-label="Options for Check film to edit"]`);
  ok('Your work lists the film with its options', (await menu.count()) === 1);
  await menu.click();
  const item = pg.locator('[role="menuitem"]', { hasText: 'Edit title, description & notes' });
  ok('the menu says "Edit title, description & notes"', (await item.count()) === 1);
  await item.click();
  await pg.locator('#request-edit-notes').waitFor({ timeout: 10000 });
  ok('the box has "Notes for the title’s page"', await pg.locator('#request-edit-notes').isVisible());
  await pg.locator('.modal-card input[type="text"]').first().fill('Check film renamed');
  await pg.locator('#request-edit-notes').fill('Notes typed in Your work.\n\nA second paragraph.');
  await pg.locator('.modal-card button[type="submit"]', { hasText: 'Send' }).click();
  await pg.waitForTimeout(1500);
  const said = await pg.locator('text=Your notes are saved.').count();
  ok('it says the notes are saved and the title is with us for review', said > 0);
  const db = rows(`select title, pending_title, page_notes from public.episodes where id = ${q(ID.edit)}`)[0] || {};
  ok('the notes applied at once', db.page_notes === 'Notes typed in Your work.\n\nA second paragraph.', db);
  ok('the title waits for review (pending_title), the live one unchanged', db.pending_title === 'Check film renamed' && db.title === 'Check film to edit', db);
  ok('no page errors on Your work', errors.length === 0, errors);
  await ctx.close();
  const live = await page(`/episode/${ID.edit}`);
  ok('the film’s page shows the new notes at once', /Notes typed in Your work\./.test(live.text));

  // The admin's Library modal.
  const a = await b.open(ADMIN, 1280);
  await goto(a.page, `/admin/library?edit=${encodeURIComponent(ID.edit)}`);
  const box = a.page.locator('#admin-page-notes');
  await box.waitFor({ timeout: 30000 }).catch(() => {});
  ok('Library ?edit= opens the modal with the Notes box', await box.isVisible().catch(() => false));
  await box.fill('Notes from the Library modal.');
  await a.page.locator('button[type="submit"]', { hasText: /Save/ }).click();
  await a.page.waitForTimeout(2000);
  const after = rows(`select page_notes, title from public.episodes where id = ${q(ID.edit)}`)[0] || {};
  ok('the Library modal stored page_notes', after.page_notes === 'Notes from the Library modal.', after);
  ok('the Library save left the title alone', after.title === 'Check film to edit', after);
  ok('no page errors on the Library', a.errors.length === 0, a.errors);
  await a.ctx.close();

  // The routes the boxes call, directly.
  const big = 'x'.repeat(4001);
  let r = await call('/api/admin/edit-episode', { who: ADMIN, method: 'POST', body: { episodeId: ID.edit, pageNotes: big } });
  ok('edit-episode refuses notes over 4,000 characters', r.status === 400, `${r.status} ${r.text.slice(0, 160)}`);
  r = await call(`/api/show/episode/${encodeURIComponent(ID.edit)}`, { who: DEE, method: 'PATCH', body: { pageNotes: 'Not Dee’s film.' } });
  ok('another creator can’t change a film’s notes', r.status === 403 || r.status === 404, `${r.status} ${r.text.slice(0, 160)}`);
  r = await call(`/api/show/episode/${encodeURIComponent(ID.edit)}`, { who: MARA, method: 'PATCH', body: { pageNotes: '' } });
  const cleared = rows(`select page_notes from public.episodes where id = ${q(ID.edit)}`)[0] || {};
  ok('the uploader clears the notes (empty = none)', r.status === 200 && cleared.page_notes === null, `${r.status} ${JSON.stringify(cleared)}`);
}

await runCheck('films-landing', async () => {
  cleanup();
  seed();
  const b = await browser();
  let member = null;
  try {
    await httpPart();
    member = await newUser('member');
    await memberContinue(member);
    await browserPart(b);
    await notesEditing(b);
  } finally {
    await b.close();
    if (member) {
      sql(`delete from public.member_payments where user_id = ${q(member.id)}`);
      sql(`delete from public.creator_ledger where member_id = ${q(member.id)}`);
      sql(`delete from public.member_customers where user_id = ${q(member.id)}`);
      sql(`delete from public.member_referrals where user_id = ${q(member.id)}`);
      await removeUser(member.id);
    }
    cleanup();
  }
});
