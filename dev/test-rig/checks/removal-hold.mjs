#!/usr/bin/env node
// Removals held a month, and titles brought back (migration 124,
// 2026-11-15; mockups/round3-build-contract.md section A; lib/removalRules.js,
// lib/titleRemoval.js, lib/showDelete.js). Runs the half that matches the
// database.
//
// After 124:
//   - the owner's request keeps "Keep the files…" (keep_after_removal), and
//     taking the request back clears it; an owner can't cancel a removal
//     the team started;
//   - a confirmation of a title nobody bought takes it off the site and
//     holds its files 30 days (purge_after), kept for later when asked, kept
//     for its buyers for good when bought (its buyer still plays it); its
//     price comes off and the owner is told;
//   - "Ask to bring it back": the owner (twice → 409, a stranger → 403, a
//     title the team removed → only a full admin), the review queue's kind
//     'restore' (a reviewer approves — never their own work, a team-removed
//     one only a full admin), approved = public again with selling off,
//     denied = a note, it stays removed;
//   - the daily clean-up (/api/cron/expire-content) deletes a title whose
//     hold ran out (files to Orphaned media, the owner told), never one
//     waiting to come back;
//   - "Delete now": a full admin, a reason, never anything bought;
//   - a show: held with everything in it at the same moment, brought back
//     with it, and deleted with it by the clean-up;
//   - Your work's route and the deletion queue carry the new fields;
//   - the review of 2026-11-15: a show removed after one of its titles
//     (held 30 days on its own, asked back on its own) holds it with the
//     show — one moment, one deadline, never "kept for buyers" — and brings
//     it back with the show; the clean-up deletes them together; two
//     confirmations at once, and a retry after one stopped part-way, leave
//     one moment; "Delete now" on a show with a held title deletes the
//     show; "keep the files" is cleared on a deny and never taken by a
//     removal the team starts; the clean-up reaches a title behind fifty
//     left to their show; a contributor can't approve their show's
//     return; a title whose availability window ended comes back without
//     one; a held show's extras stay where they were filed; an admin's
//     second try reads where the show stands; a title past its hold can't
//     be asked back.
// Before 124: a confirmation deletes at once as before, asking it back and
// "keep the files" answer 503 migration-124.
//
// It runs the cron by hand, which also flags expired availability windows
// and runs the savers' step: rows of the seed it would flag are put back.
// Rig up:
//   node dev/test-rig/checks/removal-hold.mjs
import crypto from 'node:crypto';
import { IDS, USERS, RUN, ok, section, runCheck, call, sql, rows, q, insert, session, hasColumn, ago, uidFor } from './lib.mjs';

const DEE = session(USERS.dee);
const MARA = session(USERS.mara);
const ADMIN = session(USERS.admin);
const VIEWER = session(USERS.viewer);
const SUB = session(USERS.sub); // review_submissions + manage_episodes (the seed), no manage_deletions

const ID = {
  hold: `ck-rh-hold-${RUN}`,
  keep: `ck-rh-keep-${RUN}`,
  bought: `ck-rh-bought-${RUN}`,
  askBack: `ck-rh-askback-${RUN}`,
  deny: `ck-rh-deny-${RUN}`,
  team: `ck-rh-team-${RUN}`,
  teamOpen: `ck-rh-teamopen-${RUN}`,
  subOwn: `ck-rh-subown-${RUN}`,
  purge: `ck-rh-purge-${RUN}`,
  purgeAsked: `ck-rh-purgeasked-${RUN}`,
  now: `ck-rh-now-${RUN}`,
  nowBought: `ck-rh-nowbought-${RUN}`,
  pre: `ck-rh-pre-${RUN}`,
  show: `ck-rh-show-${RUN}`,
  showE1: `ck-rh-show-e1-${RUN}`,
  showE2: `ck-rh-show-e2-${RUN}`,
  gone: `ck-rh-gone-${RUN}`,
  goneE1: `ck-rh-gone-e1-${RUN}`,
  // the review of 2026-11-15
  mix: `ck-rh-mix-${RUN}`,
  mixE1: `ck-rh-mix-e1-${RUN}`,
  mixE2: `ck-rh-mix-e2-${RUN}`,
  mixE3: `ck-rh-mix-e3-${RUN}`,
  mixP: `ck-rh-mixp-${RUN}`,
  mixPE1: `ck-rh-mixp-e1-${RUN}`,
  mixPE2: `ck-rh-mixp-e2-${RUN}`,
  race: `ck-rh-race-${RUN}`,
  raceE1: `ck-rh-race-e1-${RUN}`,
  raceE2: `ck-rh-race-e2-${RUN}`,
  retry: `ck-rh-retry-${RUN}`,
  retryE1: `ck-rh-retry-e1-${RUN}`,
  retryE2: `ck-rh-retry-e2-${RUN}`,
  nowShow: `ck-rh-nowshow-${RUN}`,
  nowShowE1: `ck-rh-nowshow-e1-${RUN}`,
  nowShowE2: `ck-rh-nowshow-e2-${RUN}`,
  keepShow: `ck-rh-keepshow-${RUN}`,
  keepShowE1: `ck-rh-keepshow-e1-${RUN}`,
  asked: `ck-rh-askedshow-${RUN}`,
  lonely: `ck-rh-lonely-${RUN}`,
  contrib: `ck-rh-contrib-${RUN}`,
  contribE1: `ck-rh-contrib-e1-${RUN}`,
  contribE2: `ck-rh-contrib-e2-${RUN}`,
  window: `ck-rh-window-${RUN}`,
  extraShow: `ck-rh-xshow-${RUN}`,
  extraShowE1: `ck-rh-xshow-e1-${RUN}`,
  extraShowX: `ck-rh-xshow-x-${RUN}`,
  due: `ck-rh-due-${RUN}`
};
const MANY = Array.from({ length: 55 }, (_, i) => `ck-rh-many-${String(i).padStart(2, '0')}-${RUN}`);
const hex = () => crypto.randomBytes(16).toString('hex');
const VID = { purge: hex(), now: hex(), gone: hex(), pre: hex() };
const cf = (u) => `https://customer-test.cloudflarestream.com/${u}/manifest/video.m3u8`;

