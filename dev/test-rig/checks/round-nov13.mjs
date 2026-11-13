#!/usr/bin/env node
// The round of 2026-11-13 (Jose: "Allow tv ads to be muted, add the
// flashing lights mark. Podcasts should be ad free. Premium members should
// not have the Google banner.").
//
//   1. Flashing lights, through the API the way the website (a cookie) and
//      the app (a Bearer token) send it: a creator turns it on for a live
//      title (applies at once), can't turn it off on a live title (403 with
//      the line, on the show editor's save and the older routes), turns it
//      off on a title in review and one that came back "Not this time"; the
//      admin turns it off on a live title; the editor's policy; the submit
//      stores it; the warning shows on the title's page once it is on.
//   2. Podcasts are ad-free: /api/episode-page carries no googleAdTag and
//      the episode no ads (adsOnFor with contentType), the page props none,
//      the ad plan isn't attached, the Ad Curator refuses (the list, the
//      read, the save, the page's words), a break of one is never filled;
//      in Chromium a podcast episode with a running house ad, a ready plan
//      and breaks at 0:00 and 0:03 never asks for an ad (no IMA, no house
//      VAST, no fill), on its own page and inline on the show's page.
//   3. AdSense: the script tag is on a public page for a visitor who isn't
//      signed in, a viewer and a Standard member, and never for a Premium
//      member or the team; never on the error page; and the page's account
//      read is reused by the document (one Clerk user read and one Stripe
//      customer read per page load, counted in the fakes' request logs).
//   4. The mute, in Chromium with the fake IMA (dev/test-rig/lib/fake-ima.mjs
//      records every setVolume): a title's IMA pre-roll muted from its ad
//      bar stays muted into the title; a player muted before play starts
//      its ad muted and the ad's button gives both their sound back; a ready
//      plan's pod (a real WebM) muted from its bar; a Live TV scheduled ad
//      break muted from its bar, the next ad in the break starting muted,
//      and the programme after the break still muted.
//
//   node dev/test-rig/checks/round-nov13.mjs
// The browser half needs ffmpeg (a real WebM); without it, that half is
// skipped and says so. It reads the running app's GOOGLE_VIDEO_AD_TAG like
// checks/google-fill.mjs does, and checks the podcast's tag either way.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { ensureBucket, putObject } from '../lib/storage.mjs';
import { readPid } from '../lib/procs.mjs';
import { PATHS } from '../lib/config.mjs';
import { FAKE_IMA_JS, serveFakeIma } from '../lib/fake-ima.mjs';
import { googleTagValid } from '../../../lib/googleAdTagRules.js';
import { adsOnFor } from '../../../lib/adBreakRules.js';
import {
  BASE, IDS, USERS, RUN, FAKES, ok, section, runCheck, call, page, sql, rows, q, insert, session, SIGNED_OUT,
  browser, goto, ago, newUser, removeUser, stripeHook, stripeApi, forgetInvoiceEvents, cloudflare
} from './lib.mjs';

function appEnvValue(name) {
  const pid = readPid('next');
  if (!pid) return null;
  try {
    const env = fs.readFileSync(`/proc/${pid}/environ`, 'utf8').split('\0');
    const hit = env.find((l) => l.startsWith(`${name}=`));
    return hit ? hit.slice(name.length + 1) : null;
  } catch (err) {
    return null;
  }
}
const RAW_TAG = (appEnvValue('GOOGLE_VIDEO_AD_TAG') || '').trim();
const GOOGLE_ON = Boolean(RAW_TAG) && googleTagValid(RAW_TAG);

const MARA = session(USERS.mara);
const DEE = session(USERS.dee);
const ADMIN = session(USERS.admin);
const VIEWER = session(USERS.viewer);
const LOCK_LINE = 'Only the team can remove this warning from a live title.';

const SUPA = process.env.RIG_SUPABASE_TLS === '0' ? FAKES.supabase : FAKES.supabaseTls;
const BUCKET = 'ck-media';
const OBJ = `ck-rn-${RUN}.webm`;
const MEDIA = `${SUPA}/storage/v1/object/public/${BUCKET}/${OBJ}`;
const ID = {
  live: `ck-rn-fl-live-${RUN}`, // Mara's live film, no warning yet
  review: `ck-rn-fl-rev-${RUN}`, // Mara's film in review, warning on
  declined: `ck-rn-fl-no-${RUN}`, // Mara's "Not this time" film, warning on
  pre: `ck-rn-pre-${RUN}`, // a film with a pre-roll (IMA)
  pod: `ck-rn-pod-${RUN}`, // a film with a ready plan, a break at 0:00 (a pod)
  podcastEp: `ck-rn-cast-${RUN}` // a podcast episode with breaks and a ready plan
};
const film = (id, extra = {}) => ({
  id, title: `Check round ${id.slice(6, 14)} ${RUN}`, description: 'The round of 2026-11-13.', tier: 'free', genre: 'Drama', main_genre: 'Drama', content_type: 'movie',
  artist: 'Mara Reyes', runtime: '0:10', rating: 'TV-G', release_year: 2026, src: MEDIA, video_type: 'html5', ads_enabled: true, ad_break_seconds: [0],
  deletion_requested: false, moderation_hold: false, submitted_by: USERS.mara, status: 'approved', reviewed_at: ago(3), released_at: ago(3), created_at: ago(5), has_page: false, ...extra
});
const HOUSE_AD = crypto.randomUUID();
const SLOT = crypto.randomUUID();
const people = [];
const invoices = [];
const created = [];
let parked = [];

