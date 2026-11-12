#!/usr/bin/env node
// The small fixes of 2026-11-12:
//   * /admin/content lists a reported account that has no profile row
//     (named from Clerk, "No public profile yet") and decides it — reports
//     upheld or cleared, the person told about their *account*; an account
//     Clerk no longer has is not listed and is "Not found";
//   * a lone surrogate in request text (lib/wellFormed.js) is saved as
//     U+FFFD instead of answering 500, through the show routes, the older
//     edit routes, the Library's edit route and submit;
//   * the Library modal's "What kind of extra?" field (the route's
//     extraKind / extraKindReady, the chips in the modal, a save);
//   * the submit page's notes for a film or a short land in page_notes
//     (never for a show's episode), and its title image in title_image_url.
// Rig up at 121 or later (the kind of extra needs 121; nothing needs 122).
//   node dev/test-rig/checks/round-fixes.mjs
import crypto from 'node:crypto';
import { EMPTY_SUBMIT_FORM, toSubmitBody } from '../../../lib/submitRules.js';
import { IDS, USERS, RUN, ok, section, runCheck, call, sql, rows, q, insert, hasColumn, session, newUser, removeUser, browser, goto, cloudflare, ago, uidFor } from './lib.mjs';

const ADMIN = session(USERS.admin);
const MARA = session(USERS.mara);
const DEE = session(USERS.dee);

const ID = {
  fresh: `ck-rf-fresh-${RUN}`,
  live: `ck-rf-live-${RUN}`,
  extra: `ck-rf-extra-${RUN}`,
  privShow: `ck-rf-priv-${RUN}`
};
const GONE_USER = `user_rigckgone${RUN}`;
const created = [];
const people = [];
const HERO = (rows(`select hero_image from public.series where id = ${q(IDS.nightBus)}`)[0] || {}).hero_image || null;
const src = (key) => `https://customer-test.cloudflarestream.com/${uidFor(key)}/manifest/video.m3u8`;
const film = (id, extra = {}) => ({
  id, title: `Check fixes film ${RUN}`, description: 'A check film.', tier: 'free', genre: 'Drama', main_genre: 'Drama', content_type: 'movie', artist: 'Mara Reyes', runtime: '1:00:00',
  rating: 'TV-PG', release_year: 2026, src: src(IDS.film), video_type: 'html5', ads_enabled: true, deletion_requested: false, moderation_hold: false, submitted_by: USERS.mara,
  status: 'pending', created_at: ago(2), has_page: true, poster: HERO, thumbnail: HERO, ...extra
});

function seed() {
  insert('episodes', film(ID.fresh));
  insert('episodes', film(ID.live, { status: 'approved', reviewed_at: ago(1), released_at: ago(1), title: `Check fixes live ${RUN}` }));
  insert('episodes', film(ID.extra, { content_type: 'bonus', bonus_parent_type: 'series', bonus_parent_id: IDS.nightBus, status: 'approved', reviewed_at: ago(1), released_at: ago(1), title: `Check fixes extra ${RUN}`, has_page: false }));
  insert('series', { id: ID.privShow, name: `Check fixes show ${RUN}`, description: 'A private show.', creator_id: USERS.mara, status: 'pending', submitted_by_user_id: USERS.mara, created_at: ago(2), kind: 'series', defaults: {}, seasons: [], credits: {} });
}
function cleanup() {
  const ids = [...Object.values(ID), ...created].map(q).join(', ');
  sql(`delete from public.notifications where episode_id in (${ids}) or message like '%Check fixes%${RUN}%'`);
  sql(`delete from public.audit_log where target_id in (${ids}) or target_id = ${q(GONE_USER)} or target_id like 'user_rigckrowless${RUN}%'`);
  sql(`delete from public.content_reports where target_id = ${q(GONE_USER)} or target_id like 'user_rigckrowless${RUN}%'`);
  sql(`delete from public.content_moderation where target_id = ${q(GONE_USER)} or target_id like 'user_rigckrowless${RUN}%'`);
  sql(`delete from public.episodes where id in (${ids}) or title like 'Check fixes submitted%${RUN}%'`);
  sql(`delete from public.series where id = ${q(ID.privShow)}`);
}