const base = (id, extra = {}) => ({
  id, title: `Check rh ${id.slice(6, 22)} ${RUN}`, description: `The description of ${id}.`, tier: 'free', genre: 'Drama', main_genre: 'Drama', content_type: 'movie',
  artist: 'Dee Park', runtime: '14:00', rating: 'TV-PG', release_year: 2026, src: cf(uidFor(IDS.short)), video_type: 'html5', video_provider: 'cloudflare',
  ads_enabled: false, deletion_requested: false, moderation_hold: false, submitted_by: USERS.dee, status: 'approved', reviewed_at: ago(3), released_at: ago(3), created_at: ago(5),
  poster: null, thumbnail: null, ...extra
});
const show = (id, extra = {}) => ({
  id, name: `Check rh show ${id.slice(6, 22)} ${RUN}`, description: 'A show for the removal check.', creator_id: USERS.dee, release_year: 2026, status: 'approved',
  submitted_by_user_id: USERS.dee, reviewed_at: ago(10), public_at: ago(10), created_at: ago(12), kind: 'series', defaults: {}, seasons: [], credits: {},
  deletion_requested: false, moderation_hold: false, ...extra
});
const removed = (days = 1, extra = {}) => ({ deletion_requested: true, deletion_reason: `Asked by the check ${RUN}`, deletion_requested_at: ago(days + 1), withdrawn_at: ago(days), ...extra });

const one = (text) => rows(text)[0] || {};
const ep = (id) => one(`select id, status, deletion_requested, deletion_reason, withdrawn_at, purge_after, keep_after_removal, restore_requested_at, restore_reason from public.episodes where id = ${q(id)}`);
const se = (id) => one(`select id, status, deletion_requested, withdrawn_at, purge_after, keep_after_removal, restore_requested_at from public.series where id = ${q(id)}`);
const errOf = (r) => (r.json && r.json.error) || '';
const told = (type, id) => rows(`select message from public.notifications where user_id = ${q(USERS.dee)} and type = ${q(type)} and created_at > now() - interval '10 minutes' and message like ${q(`%${id.slice(6, 22)}%`)}`).length > 0;
const days = (iso) => (Date.parse(iso) - Date.now()) / 86400000;

let flaggedBefore = { episodes: [], series: [] };

function cleanup() {
  const ids = Object.values(ID).map(q).join(', ');
  const uids = Object.values(VID).map(q).join(', ');
  sql(`delete from public.notifications where episode_id in (${ids}) or message like ${q(`%${RUN}%`)}`);
  sql(`delete from public.audit_log where target_id in (${ids}) or details like ${q(`%${RUN}%`)}`);
  sql(`delete from public.orphaned_media where reference in (${uids}) or context like ${q(`%${RUN}%`)}`);
  sql(`delete from public.purchases where target_id in (${ids})`);
  sql(`delete from public.title_prices where target_id in (${ids})`);
  sql(`delete from public.episodes where id in (${ids}) or id like ${q(`ck-rh-many-%-${RUN}`)} or title like ${q(`Check rh %${RUN}`)}`);
  sql(`delete from public.series where id in (${ids})`);
}

function price(id) {
  insert('title_prices', { target_type: 'episode', target_id: id, creator_id: USERS.dee, price_cents: 299, status: 'on', requested_at: ago(4), reviewed_by: USERS.admin, reviewed_at: ago(4) });
}
function bought(id) {
  insert('purchases', { buyer_id: USERS.viewer, target_type: 'episode', target_id: id, creator_id: USERS.dee, title: 'Check rh', price_cents: 299, paid_cents: 299, creator_cents: 190, fee_cents: 39, platform_cents: 109, status: 'completed', completed_at: ago(2) });
}

// The cron flags expired availability windows on any row: the seed's are
// put back as they were.
function snapshotExpired() {
  flaggedBefore = {
    episodes: rows(`select id from public.episodes where deletion_requested = false and available_until is not null and available_until <= now() + interval '1 hour'`).map((r) => r.id),
    series: rows(`select id from public.series where deletion_requested = false and available_until is not null and available_until <= now() + interval '1 hour'`).map((r) => r.id)
  };
}
function restoreExpired() {
  if (flaggedBefore.episodes.length) sql(`update public.episodes set deletion_requested = false, deletion_reason = null, deletion_requested_at = null where id in (${flaggedBefore.episodes.map(q).join(', ')})`);
  if (flaggedBefore.series.length) sql(`update public.series set deletion_requested = false, deletion_reason = null, deletion_requested_at = null where id in (${flaggedBefore.series.map(q).join(', ')})`);
}
async function runCron() {
  snapshotExpired();
  try {
    return await call('/api/cron/expire-content', { who: ADMIN, method: 'POST', body: {} });
  } finally {
    restoreExpired();
  }
}

// ---- before 124 -------------------------------------------------------------------------

async function before124() {
  section('Before migration 124: as before');
  insert('episodes', base(ID.pre, { src: cf(VID.pre), deletion_requested: true, deletion_reason: `Asked by the check ${RUN}`, deletion_requested_at: ago(1) }));
  let r = await call('/api/creator/request-episode-deletion', { who: DEE, method: 'POST', body: { episodeId: ID.pre, action: 'request', reason: 'Again', keep: true } });
  ok('"keep the files" before 124 → 503 migration-124', r.status === 503, `${r.status} ${r.text.slice(0, 200)}`);
  r = await call(`/api/show/episode/${ID.pre}/restore`, { who: DEE, method: 'POST', body: { action: 'request' } });
  ok('asking a title back before 124 → 503 migration-124', r.status === 503 && r.json && r.json.code === 'migration-124', `${r.status} ${r.text.slice(0, 200)}`);
  r = await call('/api/admin/resolve-deletion', { who: ADMIN, method: 'POST', body: { type: 'episode', id: ID.pre, decision: 'confirm' } });
  ok('a confirmation deletes at once → 200, outcome delete', r.status === 200 && r.json && r.json.outcome === 'delete', `${r.status} ${r.text.slice(0, 200)}`);
  ok('…the row is gone', rows(`select id from public.episodes where id = ${q(ID.pre)}`).length === 0);
  ok('…its file is recorded as orphaned', rows(`select id from public.orphaned_media where reference = ${q(VID.pre)}`).length === 1);
  r = await call('/api/admin/review-queue', { who: ADMIN });
  ok('the review queue still answers (no restore items)', r.status === 200 && !(r.json.items || []).some((i) => i.kind === 'restore'), r.status);
  r = await runCron();
  ok('the cron runs; nothing to purge (ready: false)', r.status === 200 && r.json && r.json.purged && r.json.purged.ready === false, `${r.status} ${r.text.slice(0, 200)}`);
}

// ---- after 124 --------------------------------------------------------------------------

