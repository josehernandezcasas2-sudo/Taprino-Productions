// SERVER-ONLY. Downloads in the app (Jose, 2026-11-14: "if they have
// something downloaded, and they are offline, they can still view it as
// long as they have the subscription, once the month is over and if they
// haven't connected, make sure they have to connect back"; Premium and
// Sponsor, plus anyone who bought the title; contract
// mockups/app-downloads-contract.md, migration 123).
//
// The rules are lib/downloadRules.js (the app's copy is that file word for
// word) and lib/downloadSiteRules.js (the server's and website's own);
// this file reads and writes: the admin switch and its lock, who may
// start a download and the link they get, the check-in that renews, ends
// or takes back the copies on a phone, the phones themselves, and the
// numbers on Admin → Downloads. Pages import only the two rules files.
//
// What it never does on a guess: a check-in that can't read the plan
// (Stripe or Clerk didn't answer), the purchases or the titles answers
// 5xx and changes nothing — a copy is never ended or taken back because a
// read failed. A switch that can't be read counts as off for a new
// download.
import { getSupabase } from './supabase';
import { internalError } from './apiErrors';
import { getSecurityRow, readSecurityRowFresh, forgetSecuritySwitches } from './securitySwitches';
import { getPromoAccessExpiry } from './promoCodes';
import { playbackGate } from './playbackGate';
import { findSeries } from './series';
import { seriesHidden } from './seriesVisibility';
import { cloudflareUidFromUrl, enableSignedUrlsForVideo, ensureCloudflareDownloadUrl, createCloudflareDownloadToken, cloudflareSignedDownloadUrl } from './cloudflareUpload';
import { parseRuntimeToSeconds } from './videoMetadata';
import { recordAudit } from './auditLog';
import { securityAlert } from './securityAlerts';
import { checkRateLimit } from './rateLimit';
import {
  DOWNLOAD_WORDS, LINK_SECONDS, downloadOffer, downloadableKind, keepUntil, planCarriesDownloads, syncVerdict
} from './downloadRules';
import {
  LIMITS, MIGRATION_123_MSG, START_WORDS, copyLicensedUntil, downloadKicker, frees, isoOrNull, startLimits, startRefusal,
  switchAuditDetails, switchChange, switchHistory, switchWords
} from './downloadSiteRules';

// An answer the routes send as it is: a status, a line for the person and
// the extra fields the app matches on ({ code, … }).
export class DownloadError extends Error {
  constructor(message, status = 400, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra || {};
  }
}

const TRY_LATER = 'Downloads can’t be reached right now. Try again in a minute.';
const needsMigration = () => new DownloadError(MIGRATION_123_MSG, 503, { code: 'migration-123' });
const unavailable = () => new DownloadError(TRY_LATER, 503, { code: 'unavailable' });

const hasKey = (row, key) => Boolean(row) && Object.prototype.hasOwnProperty.call(row, key);
function isMissing(error) {
  if (!error) return false;
  const msg = String(error.message || '');
  return error.code === '42P01' || error.code === 'PGRST205' || error.code === '42703' || error.code === 'PGRST204'
    || /relation .* does not exist|could not find the table|column .* does not exist|could not find the '.*' column/i.test(msg);
}
// A database error on one of migration 123's tables: "not set up yet" when
// the table or column is missing, otherwise an internal error (logged by
// the route, never echoed).
function dbError(error, context) {
  return isMissing(error) ? needsMigration() : internalError(error, `downloads ${context}`);
}

/* ---- the switch ---- */

// The admin switch as it stands: { known, available, enabled, locked }.
// `known` false = the settings couldn't be read (counts as off);
// `available` false = the database has no such column yet (migration
// 123). Read through lib/securitySwitches.js's copy of the settings row
// (half a minute old at most), or fresh.
export async function getDownloadsSwitch({ fresh = false } = {}) {
  let row = null;
  let ok = true;
  try {
    if (fresh) ({ row, ok } = await readSecurityRowFresh());
    else row = await getSecurityRow();
  } catch (err) {
    console.error('downloads switch:', err && err.message);
    row = null;
  }
  const known = ok !== false && row !== null && row !== undefined;
  const available = known && hasKey(row, 'downloads_enabled');
  return { known, available, enabled: available && row.downloads_enabled === true, locked: available && row.downloads_locked === true };
}