let haveVideo = false;
function makeVideo() {
  try {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ck-rn-'));
    const out = path.join(dir, 'clip.webm');
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=25', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '10', '-c:v', 'libvpx', '-b:v', '150k', '-c:a', 'libvorbis', '-shortest', out], { stdio: 'ignore' });
    const buf = fs.readFileSync(out);
    fs.rmSync(dir, { recursive: true, force: true });
    ensureBucket(BUCKET, { public: true });
    putObject(BUCKET, OBJ, buf, { contentType: 'video/webm' });
    return true;
  } catch (err) {
    console.log(`(no ffmpeg/libvpx here: the browser half is skipped — ${String(err.message || err).split('\n')[0]})`);
    return false;
  }
}

function seed() {
  insert('episodes', film(ID.live));
  insert('episodes', film(ID.review, { status: 'pending', reviewed_at: null, released_at: null, has_flashing_lights: true }));
  insert('episodes', film(ID.declined, { status: 'rejected', rejection_reason: 'Check', has_flashing_lights: true }));
  insert('episodes', film(ID.pre));
  insert('episodes', film(ID.pod));
  const nextNumber = Number((rows(`select coalesce(max(series_order), 0) + 1 as n from public.episodes where series_id = ${q(IDS.podcast)}`)[0] || {}).n || 900);
  insert('episodes', film(ID.podcastEp, { content_type: 'podcast', series_id: IDS.podcast, season: 1, series_order: nextNumber, artist: 'Dee Park', submitted_by: USERS.dee, ad_break_seconds: [0, 3], title: `Check round podcast ${RUN}` }));
  const plan = (id, at) => sql(`insert into public.episode_ad_plans (episode_id, status, breaks, round_to, on_demand, auto_bumper) values (${q(id)}, 'ready', ${q(JSON.stringify([{ at, pieces: [{ kind: 'exact', seconds: 15 }] }]))}::jsonb, 15, true, 'hold')`);
  plan(ID.pod, 0);
  plan(ID.podcastEp, 0);
  parked = rows(`select id from public.house_ads where active = true and review_status = 'approved'`).map((r) => r.id);
  if (parked.length) sql(`update public.house_ads set active = false where id in (${parked.map(q).join(', ')})`);
  // A 15-second house ad whose file is the check's WebM (a plan's pod plays
  // it; IMA's fake reads only the VAST).
  sql(`insert into public.house_ads (id, title, advertiser, video_url, duration_seconds, click_url, weight, active, review_status, created_by) values (${q(HOUSE_AD)}, 'Check round house ad ${RUN}', 'Kettle Coffee', ${q(MEDIA)}, 15, 'https://kettle.example.com/', 1, true, 'approved', ${q(USERS.admin)})`);
}
async function cleanup() {
  const eps = [...Object.values(ID), ...created].map(q).join(', ');
  const ids = people.map(q).join(', ') || "''";
  await forgetInvoiceEvents({ members: people, invoices }).catch(() => 0);
  try {
    const subs = (await stripeHook('/__state')).json.objects.filter((o) => o.object === 'subscription' && o.metadata && people.includes(o.metadata.member));
    for (const s of subs) await stripeApi(`/subscriptions/${s.id}`, { method: 'DELETE' });
  } catch (err) { /* the fake is gone */ }
  sql(`delete from public.channel_slots where id = ${q(SLOT)}`);
  sql(`delete from public.ad_impression_days where ad_id = ${q(HOUSE_AD)}`);
  sql(`delete from public.house_ads where id = ${q(HOUSE_AD)}`);
  if (parked.length) sql(`update public.house_ads set active = true where id in (${parked.map(q).join(', ')})`);
  for (const t of ['creator_ledger', 'member_referrals', 'member_payments', 'member_customers', 'member_lineups']) {
    sql(`delete from public.${t} where ${t === 'creator_ledger' ? 'member_id' : 'user_id'} in (${ids})`);
  }
  sql(`delete from public.notifications where user_id in (${ids}) or episode_id in (${eps})`);
  sql(`delete from public.audit_log where target_id in (${eps})`);
  sql(`delete from public.episode_ad_plans where episode_id in (${eps})`);
  sql(`delete from public.episodes where id in (${eps}) or title like 'Check round submitted ${RUN}%'`);
  for (const id of people) await removeUser(id);
}