function seed() {
  insert('episodes', base(ID.hold));
  price(ID.hold);
  insert('episodes', base(ID.keep));
  insert('episodes', base(ID.bought, { deletion_requested: true, deletion_reason: `Asked by the check ${RUN}`, deletion_requested_at: ago(1) }));
  price(ID.bought);
  bought(ID.bought);
  insert('episodes', base(ID.askBack, removed(2, { purge_after: new Date(Date.now() + 20 * 86400000).toISOString() })));
  insert('episodes', base(ID.deny, removed(2, { purge_after: new Date(Date.now() + 20 * 86400000).toISOString(), restore_requested_at: ago(0.1), restore_reason: `Back please ${RUN}` })));
  insert('episodes', base(ID.team, removed(2, { deletion_reason: `Removed by an admin: abuse ${RUN}`, purge_after: new Date(Date.now() + 20 * 86400000).toISOString() })));
  insert('episodes', base(ID.teamOpen, { deletion_requested: true, deletion_reason: `Removed by an admin: stopped part-way ${RUN}`, deletion_requested_at: ago(1) }));
  insert('episodes', base(ID.subOwn, removed(2, { submitted_by: USERS.sub, artist: 'Sam Subadmin', purge_after: new Date(Date.now() + 20 * 86400000).toISOString(), restore_requested_at: ago(0.1) })));
  insert('episodes', base(ID.purge, removed(31, { src: cf(VID.purge), purge_after: ago(1) })));
  insert('episodes', base(ID.purgeAsked, removed(31, { purge_after: ago(1), restore_requested_at: ago(0.5) })));
  insert('episodes', base(ID.now, { src: cf(VID.now), deletion_requested: true, deletion_reason: `Asked by the check ${RUN}`, deletion_requested_at: ago(1) }));
  insert('episodes', base(ID.nowBought, { deletion_requested: true, deletion_reason: `Asked by the check ${RUN}`, deletion_requested_at: ago(1) }));
  bought(ID.nowBought);
  insert('series', show(ID.show));
  insert('episodes', base(ID.showE1, { content_type: 'series', series_id: ID.show, season: 1, series_order: 1 }));
  insert('episodes', base(ID.showE2, { content_type: 'series', series_id: ID.show, season: 1, series_order: 2 }));
  insert('series', show(ID.gone, removed(31, { purge_after: ago(1) })));
  const goneAt = one(`select withdrawn_at from public.series where id = ${q(ID.gone)}`).withdrawn_at;
  insert('episodes', base(ID.goneE1, { content_type: 'series', series_id: ID.gone, season: 1, series_order: 1, src: cf(VID.gone), deletion_requested: true, deletion_reason: 'Removed with its show', deletion_requested_at: goneAt, withdrawn_at: goneAt, purge_after: ago(1) }));
}

async function requests() {
  section('The owner’s request: keep the files, cancel, a removal the team started');
  let r = await call(`/api/show/episode/${ID.keep}/removal`, { who: DEE, method: 'POST', body: { action: 'request', reason: `Recut ${RUN}`, keep: true } });
  ok('asked with "keep the files" → 200, keep', r.status === 200 && r.json && r.json.keep === true, `${r.status} ${r.text.slice(0, 200)}`);
  ok('…keep_after_removal is true', ep(ID.keep).keep_after_removal === true, ep(ID.keep));
  r = await call(`/api/show/episode/${ID.keep}/removal`, { who: DEE, method: 'POST', body: { action: 'cancel' } });
  ok('taken back → 200, keep cleared', r.status === 200 && ep(ID.keep).keep_after_removal === false && ep(ID.keep).deletion_requested === false, ep(ID.keep));
  r = await call('/api/creator/request-episode-deletion', { who: DEE, method: 'POST', body: { episodeId: ID.keep, action: 'request', reason: `Recut ${RUN}`, keep: true } });
  ok('asked again through Your work’s route with keep → 200', r.status === 200 && ep(ID.keep).keep_after_removal === true, `${r.status} ${r.text.slice(0, 200)}`);
  r = await call(`/api/show/episode/${ID.hold}/removal`, { who: DEE, method: 'POST', body: { action: 'request', reason: `Recut ${RUN}` } });
  ok('a plain request → 200, keep false', r.status === 200 && ep(ID.hold).keep_after_removal === false && ep(ID.hold).deletion_requested === true, ep(ID.hold));
  r = await call('/api/creator/request-episode-deletion', { who: DEE, method: 'POST', body: { episodeId: ID.teamOpen, action: 'cancel' } });
  ok('the owner’s cancel of a removal the team started → 403 team-removal', r.status === 403 && r.json && r.json.code === 'team-removal', `${r.status} ${r.text.slice(0, 200)}`);
  r = await call(`/api/show/episode/${ID.teamOpen}/removal`, { who: DEE, method: 'POST', body: { action: 'cancel' } });
  ok('…on the editor’s route too', r.status === 403, r.status);
  r = await call('/api/creator/request-episode-deletion', { who: DEE, method: 'POST', body: { episodeId: ID.teamOpen, action: 'request', reason: 'mine now' } });
  ok('…and asking again (which would overwrite its reason) → 403', r.status === 403, r.status);
  ok('…still the team’s removal', String(ep(ID.teamOpen).deletion_reason || '').startsWith('Removed by an admin: '), ep(ID.teamOpen));
}

async function confirming() {
  section('Confirming: held 30 days, kept for later, kept for buyers');
  let r = await call('/api/admin/pending-deletions', { who: ADMIN });
  const item = r.json && (r.json.episodes || []).find((e) => e.id === ID.hold);
  ok('the deletion queue: holdReady, "Remove · keep 30 days", Delete now for a full admin', r.status === 200 && r.json.holdReady === true && item && item.confirmLabel === 'Remove · keep 30 days' && item.canDeleteNow === true, item || r.status);
  const keepItem = r.json && (r.json.episodes || []).find((e) => e.id === ID.keep);
  ok('…a kept-for-later request reads "Remove · kept for later"', keepItem && keepItem.confirmLabel === 'Remove · kept for later', keepItem);
  const boughtItem = r.json && (r.json.episodes || []).find((e) => e.id === ID.bought);
  ok('…a bought one "Remove · kept for buyers", no Delete now', boughtItem && boughtItem.confirmLabel === 'Remove · kept for buyers' && boughtItem.canDeleteNow === false, boughtItem);
  ok('…the held list carries a held title', (r.json.held || []).some((h) => h.id === ID.askBack && /Removed · deleted on/.test(h.label)), (r.json.held || []).length);

  r = await call('/api/admin/resolve-deletion', { who: ADMIN, method: 'POST', body: { type: 'episode', id: ID.hold, decision: 'confirm' } });
  const h = ep(ID.hold);
  ok('a title nobody bought → 200, outcome hold', r.status === 200 && r.json && r.json.outcome === 'hold', `${r.status} ${r.text.slice(0, 200)}`);
  ok('…withdrawn now, files kept ~30 days', Boolean(h.withdrawn_at) && h.purge_after && days(h.purge_after) > 29 && days(h.purge_after) < 31, h);
  ok('…its price is off', one(`select status from public.title_prices where target_id = ${q(ID.hold)}`).status === 'off');
  ok('…the row is still there (nothing deleted)', Boolean(h.id));
  r = await call(`/api/episode-page?id=${ID.hold}`, { who: MARA });
  ok('…off the site (/api/episode-page → 404)', r.status === 404, r.status);
  ok('…its owner was told when the files go', told('deletion_confirmed', ID.hold));

  r = await call('/api/admin/resolve-deletion', { who: ADMIN, method: 'POST', body: { type: 'episode', id: ID.keep, decision: 'confirm' } });
  const k = ep(ID.keep);
  ok('kept for later → 200, outcome later, no purge date', r.status === 200 && r.json.outcome === 'later' && Boolean(k.withdrawn_at) && !k.purge_after && k.keep_after_removal === true, k);

  r = await call('/api/admin/resolve-deletion', { who: ADMIN, method: 'POST', body: { type: 'episode', id: ID.bought, decision: 'confirm' } });
  const b = ep(ID.bought);
  ok('bought → 200, outcome buyers, kept for good', r.status === 200 && r.json.outcome === 'buyers' && Boolean(b.withdrawn_at) && !b.purge_after, b);
  r = await call('/api/stream-token', { who: VIEWER, method: 'POST', body: { episodeId: ID.bought } });
  ok('…its buyer still gets a playable link', r.status === 200 && r.json && r.json.src, `${r.status} ${r.text.slice(0, 160)}`);
  r = await call('/api/admin/resolve-deletion', { who: ADMIN, method: 'POST', body: { type: 'episode', id: ID.hold, decision: 'confirm' } });
  ok('confirming a held title again → 409', r.status === 409, r.status);

  r = await call('/api/creator/my-submissions', { who: DEE });
  const mine = r.json && (r.json.submissions || []).find((s) => s.id === ID.hold);
  ok('Your work’s route: removalReady, purgeAfter, keepAfterRemoval, restoreRequestedAt', mine && mine.removalReady === true && mine.purgeAfter && mine.keepAfterRemoval === false && mine.restoreRequestedAt === null, mine);
  const teamRow = r.json && (r.json.submissions || []).find((s) => s.id === ID.team);
  ok('…teamRemoved for a title the team removed', teamRow && teamRow.teamRemoved === true, teamRow);
}

