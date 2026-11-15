#!/usr/bin/env node
// Every change to a live title is reviewed (Jose, 2026-11-15: "make sure any
// caption change or anything to change the series/live titles needs
// review"; mockups/round3-build-contract.md section B; migration 124's
// episodes.pending_fields / series.pending_fields; lib/liveReviewRules.js,
// lib/showRules.js FIELD_POLICY / teamLiveMode / ownTeamTitle,
// lib/showPage.js updateEpisode / updateShow / setEpisodeCaptions /
// seasonsAction, lib/stagedChanges.js, /api/admin/edit-episode). Runs the
// half that matches the database:
//   after 124  (the rig's default):
//     details   a live film's genres, year, runtime, funding link, ad
//               breaks, ads turned on and credits wait in pending_fields;
//               turning ads off applies at once; the film's page and
//               /api/episode-page keep the live values; the editor shows
//               "Live now → Proposed"; the same value again takes one back;
//               DELETE …/staged takes one back; a film in review takes them
//               at once; another creator is refused;
//     library   pending-edits lists the details with `seen`; a stale `seen`
//               → 409; resolve-edit approves (columns written, nothing
//               waits, the uploader told) and denies;
//     captions  a new track on a live film waits (the live one keeps
//               playing through /api/captions), approving swaps it and
//               deletes the old private file, denying deletes the new one;
//               a removal waits as ''; a film in review takes captions at
//               once;
//     show      a live show's year, link, season names (the editor and the
//               season menu's rename), credits wait; the admin show page's
//               Waiting for approval lists and decides them;
//     team      a full admin's change applies at once; a sub-admin's own
//               live title goes the owner's way (details wait, Who can
//               watch refused with the own-work line) — through the show
//               editor and /api/admin/edit-episode —; a reviewer's change
//               to someone else's live title applies at once, but a file
//               they attach waits in pending_src and they can't approve it;
//               a sub-admin without review is refused on someone else's
//               live title; queue-counts counts what waits;
//   before 124 (RIG_MIGRATE_TO=123 RIG_REBUILD=1 dev/test-rig/start.sh):
//               a live title's detail change and new captions answer 503
//               migration-124 and change nothing; the editor greys the
//               details with the migration's line; a title in review still
//               takes them at once; the Library's lists still answer.
//   node dev/test-rig/checks/live-review.mjs
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { USERS, RUN, ok, section, runCheck, call, page, sql, rows, q, insert, hasColumn, session, newUser, removeUser, clerk, cloudflare, ago } from './lib.mjs';
import { PATHS } from '../lib/config.mjs';
import { ensureBucket, putObject } from '../lib/storage.mjs';

const MARA = session(USERS.mara);
const DEE = session(USERS.dee);
const ADMIN = session(USERS.admin);

const MIGRATION_124_LINE = 'Changing a live title’s details needs a database update (migration 124).';
const TEAM_REVIEW_LINE = 'A reviewer changes someone else’s live title.';
const OWN_TITLE_LINE = 'Someone else on the team changes this on your own title.';
const OWN_WORK_LINE = 'Someone else on the team approves your own work.';

const ID = {
  live: `ck-lr-live-${RUN}`,
  fresh: `ck-lr-fresh-${RUN}`,
  caps: `ck-lr-caps-${RUN}`,
  show: `ck-lr-show-${RUN}`,
  showEp: `ck-lr-show-e1-${RUN}`,
  subOwn: `ck-lr-subown-${RUN}`
};
const hex = () => crypto.randomBytes(16).toString('hex');
const VID = { live: hex(), subOwn: hex(), revFile: hex() };
const cf = (u) => `https://customer-test.cloudflarestream.com/${u}/manifest/video.m3u8`;
const OLD_TRACK = `captions/${ID.caps}-old.vtt`;
const vtt = (line) => `WEBVTT\n\n00:00:01.000 --> 00:00:04.000\n${line}\n`;
const dataUrl = (text) => `data:text/vtt;base64,${Buffer.from(text).toString('base64')}`;

let REVIEWER = null; // a sub-admin: review_submissions + manage_episodes, owns ID.subOwn
let EDITOR = null; // a sub-admin: manage_episodes only

const film = (id, extra = {}) => ({
  id, title: `Check live review ${id.slice(6, 14)} ${RUN}`, description: `The description of ${id}.`, tier: 'free', genre: 'Noir', main_genre: 'Drama', content_type: 'movie',
  artist: 'Mara Reyes', runtime: '22:04', rating: 'TV-PG', release_year: 2024, src: cf(VID.live), video_type: 'html5', video_provider: 'cloudflare',
  ads_enabled: false, ad_break_seconds: [0], funding_url: null, credits: {}, deletion_requested: false, moderation_hold: false, submitted_by: USERS.mara,
  status: 'approved', reviewed_at: ago(3), released_at: ago(3), created_at: ago(5), has_page: true, ...extra
});

