#!/usr/bin/env node
// The titles-and-shows security fixes of 2026-11-15 (lib/titleSecurityRules.js):
//   - a withdrawn title or show (kept for its buyers) stays withdrawn: its
//     uploader's "take back the removal" is refused on both routes, an
//     admin's deny too, and the public readers skip it even if its request
//     were cleared — while its buyer still plays it;
//   - confirming a removal nobody asked for does nothing (409) — no sales
//     switched off, no "deleted" notice, no orphaned files;
//   - "the team" that previews and plays other people's unreleased titles
//     is a full admin or a sub-admin with review_submissions or
//     manage_episodes: a sub-admin with no permission is refused, one with
//     only manage_artwork reads a show's page for Admin → Shows but can't
//     write, open an editor or list every show;
//   - a new file on a live title is a reviewer's call, and only a full
//     admin attaches someone else's video;
//   - a podcast's audio address is one of our own files, the uploader's,
//     no other title's;
//   - an untagged video used only by an ownerless title can't be claimed;
//   - a screener stops playing once its title's show is pulled, and none
//     can be made for it then;
//   - an uploader can't take a pending episode out of someone else's show;
//   - nobody but a full admin approves their own work.
// Rig up, any migration from 120 on.
//   node dev/test-rig/checks/sec-titles.mjs
import crypto from 'node:crypto';
import { IDS, USERS, RUN, FAKES, ok, section, runCheck, call, page, sql, rows, q, insert, session, SIGNED_OUT, newUser, removeUser, cloudflare, clerk, ago, uidFor, hasColumn } from './lib.mjs';

const MARA = session(USERS.mara);
const DEE = session(USERS.dee);
const ADMIN = session(USERS.admin);
const VIEWER = session(USERS.viewer);
const SUB = session(USERS.sub); // review_submissions + manage_episodes (the seed)

// The lines the site answers with (lib/titleSecurityRules.js).
const WITHDRAWN_LINE = 'It’s withdrawn and kept for the people who bought it, so it can’t be changed here.';
const NO_REMOVAL_LINE = 'No removal is requested for this.';
const FILE_REVIEW_LINE = 'A reviewer approves a new file on a live title.';
const OWN_WORK_LINE = 'Someone else on the team approves your own work.';
const AUDIO_NOT_OURS = 'Upload the audio here (or paste a link to the file and we’ll copy it in) — an outside address can’t be used.';
const AUDIO_OTHERS = 'That audio file was uploaded by someone else.';
const AUDIO_TAKEN = 'That audio file is already used by another title.';

const ID = {
  wFilm: `ck-st-wfilm-${RUN}`,
  wShow: `ck-st-wshow-${RUN}`,
  wShowE1: `ck-st-wshow-e1-${RUN}`,
  notAsked: `ck-st-notasked-${RUN}`,
  notAskedBought: `ck-st-notasked-b-${RUN}`,
  pending: `ck-st-pending-${RUN}`,
  privShow: `ck-st-privshow-${RUN}`,
  privE1: `ck-st-privshow-e1-${RUN}`,
  live: `ck-st-live-${RUN}`,
  inReview: `ck-st-inreview-${RUN}`,
  pod: `ck-st-pod-${RUN}`,
  podMara: `ck-st-pod-mara-${RUN}`,
  ownerless: `ck-st-ownerless-${RUN}`,
  scrShow: `ck-st-scrshow-${RUN}`,
  scrE1: `ck-st-scrshow-e1-${RUN}`,
  maraShow: `ck-st-marashow-${RUN}`,
  deeInMara: `ck-st-dee-in-mara-${RUN}`,
  subOwn: `ck-st-subown-${RUN}`,
  subLive: `ck-st-sublive-${RUN}`
};
const PRODUCTION = crypto.randomUUID();
const TOKEN = crypto.randomBytes(18).toString('base64url');
const SCREENER_LABEL = `Check st programmers ${RUN}`;
const CHANNEL_MEDIA = crypto.randomUUID();
const hex = () => crypto.randomBytes(16).toString('hex');
const VID = { eps: hex(), mara: hex(), deeOld: hex(), untaggedUsed: hex(), untaggedFree: hex() };
const cf = (u) => `https://customer-test.cloudflarestream.com/${u}/manifest/video.m3u8`;
// The address the app's own storage gives a file (lib/audioUpload.js).
const SUPA = process.env.RIG_SUPABASE_TLS === '0' ? FAKES.supabase : FAKES.supabaseTls;
const audioAt = (path) => `${String(SUPA).replace(/\/+$/, '')}/storage/v1/object/public/episode-audio/${path}`;
const AUDIO = {
  deeOwn: `podcast-${USERS.dee}-${RUN}-own.mp3`,
  maraNamed: `podcast-${USERS.mara}-${RUN}-hers.mp3`,
  legacyMara: `podcast-${RUN}-legacy.mp3`
};

