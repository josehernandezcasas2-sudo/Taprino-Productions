#!/usr/bin/env node
// Descriptions and notes wait for review on a live title (2026-11-12,
// migration 122's episodes.pending_page_notes; lib/showRules.js
// FIELD_POLICY, lib/showPage.js updateEpisode / updateShow,
// lib/stagedChanges.js). Runs the half that matches the database:
//   after 122  (the rig's default): a live film's description and notes
//              through the show editor's route and through the older
//              /api/creator/request-episode-edit go to pending_* and every
//              page and payload keeps the live ones; a newer ask replaces
//              the waiting one, the same text cancels it, "clear the
//              notes" waits as ''; the Library queue (pending-edits →
//              resolve-edit) approves and denies them with `seen` (a stale
//              one → 409) and tells the uploader; a title that was never
//              live applies at once; the team's own save applies at once;
//              a show's description waits and the admin show page's
//              Waiting for approval decides it, as it does a show
//              episode's notes; a live title's new title image waits; the
//              Library and Shows badges count what waits;
//   before 122 (RIG_MIGRATE_TO=121 RIG_REBUILD=1 dev/test-rig/start.sh):
//              a live title's notes answer 503 migration-122 (both routes)
//              while its description still waits, a title in review takes
//              notes at once, Your work says the box needs 122, the
//              Library's lists still answer.
//   node dev/test-rig/checks/review-waits.mjs
import { createRequire } from 'node:module';
import path from 'node:path';
import { REPO_DIR } from '../lib/config.mjs';
import { IDS, USERS, RUN, ok, section, runCheck, call, page, sql, rows, q, insert, hasColumn, session, ago, uidFor } from './lib.mjs';

const MARA = session(USERS.mara);
const DEE = session(USERS.dee);
const ADMIN = session(USERS.admin);

const ID = {
  live: `ck-rw-live-${RUN}`,
  fresh: `ck-rw-fresh-${RUN}`,
  show: `ck-rw-show-${RUN}`,
  showEp: `ck-rw-show-e1-${RUN}`
};
const HERO = (rows(`select hero_image from public.series where id = ${q(IDS.nightBus)}`)[0] || {}).hero_image || null;
const src = (key) => `https://customer-test.cloudflarestream.com/${uidFor(key)}/manifest/video.m3u8`;
const film = (id, extra = {}) => ({
  id, title: `Check review film ${RUN}`, description: 'The live description.', tier: 'free', genre: 'Drama', main_genre: 'Drama', content_type: 'movie',
  artist: 'Mara Reyes', runtime: '1:30:00', rating: 'TV-PG', release_year: 2026, src: src(IDS.film), video_type: 'html5', video_provider: 'cloudflare',
  ads_enabled: true, deletion_requested: false, moderation_hold: false, submitted_by: USERS.mara, status: 'approved', reviewed_at: ago(3), released_at: ago(3), created_at: ago(5),
  has_page: true, page_notes: 'The live notes.', poster: HERO, thumbnail: HERO, ...extra
});

function seed() {
  insert('episodes', film(ID.live));
  insert('episodes', film(ID.fresh, { title: `Check review film in review ${RUN}`, status: 'pending', reviewed_at: null, released_at: null, page_notes: null }));
  insert('series', {
    id: ID.show, name: `Check review show ${RUN}`, description: 'The live show description.', creator_id: USERS.mara, release_year: 2026, status: 'approved',
    submitted_by: 'mara@rig.example.com', submitted_by_user_id: USERS.mara, reviewed_at: ago(10), public_at: ago(10), created_at: ago(12), kind: 'series',
    poster: HERO, thumbnail: HERO, hero_image: HERO, defaults: { genre: 'Drama', mainGenre: 'Drama', rating: 'TV-14' }, seasons: [], credits: {}
  });
  insert('episodes', film(ID.showEp, { title: `Check review episode ${RUN}`, content_type: 'series', series_id: ID.show, season: 1, series_order: 1, has_page: true, page_notes: 'The live episode notes.' }));
}
function cleanup() {
  const ids = Object.values(ID).map(q).join(', ');
  sql(`delete from public.notifications where episode_id in (${ids}) or message like '%Check review%${RUN}%'`);
  sql(`delete from public.audit_log where target_id in (${ids})`);
  sql(`delete from public.orphaned_media where reference like '%ck-rw-%${RUN}%'`);
  sql(`delete from public.episodes where id in (${ids})`);
  sql(`delete from public.series where id = ${q(ID.show)}`);
}