async function subscribe(who, tier) {
  const r = await call('/api/create-checkout-session', { who, method: 'POST', body: { tier } });
  const sid = r.json && r.json.url ? r.json.url.split('/checkout/')[1] : null;
  if (!sid) return false;
  const done = await stripeHook(`/__checkout/${sid}/complete`, { method: 'POST' });
  const objs = (await stripeHook('/__state')).json.objects;
  for (const o of objs) if (o.object === 'invoice' && o.customer && done.json && done.json.session && o.customer === done.json.session.customer) invoices.push(o.id);
  return done.status === 200;
}
async function person(tag) {
  const m = await newUser(tag);
  people.push(m.id);
  return m;
}
const nextData = (html) => {
  const m = /<script id="__NEXT_DATA__" type="application\/json"[^>]*>([\s\S]*?)<\/script>/.exec(html || '');
  try { return m ? JSON.parse(m[1]).props.pageProps : null; } catch (err) { return null; }
};
const flash = (id) => (rows(`select has_flashing_lights as f from public.episodes where id = ${q(id)}`)[0] || {}).f === true;
const patch = (who, id, body, { bearer = false } = {}) => call(`/api/show/episode/${encodeURIComponent(id)}`, { who, method: 'PATCH', body, bearer });

// ---- 1. flashing lights ---------------------------------------------------------------
async function flashingLights() {
  section('Flashing lights: a live title (the show editor’s save, as the app sends it: Bearer)');
  let r = await call(`/api/show/episode/${encodeURIComponent(ID.live)}`, { who: MARA, bearer: true });
  ok('the editor read: unticked, the box open (direct)', r.status === 200 && r.json.episode.hasFlashingLights === false && r.json.policy.hasFlashingLights && r.json.policy.hasFlashingLights.mode === 'direct', r.json && r.json.policy && r.json.policy.hasFlashingLights);
  r = await patch(MARA, ID.live, { hasFlashingLights: true }, { bearer: true });
  ok('the uploader turns it on for a live title → applies at once', r.status === 200 && r.json.applied.includes('hasFlashingLights') && !(r.json.staged || []).includes('hasFlashingLights') && flash(ID.live), `${r.status} ${r.text.slice(0, 300)}`);
  r = await call(`/api/show/episode/${encodeURIComponent(ID.live)}`, { who: MARA, bearer: true });
  ok('…the editor now: ticked and locked with the team’s line', r.status === 200 && r.json.episode.hasFlashingLights === true && r.json.policy.hasFlashingLights.mode === 'locked' && r.json.policy.hasFlashingLights.line === LOCK_LINE, r.json && r.json.policy && r.json.policy.hasFlashingLights);
  const pg = await page(`/episode/${ID.live}`, SIGNED_OUT);
  ok('…the title’s page shows the warning chip at once', pg.status === 200 && /ep-flash-chip|Flashing lights/.test(pg.text), pg.status);
  r = await patch(MARA, ID.live, { hasFlashingLights: false }, { bearer: true });
  ok('the uploader can’t turn it off on a live title (Bearer): 403 with the line', r.status === 403 && r.json && r.json.error === LOCK_LINE && flash(ID.live), `${r.status} ${r.text.slice(0, 300)}`);
  r = await patch(MARA, ID.live, { hasFlashingLights: false });
  ok('…nor with the website’s cookie', r.status === 403 && r.json && r.json.error === LOCK_LINE && flash(ID.live), `${r.status} ${r.text.slice(0, 300)}`);
  r = await patch(MARA, ID.live, { hasFlashingLights: false, title: `Check round renamed ${RUN}` });
  ok('…nor slipped in with another change (nothing of the save applies)', r.status === 403 && flash(ID.live) && !rows(`select pending_title from public.episodes where id = ${q(ID.live)}`)[0].pending_title, `${r.status} ${r.text.slice(0, 200)}`);
  r = await call('/api/creator/edit-submission', { who: MARA, method: 'POST', body: { episodeId: ID.live, hasFlashingLights: false } });
  ok('…nor through the older edit-submission route (only titles in review)', r.status === 400 && flash(ID.live), `${r.status} ${r.text.slice(0, 200)}`);
  r = await call('/api/creator/request-episode-edit', { who: MARA, method: 'POST', bearer: true, body: { episodeId: ID.live, hasFlashingLights: false, description: 'The round of 2026-11-13.' } });
  ok('…nor through request-episode-edit (an old app build: the field is never read)', r.status === 400 && flash(ID.live), `${r.status} ${r.text.slice(0, 200)}`);
  r = await patch(MARA, ID.live, { hasFlashingLights: 'no' });
  ok('…a value that isn’t true or false: 400', r.status === 400 && flash(ID.live), r.status);
  r = await patch(DEE, ID.live, { hasFlashingLights: false });
  ok('…someone else: refused, nothing changes', r.status >= 400 && flash(ID.live), r.status);
  r = await patch(ADMIN, ID.live, { hasFlashingLights: false });
  ok('the team takes it off a live title (the admin show editor’s save)', r.status === 200 && r.json.applied.includes('hasFlashingLights') && !flash(ID.live), `${r.status} ${r.text.slice(0, 300)}`);
  r = await call('/api/admin/edit-episode', { who: ADMIN, method: 'POST', body: { episodeId: ID.live, hasFlashingLights: true } });
  ok('…and the Library modal’s route puts it back', r.status === 200 && flash(ID.live), `${r.status} ${r.text.slice(0, 200)}`);
  r = await call('/api/admin/edit-episode', { who: ADMIN, method: 'POST', body: { episodeId: ID.live, hasFlashingLights: false } });
  ok('…and takes it off again (full control)', r.status === 200 && !flash(ID.live), `${r.status} ${r.text.slice(0, 200)}`);

  section('Flashing lights: before it is live');
  r = await call(`/api/show/episode/${encodeURIComponent(ID.review)}`, { who: MARA, bearer: true });
  ok('in review: ticked, the box open', r.status === 200 && r.json.episode.hasFlashingLights === true && r.json.policy.hasFlashingLights.mode === 'direct', r.json && r.json.policy && r.json.policy.hasFlashingLights);
  r = await patch(MARA, ID.review, { hasFlashingLights: false }, { bearer: true });
  ok('in review: the uploader turns it off (Bearer)', r.status === 200 && r.json.applied.includes('hasFlashingLights') && !flash(ID.review), `${r.status} ${r.text.slice(0, 200)}`);
  r = await patch(MARA, ID.review, { hasFlashingLights: true });
  ok('…and on again (cookie)', r.status === 200 && flash(ID.review), r.status);
  r = await call('/api/creator/edit-submission', { who: MARA, method: 'POST', body: { episodeId: ID.review, hasFlashingLights: false } });
  ok('Your work’s Edit submission (edit-submission) turns it off while in review', r.status === 200 && !flash(ID.review), `${r.status} ${r.text.slice(0, 200)}`);
  r = await call('/api/creator/edit-submission', { who: MARA, method: 'POST', body: { episodeId: ID.review, hasFlashingLights: true } });
  ok('…and on', r.status === 200 && flash(ID.review), `${r.status} ${r.text.slice(0, 200)}`);
  r = await patch(MARA, ID.declined, { hasFlashingLights: false }, { bearer: true });
  ok('“Not this time”: the uploader turns it off', r.status === 200 && !flash(ID.declined), `${r.status} ${r.text.slice(0, 200)}`);

  section('Flashing lights: the three-step submit and a draft');
  const uid = crypto.createHash('md5').update(`ck-rn-submit-${RUN}`).digest('hex');
  await cloudflare('/__video', { method: 'POST', body: { uid, name: 'flash.mp4', creator: USERS.mara, duration: 600, ready: true, requireSignedURLs: true } });
  r = await call('/api/creator/submit-episode', { who: MARA, method: 'POST', bearer: true, body: { contentType: 'movie', title: `Check round submitted ${RUN}`, description: 'Strobes in the second act.', genre: 'Drama', mainGenre: 'Drama', runtime: '10:00', artist: 'Mara Reyes', tier: 'free', rating: 'TV-14', videoUid: uid, hasFlashingLights: true } });
  const subId = r.json && (r.json.id || (r.json.episode && r.json.episode.id));
  if (subId) created.push(subId);
  ok('submit-episode with hasFlashingLights → stored on the new title', r.status === 200 && subId && flash(subId), `${r.status} ${r.text.slice(0, 200)}`);
  r = await call('/api/creator/drafts', { who: MARA, method: 'POST', body: { form: { contentType: 'movie', title: `Check round draft ${RUN}`, hasFlashingLights: true } } });
  const draftId = r.json && (r.json.id || (r.json.draft && r.json.draft.id));
  ok('a draft keeps the tick in its form', (r.status === 200 || r.status === 201) && draftId, `${r.status} ${r.text.slice(0, 200)}`);
  if (draftId) {
    r = await call('/api/creator/drafts', { who: MARA, method: 'PATCH', body: { id: draftId, form: { hasFlashingLights: false } } });
    const form = (rows(`select form from public.creator_drafts where id = ${q(draftId)}`)[0] || {}).form || {};
    ok('…and the untick (a draft is never live)', r.status === 200 && form.hasFlashingLights === false, `${r.status} ${JSON.stringify(form).slice(0, 200)}`);
    sql(`delete from public.creator_drafts where id = ${q(draftId)}`);
  }
}