const base = (id, extra = {}) => ({
  id, title: `Check st ${id.slice(6, 20)} ${RUN}`, description: `The description of ${id}.`, tier: 'free', genre: 'Drama', main_genre: 'Drama', content_type: 'movie',
  artist: 'Dee Park', runtime: '14:00', rating: 'TV-PG', release_year: 2026, src: cf(uidFor(IDS.short)), video_type: 'html5', video_provider: 'cloudflare',
  ads_enabled: false, deletion_requested: false, moderation_hold: false, submitted_by: USERS.dee, status: 'approved', reviewed_at: ago(3), released_at: ago(3), created_at: ago(5),
  poster: null, thumbnail: null, ...extra
});
const show = (id, extra = {}) => ({
  id, name: `Check st show ${id.slice(6, 20)} ${RUN}`, description: 'A show for the security check.', creator_id: USERS.dee, release_year: 2026, status: 'approved',
  submitted_by_user_id: USERS.dee, reviewed_at: ago(10), public_at: ago(10), created_at: ago(12), kind: 'series', defaults: {}, seasons: [], credits: {},
  deletion_requested: false, moderation_hold: false, ...extra
});

let NOPERM = null; // a sub-admin with no permission at all
let ART = null; // a sub-admin with manage_artwork only
let EPS = null; // a sub-admin with manage_episodes only (no review)
const createdIds = [];

async function teamAccount(tag, permissions) {
  const u = await newUser(tag, { role: 'sub_admin', createdDaysAgo: 120 });
  const r = await clerk(`/__users/${u.id}`, { method: 'POST', body: { permissions, twoFactorEnabled: true } });
  if (r.status !== 200) throw new Error(`fake Clerk refused permissions for ${u.id}: ${r.status}`);
  return u;
}