async function teamAccount(tag, permissions) {
  const u = await newUser(tag, { role: 'sub_admin', createdDaysAgo: 120 });
  const r = await clerk(`/__users/${u.id}`, { method: 'POST', body: { role: 'sub_admin', permissions, twoFactorEnabled: true } });
  if (r.status !== 200) throw new Error(`fake Clerk refused permissions for ${u.id}: ${r.status}`);
  return u;
}

async function seed() {
  REVIEWER = await teamAccount('lrrev', ['review_submissions', 'manage_episodes']);
  EDITOR = await teamAccount('lredit', ['manage_episodes']);
  for (const [uid, creator] of [[VID.live, USERS.mara], [VID.subOwn, REVIEWER.id], [VID.revFile, REVIEWER.id]]) {
    const r = await cloudflare('/__video', { method: 'POST', body: { uid, name: `ck-lr-${uid.slice(0, 6)}.mp4`, creator, duration: 1324, ready: true, requireSignedURLs: true } });
    if (r.status !== 200) throw new Error(`fake Cloudflare refused a video: ${r.status}`);
  }
  ensureBucket('private-uploads', { public: false });
  putObject('private-uploads', OLD_TRACK, Buffer.from(vtt(`The old line ${RUN}.`)), { contentType: 'text/vtt' });
  insert('episodes', film(ID.live));
  insert('episodes', film(ID.fresh, { status: 'pending', reviewed_at: null, released_at: null }));
  insert('episodes', film(ID.caps, { captions_url: `private:${OLD_TRACK}`, captions_label: 'English', captions_language: 'en' }));
  insert('episodes', film(ID.subOwn, { submitted_by: REVIEWER.id, artist: 'Rev Check', src: cf(VID.subOwn) }));
  insert('series', {
    id: ID.show, name: `Check live review show ${RUN}`, description: 'A live show.', creator_id: USERS.mara, release_year: 2024, status: 'approved',
    submitted_by_user_id: USERS.mara, reviewed_at: ago(10), public_at: ago(10), created_at: ago(12), kind: 'series', defaults: {},
    seasons: [{ number: 1, name: 'The First' }], credits: {}, deletion_requested: false, moderation_hold: false
  });
  insert('episodes', film(ID.showEp, { content_type: 'series', series_id: ID.show, season: 1, series_order: 1, title: `Check live review episode ${RUN}` }));
}

function trackPath(ref) {
  return path.join(PATHS.storage, 'objects', 'private-uploads', String(ref || '').replace(/^private:/, ''));
}

async function cleanup() {
  const ids = Object.values(ID).map(q).join(', ');
  const refs = rows(`select captions_url${hasColumn('episodes', 'pending_fields') ? ', pending_fields' : ''} from public.episodes where id in (${ids})`);
  sql(`delete from public.notifications where episode_id in (${ids}) or message like '%Check live review%${RUN}%'`);
  sql(`delete from public.audit_log where target_id in (${ids})`);
  sql(`delete from public.orphaned_media where context like '%Check live review%${RUN}%' or reference in (${Object.values(VID).map(q).join(', ')})`);
  sql(`delete from public.episodes where id in (${ids})`);
  sql(`delete from public.series where id = ${q(ID.show)}`);
  for (const r of refs) {
    const pf = r.pending_fields && typeof r.pending_fields === 'object' ? r.pending_fields : null;
    for (const ref of [r.captions_url, pf && pf.captions && pf.captions.ref]) if (ref && String(ref).startsWith('private:captions/ck-lr-')) fs.rmSync(trackPath(ref), { force: true });
  }
  fs.rmSync(trackPath(`private:${OLD_TRACK}`), { force: true });
  for (const u of [REVIEWER, EDITOR]) if (u) await removeUser(u.id);
}

const ep = (id) => rows(`select * from public.episodes where id = ${q(id)}`)[0] || {};
const show = () => rows(`select * from public.series where id = ${q(ID.show)}`)[0] || {};
const pf = (row) => (row.pending_fields && typeof row.pending_fields === 'object' ? row.pending_fields : {});
const patchEp = (who, id, body) => call(`/api/show/episode/${encodeURIComponent(id)}`, { who, method: 'PATCH', body });
const editor = (who, id) => call(`/api/show/episode/${encodeURIComponent(id)}`, { who });
const errOf = (r) => (r && r.json && r.json.error) || '';
const brief = (r) => `${r.status} ${String(r.text || '').slice(0, 220)}`;
async function counts() {
  const r = await call('/api/admin/queue-counts', { who: ADMIN });
  return r.json || {};
}
async function pendingEdit(id) {
  const r = await call('/api/admin/pending-edits', { who: ADMIN });
  return { status: r.status, row: r.json && (r.json.episodes || []).find((e) => e.id === id), series: r.json && (r.json.series || []).find((s) => s.id === ID.show) };
}
const resolveEdit = (who, body) => call('/api/admin/resolve-edit', { who, method: 'POST', body });
const captionsOf = (id, who) => call(`/api/captions/${encodeURIComponent(id)}?terms=1`, { who, bearer: true, accept: 'text/vtt' });
const addCaptions = (who, body) => call('/api/creator/add-captions', { who, method: 'POST', body });

