#!/usr/bin/env node
// The app's captions and the app's podcast preview, called the way the app
// calls them: Authorization: Bearer, no Origin, no cookie.
//   /api/captions/<id>                 an entitled viewer gets the track, a
//                                      refused one the gate's answer
//   /api/podcast-show?id=&preview=1    a private podcast show for its owner,
//                                      an uploader, the team; locked rows
//                                      carry no audio or video; strangers 404
//   node dev/test-rig/checks/captions-podcast-preview.mjs
import fs from 'node:fs';
import path from 'node:path';
import { IDS, USERS, RUN, ok, section, runCheck, call, page, sql, rows, q, insert, session, SIGNED_OUT, SIGNED_OUT_NO_TERMS, ago, uidFor } from './lib.mjs';
import { PATHS } from '../lib/config.mjs';
import { ensureBucket, putObject } from '../lib/storage.mjs';

const MARA = session(USERS.mara);
const DEE = session(USERS.dee);
const ADMIN = session(USERS.admin);
const VIEWER = session(USERS.viewer);
const SUB = session(USERS.sub);
const app = (who) => ({ who, bearer: true });

const ID = {
  premium: `ck-cap-prem-${RUN}`,
  free: `ck-cap-free-${RUN}`,
  none: `ck-cap-none-${RUN}`,
  show: `ck-pod-priv-${RUN}`,
  podA: `ck-pod-a-${RUN}`,
  podB: `ck-pod-b-${RUN}`
};
const VTT = 'WEBVTT\n\n00:00:01.000 --> 00:00:04.000\nThe check’s first line.\n\n00:00:05.000 --> 00:00:08.000\nAnd its second.\n';
const keyOf = (id) => `captions/${id}-check.vtt`;
const src = (key) => `https://customer-test.cloudflarestream.com/${uidFor(key)}/manifest/video.m3u8`;
const title = (id, extra) => ({
  id, title: `Check captions ${id.slice(7, 12)}`, description: 'Captions check.', tier: 'free', genre: 'Drama', main_genre: 'Drama', content_type: 'short', artist: 'Dee Park',
  runtime: '12:00', rating: 'TV-PG', release_year: 2026, src: src(IDS.short), video_type: 'html5', video_provider: 'cloudflare', ads_enabled: true,
  deletion_requested: false, moderation_hold: false, submitted_by: USERS.dee, status: 'approved', reviewed_at: ago(4), released_at: ago(4), created_at: ago(5), ...extra
});

function seed() {
  ensureBucket('private-uploads', { public: false });
  for (const id of [ID.premium, ID.free, ID.podB]) putObject('private-uploads', keyOf(id), Buffer.from(VTT), { contentType: 'text/vtt' });
  insert('episodes', title(ID.premium, { tier: 'premium', captions_url: `private:${keyOf(ID.premium)}`, captions_label: 'English' }));
  insert('episodes', title(ID.free, { rating: 'PG-13', captions_url: `private:${keyOf(ID.free)}`, captions_label: 'English' }));
  insert('episodes', title(ID.none, {}));
  // A private podcast show of Dee's: her episode approved, Mara's in review.
  insert('series', { id: ID.show, name: `Check Private Pod ${RUN}`, description: 'A podcast that isn’t public yet.', creator_id: USERS.dee, status: 'pending', kind: 'podcast', submitted_by_user_id: USERS.dee, created_at: ago(6), deletion_requested: false, moderation_hold: false });
  const pod = (id, who, status, order, extra = {}) => ({
    id, title: `Check pod ${order}`, description: 'A preview episode.', tier: 'free', genre: 'Talk', main_genre: 'Podcast', content_type: 'podcast', series_id: ID.show, season: 1, series_order: order,
    artist: who === USERS.dee ? 'Dee Park' : 'Mara Reyes', runtime: '20:00', release_year: 2026, audio_url: `https://audio.rig.example.com/${id}.mp3`, src: src(IDS.podE1),
    video_type: 'html5', video_provider: 'cloudflare', ads_enabled: true, deletion_requested: false, moderation_hold: false, submitted_by: who, status,
    ...(status === 'approved' ? { reviewed_at: ago(2), released_at: ago(2) } : {}), created_at: ago(3), ...extra
  });
  insert('episodes', pod(ID.podA, USERS.dee, 'approved', 1));
  insert('episodes', pod(ID.podB, USERS.mara, 'pending', 2, { captions_url: `private:${keyOf(ID.podB)}`, captions_label: 'English' }));
}
function cleanup() {
  const ids = Object.values(ID).map(q).join(', ');
  sql(`delete from public.notifications where episode_id in (${ids})`);
  sql(`delete from public.episodes where id in (${ids})`);
  sql(`delete from public.series where id = ${q(ID.show)}`);
  for (const id of [ID.premium, ID.free, ID.podB]) {
    fs.rmSync(path.join(PATHS.storage, 'objects', 'private-uploads', keyOf(id)), { force: true });
    fs.rmSync(path.join(PATHS.storage, 'meta', 'private-uploads', `${keyOf(id)}.json`), { force: true });
  }
}