function requireReady(sw) {
  if (!sw.known) throw unavailable();
  if (!sw.available) throw needsMigration();
}

/* ---- the plan ---- */

// What the account's plan means for downloads: whether it carries them,
// the end of the paid month (milliseconds; null for the team, a comped
// account and a promo), a promo's end when that is what carries it, and
// whether any of it could be read (`known` false = Stripe or Clerk didn't
// answer and nothing else carries the plan).
export async function downloadPlan(account) {
  const a = account || {};
  const team = a.isAdmin === true || a.isSubAdmin === true;
  const privileged = team || a.isComped === true;
  const tier = a.tier || 'basic';
  const carries = planCarriesDownloads({ tier, isAdmin: a.isAdmin === true });
  const paidThrough = privileged ? null : (Number(a.paidThrough) > 0 ? Number(a.paidThrough) : null);
  let promoEnd = null;
  if (carries && !privileged && paidThrough === null && a.userId) {
    const promo = await getPromoAccessExpiry(a.userId).catch(() => null);
    const at = promo ? Date.parse(promo) : NaN;
    promoEnd = Number.isFinite(at) ? at : null;
  }
  return { known: carries || a.billingKnown !== false, carries, tier, paidThrough, promoEnd };
}

/* ---- titles ---- */

export function isDownloadable(episode) {
  return Boolean(episode) && Boolean(cloudflareUidFromUrl(episode.src || '')) && downloadableKind(episode.contentType);
}

// The Download button for this viewer on this title, for the episode
// payloads (/api/episode-page and the website's page props): { state,
// reason?, basis? } from lib/downloadRules.js downloadOffer; hidden in a
// preview. Never throws.
export async function downloadOfferFor({ episode, account, owned = false, previewing = false }) {
  if (previewing) return { state: 'hidden', reason: 'preview' };
  try {
    const sw = await getDownloadsSwitch();
    const a = account || {};
    return downloadOffer({
      enabled: sw.enabled,
      downloadable: isDownloadable(episode),
      allowed: episode ? episode.downloadsAllowed : true,
      signedIn: a.isSignedIn === true,
      tier: a.tier || 'basic',
      isAdmin: a.isAdmin === true,
      owned: owned === true
    });
  } catch (err) {
    console.error('downloadOfferFor:', err && err.message);
    return { state: 'hidden', reason: 'off' };
  }
}

// What this account bought, read strictly (a failed read throws: a bought
// copy is never taken back because the purchases couldn't be read).
async function readOwnership(userId) {
  const out = { episodeIds: new Set(), seriesIds: new Set() };
  const { data, error } = await getSupabase().from('purchases').select('target_type, target_id').eq('buyer_id', userId).eq('status', 'completed');
  if (error) {
    // No purchases table at all: nobody owns anything.
    if (error.code === '42P01' || error.code === 'PGRST205') return out;
    throw internalError(error, 'downloads ownership');
  }
  for (const p of data || []) (p.target_type === 'episode' ? out.episodeIds : out.seriesIds).add(p.target_id);
  return out;
}

const hidesForOwner = (row) => Boolean(row) && (row.moderation_hold === true || row.status === 'rejected');
const past = (iso, now) => Boolean(iso) && Date.parse(iso) <= now;