async function details() {
  section('A live film’s details wait in pending_fields');
  const before = await counts();
  let r = await patchEp(MARA, ID.live, {
    genre: 'Cosmic Horror', mainGenre: 'Horror', releaseYear: 2025, runtime: '23:10', fundingUrl: 'https://example.com/back-it', adBreakSeconds: [0, 600], adsEnabled: true,
    credits: { studio: { name: `Night Owl ${RUN}` } }
  });
  const want = ['genre', 'mainGenre', 'releaseYear', 'runtime', 'fundingUrl', 'adBreakSeconds', 'adsEnabled', 'credits'];
  ok('PATCH → 200, every detail staged, nothing applied', r.status === 200 && want.every((f) => (r.json.staged || []).includes(f)) && !(r.json.applied || []).length, brief(r));
  let row = ep(ID.live);
  ok('…pending_fields holds them; the live columns are unchanged', pf(row).genre === 'Cosmic Horror' && pf(row).releaseYear === 2025 && JSON.stringify(pf(row).adBreakSeconds) === '[0,600]' && pf(row).adsEnabled === true
    && row.genre === 'Noir' && row.release_year === 2024 && row.runtime === '22:04' && row.ads_enabled === false && !row.funding_url, { pf: row.pending_fields, genre: row.genre });
  const html = await page(`/episode/${ID.live}`);
  ok('the film’s page shows none of the waiting values', html.status === 200 && !html.text.includes('Cosmic Horror') && !html.text.includes(`Night Owl ${RUN}`) && !html.text.includes('back-it'), html.status);
  r = await call(`/api/episode-page?id=${encodeURIComponent(ID.live)}&terms=1`);
  ok('/api/episode-page: no pending_fields, no waiting value', r.status === 200 && !r.text.includes('pending_fields') && !r.text.includes('pendingFields') && !r.text.includes('Cosmic Horror') && !r.text.includes(`Night Owl ${RUN}`), brief(r));
  r = await editor(MARA, ID.live);
  const d = (r.json && r.json.episode && r.json.episode.staged && r.json.episode.staged.details) || [];
  const g = d.find((x) => x.field === 'genre');
  ok('the uploader’s editor: Live now → Proposed for each waiting detail', r.status === 200 && d.length === want.length && g && g.live === 'Noir' && g.proposed === 'Cosmic Horror', d);
  ok('…the policy says the details wait; the ads switch is off, so turning it on waits', r.json.policy.genre.mode === 'staged' && r.json.policy.credits.mode === 'staged' && r.json.policy.adsEnabled.mode === 'staged', r.json && r.json.policy && { g: r.json.policy.genre, a: r.json.policy.adsEnabled });
  const after = await counts();
  ok('queue-counts: the Library’s edits count it', after.library >= before.library + 1, `${before.library} → ${after.library}`);

  section('Taking back, replacing, and what applies at once');
  r = await patchEp(MARA, ID.live, { genre: 'Noir' });
  ok('the live genre again takes the waiting one back (and says so)', r.status === 200 && !('genre' in pf(ep(ID.live))) && (r.json.notices || []).some((n) => /taken back/.test(n)), brief(r));
  r = await patchEp(MARA, ID.live, { runtime: '23:45' });
  ok('a newer runtime replaces the waiting one', r.status === 200 && pf(ep(ID.live)).runtime === '23:45' && (r.json.notices || []).some((n) => /replaces/.test(n)), brief(r));
  r = await call(`/api/show/episode/${encodeURIComponent(ID.live)}/staged?field=runtime`, { who: MARA, method: 'DELETE' });
  ok('DELETE …/staged?field=runtime takes it back', r.status === 200 && !('runtime' in pf(ep(ID.live))) && ep(ID.live).runtime === '22:04', brief(r));
  r = await call(`/api/show/episode/${encodeURIComponent(ID.live)}/staged?field=runtime`, { who: MARA, method: 'DELETE' });
  ok('…again → 409 nothing-staged', r.status === 409, r.status);
  sql(`update public.episodes set ads_enabled = true where id = ${q(ID.fresh)}`);
  r = await patchEp(MARA, ID.fresh, { genre: 'Western', adsEnabled: false, releaseYear: 2023 });
  ok('a film in review: its details apply at once', r.status === 200 && ep(ID.fresh).genre === 'Western' && ep(ID.fresh).release_year === 2023 && ep(ID.fresh).ads_enabled === false && !(r.json.staged || []).length, brief(r));
  sql(`update public.episodes set ads_enabled = true where id = ${q(ID.showEp)}`);
  r = await patchEp(MARA, ID.showEp, { adsEnabled: false });
  ok('turning ads off on a live title applies at once', r.status === 200 && ep(ID.showEp).ads_enabled === false && (r.json.applied || []).includes('adsEnabled'), brief(r));
  r = await patchEp(DEE, ID.live, { genre: 'Not Dee’s' });
  ok('another creator is refused (403/404)', r.status === 403 || r.status === 404, r.status);

  section('The Library decides them (pending-edits → resolve-edit)');
  let pe = await pendingEdit(ID.live);
  ok('pending-edits lists the film’s details in words with a seen map', pe.status === 200 && pe.row && Array.isArray(pe.row.details) && pe.row.details.some((x) => x.field === 'releaseYear' && x.live === '2024' && x.proposed === '2025') && pe.row.seen && pe.row.seen.releaseYear, pe.row);
  const stale = pe.row.seen;
  r = await patchEp(MARA, ID.live, { releaseYear: 2026 });
  r = await resolveEdit(ADMIN, { type: 'episode', id: ID.live, decision: 'approve', seen: stale });
  ok('a change replaced after the list loaded → 409 changed, nothing decided', r.status === 409 && ep(ID.live).release_year === 2024 && pf(ep(ID.live)).releaseYear === 2026, brief(r));
  pe = await pendingEdit(ID.live);
  r = await resolveEdit(ADMIN, { type: 'episode', id: ID.live, decision: 'approve', seen: pe.row.seen });
  row = ep(ID.live);
  ok('approve → 200: each detail in its column, nothing waits', r.status === 200 && row.release_year === 2026 && row.main_genre === 'Horror' && row.funding_url === 'https://example.com/back-it' && JSON.stringify(row.ad_break_seconds) === '[0,600]'
    && row.ads_enabled === true && row.credits && row.credits.studio && row.credits.studio.name === `Night Owl ${RUN}` && row.pending_fields === null, { status: r.status, row: { y: row.release_year, pf: row.pending_fields, ads: row.ads_enabled } });
  const told = rows(`select type, message from public.notifications where user_id = ${q(USERS.mara)} and episode_id = ${q(ID.live)} order by created_at desc limit 1`)[0];
  ok('…the uploader is told', told && told.type === 'edit_approved', told);
  r = await patchEp(MARA, ID.live, { artist: `A new credit ${RUN}` });
  pe = await pendingEdit(ID.live);
  r = await resolveEdit(ADMIN, { type: 'episode', id: ID.live, decision: 'deny', seen: pe.row.seen, note: 'Not this one.' });
  ok('deny → 200: the live Made by stays, nothing waits', r.status === 200 && ep(ID.live).artist === 'Mara Reyes' && ep(ID.live).pending_fields === null, brief(r));
}