async function captions() {
  section('Captions (/api/captions/<id>, as the app asks)');
  let r = await call(`/api/captions/${ID.premium}`, app(ADMIN));
  ok('premium title, the team → 200 with the track', r.status === 200 && r.text.startsWith('WEBVTT') && r.text.includes('first line'), `${r.status} ${r.text.slice(0, 120)}`);
  ok('…served as text/vtt, private and not stored', /text\/vtt/.test(r.headers.get('content-type') || '') && /no-store/.test(r.headers.get('cache-control') || ''), `${r.headers.get('content-type')} / ${r.headers.get('cache-control')}`);
  r = await call(`/api/captions/${ID.premium}`, app(VIEWER));
  ok('premium title, a viewer without a plan → refused (403), no track', r.status === 403 && !r.text.includes('WEBVTT'), `${r.status} ${r.text.slice(0, 160)}`);
  r = await call(`/api/captions/${ID.premium}`, { who: SIGNED_OUT_NO_TERMS });
  ok('premium title, signed out → refused, no track', r.status >= 400 && r.status < 500 && !r.text.includes('WEBVTT'), r.status);
  r = await call(`/api/captions/${ID.free}`, { who: SIGNED_OUT_NO_TERMS });
  ok('free PG-13 title, signed out without the viewing terms → refused', r.status >= 400 && r.status < 500 && !r.text.includes('WEBVTT'), `${r.status} ${r.text.slice(0, 160)}`);
  r = await call(`/api/captions/${ID.free}?terms=1`, { who: SIGNED_OUT_NO_TERMS });
  ok('free PG-13 title, signed out with terms=1 → 200', r.status === 200 && r.text.startsWith('WEBVTT'), r.status);
  r = await call(`/api/captions/${ID.free}?terms=1`, app(VIEWER));
  ok('free PG-13 title, the app’s viewer with terms=1 → 200', r.status === 200 && r.text.startsWith('WEBVTT'), r.status);
  r = await call(`/api/captions/${ID.none}?terms=1`, app(VIEWER));
  ok('a title without captions → 404', r.status === 404, r.status);
  r = await call(`/api/captions/ck-no-such-title-${RUN}`, app(VIEWER));
  ok('a title that doesn’t exist → 404', r.status === 404, r.status);
  r = await call(`/api/captions/${ID.premium}`, { method: 'POST', ...app(ADMIN) });
  ok('POST → 405', r.status === 405, r.status);
  // The episode payload names the track only for a viewer who may watch.
  r = await call(`/api/episode-page?id=${ID.premium}`, app(VIEWER));
  ok('/api/episode-page premium, no plan → no captionsUrl', r.status === 200 && r.json && r.json.episode && !r.json.episode.captionsUrl, r.json && r.json.episode && r.json.episode.captionsUrl);
  r = await call(`/api/episode-page?id=${ID.premium}`, app(ADMIN));
  ok('/api/episode-page premium, the team → captionsUrl is the gated route', r.status === 200 && r.json && r.json.episode && r.json.episode.captionsUrl === `/api/captions/${ID.premium}`, r.json && r.json.episode && r.json.episode.captionsUrl);
  ok('…and never the stored address', r.json && !JSON.stringify(r.json).includes(`private:${keyOf(ID.premium)}`));
  // In a preview the track is asked for with ?preview=1.
  r = await call(`/api/captions/${ID.podB}?preview=1`, app(MARA));
  ok('preview: the uploader gets the track of her episode in review', r.status === 200 && r.text.startsWith('WEBVTT'), r.status);
  r = await call(`/api/captions/${ID.podB}?preview=1`, app(DEE));
  ok('preview: the show’s owner gets it too', r.status === 200 && r.text.startsWith('WEBVTT'), r.status);
  r = await call(`/api/captions/${ID.podB}?preview=1`, app(VIEWER));
  ok('preview: a stranger gets nothing', r.status >= 400 && !r.text.includes('WEBVTT'), r.status);
  r = await call(`/api/captions/${ID.premium}?preview=1`, app(VIEWER));
  ok('?preview=1 on a live premium title is no way round the plan: a viewer gets nothing', r.status >= 400 && !r.text.includes('WEBVTT'), r.status);
  r = await call(`/api/captions/${ID.premium}?preview=1`, app(MARA));
  ok('…nor another creator', r.status >= 400 && !r.text.includes('WEBVTT'), r.status);
  r = await call(`/api/captions/${ID.premium}?preview=1`, app(DEE));
  // A live title has no preview: ?preview=1 is the ordinary gate (lib/playbackGate.js
  // only previews a title that isn't live), so its uploader without a plan is refused too.
  ok('…a live title’s ?preview=1 is the ordinary gate, for its uploader too', r.status === 403 && !r.text.includes('WEBVTT'), r.status);
  r = await call('/api/stream-token', { method: 'POST', body: { episodeId: ID.premium, preview: true }, ...app(VIEWER) });
  ok('the video’s preview token isn’t minted for a viewer without the plan either', r.status >= 400 && !(r.json && r.json.src), `${r.status} ${r.text.slice(0, 120)}`);
  r = await call(`/api/captions/${ID.podB}`, app(MARA));
  ok('without ?preview=1 an episode in review has no track', r.status >= 400 && !r.text.includes('WEBVTT'), r.status);
}