// Whether each title is still fine to keep on a phone, read strictly and
// in one go (the rules of lib/episodes.js: findEpisode for everyone,
// findEpisodeForOwner for someone who bought it). → Map(id → { seriesId,
// allowed, open, openForOwner }): `open` = public now (approved, not
// held, not on its way out, not withdrawn, inside its window, its show —
// and for an extra what it hangs on — public and not held); `openForOwner`
// = a creator-side takedown doesn't count, a hold or a rejection does.
async function readTitleStates(ids, now) {
  const out = new Map();
  if (!ids.length) return out;
  const supabase = getSupabase();
  const { data: eps, error } = await supabase
    .from('episodes')
    .select('id, status, moderation_hold, deletion_requested, available_until, withdrawn_at, series_id, content_type, bonus_parent_type, bonus_parent_id, downloads_allowed')
    .in('id', ids);
  if (error) throw dbError(error, 'titles');
  const rows = eps || [];
  const extra = (r) => (r.content_type === 'bonus' && r.bonus_parent_id && (r.bonus_parent_type === 'series' || r.bonus_parent_type === 'episode') ? { type: r.bonus_parent_type, id: String(r.bonus_parent_id) } : null);

  const parentIds = [...new Set(rows.map(extra).filter((x) => x && x.type === 'episode').map((x) => x.id))];
  const parents = new Map();
  if (parentIds.length) {
    const { data, error: e2 } = await supabase.from('episodes').select('id, series_id, status, deletion_requested, moderation_hold, available_until').in('id', parentIds);
    if (e2) throw internalError(e2, 'downloads parent titles');
    for (const p of data || []) parents.set(p.id, p);
  }
  const showIds = [...new Set([
    ...rows.map((r) => r.series_id),
    ...rows.map(extra).filter((x) => x && x.type === 'series').map((x) => x.id),
    ...[...parents.values()].map((p) => p.series_id)
  ].filter(Boolean).map(String))];
  const shows = new Map();
  if (showIds.length) {
    const { data, error: e3 } = await supabase.from('series').select('id, status, moderation_hold, deletion_requested').in('id', showIds);
    if (e3) throw internalError(e3, 'downloads shows');
    for (const s of data || []) shows.set(s.id, s);
  }

  for (const r of rows) {
    const show = r.series_id ? shows.get(String(r.series_id)) || null : null;
    let open = r.status === 'approved' && !r.deletion_requested && !r.moderation_hold && !r.withdrawn_at && !past(r.available_until, now) && !seriesHidden(show);
    let openForOwner = r.status === 'approved' && !r.moderation_hold && !hidesForOwner(show);
    const ref = extra(r);
    if (ref && ref.type === 'series') {
      const up = shows.get(ref.id) || null;
      if (seriesHidden(up)) open = false;
      if (hidesForOwner(up)) openForOwner = false;
    } else if (ref) {
      const p = parents.get(ref.id) || null;
      const up = p && p.series_id ? shows.get(String(p.series_id)) || null : null;
      if (!p || p.status !== 'approved' || p.deletion_requested || p.moderation_hold || past(p.available_until, now) || seriesHidden(up)) open = false;
      if (hidesForOwner(p) || hidesForOwner(up)) openForOwner = false;
    }
    out.set(r.id, { seriesId: r.series_id || null, allowed: r.downloads_allowed !== false, open, openForOwner });
  }
  return out;
}

/* ---- phones and copies ---- */

const toDevice = (d) => ({ deviceId: d.device_id, name: d.name ?? null, platform: d.platform ?? null, lastSeenAt: isoOrNull(d.last_seen_at), removedAt: isoOrNull(d.removed_at) });

// The account's phones (every row, removed ones too) and its live copies.
async function readAccountDownloads(userId) {
  const supabase = getSupabase();
  const [devices, copies] = await Promise.all([
    supabase.from('download_devices').select('device_id, name, platform, last_seen_at, removed_at').eq('user_id', userId),
    supabase.from('downloads').select('id, device_id, episode_id, basis, licensed_until, ended_at, created_at, renewed_at').eq('user_id', userId).eq('status', 'active')
  ]);
  if (devices.error) throw dbError(devices.error, 'phones');
  if (copies.error) throw dbError(copies.error, 'copies');
  return { devices: devices.data || [], copies: copies.data || [] };
}

// The phones as the lists show them: the ones holding a copy (and the one
// asking, once it has downloaded), most recently online first.
// [{ deviceId, name, platform, lastSeenAt, count, current }]
function phoneList({ devices, copies }, currentDeviceId = null) {
  const counts = new Map();
  for (const c of copies) counts.set(c.device_id, (counts.get(c.device_id) || 0) + 1);
  return devices
    .filter((d) => !d.removed_at && ((counts.get(d.device_id) || 0) > 0 || d.device_id === currentDeviceId))
    .sort((a, b) => String(b.last_seen_at || '').localeCompare(String(a.last_seen_at || '')))
    .map((d) => ({ deviceId: d.device_id, name: d.name ?? null, platform: d.platform ?? null, lastSeenAt: isoOrNull(d.last_seen_at), count: counts.get(d.device_id) || 0, current: d.device_id === currentDeviceId }));
}