async function seed() {
  NOPERM = await teamAccount('stnoperm', []);
  ART = await teamAccount('start', ['manage_artwork']);
  EPS = await teamAccount('steps', ['manage_episodes']);
  for (const [key, creator] of [['eps', EPS.id], ['mara', USERS.mara], ['deeOld', USERS.dee], ['untaggedUsed', null], ['untaggedFree', null]]) {
    const r = await cloudflare('/__video', { method: 'POST', body: { uid: VID[key], name: `ck-st-${key}.mp4`, creator, duration: 600, ready: true } });
    if (r.status !== 200) throw new Error(`fake Cloudflare refused a video: ${r.status}`);
  }

  // A withdrawn film of Dee's (kept for its buyer, the viewer) and a
  // withdrawn show with its kept episode.
  insert('episodes', base(ID.wFilm, { deletion_requested: true, deletion_reason: 'Asked by the check.', deletion_requested_at: ago(2), withdrawn_at: ago(1) }));
  insert('purchases', { buyer_id: USERS.viewer, target_type: 'episode', target_id: ID.wFilm, creator_id: USERS.dee, title: 'Check st', price_cents: 199, paid_cents: 199, creator_cents: 129, fee_cents: 36, platform_cents: 70, status: 'completed', completed_at: ago(3) });
  insert('series', show(ID.wShow, { deletion_requested: true, deletion_reason: 'Asked by the check.', deletion_requested_at: ago(2), withdrawn_at: ago(1) }));
  insert('episodes', base(ID.wShowE1, { content_type: 'series', series_id: ID.wShow, season: 1, series_order: 1, deletion_requested: true, deletion_requested_at: ago(2), withdrawn_at: ago(1) }));

  // Two live films nobody asked to remove; one has a buyer and a price.
  insert('episodes', base(ID.notAsked, { src: cf(VID.untaggedFree) }));
  insert('episodes', base(ID.notAskedBought));
  insert('title_prices', { target_type: 'episode', target_id: ID.notAskedBought, creator_id: USERS.dee, price_cents: 299, status: 'on', requested_at: ago(4), reviewed_by: USERS.admin, reviewed_at: ago(4) });
  insert('purchases', { buyer_id: USERS.viewer, target_type: 'episode', target_id: ID.notAskedBought, creator_id: USERS.dee, title: 'Check st', price_cents: 299, paid_cents: 299, creator_cents: 190, fee_cents: 39, platform_cents: 109, status: 'completed', completed_at: ago(2) });

  // Mara's film in review, and a private show of hers with an approved episode.
  insert('episodes', base(ID.pending, { submitted_by: USERS.mara, artist: 'Mara Reyes', src: cf(uidFor(IDS.film)), status: 'pending', reviewed_at: null, released_at: null }));
  insert('series', show(ID.privShow, { creator_id: USERS.mara, submitted_by_user_id: USERS.mara, status: 'pending', public_at: null }));
  insert('episodes', base(ID.privE1, { submitted_by: USERS.mara, artist: 'Mara Reyes', content_type: 'series', series_id: ID.privShow, season: 1, series_order: 1, src: cf(uidFor(IDS.film)) }));

  // Dee's live film and her film in review (the file-swap section).
  insert('episodes', base(ID.live));
  insert('episodes', base(ID.inReview, { src: cf(VID.deeOld), status: 'pending', reviewed_at: null, released_at: null }));

  // A podcast episode of Dee's, and a title of Mara's using a legacy-named audio file.
  insert('episodes', base(ID.pod, { content_type: 'podcast', series_id: IDS.podcast, season: 9, series_order: 1, genre: 'Talk', main_genre: 'Podcast', audio_url: audioAt(AUDIO.deeOwn) }));
  insert('episodes', base(ID.podMara, { submitted_by: USERS.mara, artist: 'Mara Reyes', audio_url: audioAt(AUDIO.legacyMara), status: 'pending', reviewed_at: null, released_at: null }));

  // An ownerless title using an untagged video.
  insert('episodes', base(ID.ownerless, { submitted_by: null, src: cf(VID.untaggedUsed) }));

  // A screener of Dee's on an episode of her show.
  insert('series', show(ID.scrShow));
  insert('episodes', base(ID.scrE1, { content_type: 'series', series_id: ID.scrShow, season: 1, series_order: 1 }));
  insert('productions', { id: PRODUCTION, owner_id: USERS.dee, title: `Check st production ${RUN}`, status: 'post' });
  // A 109 screener: since migration 128 it names its owner and title too.
  insert('screeners', { production_id: PRODUCTION, episode_id: ID.scrE1, token: TOKEN, label: SCREENER_LABEL, expires_at: new Date(Date.now() + 7 * 86400000).toISOString(), max_views: 20, created_by: USERS.dee, ...(hasColumn('screeners', 'target_id') ? { owner_id: USERS.dee, target_id: ID.scrE1 } : {}) });

  // Dee's episode in review filed in Mara's show.
  insert('series', show(ID.maraShow, { creator_id: USERS.mara, submitted_by_user_id: USERS.mara }));
  insert('episodes', base(ID.deeInMara, { content_type: 'series', series_id: ID.maraShow, season: 1, series_order: 1, status: 'pending', reviewed_at: null, released_at: null }));

  // The seed sub-admin's own title in review, a live one with a waiting
  // title, and a channel upload of theirs.
  insert('episodes', base(ID.subOwn, { submitted_by: USERS.sub, artist: 'Sam Subadmin', src: 'https://media.example.com/check-st.mp4', video_provider: 'cloudflare', status: 'pending', reviewed_at: null, released_at: null, poster: 'https://media.example.com/p.jpg', thumbnail: 'https://media.example.com/t.jpg' }));
  insert('episodes', base(ID.subLive, { submitted_by: USERS.sub, artist: 'Sam Subadmin', pending_title: `Check st renamed ${RUN}` }));
  insert('channel_media', { id: CHANNEL_MEDIA, owner_id: USERS.sub, title: `Check st bumper ${RUN}`, kind: 'bumper', src: cf(uidFor(IDS.short)), status: 'pending' });
}

function cleanup() {
  const ids = [...Object.values(ID), ...createdIds].map(q).join(', ');
  const uids = Object.values(VID).map(q).join(', ');
  sql(`delete from public.notifications where episode_id in (${ids}) or message like ${q(`%${RUN}%`)} or message like ${q(`%${SCREENER_LABEL}%`)}`);
  sql(`delete from public.audit_log where target_id in (${ids}) or details like ${q(`%${RUN}%`)}`);
  sql(`delete from public.orphaned_media where reference in (${uids}) or context like ${q(`%${RUN}%`)}`);
  sql(`delete from public.screeners where production_id = ${q(PRODUCTION)}`);
  sql(`delete from public.productions where id = ${q(PRODUCTION)}`);
  sql(`delete from public.channel_media where id = ${q(CHANNEL_MEDIA)}`);
  sql(`delete from public.purchases where target_id in (${ids})`);
  sql(`delete from public.title_prices where target_id in (${ids})`);
  sql(`delete from public.episodes where id in (${ids}) or title like ${q(`Check st %${RUN}`)}`);
  sql(`delete from public.series where id in (${ids})`);
}