const ep = (id) => rows(`select title, description, page_notes, pending_title, pending_description${hasColumn('episodes', 'pending_page_notes') ? ', pending_page_notes' : ''}, title_image_url, pending_title_image_url from public.episodes where id = ${q(id)}`)[0] || {};
const patchEp = (who, id, body, opts = {}) => call(`/api/show/episode/${encodeURIComponent(id)}`, { who, method: 'PATCH', body, ...opts });
const requestEdit = (who, body) => call('/api/creator/request-episode-edit', { who, bearer: true, method: 'POST', body });
async function counts() {
  const r = await call('/api/admin/queue-counts', { who: ADMIN });
  return r.json || {};
}
async function pendingEdit(id) {
  const r = await call('/api/admin/pending-edits', { who: ADMIN });
  return { status: r.status, row: r.json && (r.json.episodes || []).find((e) => e.id === id), all: r.json };
}
const resolveEdit = (body) => call('/api/admin/resolve-edit', { who: ADMIN, method: 'POST', body });
// The visible text of a page, for "the live words are there, the waiting ones aren't".
const words = (html) => (html || '').replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ');

function pngTitle() {
  const sharp = createRequire(path.join(REPO_DIR, 'package.json'))('sharp');
  return sharp({ create: { width: 600, height: 160, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="160"><text x="20" y="110" font-size="90" fill="#ff8c42" font-family="sans-serif">${RUN}</text></svg>`) }])
    .png().toBuffer().then((b) => `data:image/png;base64,${b.toString('base64')}`);
}

async function after122() {
  section('A live film through the show editor’s route: description and notes wait');
  const before = await counts();
  let r = await patchEp(MARA, ID.live, { description: `A new description ${RUN}.`, pageNotes: `New notes ${RUN}.\n\nSecond paragraph.` });
  ok('PATCH → 200 with both staged', r.status === 200 && ['description', 'pageNotes'].every((f) => (r.json.staged || []).includes(f)) && !(r.json.applied || []).length, `${r.status} ${r.text.slice(0, 220)}`);
  let row = ep(ID.live);
  ok('…pending_description and pending_page_notes hold them, the live ones unchanged', row.pending_description === `A new description ${RUN}.` && row.pending_page_notes === `New notes ${RUN}.\n\nSecond paragraph.` && row.description === 'The live description.' && row.page_notes === 'The live notes.', row);
  let html = await page(`/episode/${ID.live}`);
  ok('the film’s page shows the live description and notes, not the waiting ones', html.status === 200 && /The live notes\./.test(words(html.text)) && !html.text.includes(`New notes ${RUN}`) && !html.text.includes(`A new description ${RUN}`), html.status);
  r = await call(`/api/episode-page?id=${encodeURIComponent(ID.live)}`);
  ok('/api/episode-page carries neither waiting value', r.status === 200 && !r.text.includes(`New notes ${RUN}`) && !r.text.includes(`A new description ${RUN}`), r.status);
  r = await call(`/api/show/episode/${encodeURIComponent(ID.live)}`, { who: MARA });
  ok('the uploader’s editor shows both waiting, with the policy “staged”', r.status === 200 && r.json.episode && r.json.episode.staged && r.json.episode.staged.pageNotes === `New notes ${RUN}.\n\nSecond paragraph.` && r.json.episode.staged.description === `A new description ${RUN}.`, r.json && r.json.episode && r.json.episode.staged);
  const after = await counts();
  ok('the Library badge counts the waiting edit', after.library === before.library + 1, `${before.library} → ${after.library}`);
  r = await call('/api/creator/my-submissions', { who: MARA });
  const mine = r.json && (r.json.submissions || []).find((s) => s.id === ID.live);
  ok('Your work carries the waiting notes and pageNotesWaitReady', mine && mine.pendingPageNotes === `New notes ${RUN}.\n\nSecond paragraph.` && mine.pageNotesWaitReady === true, mine && { p: mine.pendingPageNotes, ready: mine.pageNotesWaitReady });

  section('Replacing, cancelling and clearing what waits');
  r = await patchEp(MARA, ID.live, { pageNotes: `Newer notes ${RUN}.` });
  ok('a newer ask replaces the waiting notes (and says so)', r.status === 200 && ep(ID.live).pending_page_notes === `Newer notes ${RUN}.` && (r.json.notices || []).some((n) => /replace/.test(n)), r.json && r.json.notices);
  r = await patchEp(MARA, ID.live, { pageNotes: 'The live notes.' });
  ok('sending the live notes again cancels the waiting ones', r.status === 200 && ep(ID.live).pending_page_notes === null && (r.json.notices || []).some((n) => /cancelled/.test(n)), `${r.status} ${JSON.stringify(ep(ID.live))}`);
  r = await patchEp(MARA, ID.live, { pageNotes: '' });
  ok('clearing the notes waits as \'\'', r.status === 200 && ep(ID.live).pending_page_notes === '' && ep(ID.live).page_notes === 'The live notes.', ep(ID.live));
  r = await call(`/api/show/episode/${encodeURIComponent(ID.live)}/staged?field=pageNotes`, { who: MARA, method: 'DELETE' });
  ok('the uploader takes the clearing back (DELETE …/staged?field=pageNotes)', r.status === 200 && ep(ID.live).pending_page_notes === null, `${r.status} ${r.text.slice(0, 160)}`);
  r = await call(`/api/show/episode/${encodeURIComponent(ID.live)}/staged?field=pageNotes`, { who: MARA, method: 'DELETE' });
  ok('again → 409 nothing-staged', r.status === 409, r.status);
  r = await patchEp(MARA, ID.live, { description: '' });
  ok('an empty description on a live film is refused (400)', r.status === 400, r.status);
  r = await patchEp(DEE, ID.live, { pageNotes: 'Not Dee’s.' });
  ok('another creator can’t (403/404)', r.status === 403 || r.status === 404, r.status);

  section('The older route (request-episode-edit, as an older app build sends it)');
  r = await requestEdit(MARA, { episodeId: ID.live, title: `Check review film ${RUN}`, description: `Old-build description ${RUN}.`, pageNotes: `Old-build notes ${RUN}.` });
  ok('→ 200, description and notes staged; the unchanged title is left out', r.status === 200 && ['description', 'pageNotes'].every((f) => (r.json.staged || []).includes(f)) && !(r.json.staged || []).includes('title'), `${r.status} ${r.text.slice(0, 220)}`);
  row = ep(ID.live);
  ok('…they wait; the live ones stand', row.pending_description === `Old-build description ${RUN}.` && row.pending_page_notes === `Old-build notes ${RUN}.` && row.description === 'The live description.' && row.pending_title === null, row);
  r = await requestEdit(MARA, { episodeId: ID.live, title: `Check review film ${RUN}` });
  ok('nothing changed → 400', r.status === 400, r.status);
  r = await requestEdit(DEE, { episodeId: ID.live, description: 'Dee tries.' });
  ok('another creator → 403/404', r.status === 403 || r.status === 404, r.status);

  section('The Library queue decides them (pending-edits → resolve-edit)');
  let pe = await pendingEdit(ID.live);
  ok('pending-edits lists the film with the waiting notes and a seen map', pe.status === 200 && pe.row && pe.row.pendingPageNotes === `Old-build notes ${RUN}.` && pe.row.currentPageNotes === 'The live notes.' && pe.row.seen && pe.row.seen.pageNotes, pe.row);
  const staleSeen = pe.row.seen;
  r = await patchEp(MARA, ID.live, { pageNotes: `Replaced after the list loaded ${RUN}.` });
  r = await resolveEdit({ type: 'episode', id: ID.live, decision: 'approve', seen: staleSeen });
  ok('approve with a seen from before the creator replaced it → 409', r.status === 409, `${r.status} ${r.text.slice(0, 160)}`);
  ok('…nothing went live', ep(ID.live).page_notes === 'The live notes.');
  pe = await pendingEdit(ID.live);
  r = await resolveEdit({ type: 'episode', id: ID.live, decision: 'approve', seen: pe.row.seen });
  ok('approve with the current seen → 200', r.status === 200, `${r.status} ${r.text.slice(0, 160)}`);
  row = ep(ID.live);
  ok('…the description and notes are live, nothing waits', row.description === `Old-build description ${RUN}.` && row.page_notes === `Replaced after the list loaded ${RUN}.` && row.pending_description === null && row.pending_page_notes === null, row);
  html = await page(`/episode/${ID.live}`);
  ok('the film’s page shows the approved notes', /Replaced after the list loaded/.test(words(html.text)));
  ok('the uploader was told (edit_approved)', rows(`select type from public.notifications where user_id = ${q(USERS.mara)} and episode_id = ${q(ID.live)} and type = 'edit_approved'`).length >= 1);
  ok('the Library badge is back', (await counts()).library === before.library);
  r = await patchEp(MARA, ID.live, { pageNotes: '' });
  pe = await pendingEdit(ID.live);
  ok('a waiting clear is listed as \'\'', pe.row && pe.row.pendingPageNotes === '', pe.row);
  r = await resolveEdit({ type: 'episode', id: ID.live, decision: 'deny', seen: pe.row.seen, note: 'Keep them.' });
  ok('deny → 200, the notes stay', r.status === 200 && ep(ID.live).page_notes === `Replaced after the list loaded ${RUN}.` && ep(ID.live).pending_page_notes === null, `${r.status} ${JSON.stringify(ep(ID.live))}`);
  ok('…the uploader was told with the note', rows(`select message from public.notifications where user_id = ${q(USERS.mara)} and episode_id = ${q(ID.live)} and type = 'edit_denied'`).some((n) => /Keep them/.test(n.message)));
  r = await patchEp(MARA, ID.live, { pageNotes: '' });
  pe = await pendingEdit(ID.live);
  r = await resolveEdit({ type: 'episode', id: ID.live, decision: 'approve', seen: pe.row.seen });
  ok('approving a waiting clear empties the notes (null)', r.status === 200 && ep(ID.live).page_notes === null && ep(ID.live).pending_page_notes === null, ep(ID.live));

  section('The team’s own save, and a title never live');
  r = await patchEp(ADMIN, ID.live, { pageNotes: `Team notes ${RUN}.`, description: `Team description ${RUN}.` });
  ok('an admin’s save applies at once', r.status === 200 && ep(ID.live).page_notes === `Team notes ${RUN}.` && ep(ID.live).description === `Team description ${RUN}.` && ep(ID.live).pending_page_notes === null, `${r.status} ${JSON.stringify(ep(ID.live))}`);
  r = await patchEp(MARA, ID.fresh, { description: `In review description ${RUN}.`, pageNotes: `In review notes ${RUN}.` });
  row = ep(ID.fresh);
  ok('a film in review: both apply at once', r.status === 200 && (r.json.applied || []).includes('pageNotes') && (r.json.applied || []).includes('description') && row.page_notes === `In review notes ${RUN}.` && row.description === `In review description ${RUN}.` && row.pending_page_notes === null, `${r.status} ${JSON.stringify(row)}`);
  r = await requestEdit(MARA, { episodeId: ID.fresh, description: `Old-build in review ${RUN}.` });
  ok('…through the older route too (it used to stage even here)', r.status === 200 && ep(ID.fresh).description === `Old-build in review ${RUN}.` && ep(ID.fresh).pending_description === null, `${r.status} ${r.text.slice(0, 160)}`);

  section('A show’s description, and a show episode’s notes, on the admin show page');
  const showsBefore = (await counts()).shows;
  r = await call(`/api/show/${encodeURIComponent(ID.show)}`, { who: MARA, method: 'PATCH', body: { description: `A new show description ${RUN}.` } });
  ok('a live show’s description → staged', r.status === 200 && (r.json.staged || []).includes('description'), `${r.status} ${r.text.slice(0, 200)}`);
  const srow = rows(`select description, pending_description from public.series where id = ${q(ID.show)}`)[0];
  ok('…pending_description holds it, the live one stands', srow.pending_description === `A new show description ${RUN}.` && srow.description === 'The live show description.', srow);
  r = await call(`/api/series-hub?id=${encodeURIComponent(ID.show)}`);
  ok('/api/series-hub: the live description only', r.status === 200 && r.text.includes('The live show description.') && !r.text.includes(`A new show description ${RUN}`), r.status);
  html = await page(`/series/${ID.show}`);
  ok('/series page: the live description only', html.status === 200 && !html.text.includes(`A new show description ${RUN}`), html.status);
  r = await patchEp(MARA, ID.showEp, { pageNotes: `Waiting episode notes ${RUN}.` });
  ok('the show episode’s notes → staged', r.status === 200 && (r.json.staged || []).includes('pageNotes'), `${r.status} ${r.text.slice(0, 160)}`);
  ok('the Shows badge counts both', (await counts()).shows >= showsBefore + 2, `${showsBefore} → ${(await counts()).shows}`);
  r = await call(`/api/admin/show/${encodeURIComponent(ID.show)}`, { who: ADMIN });
  const items = (r.json && r.json.staged) || [];
  const desc = items.find((i) => i.target === 'series' && i.field === 'description');
  const notes = items.find((i) => i.target === 'episode' && i.id === ID.showEp && i.field === 'pageNotes');
  ok('Waiting for approval lists the show’s description and the episode’s notes', desc && notes && desc.proposed === `A new show description ${RUN}.` && notes.proposed === `Waiting episode notes ${RUN}.`, items.map((i) => `${i.target}:${i.field}`));
  r = await call(`/api/admin/show/${encodeURIComponent(ID.show)}`, { who: ADMIN, method: 'POST', body: { action: 'staged', decision: 'approve', items: [{ target: 'series', id: ID.show, field: 'description', seen: desc && desc.seen }, { target: 'episode', id: ID.showEp, field: 'pageNotes', seen: notes && notes.seen }] } });
  ok('approve both → ok', r.status === 200 && r.json.ok === true, r.json);
  ok('…the show’s description is live', rows(`select description, pending_description from public.series where id = ${q(ID.show)}`)[0].description === `A new show description ${RUN}.`);
  ok('…the episode’s notes are live', ep(ID.showEp).page_notes === `Waiting episode notes ${RUN}.` && ep(ID.showEp).pending_page_notes === null, ep(ID.showEp));

  section('A live title’s title image waits');
  const png = await pngTitle();
  r = await patchEp(MARA, ID.live, { titleImageBase64: png, titleImageFileName: 'title.png' });
  ok('a new title image → staged titleImage', r.status === 200 && (r.json.staged || []).includes('titleImage'), `${r.status} ${r.text.slice(0, 200)}`);
  row = ep(ID.live);
  ok('…pending_title_image_url holds it, nothing live', /^https:\/\//.test(row.pending_title_image_url || '') && !row.title_image_url, row);
  html = await page(`/episode/${ID.live}`);
  ok('the film’s page doesn’t draw the waiting title image', html.status === 200 && !html.text.includes('ep-title-image') && !(row.pending_title_image_url && html.text.includes(row.pending_title_image_url.split('/').pop())), html.status);
  r = await call('/api/creator/my-submissions', { who: MARA });
  const art = r.json && (r.json.submissions || []).find((s) => s.id === ID.live);
  ok('Your work’s artwork box knows one waits', art && art.pendingTitleImageUrl === row.pending_title_image_url && art.titleImageWaitReady === true, art && art.pendingTitleImageUrl);
}

async function before122() {
  section('Before 122: notes on a live title can’t wait, so they’re refused');
  let r = await patchEp(MARA, ID.live, { pageNotes: `New notes ${RUN}.` });
  ok('PATCH notes on a live film → 503 migration-122', r.status === 503 && r.json && r.json.code === 'migration-122' && /migration 122/.test(r.json.error || ''), `${r.status} ${r.text.slice(0, 200)}`);
  ok('…nothing changed', ep(ID.live).page_notes === 'The live notes.');
  r = await requestEdit(MARA, { episodeId: ID.live, pageNotes: `Old-build notes ${RUN}.` });
  ok('request-episode-edit notes → 503 migration-122', r.status === 503 && r.json && r.json.code === 'migration-122', `${r.status} ${r.text.slice(0, 200)}`);
  r = await patchEp(MARA, ID.live, { description: `A new description ${RUN}.` });
  ok('the description still waits (pending_description, migration 030)', r.status === 200 && (r.json.staged || []).includes('description') && ep(ID.live).pending_description === `A new description ${RUN}.` && ep(ID.live).description === 'The live description.', `${r.status} ${r.text.slice(0, 200)}`);
  r = await patchEp(MARA, ID.fresh, { pageNotes: `In review notes ${RUN}.` });
  ok('a film in review: the notes apply at once', r.status === 200 && ep(ID.fresh).page_notes === `In review notes ${RUN}.`, `${r.status} ${r.text.slice(0, 200)}`);
  r = await call(`/api/show/episode/${encodeURIComponent(ID.live)}`, { who: MARA });
  ok('the editor greys the notes with the migration line', r.status === 200 && r.json.policy && r.json.policy.pageNotes && r.json.policy.pageNotes.mode === 'locked' && /migration 122/.test(r.json.policy.pageNotes.line || ''), r.json && r.json.policy && r.json.policy.pageNotes);
  r = await call('/api/creator/my-submissions', { who: MARA });
  const mine = r.json && (r.json.submissions || []).find((s) => s.id === ID.live);
  ok('Your work says the notes can’t wait yet (pageNotesWaitReady false)', mine && mine.pageNotesWaitReady === false, mine && mine.pageNotesWaitReady);
  const pe = await pendingEdit(ID.live);
  ok('pending-edits still answers and lists the description', pe.status === 200 && pe.row && pe.row.pendingDescription === `A new description ${RUN}.`, pe.status);
  const c = await counts();
  ok('queue-counts still answers', typeof c.library === 'number' && typeof c.shows === 'number', c);
  for (const p of ['/creator/my-work', `/episode/${ID.live}`, '/admin/library']) {
    const h = await page(p, p.startsWith('/admin') ? ADMIN : MARA);
    ok(`${p} → 200`, h.status === 200, h.status);
  }
}

await runCheck('review-waits', async () => {
  const has122 = hasColumn('episodes', 'pending_page_notes');
  console.log(`database ${has122 ? 'with' : 'without'} migration 122`);
  cleanup();
  seed();
  try {
    if (has122) await after122();
    else await before122();
  } finally {
    cleanup();
  }
});