// ---- 2. podcasts are ad-free --------------------------------------------------------------
async function podcasts() {
  section(`Podcasts are ad-free (the app’s GOOGLE_VIDEO_AD_TAG: ${GOOGLE_ON ? 'set' : 'not set'})`);
  for (const [label, who] of [['signed out', SIGNED_OUT], ['a viewer', VIEWER]]) {
    const r = await call(`/api/episode-page?id=${encodeURIComponent(ID.podcastEp)}&terms=1`, { who, bearer: Boolean(who.token) });
    const e = r.json && r.json.episode;
    ok(`/api/episode-page, ${label}: no googleAdTag, adsEnabled false, no ad plan`, r.status === 200 && e && r.json.googleAdTag === null && e.adsEnabled === false && !e.adPlan, r.json && { tag: r.json.googleAdTag, ads: e && e.adsEnabled, plan: e && e.adPlan });
    ok(`…the app’s rule (adsOnFor with contentType) gives no ads, ${label}`, e && adsOnFor({ previewing: false, trailer: false, adFree: Boolean(r.json.adFree), isAdmin: Boolean(r.json.isAdmin), owned: false, adsEnabled: e.adsEnabled, contentType: e.contentType }) === false && adsOnFor({ adFree: Boolean(r.json.adFree), contentType: e.contentType }) === false, e && e.contentType);
  }
  let r = await call(`/api/episode-page?id=${encodeURIComponent(ID.pre)}&terms=1`, { who: VIEWER, bearer: true });
  ok(`a film for the same viewer still gets ads${GOOGLE_ON ? ' and the tag' : ''} (the rule only takes podcasts out)`, r.status === 200 && r.json.episode.adsEnabled === true && (GOOGLE_ON ? typeof r.json.googleAdTag === 'string' : r.json.googleAdTag === null), r.json && { tag: r.json.googleAdTag, ads: r.json.episode && r.json.episode.adsEnabled });
  let p = await page(`/episode/${ID.podcastEp}`, VIEWER);
  let props = nextData(p.text);
  ok('the episode page’s props: no googleAdTag, adsEnabled false', p.status === 200 && props && (props.googleAdTag || null) === null && props.episode && props.episode.adsEnabled === false, props && { tag: props.googleAdTag, ads: props.episode && props.episode.adsEnabled });
  p = await page(`/podcasts/${IDS.podcast}`, VIEWER);
  props = nextData(p.text);
  ok('the podcast show page: no googleAdTag prop, every episode adsEnabled false', p.status === 200 && props && !('googleAdTag' in props) && Array.isArray(props.episodes) && props.episodes.every((e) => e.adsEnabled === false && !('adBreakSeconds' in e)), props && props.episodes && props.episodes.map((e) => [e.id, e.adsEnabled]));
  r = await call(`/api/podcast-show?id=${encodeURIComponent(IDS.podcast)}`, { who: VIEWER, bearer: true });
  ok('/api/podcast-show (the app): every episode adsEnabled false', r.status === 200 && r.json.episodes.every((e) => e.adsEnabled === false), r.status);
  r = await call(`/api/ad-plan/fill?episode=${encodeURIComponent(ID.podcastEp)}&break=0&surface=vod`);
  ok('a podcast’s break is never filled (its ready plan is left unread): vod', r.status === 200 && r.json.fill === null, r.text.slice(0, 200));
  r = await call(`/api/ad-plan/fill?episode=${encodeURIComponent(ID.podcastEp)}&break=0&surface=live`);
  ok('…nor live', r.status === 200 && r.json.fill === null, r.text.slice(0, 200));
  r = await call(`/api/ad-plan/fill?episode=${encodeURIComponent(ID.pod)}&break=0&surface=vod`);
  ok('…while a film’s ready plan still fills (the same house ad)', r.status === 200 && r.json.fill && Array.isArray(r.json.fill.items) && r.json.fill.items.some((i) => i.type === 'ad'), r.text.slice(0, 200));

  section('The Ad Curator and podcasts');
  r = await call('/api/admin/ad-plans', { who: ADMIN });
  const listed = r.json && Array.isArray(r.json.episodes) ? r.json.episodes : [];
  ok('Ads → Episode ad plans: no podcast listed, films still are', r.status === 200 && !listed.some((e) => e.contentType === 'podcast') && listed.some((e) => e.id === ID.pre), r.status);
  r = await call(`/api/ad-plan/curator?episode=${encodeURIComponent(ID.podcastEp)}`, { who: ADMIN });
  ok('the curator’s read: adFree, "Podcasts are ad-free.", no plan', r.status === 200 && r.json.adFree === true && r.json.adFreeNote === 'Podcasts are ad-free.' && r.json.plan === null, r.text.slice(0, 200));
  r = await call('/api/ad-plan/curator', { who: ADMIN, method: 'POST', body: { episodeId: ID.podcastEp, plan: { status: 'ready', breaks: [{ at: 0, pieces: [{ kind: 'exact', seconds: 15 }] }] } } });
  ok('…a save is refused (409) with the words', r.status === 409 && /Podcasts are ad-free\./.test(r.json && r.json.error), `${r.status} ${r.text.slice(0, 200)}`);
  r = await call(`/api/ad-plan/curator?episode=${encodeURIComponent(ID.pre)}`, { who: ADMIN });
  ok('…a film still opens with a plan', r.status === 200 && r.json.plan && !r.json.adFree, r.status);
  p = await page(`/ad-plan/${ID.podcastEp}`, ADMIN);
  ok('the curator page renders for a podcast (200)', p.status === 200, p.status);
}