// GET /api/downloads?deviceId=
export async function getDownloads(account, deviceId = null) {
  const sw = await getDownloadsSwitch();
  requireReady(sw);
  const [plan, data] = await Promise.all([downloadPlan(account), readAccountDownloads(account.userId)]);
  return {
    enabled: sw.enabled,
    plan: { carries: plan.carries, tier: plan.tier },
    limits: LIMITS,
    devices: phoneList(data, deviceId),
    items: deviceId
      ? data.copies.filter((c) => c.device_id === deviceId).map((c) => ({ episodeId: c.episode_id, basis: c.basis, licensedUntil: isoOrNull(c.licensed_until), endedAt: isoOrNull(c.ended_at) }))
      : []
  };
}

// GET /api/downloads/devices
export async function listPhones(account) {
  const sw = await getDownloadsSwitch();
  requireReady(sw);
  return phoneList(await readAccountDownloads(account.userId));
}

// The website's /downloads page: never throws (a database without 123, or
// one that can't be reached, shows the page without the list).
export async function getDownloadsPage(account) {
  const sw = await getDownloadsSwitch();
  if (!sw.available || !account || !account.isSignedIn) return { enabled: sw.enabled, ready: sw.available, phones: [] };
  try {
    return { enabled: sw.enabled, ready: true, phones: phoneList(await readAccountDownloads(account.userId)) };
  } catch (err) {
    console.error('downloads page:', err && err.message);
    return { enabled: sw.enabled, ready: false, phones: [] };
  }
}

// POST /api/downloads/devices { remove }: the phone leaves the list and
// its copies are taken back (that phone hears `deviceRemoved` at its next
// check-in). Removing one that isn't there changes nothing.
export async function removePhone(account, deviceId) {
  const sw = await getDownloadsSwitch();
  requireReady(sw);
  const supabase = getSupabase();
  const now = new Date().toISOString();
  const gone = await supabase.from('download_devices').update({ removed_at: now }).eq('user_id', account.userId).eq('device_id', deviceId).is('removed_at', null);
  if (gone.error) throw dbError(gone.error, 'remove phone');
  const copies = await supabase.from('downloads').update({ status: 'revoked', revoke_reason: 'device', removed_at: now }).eq('user_id', account.userId).eq('device_id', deviceId).eq('status', 'active');
  if (copies.error) throw dbError(copies.error, 'remove phone copies');
  return phoneList(await readAccountDownloads(account.userId));
}

// POST /api/downloads/remove { deviceId, episodeId }: the phone deleted
// its copy; the slot is free.
export async function removeCopy(account, { deviceId, episodeId }) {
  const sw = await getDownloadsSwitch();
  requireReady(sw);
  const { error } = await getSupabase().from('downloads')
    .update({ status: 'removed', removed_at: new Date().toISOString() })
    .eq('user_id', account.userId).eq('device_id', deviceId).eq('episode_id', episodeId).eq('status', 'active');
  if (error) throw dbError(error, 'remove copy');
  return { ok: true };
}

/* ---- starting a download ---- */

// A title's MP4 is only ever made, or handed out, for a video that plays
// through signed links alone: with its download made, an unprotected
// video's whole file would sit at an address anyone holding its uid could
// fetch (and the uid can be read out of any playback token). Approved
// titles are protected already (lib/streamProtection.js); this makes sure,
// once per video per server instance, and a refusal stops the download.
const protectedUids = new Set();
async function ensureProtected(uid) {
  if (protectedUids.has(uid)) return;
  await enableSignedUrlsForVideo(uid);
  if (protectedUids.size >= 2000) protectedUids.delete(protectedUids.values().next().value);
  protectedUids.add(uid);
}

// At most this many NEW copies an hour per account. Asking again for a
// title the phone already holds (while Cloudflare makes the file, after
// the app restarts, when a link is about to run out, after a failed
// transfer) never counts against it: the route as a whole has its own,
// much higher ceiling (pages/api/downloads/start.js).
export const NEW_COPIES_PER_HOUR = 60;