const one = (sqlText) => rows(sqlText)[0] || {};
const ep = (id) => one(`select status, src, pending_src, deletion_requested, withdrawn_at, series_id, audio_url, title, pending_title, moderation_hold from public.episodes where id = ${q(id)}`);
const errOf = (r) => (r.json && r.json.error) || '';

async function withdrawn() {
  section('A withdrawn title or show stays withdrawn');
  let r = await call(`/api/episode-page?id=${ID.wFilm}`, { who: MARA });
  ok('a stranger: the withdrawn film’s page → 404', r.status === 404, r.status);
  r = await call('/api/stream-token', { who: VIEWER, method: 'POST', body: { episodeId: ID.wFilm } });
  ok('its buyer still gets a playable link', r.status === 200 && r.json && r.json.src, `${r.status} ${r.text.slice(0, 160)}`);
  r = await call('/api/creator/request-episode-deletion', { who: DEE, method: 'POST', body: { episodeId: ID.wFilm, action: 'cancel' } });
  ok('the uploader’s "cancel" (Your work’s route) → 409 with the withdrawn line', r.status === 409 && errOf(r) === WITHDRAWN_LINE, `${r.status} ${r.text.slice(0, 200)}`);
  r = await call(`/api/show/episode/${ID.wFilm}/removal`, { who: DEE, method: 'POST', body: { action: 'cancel' } });
  ok('…and on the episode editor’s route → 409', r.status === 409 && r.json && r.json.code === 'withdrawn', `${r.status} ${r.text.slice(0, 200)}`);
  r = await call('/api/creator/request-episode-deletion', { who: DEE, method: 'POST', body: { episodeId: ID.wFilm, action: 'request', reason: 'Again.' } });
  ok('…asking for it again is refused too', r.status === 409, r.status);
  ok('the row still asks for its removal and is still withdrawn', ep(ID.wFilm).deletion_requested === true && Boolean(ep(ID.wFilm).withdrawn_at), ep(ID.wFilm));
  r = await call('/api/admin/resolve-deletion', { who: ADMIN, method: 'POST', body: { type: 'episode', id: ID.wFilm, decision: 'deny' } });
  ok('an admin’s deny of a withdrawn title → 409', r.status === 409 && r.json && r.json.code === 'withdrawn', `${r.status} ${r.text.slice(0, 200)}`);
  r = await call('/api/admin/resolve-deletion', { who: ADMIN, method: 'POST', body: { type: 'episode', id: ID.wFilm, decision: 'confirm' } });
  ok('…and confirming it again → 409', r.status === 409, r.status);
  ok('…still withdrawn', ep(ID.wFilm).deletion_requested === true && Boolean(ep(ID.wFilm).withdrawn_at));

  // Even with its request cleared some other way, nobody but its buyer sees it.
  sql(`update public.episodes set deletion_requested = false where id = ${q(ID.wFilm)}`);
  try {
    r = await call(`/api/episode-page?id=${ID.wFilm}`, { who: MARA });
    ok('request cleared in the database: the page is still 404 for a stranger', r.status === 404, r.status);
    r = await call('/api/stream-token', { who: MARA, method: 'POST', body: { episodeId: ID.wFilm } });
    ok('…no playable link for a stranger', r.status === 404 && !(r.json && r.json.src), `${r.status} ${r.text.slice(0, 160)}`);
    r = await page(`/episode/${ID.wFilm}`, SIGNED_OUT);
    ok('…the website’s page is 404 signed out', r.status === 404, r.status);
    r = await call('/api/stream-token', { who: VIEWER, method: 'POST', body: { episodeId: ID.wFilm } });
    ok('…its buyer still plays it', r.status === 200 && r.json && r.json.src, r.status);
  } finally {
    sql(`update public.episodes set deletion_requested = true where id = ${q(ID.wFilm)}`);
  }

  r = await call(`/api/show/${ID.wShow}/removal`, { who: DEE, method: 'POST', body: { action: 'cancel' } });
  ok('the withdrawn show: its owner’s cancel → 409', r.status === 409 && r.json && r.json.code === 'withdrawn' && errOf(r) === WITHDRAWN_LINE, `${r.status} ${r.text.slice(0, 200)}`);
  ok('…the show still asks for its removal', one(`select deletion_requested from public.series where id = ${q(ID.wShow)}`).deletion_requested === true);
  r = await call('/api/admin/resolve-deletion', { who: ADMIN, method: 'POST', body: { type: 'series', id: ID.wShow, decision: 'confirm', confirmName: 'x' } });
  ok('…confirming it again → 409 withdrawn', r.status === 409 && r.json && r.json.code === 'withdrawn', `${r.status} ${r.text.slice(0, 200)}`);
  sql(`update public.series set deletion_requested = false where id = ${q(ID.wShow)}`);
  sql(`update public.episodes set deletion_requested = false where id = ${q(ID.wShowE1)}`);
  try {
    r = await call(`/api/series-hub?id=${ID.wShow}`, { who: VIEWER });
    ok('show’s request cleared in the database: /api/series-hub → 404', r.status === 404, r.status);
    r = await page(`/series/${ID.wShow}`, SIGNED_OUT);
    ok('…the series page → 404', r.status === 404, r.status);
    r = await call(`/api/episode-page?id=${ID.wShowE1}`, { who: VIEWER });
    ok('…its kept episode → 404', r.status === 404, r.status);
  } finally {
    sql(`update public.series set deletion_requested = true where id = ${q(ID.wShow)}`);
    sql(`update public.episodes set deletion_requested = true where id = ${q(ID.wShowE1)}`);
  }
}