// ---- 3. AdSense ----------------------------------------------------------------------------
const ADSENSE = 'pagead2.googlesyndication.com/pagead/js/adsbygoogle.js';
const logCount = (name, re) => {
  try {
    return fs.readFileSync(path.join(PATHS.logs, `${name}.requests.log`), 'utf8').split('\n').filter((l) => re.test(l)).length;
  } catch (err) {
    return -1;
  }
};
async function adsense(members) {
  section('AdSense: never for an ad-free member');
  const who = [['signed out', SIGNED_OUT, true], ['a viewer (Basic)', VIEWER, true], ['a Standard member', members.standard, true], ['a Premium member', members.premium, false], ['the team (admin)', ADMIN, false]];
  for (const pathName of ['/stream', `/episode/${ID.pre}`, '/terms']) {
    for (const [label, s, want] of who) {
      const p = await page(pathName, s);
      ok(`${pathName}, ${label}: the script ${want ? 'is' : 'is not'} in the page`, p.status === 200 && p.text.includes(ADSENSE) === want, `${p.status} has=${p.text.includes(ADSENSE)}`);
    }
  }
  let p = await page(`/episode/ck-rn-missing-${RUN}`, SIGNED_OUT);
  ok('a missing title (the 404 page): no script', p.status === 404 && !p.text.includes(ADSENSE), p.status);
  p = await page('/account', members.standard);
  ok('a private page for a Standard member: still none', !p.text.includes(ADSENSE), p.status);

  section('…and the document reuses the page’s account read');
  const userRe = new RegExp(`GET /v1/users/${members.premium.id} `);
  const custRe = /GET \/v1\/customers\/cus_[^ ?]+\?expand/;
  for (const pathName of ['/stream', `/episode/${ID.pre}`, '/terms', '/account']) {
    const u0 = logCount('clerk', userRe);
    const c0 = logCount('stripe', custRe);
    p = await page(pathName, members.premium);
    const u = logCount('clerk', userRe) - u0;
    const c = logCount('stripe', custRe) - c0;
    ok(`${pathName}, a Premium member: one Clerk user read and one Stripe customer read for the page load (no second from the document)`, p.status === 200 && u === 1 && c === 1, { status: p.status, clerkUserReads: u, stripeCustomerReads: c });
  }
}

