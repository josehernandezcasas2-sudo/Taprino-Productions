// Downloads in the app, the rules (Jose, 2026-11-14: "if they have something
// downloaded, and they are offline, they can still view it as long as they
// have the subscription, once the month is over and if they haven't
// connected, make sure they have to connect back"; Premium and Sponsor;
// mockup https://claude.ai/artifact/GbG6FPXECgH61aMsbFvnyT, contract
// mockups/app-downloads-contract.md).
//
// Pure and client-safe: no imports. The server (lib/downloads.js) decides
// who may download and until when a copy is licensed; the app
// (mobile/src/lib/downloads.js) decides, with no connection, whether a copy
// on the phone may play. The app's mobile/src/lib/downloadRules.js is this
// file word for word; `node scripts/test-downloads.mjs` checks both.

const DAY_MS = 86400000;

// The plans that carry downloads. The team counts as Premium everywhere.
export const DOWNLOAD_TIERS = ['premium', 'sponsor'];
export const MAX_TITLES_PER_DEVICE = 25;
export const MAX_DEVICES = 2;
// A renewal can land a few hours after the paid month ends: nobody is
// locked out for that.
export const GRACE_DAYS = 2;
// "Once the month is over": a member's copy never runs longer than this
// without the phone connecting, whatever the plan's billing period.
export const MEMBER_MAX_DAYS = 31;
// A bought title, and an account with no paid-through date (the team, a
// comped or promo account): the phone connects at least this often, so a
// refund, a takedown or an ended promo reaches it.
export const CHECKIN_DAYS = 30;
// After a membership ends the files stay this long in case they rejoin.
export const KEEP_AFTER_END_DAYS = 30;
// A phone's clock set back further than this since it was last seen locks
// the downloads until it connects.
export const CLOCK_SLACK_MS = 10 * 60 * 1000;
// A download link's life. Cloudflare's ceiling is 24 hours.
export const LINK_SECONDS = 6 * 60 * 60;

const ms = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Date.parse(v);
  return Number.isFinite(n) ? n : null;
};

export function planCarriesDownloads({ tier = 'basic', isAdmin = false } = {}) {
  return Boolean(isAdmin) || DOWNLOAD_TIERS.includes(tier);
}

// Podcasts are free, public audio with a feed of their own: not in v1.
export function downloadableKind(contentType) {
  return contentType !== 'podcast';
}

// What the Download button is for this viewer on this title.
//   { state: 'hidden', reason: 'off' | 'kind' | 'title' }  nothing is drawn
//   { state: 'ok', basis: 'owned' | 'member' }             downloads
//   { state: 'signin' }                                    asks them to sign in
//   { state: 'plan' }                                      "Downloads come with Premium"
// `enabled`: the admin switch. `downloadable`: the title has a file the app
// can fetch (a Cloudflare video, not a podcast). `allowed`: the creator's
// switch for this title. `owned`: they bought it (Buy to own).
export function downloadOffer({ enabled = false, downloadable = false, allowed = true, signedIn = false, tier = 'basic', isAdmin = false, owned = false } = {}) {
  if (!enabled) return { state: 'hidden', reason: 'off' };
  if (!downloadable) return { state: 'hidden', reason: 'kind' };
  if (allowed === false) return { state: 'hidden', reason: 'title' };
  if (!signedIn) return { state: 'signin' };
  if (owned) return { state: 'ok', basis: 'owned' };
  if (planCarriesDownloads({ tier, isAdmin })) return { state: 'ok', basis: 'member' };
  return { state: 'plan' };
}

// The server's side: until when a copy may play without the phone
// connecting. `paidThrough` is the end of the paid month (Stripe's
// current_period_end), null for an account with none. Milliseconds.
export function licensedUntil({ basis = 'member', now = Date.now(), paidThrough = null } = {}) {
  const at = ms(now);
  if (basis === 'owned') return at + CHECKIN_DAYS * DAY_MS;
  const paid = ms(paidThrough);
  if (paid === null) return at + CHECKIN_DAYS * DAY_MS;
  // Stripe still says "active" for a moment after the period ends: the
  // grace starts from now, never from the past.
  const end = Math.max(paid, at) + GRACE_DAYS * DAY_MS;
  return Math.min(end, at + (MEMBER_MAX_DAYS + GRACE_DAYS) * DAY_MS);
}

// The server's verdict on one copy when the phone checks in.
//   { state: 'ok', basis }                  licensed again (the caller sets the new date)
//   { state: 'paused' }                     the admin switch is off: the date it has stands, no renewal
//   { state: 'ended' }                      a member copy and the plan no longer carries downloads
//   { state: 'revoked', reason: 'title' }   the title is gone, held, or its creator switched downloads off
//   { state: 'revoked', reason: 'refund' }  a bought copy whose purchase was refunded, for someone with no plan
// `titleOk`: the title is still live and still allows downloads.
export function syncVerdict({ enabled = false, titleOk = true, owned = false, planOk = false, basis = 'member' } = {}) {
  if (!titleOk) return { state: 'revoked', reason: 'title' };
  if (!enabled) return { state: 'paused' };
  if (owned) return { state: 'ok', basis: 'owned' };
  if (planOk) return { state: 'ok', basis: 'member' };
  if (basis === 'owned') return { state: 'revoked', reason: 'refund' };
  return { state: 'ended' };
}

export function keepUntil(endedAt) {
  const at = ms(endedAt);
  return at === null ? null : at + KEEP_AFTER_END_DAYS * DAY_MS;
}