async function confirmUnasked() {
  section('Confirming a removal nobody asked for does nothing');
  let r = await call('/api/admin/resolve-deletion', { who: ADMIN, method: 'POST', body: { type: 'episode', id: ID.notAskedBought, decision: 'confirm' } });
  ok('a title with buyers, no request → 409 with the line', r.status === 409 && errOf(r) === NO_REMOVAL_LINE, `${r.status} ${r.text.slice(0, 200)}`);
  ok('…its price is still on', one(`select status from public.title_prices where target_id = ${q(ID.notAskedBought)}`).status === 'on');
  ok('…not withdrawn', !ep(ID.notAskedBought).withdrawn_at);
  r = await call('/api/admin/resolve-deletion', { who: ADMIN, method: 'POST', body: { type: 'episode', id: ID.notAsked, decision: 'confirm' } });
  ok('a title without buyers, no request → 409', r.status === 409, r.status);
  ok('…the row is there, nothing recorded as orphaned', Boolean(ep(ID.notAsked).status) && rows(`select id from public.orphaned_media where reference = ${q(VID.untaggedFree)}`).length === 0);
  ok('…its uploader wasn’t told it was deleted', rows(`select id from public.notifications where user_id = ${q(USERS.dee)} and type = 'deletion_confirmed' and created_at > now() - interval '5 minutes' and message like ${q(`%${RUN}%`)}`).length === 0);
  r = await call('/api/admin/resolve-deletion', { who: ADMIN, method: 'POST', body: { type: 'episode', id: `ck-st-nothing-${RUN}`, decision: 'confirm' } });
  ok('an id that isn’t there → 404', r.status === 404, r.status);
  r = await call('/api/admin/resolve-deletion', { who: ADMIN, method: 'POST', body: { type: 'series', id: ID.scrShow, decision: 'confirm', confirmName: `Check st show ${ID.scrShow.slice(6, 20)} ${RUN}` } });
  ok('a show nobody asked to remove → 409 (Admin → Shows removes those)', r.status === 409 && errOf(r) === NO_REMOVAL_LINE, `${r.status} ${r.text.slice(0, 200)}`);
  ok('…the show is still there', Boolean(one(`select id from public.series where id = ${q(ID.scrShow)}`).id));
}