async function askingBack() {
  section('Ask to bring it back');
  let r = await call(`/api/show/episode/${ID.askBack}/restore`, { who: MARA, method: 'POST', body: { action: 'request' } });
  ok('someone else’s title → 403', r.status === 403, `${r.status} ${r.text.slice(0, 200)}`);
  r = await call(`/api/show/episode/${ID.askBack}/restore`, { who: VIEWER, method: 'POST', body: { action: 'request' } });
  ok('a viewer → 403', r.status === 403, r.status);
  r = await call(`/api/show/episode/${ID.askBack}/restore`, { who: DEE, method: 'POST', body: { action: 'request', reason: `I changed my mind ${RUN}` } });
  ok('its owner asks → 200', r.status === 200 && r.json && r.json.asked === true, `${r.status} ${r.text.slice(0, 200)}`);
  ok('…restore_requested_at and the note stored', Boolean(ep(ID.askBack).restore_requested_at) && ep(ID.askBack).restore_reason === `I changed my mind ${RUN}`, ep(ID.askBack));
  r = await call(`/api/show/episode/${ID.askBack}/restore`, { who: DEE, method: 'POST', body: { action: 'request' } });
  ok('…asking twice → 409 asked', r.status === 409 && r.json && r.json.code === 'asked', `${r.status} ${r.text.slice(0, 200)}`);
  r = await call(`/api/show/episode/${ID.askBack}/restore`, { who: DEE, method: 'POST', body: { action: 'request', reason: 'x'.repeat(1001) }, bearer: true });
  ok('…(the app, Bearer) a note over 1,000 characters is refused before anything', r.status === 409 || r.status === 400, r.status);
  r = await call(`/api/show/episode/${ID.team}/restore`, { who: DEE, method: 'POST', body: { action: 'request' } });
  ok('a title the team removed: its owner → 403 team', r.status === 403 && r.json && r.json.code === 'team', `${r.status} ${r.text.slice(0, 200)}`);
  r = await call(`/api/show/episode/${ID.team}/restore`, { who: ADMIN, method: 'POST', body: { action: 'request', reason: `Cleared ${RUN}` } });
  ok('…a full admin asks for it → 200', r.status === 200, `${r.status} ${r.text.slice(0, 200)}`);
  r = await call(`/api/show/episode/${ID.hold}/restore`, { who: DEE, method: 'POST', body: { action: 'cancel' } });
  ok('taking back a request that isn’t there → 409', r.status === 409, r.status);

  section('The review queue: kind restore');
  r = await call('/api/admin/review-queue', { who: ADMIN });
  const items = (r.json && r.json.items) || [];
  const ask = items.find((i) => i.kind === 'restore' && i.id === `episode:${ID.askBack}`);
  ok('a full admin sees the request with its owner, note and dates', ask && /removed/.test(ask.subtitle) && /files go/.test(ask.subtitle) && ask.description === `I changed my mind ${RUN}`, ask);
  ok('…counts.restore', r.json && r.json.counts && r.json.counts.restore >= 3, r.json && r.json.counts);
  r = await call('/api/admin/review-queue', { who: SUB });
  const subItems = (r.json && r.json.items) || [];
  const subOwn = subItems.find((i) => i.id === `episode:${ID.subOwn}`);
  const subTeam = subItems.find((i) => i.id === `episode:${ID.team}`);
  ok('a reviewer sees them; Approve greyed on their own work and on a team removal', subOwn && subOwn.meta.blocked && subTeam && subTeam.meta.blocked, { subOwn: subOwn && subOwn.meta, subTeam: subTeam && subTeam.meta });
  r = await call('/api/admin/review-queue', { who: SUB, method: 'POST', body: { kind: 'restore', id: `episode:${ID.subOwn}`, decision: 'approve' } });
  ok('…their own → 403 own-work', r.status === 403, `${r.status} ${r.text.slice(0, 200)}`);
  r = await call('/api/admin/review-queue', { who: SUB, method: 'POST', body: { kind: 'restore', id: `episode:${ID.team}`, decision: 'approve' } });
  ok('…a team removal → 403', r.status === 403, `${r.status} ${r.text.slice(0, 200)}`);
  r = await call('/api/admin/review-queue', { who: SUB, method: 'POST', body: { kind: 'restore', id: `episode:${ID.askBack}`, decision: 'approve' } });
  const back = ep(ID.askBack);
  ok('a reviewer approves Dee’s → 200', r.status === 200, `${r.status} ${r.text.slice(0, 200)}`);
  ok('…on the site again: withdrawn, purge, request, keep and restore cleared', !back.withdrawn_at && !back.purge_after && back.deletion_requested === false && !back.restore_requested_at && back.keep_after_removal === false, back);
  r = await call(`/api/episode-page?id=${ID.askBack}`, { who: MARA });
  ok('…/api/episode-page → 200', r.status === 200, r.status);
  ok('…its owner was told', told('title_restored', ID.askBack));
  r = await call('/api/admin/review-queue', { who: ADMIN, method: 'POST', body: { kind: 'restore', id: `episode:${ID.askBack}`, decision: 'approve' } });
  ok('…deciding it again → 409', r.status === 409, r.status);
  r = await call('/api/admin/review-queue', { who: ADMIN, method: 'POST', body: { kind: 'restore', id: `episode:${ID.team}`, decision: 'approve' } });
  ok('a full admin approves a team removal → 200', r.status === 200 && !ep(ID.team).withdrawn_at, `${r.status} ${r.text.slice(0, 200)}`);

  r = await call('/api/admin/review-queue', { who: ADMIN, method: 'POST', body: { kind: 'restore', id: `episode:${ID.deny}`, decision: 'reject' } });
  ok('Deny without a note → 400', r.status === 400, r.status);
  r = await call('/api/admin/review-queue', { who: ADMIN, method: 'POST', body: { kind: 'restore', id: `episode:${ID.deny}`, decision: 'reject', reason: `Still not right ${RUN}` } });
  const d = ep(ID.deny);
  ok('Deny with a note → 200; still removed, its hold runs on', r.status === 200 && Boolean(d.withdrawn_at) && Boolean(d.purge_after) && !d.restore_requested_at, d);
  ok('…its owner was told', told('restore_denied', ID.deny));
}

