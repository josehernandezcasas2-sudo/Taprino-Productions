// House ads in the players: the rules, pure and client-safe (no imports).
// Who gets ads on a title, which breaks play after a resume or a seek,
// what fills each slot, the words around an ad, and how often the swipe
// feeds carry an ad card. They are the website's own decisions written
// down once — components/VideoPlayer.js (the pre-roll, plain breaks and a
// ready plan's pods), components/ChannelPlayer.js (live breaks),
// pages/vertical/discover.js and pages/snippets/discover.js (ad cards) —
// so the app can make the same ones: mobile/src/lib/adBreakRules.js is
// this file word for word below its header. Tested by
// `node scripts/test-ad-breaks.mjs`.

// How long the app waits for a slot's answer (the pick or the plan's fill)
// before it gives up and plays the title: an ad never holds a title up.
export const AD_SLOT_TIMEOUT_MS = 4000;
// How long an ad or a bumper may take to start once it is loading before
// the break moves on without it.
export const AD_START_TIMEOUT_MS = 5000;
// An item never runs past its booked seconds by much (VideoPlayer's runPod).
export const AD_ITEM_GRACE_SECONDS = 6;
// Playback moving by more than this between two time ticks is a seek, a
// resume or a skip, not watching (VideoPlayer's mid-roll check).
export const JUMP_SECONDS = 2;
// One ad card per this many content slides in the swipe feeds.
export const REEL_AD_EVERY = 6;
// No break between two live programs sooner than this after the last one
// (or after tuning in).
export const LIVE_BREAK_GAP_MS = 10 * 60 * 1000;
// A scheduled live ad break starts another ad only with this much left.
export const LIVE_NEXT_AD_MIN_MS = 5000;

// Where an ad may run (house_ads.placements) and where it played (the
// impression's surface, migration 103's ad share).
export const AD_PLACEMENTS = { title: 'main_player', live: 'live_tv', reel: 'vertical_discover' };
export const AD_SURFACES = ['preroll', 'vod', 'live'];

/* ---------------- who gets ads ---------------- */

// A title's ads (pages/episode/[id].js and the podcast show page): never in
// a preview or on a trailer, never for a Premium/Sponsor member (adFree),
// the team, or someone who bought the title, and never on a title its
// creator switched ads off for. Live channels ignore all of this: ads run
// for every viewer there.
export function adsOnFor({ previewing = false, trailer = false, adFree = false, isAdmin = false, owned = false, adsEnabled = true } = {}) {
  return !previewing && !trailer && !adFree && !isAdmin && !owned && adsEnabled !== false;
}

// The swipe feeds' ad cards: not for an ad-free member or the team.
export function reelAdsOn({ adFree = false, isAdmin = false } = {}) {
  return !(adFree || isAdmin);
}

/* ---------------- a title's breaks ---------------- */

// The creator's break times (episode.adBreakSeconds); none set = a
// pre-roll only.
export function breakTimes(adBreakSeconds) {
  return Array.isArray(adBreakSeconds) && adBreakSeconds.length > 0 ? adBreakSeconds : [0];
}

// The ready ad plan (episode.adPlan, on demand) a viewer's breaks come
// from, or null.
export function planFor(adsOn, adPlan) {
  return adsOn && adPlan && Array.isArray(adPlan.breaks) && adPlan.breaks.length ? adPlan : null;
}

// Every break of a title for a viewer, earliest first: { at, index } —
// `index` is the plan's break (the fill's `break`), null for a plain one.
// A ready plan's breaks replace the plain ones. None when the viewer gets
// no ads.
export function titleBreaks({ adsOn, adPlan = null, adBreakSeconds = null } = {}) {
  if (!adsOn) return [];
  const plan = planFor(adsOn, adPlan);
  const raw = plan
    ? plan.breaks.map((b) => ({ at: Number(b.at), index: Number.isInteger(b.index) ? b.index : null }))
    : breakTimes(adBreakSeconds).map((at) => ({ at: Number(at), index: null }));
  const seen = new Set();
  const out = [];
  for (const b of raw.filter((x) => Number.isFinite(x.at) && x.at >= 0 && (!plan || x.index !== null)).sort((x, y) => x.at - y.at)) {
    if (seen.has(b.at)) continue;
    seen.add(b.at);
    out.push(b);
  }
  return out;
}