// POST /api/downloads/start. `req` is asked who they are by the playback
// gate (lib/playbackGate.js: the same answers playback gives), then the
// download rules, the two limits, Cloudflare, and only then a link.
// Asking again for a title this phone already holds is the same call: it
// never meets either limit, and answers a fresh link and a renewed date.
// → { status: 200, body: { ready: true, url, … } } or { status: 202,
// body: { ready: false, percent } }; refusals are DownloadErrors.
export async function startDownload(req, { episodeId, deviceId, deviceName = null, platform = null }) {
  const sw = await getDownloadsSwitch();
  requireReady(sw);

  const gate = await playbackGate(req, episodeId);
  if (gate.denied) {
    const { error, ...rest } = gate.denied.body || {};
    throw new DownloadError(error || 'Not available.', gate.denied.status, rest);
  }
  const { episode, account } = gate;
  const owned = gate.owned === true;
  const userId = account.userId;
  if (!userId) throw new DownloadError(DOWNLOAD_WORDS.signIn, 401, { code: 'signin' });

  const plan = await downloadPlan(account);
  const uid = cloudflareUidFromUrl(episode.src || '');
  const offer = downloadOffer({
    enabled: sw.enabled,
    downloadable: Boolean(uid) && downloadableKind(episode.contentType),
    allowed: episode.downloadsAllowed,
    signedIn: true,
    tier: plan.tier,
    isAdmin: account.isAdmin === true,
    owned
  });
  // "Downloads come with Premium" is never said on a guess.
  if (offer.state === 'plan' && !plan.known) throw unavailable();
  const refusal = startRefusal(offer);
  if (refusal) throw new DownloadError(refusal.error, refusal.status, { code: refusal.code });
  const basis = offer.basis;

  const data = await readAccountDownloads(userId);
  const limit = startLimits({
    deviceId,
    episodeId: episode.id,
    devices: data.devices.map(toDevice),
    copies: data.copies.map((c) => ({ deviceId: c.device_id, episodeId: c.episode_id }))
  });
  if (!limit.ok) {
    if (limit.code === 'devices') throw new DownloadError(DOWNLOAD_WORDS.deviceLimit, 409, { code: 'devices', devices: phoneList(data, deviceId).filter((d) => !d.current) });
    throw new DownloadError(DOWNLOAD_WORDS.titleLimit, 409, { code: 'titles' });
  }

  // Cloudflare makes the MP4 once per video; until it has, the app asks again.
  let file;
  try {
    await ensureProtected(uid);
    file = await ensureCloudflareDownloadUrl(uid);
  } catch (err) {
    console.error('downloads start (Cloudflare file):', err && err.message);
    throw new DownloadError(START_WORDS.cloudflare, 503, { code: 'cloudflare' });
  }
  if (!(file && file.status === 'ready' && file.url)) {
    const percent = Number(file && file.percentComplete);
    return { status: 202, body: { ready: false, percent: Number.isFinite(percent) ? Math.max(0, Math.min(100, Math.round(percent))) : 0 } };
  }

  if (!limit.again && !(await checkRateLimit(`downloads-new:${userId}`, NEW_COPIES_PER_HOUR, 3600))) {
    throw new DownloadError('That’s a lot of downloads in a row — give it a little while.', 429, { code: 'rate' });
  }
  let link;
  try {
    const { token, expiresAt } = await createCloudflareDownloadToken(uid, { expiresInSeconds: LINK_SECONDS });
    link = { url: cloudflareSignedDownloadUrl(token), expiresAt };
  } catch (err) {
    console.error('downloads start (Cloudflare token):', err && err.message);
    link = null;
  }
  if (!link || !link.url) throw new DownloadError(START_WORDS.cloudflare, 503, { code: 'cloudflare' });

  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const until = new Date(copyLicensedUntil({ basis, now, paidThrough: plan.paidThrough, promoEnd: plan.promoEnd })).toISOString();
  const supabase = getSupabase();
  const known = data.devices.find((d) => d.device_id === deviceId) || null;
  // The phone: every column without a default is sent (an upsert is
  // checked as an insert first), on the (user_id, device_id) pair.
  const phone = await supabase.from('download_devices').upsert({
    user_id: userId,
    device_id: deviceId,
    name: deviceName || (known ? known.name : null) || null,
    platform: platform || (known ? known.platform : null) || null,
    last_seen_at: nowIso,
    removed_at: null
  }, { onConflict: 'user_id,device_id' });
  if (phone.error) throw dbError(phone.error, 'start phone');

  // The copy: one live row per phone and title. A second start for a
  // title the phone already holds (a link that ran out) renews that row.
  const licence = { basis, licensed_until: until, renewed_at: nowIso, ended_at: null };
  const renew = () => supabase.from('downloads').update(licence).eq('user_id', userId).eq('device_id', deviceId).eq('episode_id', episode.id).eq('status', 'active');
  if (limit.again) {
    const { error } = await renew();
    if (error) throw dbError(error, 'start renew');
  } else {
    const { error } = await supabase.from('downloads').insert({ user_id: userId, device_id: deviceId, episode_id: episode.id, status: 'active', ...licence });
    if (error && error.code === '23505') {
      // Two starts at once: the other one made the row.
      const again = await renew();
      if (again.error) throw dbError(again.error, 'start renew');
    } else if (error) {
      throw dbError(error, 'start copy');
    }
  }

  const show = episode.seriesId ? await findSeries(episode.seriesId).catch(() => null) : null;
  return {
    status: 200,
    body: {
      ready: true,
      url: link.url,
      expiresAt: isoOrNull(link.expiresAt * 1000),
      basis,
      licensedUntil: until,
      paidThrough: isoOrNull(plan.paidThrough),
      item: {
        episodeId: episode.id,
        title: episode.title ?? null,
        kicker: downloadKicker(episode, show ? show.name : null),
        seriesId: episode.seriesId ?? null,
        seriesName: show ? show.name ?? null : null,
        season: episode.seriesId ? episode.season || 1 : null,
        number: episode.seriesOrder ?? null,
        contentType: episode.contentType ?? null,
        runtimeSeconds: parseRuntimeToSeconds(episode.runtime),
        rating: episode.rating ?? null,
        art: episode.thumbnail || episode.poster || null,
        hasCaptions: Boolean(episode.captionsUrl),
        // The photosensitivity warning shows before an offline play too.
        hasFlashingLights: episode.hasFlashingLights === true
      }
    }
  };
}