async function cleanUp() {
  section('The daily clean-up');
  const r = await runCron();
  ok('the cron runs → 200 with what it purged', r.status === 200 && r.json && r.json.purged && r.json.purged.ready === true, `${r.status} ${r.text.slice(0, 300)}`);
  ok('a title whose hold ran out is deleted', rows(`select id from public.episodes where id = ${q(ID.purge)}`).length === 0);
  ok('…its file recorded in Orphaned media', rows(`select id from public.orphaned_media where reference = ${q(VID.purge)}`).length === 1);
  ok('…audited purge_episode', rows(`select id from public.audit_log where action = 'purge_episode' and target_id = ${q(ID.purge)}`).length === 1);
  ok('…its owner told it was deleted for good', told('title_purged', ID.purge));
  ok('one waiting to come back is kept', Boolean(ep(ID.purgeAsked).id));
  ok('a show whose hold ran out goes with its episodes', rows(`select id from public.series where id = ${q(ID.gone)}`).length === 0 && rows(`select id from public.episodes where id = ${q(ID.goneE1)}`).length === 0);
  ok('…its episode’s file recorded', rows(`select id from public.orphaned_media where reference = ${q(VID.gone)}`).length === 1);
  ok('titles held for later or for buyers are untouched', Boolean(ep(ID.keep).id) && Boolean(ep(ID.bought).id) && Boolean(ep(ID.hold).id));
}

async function deleteNow() {
  section('Delete now');
  let r = await call('/api/admin/resolve-deletion', { who: SUB, method: 'POST', body: { type: 'episode', id: ID.now, decision: 'delete_now', reason: 'abuse' } });
  ok('a sub-admin without manage_deletions → 403', r.status === 403, r.status);
  r = await call('/api/admin/resolve-deletion', { who: ADMIN, method: 'POST', body: { type: 'episode', id: ID.now, decision: 'delete_now' } });
  ok('no reason → 400', r.status === 400, `${r.status} ${r.text.slice(0, 200)}`);
  r = await call('/api/admin/resolve-deletion', { who: ADMIN, method: 'POST', body: { type: 'episode', id: ID.nowBought, decision: 'delete_now', reason: `Abuse ${RUN}` } });
  ok('anything bought → 409 bought', r.status === 409 && r.json && r.json.code === 'bought', `${r.status} ${r.text.slice(0, 200)}`);
  r = await call('/api/admin/resolve-deletion', { who: ADMIN, method: 'POST', body: { type: 'episode', id: ID.now, decision: 'delete_now', reason: `Abuse ${RUN}` } });
  ok('a full admin with a reason → 200, deleted', r.status === 200 && rows(`select id from public.episodes where id = ${q(ID.now)}`).length === 0, `${r.status} ${r.text.slice(0, 200)}`);
  ok('…its file recorded, audited delete_episode_now', rows(`select id from public.orphaned_media where reference = ${q(VID.now)}`).length === 1 && rows(`select id from public.audit_log where action = 'delete_episode_now' and target_id = ${q(ID.now)}`).length === 1);
  r = await call('/api/admin/resolve-deletion', { who: ADMIN, method: 'POST', body: { type: 'episode', id: ID.hold, decision: 'delete_now', reason: `Held, now deleted ${RUN}` } });
  ok('a held title deleted now → 200', r.status === 200 && rows(`select id from public.episodes where id = ${q(ID.hold)}`).length === 0, `${r.status} ${r.text.slice(0, 200)}`);
}

async function shows() {
  section('A show: held with everything in it, and brought back');
  let r = await call(`/api/show/${ID.show}/removal`, { who: DEE, method: 'POST', body: { action: 'request', reason: `Done with it ${RUN}` } });
  ok('its owner asks → 200', r.status === 200, `${r.status} ${r.text.slice(0, 200)}`);
  const name = one(`select name from public.series where id = ${q(ID.show)}`).name;
  r = await call(`/api/admin/show/${ID.show}`, { who: ADMIN });
  ok('the admin card: holdReady, "Remove · keep 30 days"', r.status === 200 && r.json.removal && r.json.removal.holdReady === true && r.json.removal.confirmLabel === 'Remove · keep 30 days', r.json && r.json.removal);
  r = await call(`/api/admin/show/${ID.show}`, { who: ADMIN, method: 'POST', body: { action: 'remove', confirmName: name } });
  const s = se(ID.show);
  ok('removing it → 200, mode hold', r.status === 200 && r.json && r.json.mode === 'hold', `${r.status} ${r.text.slice(0, 300)}`);
  ok('…the show withdrawn, files kept ~30 days', Boolean(s.withdrawn_at) && s.purge_after && days(s.purge_after) > 29, s);
  const e1 = ep(ID.showE1);
  const e2 = ep(ID.showE2);
  ok('…its episodes withdrawn at the same moment, held too', e1.withdrawn_at && Date.parse(e1.withdrawn_at) === Date.parse(s.withdrawn_at) && e2.purge_after, { e1, e2 });
  r = await call(`/api/series-hub?id=${ID.show}`, { who: VIEWER });
  ok('…off the site (/api/series-hub → 404)', r.status === 404, r.status);
  r = await call(`/api/show/${ID.show}`, { who: DEE });
  ok('the show page says where it stands and offers Ask to bring it back', r.status === 200 && r.json.show && r.json.show.removal && r.json.show.removal.removed && r.json.show.removal.ask && r.json.show.removal.ask.ok === true, r.json && r.json.show && r.json.show.removal);
  r = await call(`/api/show/episode/${ID.showE1}/restore`, { who: DEE, method: 'POST', body: { action: 'request' } });
  ok('one of its episodes on its own → 409 with-show', r.status === 409 && r.json && r.json.code === 'with-show', `${r.status} ${r.text.slice(0, 200)}`);
  r = await call(`/api/show/${ID.show}/restore`, { who: DEE, method: 'POST', body: { action: 'request', reason: `Back ${RUN}` } });
  ok('the show asked back → 200', r.status === 200, `${r.status} ${r.text.slice(0, 200)}`);
  r = await call('/api/admin/review-queue', { who: ADMIN, method: 'POST', body: { kind: 'restore', id: `series:${ID.show}`, decision: 'approve' } });
  ok('approved → 200, two titles with it', r.status === 200 && r.json && r.json.brought === 3, `${r.status} ${r.text.slice(0, 200)}`);
  ok('…the show and its episodes are back as they were', !se(ID.show).withdrawn_at && se(ID.show).deletion_requested === false && !ep(ID.showE1).withdrawn_at && ep(ID.showE1).deletion_requested === false && !ep(ID.showE2).withdrawn_at, { s: se(ID.show), e1: ep(ID.showE1) });
  r = await call(`/api/series-hub?id=${ID.show}`, { who: VIEWER });
  ok('…/api/series-hub → 200', r.status === 200, r.status);
}