// The break before the title (at 0), or null. It plays once per title when
// the title first plays, wherever it resumes from.
export function preRollOf(breaks) {
  return (breaks || []).find((b) => b.at === 0) || null;
}

// What one time tick of the title means for its breaks. `consumed` holds
// the `at` of every break already played or passed; `last` is the previous
// tick's position (null for the first one). A tick that jumped — a seek, a
// resume, −10 / +10, the first tick — passes every break at or before it
// without playing them (resuming a film at 30:00 never queues the 10:00 and
// 20:00 breaks back to back); otherwise the earliest break playback has
// crossed is due and counted as played. → { consumed, due, jumped }.
export function breakTick({ breaks, consumed, now, last = null }) {
  const next = new Set(consumed || []);
  const mids = (breaks || []).filter((b) => b.at > 0);
  const t = Number(now) || 0;
  if (last === null || last === undefined || Math.abs(t - Number(last)) > JUMP_SECONDS) {
    for (const b of mids) if (b.at <= t) next.add(b.at);
    return { consumed: next, due: null, jumped: last !== null && last !== undefined };
  }
  for (const b of mids) {
    if (t >= b.at && !next.has(b.at)) {
      next.add(b.at);
      return { consumed: next, due: b, jumped: false };
    }
  }
  return { consumed: next, due: null, jumped: false };
}

/* ---------------- what fills a slot ---------------- */

// The pick route (/api/house-ads/pick): one house ad for a placement. A
// title's ad names the episode and the surface, which the server signs
// into the impression so the play earns the title's creator their ad
// share; a reel names neither and earns nothing.
export function adPickPath({ placement, episodeId = null, surface = null } = {}) {
  const parts = [`placement=${encodeURIComponent(placement || '')}`];
  if (episodeId && AD_SURFACES.includes(surface)) parts.push(`episode=${encodeURIComponent(episodeId)}`, `surface=${surface}`);
  return `/api/house-ads/pick?${parts.join('&')}`;
}

// A ready plan's break (/api/ad-plan/fill): ads, bumpers, cards, the hold card.
export function adFillPath({ episodeId, breakIndex, surface = 'vod' } = {}) {
  return `/api/ad-plan/fill?episode=${encodeURIComponent(episodeId || '')}&break=${Number(breakIndex) || 0}&surface=${surface === 'vod' ? 'vod' : 'live'}`;
}

// What fills a title's break: a plan's break → its fill (surface vod); a
// plain break → one house ad, signed as the pre-roll (the website's ad tag
// signs every main-player break that way). `wait` = the break shows
// "Loading the break…" while it asks, as a plan's pod does on the website.
export function titleSlot(brk, episodeId) {
  if (brk && Number.isInteger(brk.index)) return { source: 'fill', path: adFillPath({ episodeId, breakIndex: brk.index, surface: 'vod' }), wait: true };
  return { source: 'pick', path: adPickPath({ placement: AD_PLACEMENTS.title, episodeId, surface: 'preroll' }), wait: false };
}

// What fills a live break: a plan's break → its fill (surface live); the
// short break between two programs → one house ad for the program that
// follows; a scheduled ad break → house ads with no title (the loop earns
// nothing), one after another.
export function liveSlot({ kind, episodeId = null, breakIndex = null } = {}) {
  if (kind === 'plan') return { source: 'fill', path: adFillPath({ episodeId, breakIndex, surface: 'live' }), wait: true };
  if (kind === 'between') return { source: 'pick', path: adPickPath({ placement: AD_PLACEMENTS.live, episodeId, surface: 'live' }), wait: false };
  return { source: 'pick', path: adPickPath({ placement: AD_PLACEMENTS.live }), wait: false };
}

// A swipe feed's ad card.
export function reelSlot() {
  return { source: 'pick', path: adPickPath({ placement: AD_PLACEMENTS.reel }), wait: false };
}