async function maraVideo(tag) {
  const uid = crypto.createHash('md5').update(`ck-rf-${tag}-${RUN}`).digest('hex');
  const r = await cloudflare('/__video', { method: 'POST', body: { uid, name: `${tag}.mp4`, creator: USERS.mara, duration: 600, ready: true, requireSignedURLs: true } });
  if (r.status !== 200) throw new Error(`fake Cloudflare refused the video: ${r.status}`);
  return uid;
}
const notesOf = (id) => (rows(`select page_notes from public.episodes where id = ${q(id)}`)[0] || {}).page_notes;
const report = (id, who, reason = 'spam') => insert('content_reports', { target_type: 'profile', target_id: id, reporter_id: who, reason, status: 'open' });

async function rowlessAccount() {
  section('/admin/content: a reported account with no profile row');
  const acct = await newUser('rowless', { firstName: 'Rowless', displayName: 'Rowless Check' });
  people.push(acct.id);
  // A report from Messages names anyone who can sign in; the profile row is
  // only written once someone saves their profile.
  sql(`delete from public.user_profiles where user_id = ${q(acct.id)}`);
  report(acct.id, USERS.viewer);
  report(acct.id, USERS.dee, 'harassment');
  report(GONE_USER, USERS.viewer);
  let r = await call('/api/admin/content', { who: ADMIN });
  const connect = (r.json && r.json.connect) || [];
  const row = connect.find((x) => x.id === acct.id);
  ok('listed from Clerk: its name, “No public profile yet”', r.status === 200 && row && row.noProfile === true && row.title === 'Rowless Check' && row.statusLabel === 'No public profile yet' && row.publicHref === null, row);
  ok('…with its newest reports’ reasons', row && Array.isArray(row.recentReports) && row.recentReports.length === 2, row && row.recentReports);
  ok('an account Clerk no longer has isn’t in the queue', !connect.some((x) => x.id === GONE_USER));
  r = await call('/api/admin/content', { who: ADMIN, method: 'POST', body: { op: 'decide', targetType: 'profile', targetId: GONE_USER, action: 'take_down', note: 'Spam.' } });
  ok('deciding on it → 404 Not found', r.status === 404, `${r.status} ${r.text.slice(0, 160)}`);
  r = await call('/api/admin/content', { who: ADMIN, method: 'POST', body: { op: 'decide', targetType: 'profile', targetId: acct.id, action: 'take_down' } });
  ok('uphold without saying why → 400', r.status === 400, r.status);
  r = await call('/api/admin/content', { who: ADMIN, method: 'POST', body: { op: 'decide', targetType: 'profile', targetId: acct.id, action: 'take_down', note: 'Spam in Messages.' } });
  ok('uphold → 200', r.status === 200, `${r.status} ${r.text.slice(0, 200)}`);
  ok('…its reports are upheld', rows(`select status from public.content_reports where target_id = ${q(acct.id)}`).every((x) => x.status === 'upheld'));
  ok('…the person is told about their account', rows(`select message from public.notifications where user_id = ${q(acct.id)}`).some((n) => /Reports on your account were upheld after review: Spam in Messages\./.test(n.message)));
  ok('…and still no profile row was made for them', rows(`select user_id from public.user_profiles where user_id = ${q(acct.id)}`).length === 0);
  report(acct.id, USERS.sub, 'other');
  r = await call('/api/admin/content', { who: ADMIN, method: 'POST', body: { op: 'decide', targetType: 'profile', targetId: acct.id, action: 'restore' } });
  ok('“Looks fine, clear” → 200, “Nothing needs to change” about their account', r.status === 200 && rows(`select message from public.notifications where user_id = ${q(acct.id)}`).some((n) => /Reports on your account were reviewed\. Nothing needs to change\./.test(n.message)), `${r.status} ${r.text.slice(0, 200)}`);
}