async function previewTeam() {
  section('The title team: review_submissions or manage_episodes, not any team account');
  let r = await call('/api/stream-token', { who: NOPERM, method: 'POST', body: { episodeId: ID.pending, preview: true } });
  ok('a sub-admin with no permission: no preview link for a title in review', r.status === 404 && !(r.json && r.json.src), `${r.status} ${r.text.slice(0, 160)}`);
  r = await call('/api/stream-token', { who: ART, method: 'POST', body: { episodeId: ID.pending, preview: true } });
  ok('…nor one with only manage_artwork', r.status === 404, r.status);
  r = await call('/api/stream-token', { who: SUB, method: 'POST', body: { episodeId: ID.pending, preview: true } });
  ok('a sub-admin with review_submissions + manage_episodes plays it', r.status === 200 && r.json && r.json.src, `${r.status} ${r.text.slice(0, 160)}`);
  r = await call(`/api/episode-page?id=${ID.pending}&preview=1`, { who: NOPERM });
  ok('no permission: the episode preview → 404', r.status === 404, r.status);
  r = await call(`/api/episode-page?id=${ID.pending}&preview=1`, { who: SUB });
  ok('the title team: the episode preview → 200', r.status === 200, r.status);
  r = await call(`/api/series-hub?id=${ID.privShow}&preview=1`, { who: NOPERM });
  ok('no permission: a private show’s preview → 404', r.status === 404, r.status);
  r = await call(`/api/series-hub?id=${ID.privShow}&preview=1`, { who: SUB });
  ok('the title team: the private show’s preview → 200', r.status === 200, r.status);

  r = await call(`/api/show/${ID.privShow}`, { who: NOPERM });
  ok('no permission: the show page’s payload → 403', r.status === 403, r.status);
  r = await call(`/api/show/${ID.privShow}`, { who: ART });
  ok('manage_artwork (Admin → Shows opens for it): reads the show’s page', r.status === 200 && r.json && r.json.show && r.json.show.id === ID.privShow, `${r.status} ${r.text.slice(0, 160)}`);
  r = await call(`/api/show/${ID.privShow}`, { who: ART, method: 'PATCH', body: { description: 'Changed by a sub-admin.' } });
  ok('…but can’t write it (403)', r.status === 403, r.status);
  r = await call(`/api/show/episode/${ID.privE1}`, { who: ART });
  ok('…nor open an episode’s editor', r.status === 404 || r.status === 403, r.status);
  r = await call('/api/show?all=1', { who: NOPERM });
  ok('no permission: every show (?all=1) → 403', r.status === 403, r.status);
  r = await call('/api/show?all=1', { who: ART });
  ok('manage_artwork: ?all=1 lists no one else’s show', r.status === 200 && r.json && Array.isArray(r.json.shows) && !r.json.shows.some((s) => s.id === ID.privShow), r.status);
  r = await call('/api/show?all=1', { who: SUB });
  ok('the title team: ?all=1 lists the private show', r.status === 200 && r.json && r.json.shows.some((s) => s.id === ID.privShow), r.status);
  r = await call('/api/creator/list-series', { who: NOPERM });
  ok('no permission: the Library’s series picker → 403', r.status === 403, r.status);
  r = await call('/api/creator/list-series', { who: SUB });
  ok('the title team: every show in the picker', r.status === 200 && r.json && r.json.series.some((s) => s.id === ID.privShow), r.status);
}

async function fileSwap() {
  section('A new file on a live title is a reviewer’s call');
  let r = await call('/api/admin/edit-episode', { who: EPS, method: 'POST', body: { episodeId: ID.live, cloudflareVideoUid: VID.eps } });
  ok('manage_episodes alone, a live title → 403 with the line', r.status === 403 && errOf(r) === FILE_REVIEW_LINE, `${r.status} ${r.text.slice(0, 200)}`);
  ok('…its file is unchanged', ep(ID.live).src === cf(uidFor(IDS.short)), ep(ID.live).src);
  r = await call(`/api/show/episode/${ID.live}/video`, { who: EPS, method: 'POST', body: { videoUid: VID.eps } });
  ok('…the show routes refuse it too', r.status === 403 && errOf(r) === FILE_REVIEW_LINE, `${r.status} ${r.text.slice(0, 200)}`);
  r = await call(`/api/show/episode/${ID.live}`, { who: EPS });
  ok('…and its editor says why', r.status === 200 && r.json && r.json.policy && r.json.policy.video && r.json.policy.video.mode === 'locked' && r.json.policy.video.line === FILE_REVIEW_LINE, r.json && r.json.policy && r.json.policy.video);
  r = await call('/api/admin/edit-episode', { who: EPS, method: 'POST', body: { episodeId: ID.inReview, cloudflareVideoUid: VID.mara } });
  ok('in review, someone else’s video → 403', r.status === 403 && /someone else/.test(errOf(r)), `${r.status} ${r.text.slice(0, 200)}`);
  ok('…unchanged', ep(ID.inReview).src === cf(VID.deeOld), ep(ID.inReview).src);
  r = await call('/api/admin/edit-episode', { who: EPS, method: 'POST', body: { episodeId: ID.inReview, cloudflareVideoUid: VID.eps } });
  ok('in review, their own upload → 200', r.status === 200, `${r.status} ${r.text.slice(0, 200)}`);
  ok('…the file is theirs now, still in review', (ep(ID.inReview).src || '').includes(VID.eps) && ep(ID.inReview).status === 'pending', ep(ID.inReview));
  r = await call('/api/admin/manual-episode', { who: EPS, method: 'POST', body: { title: `Check st manual ${RUN}`, description: 'By the check.', contentType: 'movie', genre: 'Drama', mainGenre: 'Drama', runtime: '10:00', artist: 'Check', tier: 'free', cloudflareVideoUid: VID.mara } });
  ok('manual add with someone else’s video → 403', r.status === 403 && /someone else/.test(errOf(r)), `${r.status} ${r.text.slice(0, 200)}`);
  ok('…no title made', rows(`select id from public.episodes where title = ${q(`Check st manual ${RUN}`)}`).length === 0);
}