/* ---- the check-in ---- */

const syncItem = (episodeId, state, { basis = null, licensedUntil: until = null, endedAt = null, reason = null } = {}) => ({
  episodeId,
  state,
  basis,
  licensedUntil: isoOrNull(until),
  endedAt: isoOrNull(endedAt),
  keepUntil: isoOrNull(keepUntil(endedAt)),
  reason
});

// POST /api/downloads/sync { deviceId, deviceName, platform, have }: the
// phone says which titles it holds; each one is licensed again, left as
// it is (the switch is off), marked ended (the plan no longer carries
// downloads; the file stays until keepUntil) or taken back.
// → { enabled, serverTime, paidThrough, plan, limits, items, deviceRemoved }
export async function syncDownloads(account, { deviceId, deviceName = null, platform = null, have = [] }) {
  const sw = await getDownloadsSwitch();
  requireReady(sw);
  const userId = account.userId;
  const supabase = getSupabase();
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const plan = await downloadPlan(account);
  const base = {
    enabled: sw.enabled,
    serverTime: nowIso,
    paidThrough: isoOrNull(plan.paidThrough),
    plan: { carries: plan.carries, tier: plan.tier },
    limits: LIMITS
  };

  const { data: deviceRows, error: deviceError } = await supabase.from('download_devices').select('device_id, name, platform, removed_at').eq('user_id', userId).eq('device_id', deviceId).limit(1);
  if (deviceError) throw dbError(deviceError, 'sync phone');
  const device = (deviceRows || [])[0] || null;

  // Taken off the list from the website or another phone: everything on
  // it goes, whatever the plan says.
  if (device && device.removed_at) {
    const { error } = await supabase.from('downloads').update({ status: 'revoked', revoke_reason: 'device', removed_at: nowIso }).eq('user_id', userId).eq('device_id', deviceId).eq('status', 'active');
    if (error) throw dbError(error, 'sync removed phone');
    return { ...base, items: have.map((id) => syncItem(id, 'revoked', { reason: 'device' })), deviceRemoved: true };
  }

  const { data: active, error: activeError } = await supabase
    .from('downloads')
    .select('id, episode_id, basis, licensed_until, ended_at, created_at, renewed_at')
    .eq('user_id', userId).eq('device_id', deviceId).eq('status', 'active');
  if (activeError) throw dbError(activeError, 'sync copies');
  const rows = active || [];
  const byEpisode = new Map(rows.map((r) => [r.episode_id, r]));
  const held = have.filter((id) => byEpisode.has(id)).map((id) => byEpisode.get(id));
  const orphans = have.filter((id) => !byEpisode.has(id));
  const haveSet = new Set(have);
  // Not listed: the slot is free (lib/downloadSiteRules.js frees — at once
  // when the phone lists nothing at all; a copy licensed a moment ago is
  // spared while it lists others).
  const dropped = rows.filter((r) => !haveSet.has(r.episode_id) && frees({ renewedAt: r.renewed_at, createdAt: r.created_at, now, listed: have.length }));

  // Nothing is decided about a copy on a guess.
  if (held.length > 0 && !plan.known) throw unavailable();
  const [titles, ownership] = held.length > 0
    ? await Promise.all([readTitleStates(held.map((r) => r.episode_id), now), readOwnership(userId)])
    : [new Map(), { episodeIds: new Set(), seriesIds: new Set() }];

  const verdicts = new Map();
  const renewals = new Map(); // `${basis}|${until}` → [row ids]
  const ending = [];
  const revoking = new Map(); // reason → [row ids]
  for (const r of held) {
    const t = titles.get(r.episode_id) || null;
    const owned = ownership.episodeIds.has(r.episode_id) || Boolean(t && t.seriesId && ownership.seriesIds.has(t.seriesId));
    const titleOk = Boolean(t) && t.allowed && (t.open || (owned && t.openForOwner));
    const v = syncVerdict({ enabled: sw.enabled, titleOk, owned, planOk: plan.carries, basis: r.basis });
    if (v.state === 'ok') {
      const until = new Date(copyLicensedUntil({ basis: v.basis, now, paidThrough: plan.paidThrough, promoEnd: plan.promoEnd })).toISOString();
      const key = `${v.basis}|${until}`;
      renewals.set(key, [...(renewals.get(key) || []), r.id]);
      verdicts.set(r.episode_id, syncItem(r.episode_id, 'ok', { basis: v.basis, licensedUntil: until }));
    } else if (v.state === 'paused') {
      verdicts.set(r.episode_id, syncItem(r.episode_id, 'paused', { basis: r.basis, licensedUntil: r.licensed_until, endedAt: r.ended_at }));
    } else if (v.state === 'ended') {
      const endedAt = r.ended_at || nowIso;
      if (!r.ended_at) ending.push(r.id);
      verdicts.set(r.episode_id, syncItem(r.episode_id, 'ended', { basis: r.basis, licensedUntil: r.licensed_until, endedAt }));
    } else {
      revoking.set(v.reason, [...(revoking.get(v.reason) || []), r.id]);
      verdicts.set(r.episode_id, syncItem(r.episode_id, 'revoked', { reason: v.reason }));
    }
  }

  // A title the phone holds that has no live row here: say why it went,
  // when the history knows.
  const why = new Map();
  if (orphans.length > 0) {
    const { data: old, error } = await supabase.from('downloads').select('episode_id, status, revoke_reason, created_at').eq('user_id', userId).eq('device_id', deviceId).in('episode_id', orphans).order('created_at', { ascending: false });
    if (error) throw dbError(error, 'sync history');
    for (const o of old || []) if (!why.has(o.episode_id)) why.set(o.episode_id, o.status === 'revoked' && o.revoke_reason ? o.revoke_reason : 'removed');
  }

  // The writes, each only on rows still live.
  const live = (q) => q.eq('user_id', userId).eq('device_id', deviceId).eq('status', 'active');
  const writes = [];
  if (dropped.length) writes.push(live(supabase.from('downloads').update({ status: 'removed', removed_at: nowIso })).in('id', dropped.map((r) => r.id)));
  for (const [key, ids] of renewals) {
    const [basis, until] = key.split('|');
    writes.push(live(supabase.from('downloads').update({ basis, licensed_until: until, renewed_at: nowIso, ended_at: null })).in('id', ids));
  }
  if (ending.length) writes.push(live(supabase.from('downloads').update({ ended_at: nowIso })).in('id', ending));
  for (const [reason, ids] of revoking) writes.push(live(supabase.from('downloads').update({ status: 'revoked', revoke_reason: reason, removed_at: nowIso })).in('id', ids));
  if (device) {
    writes.push(supabase.from('download_devices').update({ last_seen_at: nowIso, ...(deviceName ? { name: deviceName } : {}), ...(platform ? { platform } : {}) }).eq('user_id', userId).eq('device_id', deviceId).is('removed_at', null));
  }
  for (const result of await Promise.all(writes)) if (result.error) throw dbError(result.error, 'sync write');

  return {
    ...base,
    items: have.map((id) => verdicts.get(id) || syncItem(id, 'revoked', { reason: why.get(id) || 'removed' })),
    deviceRemoved: false
  };
}