const rowOf = (j, id) => (j && Array.isArray(j.episodes) ? j.episodes.find((e) => e.id === id) : null);
const playable = (e) => Boolean(e && !e.locked && e.audioUrl && e.src);
const bare = (e) => Boolean(e && e.locked && !e.audioUrl && !e.src);

async function podcastPreview() {
  section('The app’s podcast preview (/api/podcast-show?preview=1)');
  const url = `/api/podcast-show?id=${encodeURIComponent(ID.show)}&preview=1`;
  let r = await call(url, app(DEE));
  ok('owner → 200', r.status === 200, `${r.status} ${r.text.slice(0, 200)}`);
  ok('owner → private, not stored', /no-store/.test(r.headers.get('cache-control') || ''), r.headers.get('cache-control'));
  ok('owner → the bar’s words (role owner)', r.json && r.json.preview && r.json.preview.role === 'owner' && r.json.preview.strong, r.json && r.json.preview);
  ok('owner → both episodes, the one in review included', r.json && r.json.episodes && r.json.episodes.length === 2 && rowOf(r.json, ID.podB) && rowOf(r.json, ID.podB).status === 'pending', r.json && r.json.episodes && r.json.episodes.map((e) => e.status));
  ok('owner → every row playable (audio + a signed video)', playable(rowOf(r.json, ID.podA)) && playable(rowOf(r.json, ID.podB)), r.json && r.json.episodes);
  ok('owner → the video is a signed link, not the stored manifest', r.json && rowOf(r.json, ID.podA) && !String(rowOf(r.json, ID.podA).src || '').includes(uidFor(IDS.podE1) + '/manifest'), rowOf(r.json, ID.podA) && rowOf(r.json, ID.podA).src);
  ok('owner → no resume, no ads', r.json && Object.keys(r.json.resume || {}).length === 0 && r.json.episodes.every((e) => e.adsEnabled === false));
  r = await call(url, app(MARA));
  ok('uploader → 200 as a contributor', r.status === 200 && r.json.preview && r.json.preview.role === 'contributor', r.json && r.json.preview);
  ok('uploader → her own row plays', playable(rowOf(r.json, ID.podB)), rowOf(r.json, ID.podB));
  ok('uploader → someone else’s row is locked with no audio or video', bare(rowOf(r.json, ID.podA)) && rowOf(r.json, ID.podA).previewLock === 'others', rowOf(r.json, ID.podA));
  ok('uploader → the link goes to the creator’s show page', r.json.preview.linkHref === `/creator/show/${encodeURIComponent(ID.show)}`, r.json.preview.linkHref);
  r = await call(url, app(ADMIN));
  ok('the team → 200, every row playable', r.status === 200 && r.json.preview && r.json.preview.role === 'team' && playable(rowOf(r.json, ID.podA)) && playable(rowOf(r.json, ID.podB)), r.json && r.json.preview);
  ok('the team → the admin show page', r.json && r.json.preview && r.json.preview.linkHref === `/admin/shows/${encodeURIComponent(ID.show)}`, r.json && r.json.preview && r.json.preview.linkHref);
  r = await call(url, app(SUB));
  ok('a sub-admin → 200 as the team', r.status === 200 && r.json.preview && r.json.preview.role === 'team', r.status);
  r = await call(url, app(VIEWER));
  ok('a stranger → 404, nothing of the show', r.status === 404 && !r.text.includes('Check pod'), r.status);
  r = await call(url, { who: SIGNED_OUT_NO_TERMS });
  ok('signed out → 404', r.status === 404, r.status);
  r = await call(`/api/podcast-show?id=${encodeURIComponent(ID.show)}`, app(DEE));
  ok('without ?preview=1 the private show → 404, even for its owner', r.status === 404, r.status);
  r = await call(`/api/podcast-show?id=${encodeURIComponent(IDS.podcast)}&preview=1`, app(VIEWER));
  ok('a public show with ?preview=1 → the ordinary answer (preview null)', r.status === 200 && r.json && r.json.preview === null && r.json.episodes.length >= 2 && r.json.episodes.every((e) => e.status === undefined), r.status);
  r = await call(`/api/podcast-show?id=${encodeURIComponent(IDS.podcast)}`, app(VIEWER));
  ok('a public show without it → the same', r.status === 200 && r.json.preview === null, r.status);
  // A private series isn't a podcast: its preview is the series page.
  r = await call(`/api/podcast-show?id=${encodeURIComponent(IDS.harbor)}&preview=1`, app(MARA));
  ok('a private series (not a podcast) with ?preview=1 → 404', r.status === 404, r.status);

  section('The podcast preview while the show is pulled');
  sql(`update public.series set moderation_hold = true where id = ${q(ID.show)}`);
  r = await call(url, app(DEE));
  ok('held: the owner → 200 but every row locked as held, no audio', r.status === 200 && r.json.episodes.length === 2 && r.json.episodes.every((e) => bare(e) && e.previewLock === 'held'), r.status === 200 ? r.json.episodes : r.status);
  r = await call(url, app(ADMIN));
  ok('held: the team still plays', r.status === 200 && r.json.episodes.every(playable), r.status);
  r = await call(url, app(VIEWER));
  ok('held: a stranger → 404', r.status === 404, r.status);
  sql(`update public.series set moderation_hold = false where id = ${q(ID.show)}`);

  section('The website’s podcast preview (the same hub)');
  const w = await page(`/podcasts/${encodeURIComponent(ID.show)}?preview=1`, DEE);
  ok('/podcasts/<id>?preview=1 as the owner → 200', w.status === 200, w.status);
  const s = await page(`/podcasts/${encodeURIComponent(ID.show)}?preview=1`, VIEWER);
  ok('…as a stranger → 404', s.status === 404, s.status);
}

await runCheck('captions-podcast-preview', async () => {
  cleanup();
  seed();
  try {
    await captions();
    await podcastPreview();
  } finally {
    cleanup();
  }
});