async function audio() {
  section('A podcast’s audio is one of our own files, the uploader’s');
  const body = (audioUrl, n) => ({ contentType: 'podcast', seriesId: IDS.podcast, season: 9, title: `Check st pod ${n} ${RUN}`, description: 'Sent by the check.', genre: 'Talk', mainGenre: 'Podcast', runtime: '20:00', artist: 'Dee Park', tier: 'free', rating: 'TV-PG', audioUrl });
  let r = await call('/api/creator/submit-episode', { who: DEE, method: 'POST', body: body('https://audio.example.com/listen.mp3', 'a') });
  ok('an outside address → 400 with the line', r.status === 400 && errOf(r) === AUDIO_NOT_OURS, `${r.status} ${r.text.slice(0, 200)}`);
  r = await call('/api/creator/submit-episode', { who: DEE, method: 'POST', body: body(audioAt(AUDIO.maraNamed), 'b') });
  ok('a file named for another account → 403', r.status === 403 && errOf(r) === AUDIO_OTHERS, `${r.status} ${r.text.slice(0, 200)}`);
  r = await call('/api/creator/submit-episode', { who: DEE, method: 'POST', body: body(audioAt(AUDIO.legacyMara), 'c') });
  ok('an older file another uploader’s title uses → 409', r.status === 409 && errOf(r) === AUDIO_TAKEN, `${r.status} ${r.text.slice(0, 200)}`);
  r = await call('/api/creator/submit-episode', { who: DEE, method: 'POST', body: body(audioAt(`podcast-${USERS.dee}-${RUN}-fresh.mp3`), 'd') });
  const made = r.json && (r.json.id || (r.json.episode && r.json.episode.id));
  if (made) createdIds.push(made);
  ok('their own file → 200, in review', r.status === 200 && made && ep(made).status === 'pending', `${r.status} ${r.text.slice(0, 200)}`);
  ok('nothing was made for the refused ones', rows(`select id from public.episodes where title in (${['a', 'b', 'c'].map((n) => q(`Check st pod ${n} ${RUN}`)).join(', ')})`).length === 0);
  r = await call('/api/admin/edit-episode', { who: EPS, method: 'POST', body: { episodeId: ID.pod, audioUrl: audioAt(AUDIO.maraNamed) } });
  ok('a sub-admin pointing Dee’s episode at Mara’s file → 403', r.status === 403 && errOf(r) === AUDIO_OTHERS, `${r.status} ${r.text.slice(0, 200)}`);
  r = await call('/api/admin/edit-episode', { who: EPS, method: 'POST', body: { episodeId: ID.pod, audioUrl: 'https://evil.example/x.mp3' } });
  ok('…or at an outside address → 400', r.status === 400 && errOf(r) === AUDIO_NOT_OURS, `${r.status} ${r.text.slice(0, 200)}`);
  ok('…its audio is unchanged', ep(ID.pod).audio_url === audioAt(AUDIO.deeOwn), ep(ID.pod).audio_url);
}

async function ownership() {
  section('An untagged video used only by an ownerless title is someone else’s');
  let r = await call(`/api/creator/video-status?uid=${VID.untaggedUsed}`, { who: MARA });
  ok('a creator asking about it → 404 (not hers)', r.status === 404, `${r.status} ${r.text.slice(0, 160)}`);
  r = await call(`/api/creator/video-status?uid=${VID.untaggedFree}`, { who: MARA });
  ok('an untagged video used by Dee’s title → 404 too', r.status === 404, r.status);
  sql(`update public.episodes set src = ${q(cf(uidFor(IDS.short)))} where id = ${q(ID.notAsked)}`);
  r = await call(`/api/creator/video-status?uid=${VID.untaggedFree}`, { who: MARA });
  ok('an untagged video nobody uses → 200', r.status === 200, `${r.status} ${r.text.slice(0, 160)}`);
}