/* ---- Admin → Downloads ---- */

const PAGE = 1000;
const MAX_PAGES = 20;

// How many phones hold a copy right now (distinct account + phone among
// the live copies), read a thousand rows at a time.
async function countPhones(supabase) {
  const seen = new Set();
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const { data, error } = await supabase.from('downloads').select('id, user_id, device_id').eq('status', 'active').order('id').range(page * PAGE, page * PAGE + PAGE - 1);
    if (error) throw error;
    for (const r of data || []) seen.add(`${r.user_id}|${r.device_id}`);
    if (!data || data.length < PAGE) break;
  }
  return seen.size;
}

// What the page shows: the switch (with when it last changed and who
// changed it, from the audit log), the numbers, and the titles whose
// creators switched downloads off. `switch.readFailed`: the settings
// couldn't be read just now (not the same as "needs migration 123").
export async function getDownloadsAdmin() {
  const sw = await getDownloadsSwitch({ fresh: true });
  const view = {
    switch: { available: sw.available, enabled: sw.enabled, locked: sw.locked, changedAt: null, changedBy: null, lockedAt: null, lockedBy: null, readFailed: !sw.known },
    numbers: { phones: 0, copies: 0, titlesOff: 0 },
    titlesOff: []
  };
  if (!sw.available) return view;
  const supabase = getSupabase();
  const [audit, copies, phones, off] = await Promise.all([
    supabase.from('audit_log').select('created_at, admin_email, details').eq('action', 'downloads_switch').order('created_at', { ascending: false }).limit(40),
    supabase.from('downloads').select('id', { count: 'exact', head: true }).eq('status', 'active'),
    countPhones(supabase).catch((err) => { console.error('downloads admin phones:', err && err.message); return null; }),
    supabase.from('episodes').select('id, title', { count: 'exact' }).eq('downloads_allowed', false).order('title').limit(100)
  ]);
  if (audit.error) console.error('downloads admin audit:', audit.error.message);
  else Object.assign(view.switch, switchHistory(audit.data || [], { locked: sw.locked }));
  if (copies.error) console.error('downloads admin copies:', copies.error.message);
  else view.numbers.copies = copies.count || 0;
  if (phones !== null) view.numbers.phones = phones;
  if (off.error) console.error('downloads admin titles off:', off.error.message);
  else {
    view.titlesOff = (off.data || []).map((t) => ({ id: t.id, title: t.title ?? null }));
    view.numbers.titlesOff = off.count ?? view.titlesOff.length;
  }
  return view;
}