// ---- 4. the mute (Chromium + the fake IMA) ---------------------------------------------------
const HIDE_DEV_OVERLAY = () => {
  const add = () => {
    const s = document.createElement('style');
    s.textContent = 'nextjs-portal { display: none !important; pointer-events: none !important; }';
    document.documentElement.appendChild(s);
  };
  if (document.documentElement) add();
  else document.addEventListener('DOMContentLoaded', add);
};
async function openPlayer(b, who, pathname, { adMs = 6000 } = {}) {
  const o = await b.open(who, 1280);
  await serveFakeIma(o.ctx);
  await o.ctx.addInitScript(HIDE_DEV_OVERLAY);
  await o.ctx.addInitScript((ms) => { window.__imaAdMs = ms; }, adMs);
  o.adRequests = [];
  o.page.on('request', (req) => {
    const u = req.url();
    if (/\/api\/house-ads\/(vast|pick)|\/api\/ad-plan\/fill|doubleclick\.net|imasdk\.googleapis/.test(u)) o.adRequests.push(u);
  });
  await goto(o.page, pathname);
  return o;
}
const volumes = (pg) => pg.evaluate(() => (window.__ima ? window.__ima.volumes || [] : []));
const titleVideo = (pg) => pg.evaluate(() => { const v = document.querySelector('video.tp-video'); return v ? { muted: v.muted, volume: v.volume, paused: v.paused, t: v.currentTime } : null; });
const podVideo = (pg) => pg.evaluate(() => { const v = document.querySelector('video.tp-pod-video'); return v ? { muted: v.muted, shown: getComputedStyle(v).display !== 'none', paused: v.paused, t: v.currentTime } : null; });
const label = async (pg, sel) => ((await pg.locator(sel).count()) ? pg.locator(sel).first().getAttribute('aria-label') : null);
async function waitPlaying(pg, past = 0.5, timeout = 20000) {
  return pg.waitForFunction((s) => { const v = document.querySelector('video.tp-video'); return v && !v.paused && v.currentTime > s; }, past, { timeout }).then(() => true, () => false);
}