async function captions() {
  section('Captions on a live title wait; approving swaps the track');
  let r = await captionsOf(ID.caps, MARA);
  ok('the live track plays', r.status === 200 && r.text.includes(`The old line ${RUN}.`), brief(r));
  r = await addCaptions(MARA, { episodeId: ID.caps, captionsBase64: dataUrl(vtt(`The new line ${RUN}.`)), captionsFileName: 'new.vtt', language: 'es', label: 'Español' });
  ok('add-captions on a live film → 200 staged', r.status === 200 && r.json.staged === true, brief(r));
  let row = ep(ID.caps);
  const ref = pf(row).captions && pf(row).captions.ref;
  ok('…the new track waits in pending_fields.captions; captions_url is the old one', /^private:captions\//.test(ref || '') && row.captions_url === `private:${OLD_TRACK}` && pf(row).captions.language === 'es', row.pending_fields);
  ok('…the new file is in private storage', fs.existsSync(trackPath(ref)));
  r = await captionsOf(ID.caps, MARA);
  ok('…viewers still get the old track', r.status === 200 && r.text.includes(`The old line ${RUN}.`) && !r.text.includes(`The new line ${RUN}.`), brief(r));
  r = await editor(MARA, ID.caps);
  ok('the editor shows the waiting track and no stored address', r.status === 200 && r.json.episode.staged.captions && r.json.episode.staged.captions.label === 'Español' && !r.text.includes(String(ref)), r.json && r.json.episode && r.json.episode.staged && r.json.episode.staged.captions);
  let pe = await pendingEdit(ID.caps);
  const capLine = pe.row && (pe.row.details || []).find((x) => x.field === 'captions');
  ok('pending-edits lists it in words (never the address)', capLine && /Español \(es\)/.test(capLine.proposed) && !JSON.stringify(pe.row).includes('private:'), capLine);
  r = await resolveEdit(ADMIN, { type: 'episode', id: ID.caps, decision: 'approve', seen: pe.row.seen });
  row = ep(ID.caps);
  ok('approve → the new track is live, nothing waits', r.status === 200 && row.captions_url === ref && row.captions_language === 'es' && row.pending_fields === null, brief(r));
  ok('…the old private file is deleted', !fs.existsSync(trackPath(`private:${OLD_TRACK}`)));
  r = await captionsOf(ID.caps, MARA);
  ok('…viewers get the new track', r.status === 200 && r.text.includes(`The new line ${RUN}.`), brief(r));

  section('Denying a waiting track deletes it; a removal waits as \'\'');
  r = await addCaptions(MARA, { episodeId: ID.caps, captionsBase64: dataUrl(vtt(`A denied line ${RUN}.`)), captionsFileName: 'denied.vtt' });
  const deniedRef = pf(ep(ID.caps)).captions && pf(ep(ID.caps)).captions.ref;
  pe = await pendingEdit(ID.caps);
  r = await resolveEdit(ADMIN, { type: 'episode', id: ID.caps, decision: 'deny', seen: pe.row.seen });
  ok('deny → the live track stays, the waiting file is deleted', r.status === 200 && ep(ID.caps).captions_url === ref && deniedRef && !fs.existsSync(trackPath(deniedRef)), brief(r));
  r = await addCaptions(MARA, { episodeId: ID.caps, remove: true });
  ok('removing them on a live film waits (\'\')', r.status === 200 && r.json.staged === true && pf(ep(ID.caps)).captions === '' && ep(ID.caps).captions_url === ref, brief(r));
  r = await call(`/api/show/episode/${encodeURIComponent(ID.caps)}/staged?field=captions`, { who: MARA, method: 'DELETE' });
  ok('…the uploader takes the removal back', r.status === 200 && !('captions' in pf(ep(ID.caps))) && ep(ID.caps).captions_url === ref, brief(r));
  r = await addCaptions(MARA, { episodeId: ID.fresh, captionsBase64: dataUrl(vtt(`In review ${RUN}.`)), captionsFileName: 'review.vtt' });
  ok('a film in review: captions apply at once', r.status === 200 && r.json.staged === false && /^private:captions\//.test(ep(ID.fresh).captions_url || ''), brief(r));
  r = await addCaptions(DEE, { episodeId: ID.caps, remove: true });
  ok('another creator can’t touch them (403/404)', r.status === 403 || r.status === 404, r.status);
}

async function showDetails() {
  section('A live show’s year, link, season names and credits wait');
  let r = await call(`/api/show/${encodeURIComponent(ID.show)}`, { who: MARA, method: 'PATCH', body: { releaseYear: 2025, fundingUrl: 'https://example.com/show', credits: { producer: { name: `Pia ${RUN}` } }, seasons: [{ number: 1, name: 'The Opener' }] } });
  ok('PATCH the show → 200, all four staged', r.status === 200 && ['releaseYear', 'fundingUrl', 'credits', 'seasons'].every((f) => (r.json.staged || []).includes(f)), brief(r));
  let s = show();
  ok('…series.pending_fields holds them; the live values stand', pf(s).releaseYear === 2025 && pf(s).seasons && pf(s).seasons[0].name === 'The Opener' && s.release_year === 2024 && s.seasons[0].name === 'The First', s.pending_fields);
  r = await call(`/api/show/${encodeURIComponent(ID.show)}/seasons`, { who: MARA, method: 'PATCH', body: { action: 'rename', number: 1, label: 'The Pilot' } });
  ok('the season menu’s rename waits too (staged, built on what waits)', r.status === 200 && r.json.staged === true && pf(show()).seasons[0].name === 'The Pilot' && show().seasons[0].name === 'The First', brief(r));
  r = await call(`/api/show/${encodeURIComponent(ID.show)}`, { who: MARA });
  const sd = (r.json && r.json.show && r.json.show.staged && r.json.show.staged.details) || [];
  ok('the show page’s data: the waiting details in words', r.status === 200 && sd.some((x) => x.field === 'seasons' && /The Pilot/.test(x.proposed)), sd);
  const html = await page(`/series/${ID.show}`);
  ok('the public series page shows none of them', html.status === 200 && !html.text.includes('The Pilot') && !html.text.includes(`Pia ${RUN}`), html.status);
  r = await call(`/api/admin/show/${encodeURIComponent(ID.show)}`, { who: ADMIN });
  const items = ((r.json && r.json.staged) || []).filter((i) => i.target === 'series');
  const year = items.find((i) => i.field === 'releaseYear');
  ok('the admin show page’s Waiting for approval lists them', r.status === 200 && year && year.current === '2024' && year.proposed === '2025' && items.some((i) => i.field === 'seasons'), items.map((i) => `${i.field}:${i.current}→${i.proposed}`));
  r = await call(`/api/admin/show/${encodeURIComponent(ID.show)}`, { who: ADMIN, method: 'POST', body: { action: 'staged', decision: 'approve', items: items.map((i) => ({ target: i.target, id: i.id, field: i.field, seen: i.seen })) } });
  s = show();
  ok('approve all → live: the year, the link, the season name, the producer', r.status === 200 && r.json.ok === true && s.release_year === 2025 && s.funding_url === 'https://example.com/show' && s.seasons[0].name === 'The Pilot' && s.credits.producer && s.credits.producer.name === `Pia ${RUN}` && s.pending_fields === null, r.json);
  r = await call(`/api/show/${encodeURIComponent(ID.show)}`, { who: MARA, method: 'PATCH', body: { releaseYear: 2027 } });
  r = await call(`/api/show/${encodeURIComponent(ID.show)}/staged?field=releaseYear`, { who: MARA, method: 'DELETE' });
  ok('the owner takes a waiting year back', r.status === 200 && show().pending_fields === null && show().release_year === 2025, brief(r));

  // The review of 2026-11-15: a live episode that left its specific genre
  // blank shows the show's default (lib/showRules.js inheritedField), so a
  // new default waits like the year.
  section('A live show’s defaults wait too');
  sql(`update public.episodes set genre = null where id = ${q(ID.showEp)}`);
  sql(`update public.series set defaults = '{"genre":"Show Noir","cutArt":true}'::jsonb where id = ${q(ID.show)}`);
  let epPage = await call(`/api/episode-page?id=${encodeURIComponent(ID.showEp)}`, { who: DEE });
  ok('the episode shows the show’s genre', epPage.status === 200 && epPage.json.episode && epPage.json.episode.genre === 'Show Noir', epPage.json && epPage.json.episode && epPage.json.episode.genre);
  r = await call(`/api/show/${encodeURIComponent(ID.show)}`, { who: MARA, method: 'PATCH', body: { defaults: { genre: `Changed ${RUN}` } } });
  s = show();
  ok('PATCH the defaults → 200, staged; the live defaults (and the cut-art flag) stand', r.status === 200 && (r.json.staged || []).includes('defaults') && pf(s).defaults && pf(s).defaults.genre === `Changed ${RUN}` && !('cutArt' in pf(s).defaults) && s.defaults.genre === 'Show Noir' && s.defaults.cutArt === true, brief(r));
  epPage = await call(`/api/episode-page?id=${encodeURIComponent(ID.showEp)}`, { who: DEE });
  ok('…the live episode still shows the live default', epPage.status === 200 && epPage.json.episode.genre === 'Show Noir', epPage.json && epPage.json.episode && epPage.json.episode.genre);
  r = await call(`/api/show/${encodeURIComponent(ID.show)}`, { who: MARA, method: 'PATCH', body: { defaults: { genre: 'Show Noir' } } });
  ok('the same value as live takes it back', r.status === 200 && show().pending_fields === null, brief(r));
  r = await call(`/api/show/${encodeURIComponent(ID.show)}`, { who: MARA, method: 'PATCH', body: { defaults: { genre: `Changed ${RUN}` } } });
  r = await call(`/api/admin/show/${encodeURIComponent(ID.show)}`, { who: ADMIN });
  const dItem = ((r.json && r.json.staged) || []).find((i) => i.target === 'series' && i.field === 'defaults');
  ok('the admin show page lists it in words', dItem && dItem.current === 'Show Noir' && dItem.proposed === `Changed ${RUN}`, dItem);
  const pe = await pendingEdit(ID.showEp);
  ok('…and the Library’s pending edits name the show’s waiting defaults', pe.status === 200 && pe.series && (pe.series.details || []).some((d) => d.field === 'defaults' && d.proposed === `Changed ${RUN}`), pe.series);
  r = await call(`/api/admin/show/${encodeURIComponent(ID.show)}`, { who: ADMIN, method: 'POST', body: { action: 'staged', decision: 'approve', items: [{ target: dItem.target, id: dItem.id, field: dItem.field, seen: dItem.seen }] } });
  s = show();
  ok('approved → the new default is live, the cut-art flag kept, nothing waits', r.status === 200 && s.defaults.genre === `Changed ${RUN}` && s.defaults.cutArt === true && s.pending_fields === null, { status: r.status, defaults: s.defaults, pf: s.pending_fields });
  epPage = await call(`/api/episode-page?id=${encodeURIComponent(ID.showEp)}`, { who: DEE });
  ok('…the episode shows it now', epPage.status === 200 && epPage.json.episode.genre === `Changed ${RUN}`, epPage.json && epPage.json.episode && epPage.json.episode.genre);
  sql(`update public.series set defaults = '{}'::jsonb where id = ${q(ID.show)}`);
}

async function team() {
  section('The team on live titles');
  let r = await patchEp(ADMIN, ID.live, { genre: 'Thriller' });
  ok('a full admin’s change applies at once', r.status === 200 && ep(ID.live).genre === 'Thriller' && (r.json.applied || []).includes('genre'), brief(r));
  r = await patchEp(REVIEWER, ID.live, { genre: 'Mystery' });
  ok('a reviewer’s change to someone else’s live title applies at once', r.status === 200 && ep(ID.live).genre === 'Mystery', brief(r));
  r = await patchEp(EDITOR, ID.live, { genre: 'Romance' });
  ok('a sub-admin without review → 403 with the line', r.status === 403 && errOf(r).replace(/\.$/, '') === TEAM_REVIEW_LINE.replace(/\.$/, ''), brief(r));
  ok('…unchanged', ep(ID.live).genre === 'Mystery');
  // The review of 2026-11-15: turning ads off only takes something away,
  // so it applies at once for them too (the show editor, as the Library's
  // route always did).
  sql(`update public.episodes set ads_enabled = true where id = ${q(ID.live)}`);
  r = await editor(EDITOR, ID.live);
  ok('…the ads switch, on, is open to them in the editor', r.status === 200 && r.json.policy && r.json.policy.adsEnabled && r.json.policy.adsEnabled.mode === 'direct', r.json && r.json.policy && r.json.policy.adsEnabled);
  r = await patchEp(EDITOR, ID.live, { adsEnabled: false });
  ok('…turning ads off applies at once', r.status === 200 && ep(ID.live).ads_enabled === false && (r.json.applied || []).includes('adsEnabled'), brief(r));
  r = await patchEp(EDITOR, ID.live, { adsEnabled: true });
  ok('…turning them back on is still refused', r.status === 403 && ep(ID.live).ads_enabled === false, brief(r));
  r = await editor(REVIEWER, ID.subOwn);
  ok('their own live title: the editor says the details wait and Who can watch is closed', r.status === 200 && r.json.policy.genre.mode === 'staged' && r.json.policy.tier.mode === 'locked', r.json && r.json.policy && { g: r.json.policy.genre, t: r.json.policy.tier });
  r = await patchEp(REVIEWER, ID.subOwn, { genre: 'Their own genre' });
  ok('…a change to their own live title waits (the own-work rule)', r.status === 200 && (r.json.staged || []).includes('genre') && ep(ID.subOwn).genre === 'Noir', brief(r));
  r = await patchEp(REVIEWER, ID.subOwn, { tier: 'premium' });
  ok('…Who can watch on their own live title → 403 own-work', r.status === 403 && /your own title/.test(errOf(r)), brief(r));
  r = await patchEp(REVIEWER, ID.subOwn, { title: `Their own new title ${RUN}` });
  ok('…their own title’s title waits too (pending_title)', r.status === 200 && ep(ID.subOwn).pending_title === `Their own new title ${RUN}`, brief(r));
  let pe = await pendingEdit(ID.subOwn);
  r = await resolveEdit(REVIEWER, { type: 'episode', id: ID.subOwn, decision: 'approve', seen: pe.row && pe.row.seen });
  ok('…and they can’t approve it themselves (403 own-work)', r.status === 403 && errOf(r) === OWN_WORK_LINE, brief(r));

  section('/api/admin/edit-episode goes through the same policy');
  r = await call('/api/admin/edit-episode', { who: REVIEWER, method: 'POST', body: { episodeId: ID.subOwn, runtime: '30:00' } });
  ok('a sub-admin’s own live title: the runtime waits (staged in the answer)', r.status === 200 && (r.json.staged || []).includes('runtime') && pf(ep(ID.subOwn)).runtime === '30:00' && ep(ID.subOwn).runtime === '22:04', brief(r));
  r = await call('/api/admin/edit-episode', { who: REVIEWER, method: 'POST', body: { episodeId: ID.subOwn, tier: 'premium' } });
  ok('…Who can watch → 403 with the own-work line', r.status === 403 && errOf(r) === OWN_TITLE_LINE && ep(ID.subOwn).tier === 'free', brief(r));
  r = await call('/api/admin/edit-episode', { who: EDITOR, method: 'POST', body: { episodeId: ID.live, artist: 'Editor tries' } });
  ok('a sub-admin without review on someone else’s live title → 403', r.status === 403 && errOf(r) === TEAM_REVIEW_LINE && ep(ID.live).artist === 'Mara Reyes', brief(r));
  r = await call('/api/admin/edit-episode', { who: REVIEWER, method: 'POST', body: { episodeId: ID.live, artist: `Reviewer credit ${RUN}` } });
  ok('a reviewer on someone else’s live title: at once', r.status === 200 && ep(ID.live).artist === `Reviewer credit ${RUN}`, brief(r));
  r = await call('/api/admin/edit-episode', { who: REVIEWER, method: 'POST', body: { episodeId: ID.live, cloudflareVideoUid: VID.revFile } });
  ok('a reviewer’s own upload as someone else’s live title’s file waits in pending_src', r.status === 200 && (r.json.staged || []).includes('video') && String(ep(ID.live).pending_src || '').includes(VID.revFile) && String(ep(ID.live).src || '').includes(VID.live), brief(r));
  r = await call('/api/admin/resolve-artwork', { who: REVIEWER, method: 'POST', body: { type: 'episode', id: ID.live, decision: 'approve', part: 'video' } });
  ok('…they can’t approve the file they uploaded (403 own-work)', r.status === 403 && errOf(r) === OWN_WORK_LINE && String(ep(ID.live).src || '').includes(VID.live), brief(r));
  r = await call('/api/admin/resolve-artwork', { who: ADMIN, method: 'POST', body: { type: 'episode', id: ID.live, decision: 'deny', part: 'video' } });
  ok('…a full admin denies it', r.status === 200 && !ep(ID.live).pending_src, brief(r));
  r = await call(`/api/show/episode/${encodeURIComponent(ID.live)}/video`, { who: REVIEWER, method: 'POST', body: { videoUid: VID.revFile } });
  ok('the show editor’s file route stages it the same way', r.status === 200 && r.json.staged === true && String(ep(ID.live).pending_src || '').includes(VID.revFile), brief(r));
  sql(`update public.episodes set pending_src = null where id = ${q(ID.live)}`);
}

async function after124() {
  await details();
  await captions();
  await showDetails();
  await team();
  for (const p of ['/admin/library', `/admin/shows/${ID.show}`]) {
    const h = await page(p, ADMIN);
    ok(`${p} → 200`, h.status === 200, h.status);
  }
  for (const p of [`/creator/show/${ID.show}`, `/creator/show/${ID.show}/episode/${ID.showEp}`, `/creator/title/${ID.live}`]) {
    const h = await page(p, MARA);
    ok(`${p} → 200`, h.status === 200, h.status);
  }
}

async function before124() {
  section('Before migration 124: a live title’s details and captions have nowhere to wait');
  let r = await patchEp(MARA, ID.live, { genre: 'Cosmic Horror' });
  ok('a live film’s genre → 503 migration-124, nothing written', r.status === 503 && r.json.code === 'migration-124' && errOf(r) === MIGRATION_124_LINE && ep(ID.live).genre === 'Noir', brief(r));
  r = await call(`/api/show/${encodeURIComponent(ID.show)}`, { who: MARA, method: 'PATCH', body: { releaseYear: 2025 } });
  ok('a live show’s year → 503 migration-124', r.status === 503 && r.json.code === 'migration-124', brief(r));
  r = await addCaptions(MARA, { episodeId: ID.caps, captionsBase64: dataUrl(vtt(`Too early ${RUN}.`)), captionsFileName: 'early.vtt' });
  ok('new captions on a live film → 503 migration-124, the track unchanged', r.status === 503 && r.json.code === 'migration-124' && ep(ID.caps).captions_url === `private:${OLD_TRACK}`, brief(r));
  r = await editor(MARA, ID.live);
  ok('the editor greys the details with the migration’s line', r.status === 200 && r.json.policy.genre.mode === 'locked' && r.json.policy.genre.line === MIGRATION_124_LINE && r.json.policy.captions.mode === 'locked', r.json && r.json.policy && r.json.policy.genre);
  r = await patchEp(MARA, ID.live, { description: `Still waits ${RUN}.` });
  ok('the description still waits in its own column', r.status === 200 && ep(ID.live).pending_description === `Still waits ${RUN}.`, brief(r));
  r = await patchEp(MARA, ID.fresh, { genre: 'Western' });
  ok('a film in review: its genre applies at once', r.status === 200 && ep(ID.fresh).genre === 'Western', brief(r));
  r = await patchEp(ADMIN, ID.live, { genre: 'Thriller' });
  ok('a full admin’s change applies at once', r.status === 200 && ep(ID.live).genre === 'Thriller', brief(r));
  const pe = await pendingEdit(ID.live);
  ok('pending-edits still answers and lists the description', pe.status === 200 && pe.row && pe.row.pendingDescription === `Still waits ${RUN}.`, pe.status);
  const c = await counts();
  ok('queue-counts still answers', typeof c.library === 'number' && typeof c.shows === 'number', c);
}

await runCheck('live-review', async () => {
  const has124 = hasColumn('episodes', 'pending_fields');
  console.log(`database ${has124 ? 'with' : 'without'} migration 124`);
  await cleanup();
  await seed();
  try {
    if (has124) await after124();
    else await before124();
  } finally {
    await cleanup();
  }
});