// ---- the review of 2026-11-15 ---------------------------------------------------------------

const full = (id) => one(`select * from public.episodes where id = ${q(id)}`);
const fullShow = (id) => one(`select * from public.series where id = ${q(id)}`);
const same = (a, b) => Boolean(a) && Boolean(b) && Date.parse(a) === Date.parse(b);
const showName = (id) => one(`select name from public.series where id = ${q(id)}`).name;
const showEp = (showId, id, n, extra = {}) => base(id, { content_type: 'series', series_id: showId, season: 1, series_order: n, ...extra });
const ask = (id, reason = `Done ${RUN}`, extra = {}) => call(`/api/show/${id}/removal`, { who: DEE, method: 'POST', body: { action: 'request', reason, ...extra } });
const confirmShow = (id, who = ADMIN, extra = {}) => call(`/api/admin/show/${id}`, { who, method: 'POST', body: { action: 'remove', confirmName: showName(id), ...extra } });
const lastMessage = (userId, type, like) => (rows(`select message from public.notifications where user_id = ${q(userId)} and type = ${q(type)} and message like ${q(`%${like}%`)} order by created_at desc limit 1`)[0] || {}).message || '';
const heldOnItsOwn = (days = 7) => removed(days, { deletion_reason: `My own request ${RUN}`, deletion_requested_at: ago(days + 1), purge_after: new Date(Date.now() + (30 - days) * 86400000).toISOString() });