async function surrogates() {
  section('A lone surrogate is saved as U+FFFD, never a 500');
  const lone = 'Half an emoji \uD83D here';
  const fixed = 'Half an emoji � here';
  let r = await call(`/api/show/episode/${encodeURIComponent(ID.fresh)}`, { who: MARA, method: 'PATCH', body: { pageNotes: lone, description: `${lone} too` } });
  ok('show editor (a film in review): notes and description → 200', r.status === 200 && notesOf(ID.fresh) === fixed, `${r.status} ${r.text.slice(0, 160)} ${JSON.stringify(notesOf(ID.fresh))}`);
  r = await call(`/api/show/${encodeURIComponent(ID.privShow)}`, { who: MARA, method: 'PATCH', body: { description: '\uDC00 a stray low half' } });
  ok('show editor (a private show): description → 200', r.status === 200 && (rows(`select description from public.series where id = ${q(ID.privShow)}`)[0] || {}).description === '� a stray low half', `${r.status} ${r.text.slice(0, 160)}`);
  r = await call('/api/creator/request-episode-edit', { who: MARA, bearer: true, method: 'POST', body: { episodeId: ID.live, description: `Waits ${lone}` } });
  ok('request-episode-edit (a live film): → 200, it waits well formed', r.status === 200 && (rows(`select pending_description from public.episodes where id = ${q(ID.live)}`)[0] || {}).pending_description === `Waits ${fixed}`, `${r.status} ${r.text.slice(0, 160)}`);
  r = await call('/api/creator/edit-submission', { who: MARA, method: 'POST', body: { episodeId: ID.fresh, title: `Check fixes film ${RUN} \uD800` } });
  ok('edit-submission: title → 200', r.status === 200 && (rows(`select title from public.episodes where id = ${q(ID.fresh)}`)[0] || {}).title === `Check fixes film ${RUN} �`, `${r.status} ${r.text.slice(0, 160)}`);
  r = await call('/api/admin/edit-episode', { who: ADMIN, method: 'POST', body: { episodeId: ID.live, artist: 'Mara \uDBFF Reyes' } });
  ok('the Library’s edit-episode: → 200', r.status === 200 && (rows(`select artist from public.episodes where id = ${q(ID.live)}`)[0] || {}).artist === 'Mara � Reyes', `${r.status} ${r.text.slice(0, 160)}`);
  r = await call(`/api/show/episode/${encodeURIComponent(ID.fresh)}`, { who: MARA, method: 'PATCH', body: { pageNotes: 'A real pair 🎬 stays.' } });
  ok('a real pair is left alone', r.status === 200 && notesOf(ID.fresh) === 'A real pair 🎬 stays.', JSON.stringify(notesOf(ID.fresh)));
}

async function libraryExtraKind(b) {
  section('The Library modal’s “What kind of extra?”');
  let r = await call('/api/admin/library', { who: ADMIN });
  const all = (r.json && (r.json.episodes || r.json.items)) || [];
  const row = all.find((e) => e.id === ID.extra);
  ok('/api/admin/library: a bonus row carries extraKind and extraKindReady', r.status === 200 && row && row.extraKind === null && row.extraKindReady === true, row && { k: row.extraKind, ready: row.extraKindReady });
  const { ctx, page: pg, errors } = await b.open(ADMIN, 1280);
  await goto(pg, `/admin/library?edit=${encodeURIComponent(ID.extra)}`);
  const field = pg.locator('.admin-extra-kind');
  await field.waitFor({ timeout: 30000 }).catch(() => {});
  ok('the modal shows the field for an extra', await field.isVisible().catch(() => false));
  const chip = field.locator('button, label', { hasText: 'Interview' }).first();
  const clicked = await chip.click({ timeout: 5000 }).then(() => true, () => false);
  ok('…with the presets as chips', clicked);
  await pg.locator('button[type="submit"]', { hasText: /Save/ }).first().click();
  await pg.waitForTimeout(2500);
  ok('saving stores interview', (rows(`select extra_kind from public.episodes where id = ${q(ID.extra)}`)[0] || {}).extra_kind === 'interview', rows(`select extra_kind from public.episodes where id = ${q(ID.extra)}`)[0]);
  ok('no page errors', errors.length === 0, errors);
  await ctx.close();
  r = await call('/api/admin/edit-episode', { who: ADMIN, method: 'POST', body: { episodeId: ID.extra, extraKind: '  Table   read ' } });
  ok('the route takes their own words (cleaned)', r.status === 200 && (rows(`select extra_kind from public.episodes where id = ${q(ID.extra)}`)[0] || {}).extra_kind === 'Table read', `${r.status} ${r.text.slice(0, 160)}`);
}