// Since migration 128 (private screening links, lib/screenings.js) a
// screener is made on the title's page (POST /api/screenings) and the
// Distribution page's old POST answers 410; the rule is the same.
async function screeners() {
  section('A screener plays only a title that could be shown');
  // Before 128 a 109 screener waits for the migration (its page says it
  // isn't available; private-screenings.mjs checks that half).
  if (!hasColumn('screeners', 'target_id')) {
    const before = await page(`/screener/${TOKEN}`, SIGNED_OUT);
    ok('before 128: the screener’s page says it isn’t available, no 500', before.status === 200 && before.text.includes('available any more'), before.status);
    return;
  }
  const gone = (text) => text.includes('available any more');
  const making = (episodeId, label) => call('/api/screenings', { who: DEE, method: 'POST', body: { target: { type: 'episode', id: episodeId }, label, endsAt: new Date(Date.now() + 7 * 86400000).toISOString(), password: 'tide-lantern-42', maxViews: 5 } });
  let r = await page(`/screener/${TOKEN}`, SIGNED_OUT);
  ok('the screener opens while its show is fine', r.status === 200 && !gone(r.text), r.status);
  sql(`update public.series set moderation_hold = true where id = ${q(ID.scrShow)}`);
  try {
    r = await page(`/screener/${TOKEN}`, SIGNED_OUT);
    ok('its show pulled: the screener says the video isn’t available', r.status === 200 && gone(r.text), r.status);
    r = await making(ID.scrE1, 'Another festival');
    ok('…and no new screener can be made for it (409)', r.status === 409, `${r.status} ${r.text.slice(0, 200)}`);
  } finally {
    sql(`update public.series set moderation_hold = false where id = ${q(ID.scrShow)}`);
  }
  r = await making(ID.wFilm, 'For the withdrawn one');
  ok('a withdrawn title can’t be screened', r.status === 400 || r.status === 409 || r.status === 404, `${r.status} ${r.text.slice(0, 200)}`);
  r = await call(`/api/productions/${PRODUCTION}/screeners`, { who: DEE, method: 'POST', body: { episodeId: ID.scrE1, label: 'Old way', days: 7, maxViews: 5 } });
  ok('the Distribution page’s old POST: 410, links are made on the title’s page', r.status === 410, `${r.status} ${r.text.slice(0, 200)}`);
}

async function moveOut() {
  section('An uploader can’t take a pending episode out of someone else’s show');
  const r = await call('/api/creator/edit-submission', { who: DEE, method: 'POST', body: { episodeId: ID.deeInMara, seriesId: '' } });
  ok('Dee moving her episode out of Mara’s show → 403', r.status === 403 && r.json && r.json.code === 'owners', `${r.status} ${r.text.slice(0, 200)}`);
  ok('…it’s still in Mara’s show', ep(ID.deeInMara).series_id === ID.maraShow, ep(ID.deeInMara).series_id);
}

async function ownWork() {
  section('Nobody but a full admin approves their own work');
  let r = await call('/api/admin/review-queue', { who: SUB, method: 'POST', body: { kind: 'submission', id: ID.subOwn, decision: 'approve' } });
  ok('the review queue: a sub-admin approving their own title → 403', r.status === 403 && errOf(r) === OWN_WORK_LINE, `${r.status} ${r.text.slice(0, 200)}`);
  ok('…still in review', ep(ID.subOwn).status === 'pending');
  r = await call('/api/admin/edit-episode', { who: SUB, method: 'POST', body: { episodeId: ID.subOwn, status: 'approved' } });
  ok('the Library’s status select → 403', r.status === 403 && errOf(r) === OWN_WORK_LINE, `${r.status} ${r.text.slice(0, 200)}`);
  ok('…still in review', ep(ID.subOwn).status === 'pending');
  r = await call('/api/admin/resolve-edit', { who: SUB, method: 'POST', body: { type: 'episode', id: ID.subLive, decision: 'approve' } });
  ok('their own waiting title change → 403', r.status === 403 && errOf(r) === OWN_WORK_LINE, `${r.status} ${r.text.slice(0, 200)}`);
  ok('…still waiting', ep(ID.subLive).pending_title === `Check st renamed ${RUN}`, ep(ID.subLive));
  r = await call('/api/admin/channel-media', { who: SUB, method: 'POST', body: { id: CHANNEL_MEDIA, action: 'approve' } });
  ok('their own channel upload → 403', r.status === 403 && errOf(r) === OWN_WORK_LINE, `${r.status} ${r.text.slice(0, 200)}`);
  ok('…still pending', one(`select status from public.channel_media where id = ${q(CHANNEL_MEDIA)}`).status === 'pending');
  r = await call('/api/admin/resolve-edit', { who: ADMIN, method: 'POST', body: { type: 'episode', id: ID.subLive, decision: 'approve' } });
  ok('a full admin approves it → 200', r.status === 200 && ep(ID.subLive).title === `Check st renamed ${RUN}`, `${r.status} ${r.text.slice(0, 200)}`);
}

await runCheck('sec-titles', async () => {
  cleanup();
  try {
    await seed();
    await withdrawn();
    await confirmUnasked();
    await previewTeam();
    await fileSwap();
    await audio();
    await ownership();
    await screeners();
    await moveOut();
    await ownWork();
  } finally {
    cleanup();
    for (const u of [NOPERM, ART, EPS]) if (u) await removeUser(u.id);
  }
});