async function muteTitle(b) {
  section('Mute: a title’s IMA pre-roll muted from its ad bar stays muted into the title');
  let o = await openPlayer(b, SIGNED_OUT, `/episode/${ID.pre}?autoplay=1`);
  ok('the SDK is on the page', await o.page.waitForFunction(() => window.google && window.google.ima, null, { timeout: 15000 }).then(() => true, () => false));
  await o.page.locator('.tp-bigplay').click();
  ok('the ad bar shows its mute button', await o.page.waitForSelector('.tp-adbar .tp-ad-mute', { timeout: 6000 }).then(() => true, () => false));
  ok('…labelled "Mute"', (await label(o.page, '.tp-adbar .tp-ad-mute')) === 'Mute');
  let vols = await volumes(o.page);
  ok('…the ad started at the player’s sound (setVolume 1)', vols.length > 0 && vols.every((x) => x.n === 1), vols);
  await o.page.locator('.tp-adbar .tp-ad-mute').click();
  await o.page.waitForTimeout(300); // volumechange is a queued media task
  let v = await titleVideo(o.page);
  vols = await volumes(o.page);
  ok('a press mutes the player (the title’s <video>)', v && v.muted === true, v);
  ok('…and the ad (setVolume 0 on the ads manager)', vols.length > 0 && vols[vols.length - 1].n === 0, vols);
  ok('…the button now says "Unmute"', (await label(o.page, '.tp-adbar .tp-ad-mute')) === 'Unmute');
  ok('the title plays after the ad', await waitPlaying(o.page));
  v = await titleVideo(o.page);
  ok('…still muted (one mute for the ad and the programme)', v && v.muted === true, v);
  await o.page.mouse.move(640, 300);
  ok('…its own volume button says "Unmute"', await o.page.locator('.tp-controls button[aria-label="Unmute"]').count().then((n) => n > 0));
  ok('no page errors', o.errors.length === 0, o.errors);
  await o.ctx.close();

  section('Mute: a player muted before play starts its ad muted; the ad’s button gives both their sound back');
  o = await openPlayer(b, SIGNED_OUT, `/episode/${ID.pre}?autoplay=1`);
  await o.page.waitForFunction(() => window.google && window.google.ima, null, { timeout: 15000 }).catch(() => {});
  await o.page.locator('.tp-player').first().focus();
  await o.page.keyboard.press('m');
  v = await titleVideo(o.page);
  ok('M mutes the player before it starts', v && v.muted === true, v);
  await o.page.locator('.tp-bigplay').click();
  await o.page.waitForSelector('.tp-adbar .tp-ad-mute', { timeout: 6000 }).catch(() => {});
  vols = await volumes(o.page);
  ok('the ad starts silent (every setVolume so far is 0)', vols.length > 0 && vols.every((x) => x.n === 0), vols);
  ok('…its button says "Unmute"', (await label(o.page, '.tp-adbar .tp-ad-mute')) === 'Unmute');
  await o.page.locator('.tp-player').first().focus();
  await o.page.keyboard.press('m');
  await o.page.waitForTimeout(300);
  v = await titleVideo(o.page);
  vols = await volumes(o.page);
  ok('M during the ad unmutes both (the player and setVolume 1)', v && v.muted === false && vols[vols.length - 1].n === 1, { v, last: vols[vols.length - 1] });
  ok('the title plays after the ad, with its sound', (await waitPlaying(o.page)) && (await titleVideo(o.page)).muted === false);
  ok('no page errors', o.errors.length === 0, o.errors);
  await o.ctx.close();

  section('Mute: a ready plan’s pod (a real file in its own <video>) muted from its bar');
  o = await openPlayer(b, SIGNED_OUT, `/episode/${ID.pod}?autoplay=1`);
  await o.page.locator('.tp-bigplay').click();
  const podUp = await o.page.waitForFunction(() => { const v = document.querySelector('video.tp-pod-video'); return v && getComputedStyle(v).display !== 'none' && !v.paused && v.currentTime > 0.3; }, null, { timeout: 15000 }).then(() => true, () => false);
  ok('the pod plays the house ad’s file', podUp, await podVideo(o.page));
  ok('…its bar has the mute button ("Mute")', (await label(o.page, '.tp-adbar .tp-ad-mute')) === 'Mute');
  await o.page.locator('.tp-adbar .tp-ad-mute').click();
  await o.page.waitForTimeout(300); // volumechange is a queued media task
  const pv = await podVideo(o.page);
  v = await titleVideo(o.page);
  ok('a press mutes the pod and the title player', pv && pv.muted === true && v && v.muted === true, { pv, v });
  ok('the title plays after the pod', await waitPlaying(o.page, 0.5, 40000));
  v = await titleVideo(o.page);
  ok('…still muted', v && v.muted === true, v);
  ok('no page errors', o.errors.length === 0, o.errors);
  await o.ctx.close();
}