// A live plan break joined `elapsed` seconds in: what is left to play,
// the first item shortened by what already played (`skip`).
export function liveBreakItems(items, elapsed = 0) {
  let skip = Math.max(0, Number(elapsed) || 0);
  const out = [];
  for (const it of Array.isArray(items) ? items : []) {
    const secs = Number(it && it.seconds) || 0;
    if (skip >= secs) { skip -= secs; continue; }
    out.push(skip > 0 ? { ...it, skip } : it);
    skip = 0;
  }
  return out;
}

// Whether a program change gets the short break between programs: neither
// side a scheduled ad break, and none in the last LIVE_BREAK_GAP_MS. (A
// program with a ready plan plays its own breaks instead.)
export function betweenProgramsBreak({ prevKind = null, nextKind = null, sinceLastBreakMs = 0 } = {}) {
  return Boolean(prevKind && nextKind && prevKind !== 'ad_break' && nextKind !== 'ad_break') && Number(sinceLastBreakMs) >= LIVE_BREAK_GAP_MS;
}

/* ---------------- the swipe feeds ---------------- */

// `count` content slides since the last ad card, `added` more just joined
// the feed → { count, adDue }: an ad card is due every REEL_AD_EVERY.
export function reelAdTick(count, added) {
  const c = (Number(count) || 0) + (Number(added) || 0);
  return c >= REEL_AD_EVERY ? { count: 0, adDue: true } : { count: c, adDue: false };
}

/* ---------------- the words ---------------- */

export const AD_TAG = 'Ad';
export const AD_RESUMES_NOTE = 'Your episode resumes right after';
export const AD_START_NOTE = 'Starts with a short ad';
export const LIVE_AD_BADGE = 'Ad break';
export const REEL_AD_CTA = 'Learn more →';

// The player's clock: "4:05", "1:02:03".
export function adClock(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// The live player's clock: minutes and seconds.
export function liveClock(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// The bar along the foot of a title's ad: "Ad", "1 of 2", "0:12 left",
// "Your episode resumes right after".
export function adBarWords({ index = 1, total = 1, remaining = 0 } = {}) {
  return {
    tag: AD_TAG,
    count: `${index} of ${total}`,
    time: remaining > 0 ? `${adClock(remaining)} left` : null,
    note: AD_RESUMES_NOTE
  };
}

// Which ad of the break the item at `position` is ("1 of 2"): bumpers and
// cards count as the ad before them.
export function podPosition(items, position) {
  const list = Array.isArray(items) ? items : [];
  const upTo = list.slice(0, (Number(position) || 0) + 1).filter((x) => x && x.type === 'ad').length;
  const total = list.filter((x) => x && x.type === 'ad').length;
  return { index: Math.max(1, upTo), total: Math.max(1, total) };
}

// The link over an advertiser's ad.
export function visitLabel(brand) {
  return `Visit ${brand || 'the advertiser'} ↗`;
}

// The card a title's break draws between ads: "Presented by" / "Supported
// by" + the brand, or the waiting and hold lines.
export function podCardWords(card) {
  const type = card && card.type;
  if (type === 'card') return { kicker: card.variant === 'supported_by' ? 'Supported by' : 'Presented by', brand: card.brand || '' };
  if (type === 'wait') return { kicker: 'Loading the break…', brand: '' };
  return { kicker: 'Back in a moment', brand: '' };
}

// The same card on a live channel: the channel's name stands in for the
// hold card, "Back in a moment" under it while the break loads.
export function liveCardWords(card, channelName = '') {
  const type = card && card.type;
  if (type === 'card') return { kicker: card.variant === 'supported_by' ? 'Supported by' : 'Presented by', brand: card.brand || '', line: '' };
  return { kicker: '', brand: channelName || '', line: type === 'wait' ? 'Back in a moment' : '' };
}

// The live bar's line: "Back to TapaTV in 1:30" / "… right after this".
export function liveAdNote(channelName, countdown) {
  return countdown !== null && countdown !== undefined
    ? `Back to ${channelName} in ${liveClock(countdown)}`
    : `Back to ${channelName} right after this`;
}