async function reviewFixes() {
  section('A show removed after one of its titles: held with it, one moment, one deadline');
  insert('series', show(ID.mix));
  insert('episodes', showEp(ID.mix, ID.mixE1, 1));
  insert('episodes', showEp(ID.mix, ID.mixE2, 2));
  insert('episodes', showEp(ID.mix, ID.mixE3, 3, heldOnItsOwn(7)));
  sql(`update public.episodes set restore_requested_at = ${q(ago(0.5))}, restore_reason = 'Back on its own' where id = ${q(ID.mixE3)}`);
  let r = await call(`/api/admin/show/${ID.mix}`, { who: ADMIN });
  ok('the admin card: "Remove · keep 30 days" and Delete now (a held title isn’t bought)', r.status === 200 && r.json.removal.confirmLabel === 'Remove · keep 30 days' && r.json.removal.canDeleteNow === true && r.json.removal.plan && r.json.removal.plan.counts.kept === 0, r.json && r.json.removal);
  r = await ask(ID.mix);
  ok('its owner asks → 200', r.status === 200, `${r.status} ${r.text.slice(0, 200)}`);
  r = await confirmShow(ID.mix);
  let s = fullShow(ID.mix);
  ok('confirmed → 200, mode hold, a deadline (not kept for buyers)', r.status === 200 && r.json.mode === 'hold' && r.json.held && r.json.held.purgeAfter && r.json.withdrawn.episodes === 0, `${r.status} ${r.text.slice(0, 300)}`);
  ok('…the show held ~30 days, not kept for later', Boolean(s.withdrawn_at) && s.purge_after && days(s.purge_after) > 29 && s.keep_after_removal === false, s);
  const e1 = full(ID.mixE1);
  const e3 = full(ID.mixE3);
  ok('…its episodes and the title held on its own share the show’s moment and deadline', same(e1.withdrawn_at, s.withdrawn_at) && same(e3.withdrawn_at, s.withdrawn_at) && same(e3.purge_after, s.purge_after) && same(full(ID.mixE2).purge_after, s.purge_after), { s: [s.withdrawn_at, s.purge_after], e1: [e1.withdrawn_at, e1.purge_after], e3: [e3.withdrawn_at, e3.purge_after] });
  ok('…the title’s own request to come back is closed (the show is asked back instead), its own removal request kept', !e3.restore_requested_at && !same(e3.deletion_requested_at, s.withdrawn_at), e3);
  const msg = lastMessage(USERS.dee, 'show_deleted', ID.mix.slice(6, 22));
  ok('…the owner reads when the files go, never "People who bought it keep it"', /until .* in case you change your mind/.test(msg) && !/People who bought it/.test(msg), msg);
  r = await call(`/api/admin/show/${ID.mix}`, { who: ADMIN });
  ok('…the admin card: held, not kept for buyers', r.status === 200 && r.json.removal.removed && r.json.removal.removed.key === 'held', r.json && r.json.removal && r.json.removal.removed);
  r = await confirmShow(ID.mix);
  ok('…confirming again → 409 with where it stands ("deleted for good on …")', r.status === 409 && /deleted for good on/.test(errOf(r)), `${r.status} ${errOf(r)}`);
  r = await call('/api/admin/resolve-deletion', { who: ADMIN, method: 'POST', body: { type: 'series', id: ID.mix, decision: 'deny' } });
  ok('…the deletion queue’s answer reads the same', r.status === 409 && /deleted for good on/.test(errOf(r)), `${r.status} ${errOf(r)}`);
  r = await call(`/api/show/${ID.mix}/restore`, { who: DEE, method: 'POST', body: { action: 'request' } });
  ok('the show asked back → 200', r.status === 200, `${r.status} ${r.text.slice(0, 200)}`);
  r = await call('/api/admin/review-queue', { who: ADMIN, method: 'POST', body: { kind: 'restore', id: `series:${ID.mix}`, decision: 'approve' } });
  ok('approved → 200, the show and its three titles', r.status === 200 && r.json.brought === 4, `${r.status} ${r.text.slice(0, 200)}`);
  ok('…E1 and E2 live again', !full(ID.mixE1).withdrawn_at && full(ID.mixE1).deletion_requested === false && !full(ID.mixE2).withdrawn_at, { e1: full(ID.mixE1) });
  ok('…the title removed on its own is back off the hold, its own removal request waiting again', !full(ID.mixE3).withdrawn_at && !full(ID.mixE3).purge_after && full(ID.mixE3).deletion_requested === true, full(ID.mixE3));

  section('Two confirmations at once, and a retry after one stopped part-way: one moment');
  insert('series', show(ID.race));
  insert('episodes', showEp(ID.race, ID.raceE1, 1));
  insert('episodes', showEp(ID.race, ID.raceE2, 2));
  await ask(ID.race);
  const both = await Promise.all([confirmShow(ID.race), confirmShow(ID.race)]);
  s = fullShow(ID.race);
  ok('both answer (200, or 409 changed); the show is held once', both.every((x) => x.status === 200 || x.status === 409) && both.some((x) => x.status === 200) && Boolean(s.withdrawn_at) && s.purge_after, both.map((x) => `${x.status} ${x.text.slice(0, 120)}`));
  ok('…every title carries the show’s moment', same(full(ID.raceE1).withdrawn_at, s.withdrawn_at) && same(full(ID.raceE2).withdrawn_at, s.withdrawn_at) && same(full(ID.raceE2).purge_after, s.purge_after), { s: s.withdrawn_at, e1: full(ID.raceE1).withdrawn_at, e2: full(ID.raceE2).withdrawn_at });
  ok('…the owner was told once', rows(`select id from public.notifications where user_id = ${q(USERS.dee)} and type = 'show_deleted' and message like ${q(`%${ID.race.slice(6, 22)}%`)}`).length === 1);
  insert('series', show(ID.retry));
  insert('episodes', showEp(ID.retry, ID.retryE1, 1));
  insert('episodes', showEp(ID.retry, ID.retryE2, 2));
  await ask(ID.retry);
  // An earlier try took E1 off, then stopped before the show.
  const earlier = ago(0.02);
  sql(`update public.episodes set withdrawn_at = ${q(earlier)}, deletion_requested = true, deletion_reason = 'Done', deletion_requested_at = ${q(earlier)}, purge_after = ${q(new Date(Date.parse(earlier) + 30 * 86400000).toISOString())} where id = ${q(ID.retryE1)}`);
  r = await confirmShow(ID.retry);
  s = fullShow(ID.retry);
  ok('the retry → 200, held with a deadline (the row it took off isn’t "kept for buyers")', r.status === 200 && r.json.mode === 'hold' && s.purge_after && r.json.withdrawn.episodes === 0, `${r.status} ${r.text.slice(0, 300)}`);
  ok('…both titles carry the show’s moment and deadline', same(full(ID.retryE1).withdrawn_at, s.withdrawn_at) && same(full(ID.retryE1).purge_after, s.purge_after) && same(full(ID.retryE2).withdrawn_at, s.withdrawn_at), { s: s.withdrawn_at, e1: full(ID.retryE1).withdrawn_at });
  await call(`/api/show/${ID.retry}/restore`, { who: DEE, method: 'POST', body: { action: 'request' } });
  r = await call('/api/admin/review-queue', { who: ADMIN, method: 'POST', body: { kind: 'restore', id: `series:${ID.retry}`, decision: 'approve' } });
  ok('…brought back together, both live', r.status === 200 && r.json.brought === 3 && !full(ID.retryE1).withdrawn_at && full(ID.retryE1).deletion_requested === false, `${r.status} ${r.text.slice(0, 200)}`);

  section('A held show’s extras stay where they were filed');
  insert('series', show(ID.extraShow));
  insert('episodes', showEp(ID.extraShow, ID.extraShowE1, 1));
  insert('episodes', base(ID.extraShowX, { content_type: 'bonus', bonus_parent_type: 'episode', bonus_parent_id: ID.extraShowE1 }));
  await ask(ID.extraShow);
  r = await confirmShow(ID.extraShow);
  const x = full(ID.extraShowX);
  ok('held → 200; the extra still hangs after its episode, off the site with the show', r.status === 200 && x.bonus_parent_type === 'episode' && x.bonus_parent_id === ID.extraShowE1 && same(x.withdrawn_at, fullShow(ID.extraShow).withdrawn_at), x);

  section('"Delete now" on a show with a held title deletes the show');
  insert('series', show(ID.nowShow));
  insert('episodes', showEp(ID.nowShow, ID.nowShowE1, 1));
  insert('episodes', showEp(ID.nowShow, ID.nowShowE2, 2, heldOnItsOwn(3)));
  r = await confirmShow(ID.nowShow, ADMIN, { now: true, reason: `Abuse ${RUN}` });
  ok('→ 200; the show and both titles are gone', r.status === 200 && !fullShow(ID.nowShow).id && !full(ID.nowShowE1).id && !full(ID.nowShowE2).id, `${r.status} ${r.text.slice(0, 300)}`);

  section('"Keep the files" goes with the request it was asked with');
  insert('series', show(ID.keepShow));
  insert('episodes', showEp(ID.keepShow, ID.keepShowE1, 1));
  r = await ask(ID.keepShow, `Keep them ${RUN}`, { keep: true });
  ok('asked with "keep the files" → keep_after_removal true', r.status === 200 && fullShow(ID.keepShow).keep_after_removal === true, `${r.status} ${r.text.slice(0, 200)}`);
  r = await call(`/api/admin/show/${ID.keepShow}`, { who: ADMIN, method: 'POST', body: { action: 'deny_removal', note: 'Keeping it up' } });
  ok('the team denies it → keep_after_removal cleared', r.status === 200 && fullShow(ID.keepShow).keep_after_removal === false && fullShow(ID.keepShow).deletion_requested === false, `${r.status} ${r.text.slice(0, 200)}`);
  sql(`update public.series set keep_after_removal = true where id = ${q(ID.keepShow)}`);
  r = await call(`/api/admin/show/${ID.keepShow}`, { who: ADMIN });
  ok('…a leftover "keep" on a show nobody asked to remove: the card still reads "Remove · keep 30 days"', r.status === 200 && r.json.removal.confirmLabel === 'Remove · keep 30 days', r.json && r.json.removal && r.json.removal.confirmLabel);
  r = await confirmShow(ID.keepShow, ADMIN, { reason: `Abuse ${RUN}` });
  s = fullShow(ID.keepShow);
  ok('the team removes it → held 30 days, never kept for later', r.status === 200 && s.purge_after && s.keep_after_removal === false && full(ID.keepShowE1).purge_after && full(ID.keepShowE1).keep_after_removal === false, { status: r.status, s });

  section('A contributor can’t approve their show’s return');
  insert('series', show(ID.contrib));
  insert('episodes', showEp(ID.contrib, ID.contribE1, 1));
  insert('episodes', showEp(ID.contrib, ID.contribE2, 2, { submitted_by: USERS.sub, artist: 'Sam Subadmin' }));
  await ask(ID.contrib);
  await confirmShow(ID.contrib);
  await call(`/api/show/${ID.contrib}/restore`, { who: DEE, method: 'POST', body: { action: 'request' } });
  r = await call('/api/admin/review-queue', { who: SUB });
  const item = ((r.json && r.json.items) || []).find((i) => i.id === `series:${ID.contrib}`);
  ok('the queue greys Approve for the reviewer whose episode is in it', item && item.meta && item.meta.blocked, item && item.meta);
  r = await call('/api/admin/review-queue', { who: SUB, method: 'POST', body: { kind: 'restore', id: `series:${ID.contrib}`, decision: 'approve' } });
  ok('…their approval → 403 own-work, the show still removed', r.status === 403 && Boolean(fullShow(ID.contrib).withdrawn_at), `${r.status} ${r.text.slice(0, 200)}`);
  r = await call('/api/admin/review-queue', { who: ADMIN, method: 'POST', body: { kind: 'restore', id: `series:${ID.contrib}`, decision: 'approve' } });
  ok('…a full admin approves it', r.status === 200 && !fullShow(ID.contrib).withdrawn_at, `${r.status} ${r.text.slice(0, 200)}`);

  section('A title whose availability window ended comes back without one');
  insert('episodes', base(ID.window, removed(2, { deletion_reason: 'Availability window ended', available_until: ago(3), purge_after: new Date(Date.now() + 25 * 86400000).toISOString() })));
  r = await call(`/api/show/episode/${ID.window}/restore`, { who: DEE, method: 'POST', body: { action: 'request' } });
  ok('its owner asks → 200', r.status === 200, `${r.status} ${r.text.slice(0, 200)}`);
  r = await call('/api/admin/review-queue', { who: ADMIN });
  const w = ((r.json && r.json.items) || []).find((i) => i.id === `episode:${ID.window}`);
  ok('the queue card says its window ended and it comes back without one', w && /availability window ended/.test(w.subtitle) && /no end date/.test(w.meta.comesBackAs), w && [w.subtitle, w.meta && w.meta.comesBackAs]);
  r = await call('/api/admin/review-queue', { who: ADMIN, method: 'POST', body: { kind: 'restore', id: `episode:${ID.window}`, decision: 'approve' } });
  ok('approved → back, its window cleared', r.status === 200 && !full(ID.window).withdrawn_at && full(ID.window).available_until === null, full(ID.window));
  r = await call(`/api/episode-page?id=${ID.window}`, { who: MARA });
  ok('…on the site again (/api/episode-page → 200)', r.status === 200, r.status);

  section('Past its hold: it can’t be asked back');
  insert('episodes', base(ID.due, removed(31, { purge_after: ago(0.5) })));
  r = await call(`/api/show/episode/${ID.due}/restore`, { who: DEE, method: 'POST', body: { action: 'request' } });
  ok('→ 409 due, nothing asked', r.status === 409 && r.json && r.json.code === 'due' && !full(ID.due).restore_requested_at, `${r.status} ${r.text.slice(0, 200)}`);

  section('The clean-up: a show deleted with what it held; titles behind fifty left to their show');
  insert('series', show(ID.mixP));
  insert('episodes', showEp(ID.mixP, ID.mixPE1, 1));
  insert('episodes', showEp(ID.mixP, ID.mixPE2, 2, heldOnItsOwn(10)));
  await ask(ID.mixP);
  r = await confirmShow(ID.mixP);
  ok('a show with a title held on its own is held → 200', r.status === 200 && fullShow(ID.mixP).purge_after, `${r.status} ${r.text.slice(0, 200)}`);
  sql(`update public.series set purge_after = ${q(ago(0.2))} where id = ${q(ID.mixP)}`);
  sql(`update public.episodes set purge_after = ${q(ago(0.2))} where id in (${q(ID.mixPE1)}, ${q(ID.mixPE2)})`);
  // A show asked back with fifty-five titles past their date, left to it,
  // and one title of its own behind them in line.
  insert('series', show(ID.asked, removed(31, { purge_after: ago(1), restore_requested_at: ago(0.5) })));
  const askedAt = fullShow(ID.asked).withdrawn_at;
  sql(`insert into public.episodes (id, title, description, tier, genre, main_genre, content_type, series_id, season, series_order, artist, runtime, rating, release_year, src, video_type, video_provider, ads_enabled, deletion_requested, deletion_reason, deletion_requested_at, withdrawn_at, purge_after, moderation_hold, submitted_by, status, reviewed_at, released_at, created_at)
    select id, 'Check rh many ' || ${q(RUN)}, 'Held with its show.', 'free', 'Drama', 'Drama', 'series', ${q(ID.asked)}, 1, n::int, 'Dee Park', '14:00', 'TV-PG', 2026, ${q(cf(uidFor(IDS.short)))}, 'html5', 'cloudflare', false, true, 'Removed with its show', ${q(askedAt)}, ${q(askedAt)}, ${q(ago(2))}, false, ${q(USERS.dee)}, 'approved', ${q(ago(39))}, ${q(ago(39))}, ${q(ago(40))}
    from unnest(array[${MANY.map(q).join(', ')}]::text[]) with ordinality as m(id, n)`);
  insert('episodes', base(ID.lonely, removed(31, { purge_after: ago(1) })));
  r = await runCron();
  ok('the cron runs → 200', r.status === 200 && r.json.purged && r.json.purged.ready === true, `${r.status} ${r.text.slice(0, 300)}`);
  ok('the held show went with both its titles, the one held on its own too', !fullShow(ID.mixP).id && !full(ID.mixPE1).id && !full(ID.mixPE2).id, { s: fullShow(ID.mixP), e2: full(ID.mixPE2) });
  ok('the title behind the fifty-five left to their show was deleted', !full(ID.lonely).id && r.json.purged.leftToShow >= 55, r.json.purged);
  ok('…the fifty-five are still there, waiting on their show', rows(`select id from public.episodes where id like ${q(`ck-rh-many-%-${RUN}`)}`).length === 55);
}

await runCheck('removal-hold', async () => {
  cleanup();
  try {
    if (!hasColumn('episodes', 'purge_after')) {
      await before124();
      return;
    }
    seed();
    await requests();
    await confirming();
    await askingBack();
    await cleanUp();
    await deleteNow();
    await shows();
    await reviewFixes();
  } finally {
    cleanup();
  }
});