async function submitNotes() {
  section('The submit page: notes and the title image');
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  const form = { ...EMPTY_SUBMIT_FORM, contentType: 'movie', title: `Check fixes submitted film ${RUN}`, description: 'Sent by the check.', genre: 'Drama', mainGenre: 'Drama', runtime: '10:00', artist: 'Mara Reyes', tier: 'free', rating: 'TV-PG', pageNotes: '  We shot it in a week.\n\nSecond line.  ' };
  const v = await maraVideo('film');
  const body = toSubmitBody(form, { video: { uid: v, runtimeSeconds: 600 } }, { titleImageBase64: png, titleImageFileName: 'title.png' });
  ok('toSubmitBody carries the notes for a film', body.pageNotes === 'We shot it in a week.\n\nSecond line.', body.pageNotes);
  let r = await call('/api/creator/submit-episode', { who: MARA, method: 'POST', body });
  const id = r.json && (r.json.id || (r.json.episode && r.json.episode.id));
  if (id) created.push(id);
  const row = id ? rows(`select page_notes, title_image_url, status from public.episodes where id = ${q(id)}`)[0] : {};
  ok('a film sent with notes → page_notes, in review', r.status === 200 && row.page_notes === 'We shot it in a week.\n\nSecond line.' && row.status === 'pending', `${r.status} ${r.text.slice(0, 200)} ${JSON.stringify(row)}`);
  ok('…and its title image → title_image_url', /^https:\/\//.test(row.title_image_url || ''), row.title_image_url);
  const v2 = await maraVideo('ep');
  const epForm = { ...form, contentType: 'series', seriesId: IDS.nightBus, season: 9, seriesOrder: 1, title: `Check fixes submitted episode ${RUN}` };
  const epBody = { ...toSubmitBody(epForm, { video: { uid: v2, runtimeSeconds: 600 } }), pageNotes: 'Should not be kept.' };
  r = await call('/api/creator/submit-episode', { who: MARA, method: 'POST', body: epBody });
  const eid = r.json && (r.json.id || (r.json.episode && r.json.episode.id));
  if (eid) created.push(eid);
  ok('a show’s episode sent with notes → saved without them', r.status === 200 && eid && (rows(`select page_notes from public.episodes where id = ${q(eid)}`)[0] || {}).page_notes === null, `${r.status} ${r.text.slice(0, 200)}`);
  r = await call('/api/creator/submit-episode', { who: MARA, method: 'POST', body: { ...body, title: `Check fixes submitted long ${RUN}`, pageNotes: 'x'.repeat(4001), videoUid: await maraVideo('long') } });
  ok('notes over 4,000 characters → 400', r.status === 400, `${r.status} ${r.text.slice(0, 160)}`);
}

await runCheck('round-fixes', async () => {
  if (!hasColumn('episodes', 'extra_kind')) {
    ok('this check needs migration 121 (the kind of extra)', false);
    return;
  }
  cleanup();
  seed();
  const b = await browser();
  try {
    await rowlessAccount();
    await surrogates();
    await libraryExtraKind(b);
    await submitNotes();
  } finally {
    await b.close();
    cleanup();
    for (const id of people) {
      sql(`delete from public.notifications where user_id = ${q(id)}`);
      await removeUser(id);
    }
  }
});