function channelNow() {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', weekday: 'long', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  const p = Object.fromEntries(f.formatToParts(new Date()).map((x) => [x.type, x.value]));
  return { weekday: p.weekday.toLowerCase(), h: Number(p.hour), m: Number(p.minute), s: Number(p.second) };
}
async function muteLive(b) {
  section('Mute: Live TV — a scheduled ad break muted from its bar; the programme after it stays muted');
  const now = channelNow();
  if (now.h === 0 && now.m < 2) { console.log('(the channel’s day just turned over: skipped this run)'); return; }
  const channel = rows("select id from public.channels where slug = 'tapatv'")[0];
  if (!channel) { ok('the seed channel is there', false); return; }
  // A break that started a minute ago and ends about 45 seconds from now.
  const start = now.h * 60 + now.m - 1;
  const elapsed = 60 + now.s;
  insert('channel_slots', { id: SLOT, channel_id: channel.id, layer: 'default', day_of_week: now.weekday, start_time: `${String(Math.floor(start / 60)).padStart(2, '0')}:${String(start % 60).padStart(2, '0')}:00`, duration_seconds: elapsed + 45, kind: 'ad_break', title: `Check round break ${RUN}` });
  const o = await b.open(SIGNED_OUT, 1280);
  await o.ctx.addInitScript(HIDE_DEV_OVERLAY);
  await o.ctx.addInitScript(() => { window.__imaAdMs = 4000; });
  await o.ctx.addInitScript(FAKE_IMA_JS);
  await goto(o.page, '/live');
  ok('the break’s ad bar shows its mute button', await o.page.waitForSelector('.tp-adbar .tp-ad-mute', { timeout: 15000 }).then(() => true, () => false));
  await o.page.waitForFunction(() => window.__ima && window.__ima.events.some((e) => e.startsWith('started')), null, { timeout: 10000 }).catch(() => {});
  ok('…labelled "Mute"', (await label(o.page, '.tp-adbar .tp-ad-mute')) === 'Mute');
  await o.page.locator('.tp-adbar .tp-ad-mute').click();
  await o.page.waitForTimeout(300); // volumechange is a queued media task
  let v = await titleVideo(o.page);
  let vols = await volumes(o.page);
  ok('a press mutes the channel player and the ad (setVolume 0)', v && v.muted === true && vols.length > 0 && vols[vols.length - 1].n === 0, { v, last: vols[vols.length - 1] });
  ok('…the button says "Unmute"', (await label(o.page, '.tp-adbar .tp-ad-mute')) === 'Unmute');
  // The next ad of the break: a new ads manager, set silent as it starts.
  const before = (await o.page.evaluate(() => window.__ima.requests.length));
  const nextAd = await o.page.waitForFunction((n) => window.__ima.requests.length > n && window.__ima.events.filter((e) => e.startsWith('started')).length >= 2, before, { timeout: 15000 }).then(() => true, () => false);
  vols = await volumes(o.page);
  const lastStart = vols.length ? vols[vols.length - 1] : null;
  ok('the next ad in the break starts muted too', nextAd && lastStart && lastStart.n === 0 && vols.filter((x) => x.n !== 0).every((x) => x.at < vols.find((y) => y.n === 0).at), { nextAd, vols });
  const over = await o.page.waitForFunction(() => !document.querySelector('.tp-adbar'), null, { timeout: 60000 }).then(() => true, () => false);
  ok('the break ends on the channel’s clock', over);
  v = await titleVideo(o.page);
  ok('…the channel player is still muted after it', v && v.muted === true, v);
  ok('…and its own mute button says "Unmute"', await o.page.locator('.tp-controls button[aria-label="Unmute"]').count().then((n) => n > 0));
  ok('no page errors', o.errors.length === 0, o.errors);
  await o.ctx.close();
  sql(`delete from public.channel_slots where id = ${q(SLOT)}`);
}

async function noAdsOnPodcasts(b) {
  section('Podcasts in Chromium: a running house ad, a ready plan, breaks at 0:00 and 0:03 — nothing asked');
  let o = await openPlayer(b, VIEWER, `/episode/${ID.podcastEp}?autoplay=1`);
  ok('no "Starts with a short ad" note', (await o.page.locator('.tp-bigplay-note').count()) === 0);
  await o.page.locator('.tp-bigplay').click();
  ok('the episode plays at once, past 0:03', await waitPlaying(o.page, 4, 20000));
  ok('…no ad bar ever', (await o.page.locator('.tp-adbar').count()) === 0);
  ok('…nothing asked: no IMA SDK, no house VAST, no pick, no fill, no Google', o.adRequests.length === 0, o.adRequests);
  ok('no page errors', o.errors.length === 0, o.errors);
  await o.ctx.close();

  o = await openPlayer(b, VIEWER, `/podcasts/${IDS.podcast}`);
  const row = o.page.locator('.podcast-episode-row', { hasText: `Check round podcast ${RUN}` }).first();
  const watch = row.locator('.podcast-inline-watch-btn');
  if (await watch.count()) {
    await watch.click();
    await o.page.waitForSelector('.podcast-inline-video .tp-bigplay', { timeout: 15000 }).catch(() => {});
    ok('inline on the show page: no "Starts with a short ad"', (await o.page.locator('.podcast-inline-video .tp-bigplay-note').count()) === 0);
    await o.page.locator('.podcast-inline-video .tp-bigplay').click();
    ok('…it plays at once, past 0:03', await waitPlaying(o.page, 4, 20000));
    ok('…nothing asked', o.adRequests.length === 0, o.adRequests);
  } else {
    ok('the show page lists the check’s episode with its Watch button', false, await o.page.locator('.podcast-episode-row').count());
  }
  ok('no page errors', o.errors.length === 0, o.errors);
  await o.ctx.close();
}

await runCheck('round-nov13', async () => {
  haveVideo = makeVideo();
  seed();
  try {
    await flashingLights();
    await podcasts();
    const standard = await person('rnstd');
    const premium = await person('rnprem');
    ok('a Standard member subscribes through Checkout', await subscribe(standard, 'standard'));
    ok('a Premium member subscribes through Checkout', await subscribe(premium, 'premium'));
    await adsense({ standard, premium });
    if (!haveVideo) return;
    const b = await browser();
    try {
      await noAdsOnPodcasts(b);
      await muteTitle(b);
      await muteLive(b);
    } finally {
      await b.close();
    }
  } finally {
    await cleanup();
  }
});