export const titleLimitReached = (count) => Number(count) >= MAX_TITLES_PER_DEVICE;
export const deviceLimitReached = (count) => Number(count) >= MAX_DEVICES;

// The phone's side. The latest moment this phone has seen, kept so a
// clock set back shows.
export function highWater(lastSeenAt, now = Date.now()) {
  const seen = ms(lastSeenAt);
  const at = ms(now);
  return seen === null ? at : Math.max(seen, at);
}

// Can this copy play right now, with or without a connection?
// → { ok: true } or { ok: false, reason }
//   'revoked'  the server took it back (the file is removed)
//   'missing'  the phone cleared the file
//   'ended'    the membership ended (the file stays until keepUntil)
//   'clock'    the phone's clock is behind the last time it was seen
//   'expired'  the licensed date has passed and the phone hasn't connected
export function playState({ now = Date.now(), licensedUntil: until = null, lastSeenAt = null, ended = false, revoked = false, missing = false } = {}) {
  if (revoked) return { ok: false, reason: 'revoked' };
  if (missing) return { ok: false, reason: 'missing' };
  if (ended) return { ok: false, reason: 'ended' };
  const at = ms(now);
  const seen = ms(lastSeenAt);
  if (seen !== null && at < seen - CLOCK_SLACK_MS) return { ok: false, reason: 'clock' };
  const end = ms(until);
  if (end === null || at > end) return { ok: false, reason: 'expired' };
  return { ok: true };
}

// A kept file whose time is up (a membership that ended and wasn't renewed).
export function removeDue({ now = Date.now(), keepUntil: keep = null } = {}) {
  const k = ms(keep);
  return k !== null && ms(now) > k;
}

/* ---- words, the same on every screen ---- */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// "Dec 14" (the year only when it isn't this one).
export function untilLabel(value, now = Date.now()) {
  const at = ms(value);
  if (at === null) return '';
  const d = new Date(at);
  const thisYear = new Date(ms(now)).getFullYear();
  return `${MONTHS[d.getMonth()]} ${d.getDate()}${d.getFullYear() === thisYear ? '' : `, ${d.getFullYear()}`}`;
}

// "310 MB", "1.1 GB".
export function bytesLabel(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return '';
  const mb = n / (1024 * 1024);
  if (mb < 1) return '1 MB';
  if (mb < 1000) return `${Math.round(mb)} MB`;
  const gb = mb / 1024;
  return `${gb < 10 ? gb.toFixed(1).replace(/\.0$/, '') : Math.round(gb)} GB`;
}

export const DOWNLOAD_WORDS = {
  nav: 'Downloads',
  button: 'Download',
  done: 'Downloaded',
  preparing: 'Getting it ready…',
  waitingWifi: 'Waiting for Wi-Fi',
  paused: 'Paused',
  failed: 'Couldn’t download. Tap to try again.',
  offlineBanner: 'You’re offline. Your downloads still play.',
  offlineBannerLocked: 'You’re offline.',
  owned: 'Yours to keep',
  wifiOnly: 'Download on Wi-Fi only',
  wifiOnlyNote: 'Never uses mobile data',
  empty: 'Nothing downloaded yet. Open a title and press Download to keep it on this phone.',
  planTitle: 'Downloads come with Premium',
  planBody: 'Premium and Sponsor members can keep titles on their phone and watch without a connection.',
  planAction: 'See plans',
  signIn: 'Sign in to download',
  titleLimit: `This phone holds ${MAX_TITLES_PER_DEVICE} downloads. Remove one to add another.`,
  deviceLimit: `Downloads are already on ${MAX_DEVICES} phones. Remove one of them to use this one.`,
  off: 'Downloads are switched off for now.',
  webOnly: 'Downloads live in the Studio Tapa TV app. A browser can’t keep a title for offline viewing.'
};

// "Plays offline until Dec 14".
export function untilChip(value, now = Date.now()) {
  const label = untilLabel(value, now);
  return label ? `Plays offline until ${label}` : '';
}

// The card over the list when copies can't play.
// → { title, body, action } (action: 'retry' | 'plans' | 'download' | null)
export function lockCard(reason, { paidThrough = null, endedAt = null, now = Date.now() } = {}) {
  if (reason === 'expired') {
    const day = untilLabel(paidThrough, now);
    return {
      title: 'Connect to keep watching',
      body: day
        ? `Your month ended on ${day} and this phone hasn’t been online since. Connect once and your downloads unlock. Nothing was deleted.`
        : `This phone hasn’t been online for ${CHECKIN_DAYS} days. Connect once and your downloads unlock. Nothing was deleted.`,
      action: 'retry'
    };
  }
  if (reason === 'clock') {
    return { title: 'Connect to keep watching', body: 'This phone’s clock is behind the last time it was online. Connect once and your downloads unlock.', action: 'retry' };
  }
  if (reason === 'ended') {
    const day = untilLabel(endedAt, now);
    return {
      title: day ? `Your membership ended on ${day}` : 'Your plan doesn’t include downloads',
      body: 'Your downloads are still on this phone. Join Premium or Sponsor and they play again, right where you left them.',
      action: 'plans'
    };
  }
  if (reason === 'missing') {
    return { title: 'This download is gone', body: 'The phone cleared it to free up space. Download it again when you’re online.', action: 'download' };
  }
  if (reason === 'revoked') {
    return { title: 'No longer available', body: 'This title was taken down or its maker switched downloads off, so it was removed from this phone.', action: null };
  }
  return { title: DOWNLOAD_WORDS.off, body: '', action: null };
}