// POST /api/admin/downloads: one change to the switch or its lock (the
// caller has checked the admin is a full admin). Written only if the row
// still reads as it did (a flip never lands on a switch someone locked a
// moment ago), then one audit line and the security alert mail.
export async function setDownloadsSwitch({ body, rc }) {
  const sw = await getDownloadsSwitch({ fresh: true });
  requireReady(sw);
  const change = switchChange(body, sw);
  if (!change.ok) throw new DownloadError(change.error, change.status, { code: change.code });
  if (change.same) return getDownloadsAdmin();

  const column = change.field === 'enabled' ? 'downloads_enabled' : 'downloads_locked';
  let write = getSupabase().from('site_settings').update({ [column]: change.to }).eq('id', 1).eq(column, change.from);
  if (change.field === 'enabled') write = write.eq('downloads_locked', false);
  const { data, error } = await write.select('id');
  if (error) throw dbError(error, 'switch');
  forgetSecuritySwitches();
  if (!data || data.length === 0) {
    const fresh = await getDownloadsSwitch({ fresh: true });
    if (change.field === 'enabled' && fresh.locked) throw new DownloadError('The switch is locked. Unlock it first.', 409, { code: 'locked' });
    throw new DownloadError('It changed a moment ago. Reload and look again.', 409, { code: 'changed' });
  }

  const words = switchWords(change.field, change.from, change.to);
  await recordAudit({ adminId: rc.userId, adminEmail: rc.email || null, action: 'downloads_switch', targetType: 'site_settings', targetId: column, details: switchAuditDetails(change.field, change.from, change.to) });
  // Awaited: a function frozen after the response would lose the email.
  await securityAlert(`Downloads switch: ${words}`, [`Changed by ${rc.email || rc.userId} on Admin → Downloads.`]).catch(() => {});
  return getDownloadsAdmin();
}
