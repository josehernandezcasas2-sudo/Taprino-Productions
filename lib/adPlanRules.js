// Episode Ad Curator: the rules, pure and client-safe (no imports), so the
// curator page, the scheduler, the players and the server all agree.
// Tested by `node scripts/test-ad-plan.mjs`.
//
// A plan = breaks + settings. A break sits at `at` seconds into the
// episode (0 = pre-roll) and is made of pieces:
//   { kind: 'exact',  seconds }          any approved ad of exactly this length
//   { kind: 'range',  min, max }         one ad inside the range; books `max`
//   { kind: 'flex',   seconds }          ads of any length, packed; bumpers after
//   { kind: 'pinned', adId, seconds }    one specific Studio Tapa ad
// A break books its pieces' seconds rounded up to the plan's roundTo
// ("round each break to 15 s"); whatever the ads don't fill at air time is
// bumper time (clips, a "Presented by" card, or the hold card). Bumper
// time is computed, never typed. runtime + every break's booked seconds =
// the air length, the one number the scheduler needs.

export const PIECE_KINDS = ['exact', 'range', 'flex', 'pinned'];
export const DEFAULT_SIZES = [10, 15, 20, 30];
export const DEFAULT_RANGES = [[10, 15], [15, 20], [20, 30]];
export const FLEX_PRESETS = [30, 60];
export const DEFAULT_ROUND = 15;
export const ROUND_CHOICES = [5, 10, 15, 30, 60];
export const DEFAULT_HOUR_CAP = 900; // 15 minutes of ads per clock hour on a channel
export const MIN_PIECE_SECONDS = 3;
export const MAX_PIECE_SECONDS = 600;
export const MAX_PIECES_PER_BREAK = 12;
export const MAX_BREAKS = 24;
export const CARD_SECONDS = 6; // the "Presented by" / "Supported by" card
export const SELF_AD_CLEARANCE = 60; // a break this close to a self-implemented ad gets a warning
export const MAX_SELF_AD_SECONDS = 600;
export const AUTO_BUMPERS = {
  presented_by: 'Presented by · the pinned Studio Tapa brand',
  supported_by: 'Supported by · the pinned Studio Tapa brand',
  station_id: 'Station ID',
  channel: 'Channel bumpers (rotate)',
  hold: 'Hold card only'
};
export const STATUS_LABELS = { none: 'Default', draft: 'Draft', ready: 'Ready for air' };

const int = (v) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : NaN);

export function roundUp(seconds, to) {
  const t = Math.max(1, int(to) || DEFAULT_ROUND);
  return Math.ceil(Math.max(0, seconds) / t) * t;
}

// The seconds a piece books: its own length, or the top of its range.
export function pieceSeconds(piece) {
  if (!piece) return 0;
  if (piece.kind === 'range') return int(piece.max) || 0;
  return int(piece.seconds) || 0;
}

export function piecesSeconds(brk) {
  return (brk && Array.isArray(brk.pieces) ? brk.pieces : []).reduce((s, p) => s + pieceSeconds(p), 0);
}

// What a break books on air: pieces rounded up to the plan's rounding.
export function bookedSeconds(brk, roundTo = DEFAULT_ROUND) {
  const s = piecesSeconds(brk);
  return s > 0 ? roundUp(s, roundTo) : 0;
}

export function pieceLabel(piece) {
  if (!piece) return '';
  if (piece.kind === 'exact') return `${piece.seconds} s`;
  if (piece.kind === 'range') return `${piece.min}–${piece.max} s`;
  if (piece.kind === 'flex') return `${piece.seconds} s block`;
  if (piece.kind === 'pinned') return piece.title ? `${piece.title} · ${piece.seconds} s` : `Pinned · ${piece.seconds} s`;
  return '';
}

export function fmtClock(seconds) {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
}

// "8:00" / "1:02:30" / "480" -> seconds, or null.
export function parseClock(text) {
  const t = String(text == null ? '' : text).trim();
  if (!t) return null;
  if (/^\d+$/.test(t)) return Number(t);
  const m = t.match(/^(\d+):([0-5]?\d)(?::([0-5]?\d))?$/);
  if (!m) return null;
  return m[3] != null ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : Number(m[1]) * 60 + Number(m[2]);
}

/* ---------------- the plan itself ---------------- */

// A starting plan when nothing is saved yet: one exact section at each of
// the creator's break times (30 s when the size list has it, else the
// longest size). Never persisted on its own and never changes playback.
export function defaultPlanFor({ adBreakSeconds, runtimeSeconds, sizes = DEFAULT_SIZES, roundTo = DEFAULT_ROUND } = {}) {
  const size = sizes.includes(30) ? 30 : Math.max(...sizes);
  const ats = [...new Set((Array.isArray(adBreakSeconds) && adBreakSeconds.length ? adBreakSeconds : [0]).map(int).filter((n) => Number.isFinite(n) && n >= 0))]
    .filter((at) => !runtimeSeconds || at < runtimeSeconds)
    .sort((a, b) => a - b);
  return {
    status: 'none',
    breaks: ats.map((at) => ({ at, pieces: [{ kind: 'exact', seconds: size }] })),
    selfAds: [],
    roundTo,
    mergeAdjacent: true,
    autoBumper: 'station_id',
    onDemand: true
  };
}

function cleanPiece(raw, errors, where) {
  if (!raw || typeof raw !== 'object') return null;
  const kind = String(raw.kind || '');
  if (kind === 'exact' || kind === 'flex') {
    const seconds = int(raw.seconds);
    if (!(seconds >= MIN_PIECE_SECONDS && seconds <= MAX_PIECE_SECONDS)) { errors.push(`${where}: a ${kind} piece needs ${MIN_PIECE_SECONDS}–${MAX_PIECE_SECONDS} seconds.`); return null; }
    return { kind, seconds };
  }
  if (kind === 'range') {
    const min = int(raw.min);
    const max = int(raw.max);
    if (!(min >= MIN_PIECE_SECONDS && max <= MAX_PIECE_SECONDS && min < max)) { errors.push(`${where}: a range needs min < max, within ${MIN_PIECE_SECONDS}–${MAX_PIECE_SECONDS} seconds.`); return null; }
    return { kind, min, max };
  }
  if (kind === 'pinned') {
    const adId = String(raw.adId || '').trim();
    const seconds = int(raw.seconds);
    if (!adId || !(seconds >= 1 && seconds <= MAX_PIECE_SECONDS)) { errors.push(`${where}: a pinned ad needs the ad and its length.`); return null; }
    return { kind, adId, seconds, title: String(raw.title || '').slice(0, 120) || null };
  }
  errors.push(`${where}: unknown piece kind "${kind}".`);
  return null;
}

// Cleans a plan sent from the curator. Returns { plan, errors }: `plan` is
// always usable (bad pieces dropped, breaks sorted and deduped, empty
// breaks removed); `errors` says what was dropped or refused.
export function normalizePlan(raw, { runtimeSeconds, sizes = DEFAULT_SIZES } = {}) {
  const errors = [];
  const src = raw && typeof raw === 'object' ? raw : {};
  const roundTo = ROUND_CHOICES.includes(int(src.roundTo)) ? int(src.roundTo) : DEFAULT_ROUND;
  const seen = new Set();
  const breaks = [];
  for (const b of Array.isArray(src.breaks) ? src.breaks : []) {
    const at = int(b && b.at);
    if (!(at >= 0)) { errors.push('A break needs a time.'); continue; }
    if (runtimeSeconds && at >= runtimeSeconds) { errors.push(`A break at ${fmtClock(at)} is past the end of the episode (${fmtClock(runtimeSeconds)}).`); continue; }
    if (seen.has(at)) { errors.push(`Two breaks at ${fmtClock(at)}; kept the first.`); continue; }
    const where = `Break at ${fmtClock(at)}`;
    const pieces = (Array.isArray(b.pieces) ? b.pieces : []).slice(0, MAX_PIECES_PER_BREAK).map((p) => cleanPiece(p, errors, where)).filter(Boolean);
    if (!pieces.length) continue; // an empty break is no break
    seen.add(at);
    breaks.push({ at, pieces });
  }
  breaks.sort((a, b) => a.at - b.at);
  if (breaks.length > MAX_BREAKS) { errors.push(`At most ${MAX_BREAKS} breaks; the rest were dropped.`); breaks.length = MAX_BREAKS; }

  const selfAds = [];
  for (const s of Array.isArray(src.selfAds) ? src.selfAds : []) {
    const inSeconds = int(s && s.inSeconds);
    const outSeconds = int(s && s.outSeconds);
    if (!(inSeconds >= 0 && outSeconds > inSeconds && outSeconds - inSeconds <= MAX_SELF_AD_SECONDS)) { errors.push('A sponsor segment needs an in time before its out time, up to 10 minutes long.'); continue; }
    if (runtimeSeconds && outSeconds > runtimeSeconds) { errors.push(`A sponsor segment ends after the episode does (${fmtClock(runtimeSeconds)}).`); continue; }
    selfAds.push({
      inSeconds, outSeconds,
      sponsor: String(s.sponsor || '').trim().slice(0, 80),
      url: String(s.url || '').trim().slice(0, 300),
      card: s.card !== false
    });
  }
  selfAds.sort((a, b) => a.inSeconds - b.inSeconds);

  const autoBumper = AUTO_BUMPERS[src.autoBumper] ? src.autoBumper : 'station_id';
  return {
    plan: {
      status: src.status === 'ready' ? 'ready' : 'draft',
      breaks,
      selfAds,
      roundTo,
      mergeAdjacent: src.mergeAdjacent !== false,
      autoBumper,
      onDemand: src.onDemand !== false
    },
    errors
  };
}

/* ---------------- air time ---------------- */

// Every break with its booked seconds and where it lands in air time.
export function airBreaks(plan) {
  const roundTo = plan && plan.roundTo ? plan.roundTo : DEFAULT_ROUND;
  let acc = 0;
  return (plan && Array.isArray(plan.breaks) ? plan.breaks : []).slice().sort((a, b) => a.at - b.at).map((b, index) => {
    const booked = bookedSeconds(b, roundTo);
    const airStart = b.at + acc;
    acc += booked;
    return { index, at: b.at, booked, airStart, airEnd: airStart + booked };
  }).filter((b) => b.booked > 0);
}

export function adsSeconds(plan) {
  return airBreaks(plan).reduce((s, b) => s + b.booked, 0);
}

export function airSeconds(runtimeSeconds, plan) {
  return (int(runtimeSeconds) || 0) + adsSeconds(plan);
}

// Seconds of ads per hour of air, for the hourly cap.
export function adsPerHour(runtimeSeconds, plan) {
  const air = airSeconds(runtimeSeconds, plan);
  return air > 0 ? Math.round((adsSeconds(plan) * 3600) / air) : 0;
}

// Where an air-time offset into the program falls: in the episode, or
// inside a break (elapsed / remaining seconds of it).
export function airToEpisode(airOffset, breaks) {
  const air = Math.max(0, Number(airOffset) || 0);
  let shift = 0;
  for (const b of breaks || []) {
    if (air < b.airStart) break;
    if (air < b.airEnd) return { episodeSeconds: b.at, inBreak: { index: b.index, at: b.at, elapsed: air - b.airStart, remaining: b.airEnd - air, booked: b.booked } };
    shift += b.booked;
  }
  return { episodeSeconds: air - shift, inBreak: null };
}

// The air-time offset at which episode second `ep` plays (a break at `at`
// plays before the content at `at`).
export function episodeToAir(episodeSeconds, breaks) {
  const ep = Math.max(0, Number(episodeSeconds) || 0);
  return ep + (breaks || []).filter((b) => b.at <= ep).reduce((s, b) => s + b.booked, 0);
}

// Breaks that land within SELF_AD_CLEARANCE of a sponsor segment.
export function selfAdConflicts(plan) {
  const out = [];
  for (const b of plan && plan.breaks ? plan.breaks : []) {
    for (const s of plan.selfAds || []) {
      if (b.at >= s.inSeconds - SELF_AD_CLEARANCE && b.at <= s.outSeconds + SELF_AD_CLEARANCE) {
        out.push({ at: b.at, selfAd: s, inside: b.at >= s.inSeconds && b.at < s.outSeconds });
      }
    }
  }
  return out;
}

/* ---------------- what an ad can fill ---------------- */

// Which section sizes/ranges an ad of this length can land in.
export function fitsFor(durationSeconds, { sizes = DEFAULT_SIZES, ranges = DEFAULT_RANGES } = {}) {
  const d = int(durationSeconds);
  const out = [];
  if (sizes.includes(d)) out.push(`${d}`);
  for (const [min, max] of ranges) if (d >= min && d <= max) out.push(`${min}–${max}`);
  out.push('flex');
  return out;
}

export function adFitsPiece(ad, piece) {
  const d = int(ad && ad.durationSeconds);
  if (!(d > 0)) return false;
  if (piece.kind === 'exact') return d === piece.seconds;
  if (piece.kind === 'range') return d >= piece.min && d <= piece.max;
  if (piece.kind === 'flex') return d <= piece.seconds;
  if (piece.kind === 'pinned') return ad.id === piece.adId;
  return false;
}

/* ---------------- filling a break at air time ---------------- */

function weightedPick(cands, rng) {
  if (!cands.length) return null;
  const total = cands.reduce((s, a) => s + Math.max(1, Number(a.weight) || 1), 0);
  let roll = rng() * total;
  for (const a of cands) {
    roll -= Math.max(1, Number(a.weight) || 1);
    if (roll <= 0) return a;
  }
  return cands[cands.length - 1];
}

// The longest Studio Tapa ad that fits (ties by weight), for a section
// nobody's ad can fill that day.
function houseFallback(ads, used, maxSeconds, rng) {
  const cands = ads.filter((a) => a.house && !used.has(a.id) && a.durationSeconds > 0 && a.durationSeconds <= maxSeconds);
  if (!cands.length) return null;
  const longest = Math.max(...cands.map((a) => a.durationSeconds));
  return weightedPick(cands.filter((a) => a.durationSeconds === longest), rng);
}

// Bumper time: a "Presented by" card first when asked for (and there is a
// brand to name), then the longest clips that fit, each once, then the
// hold card for whatever is left.
export function fillBumpers(tail, { bumpers = [], autoBumper = 'station_id', brand = null, rng = Math.random } = {}) {
  const items = [];
  let left = Math.max(0, int(tail) || 0);
  if ((autoBumper === 'presented_by' || autoBumper === 'supported_by') && brand && left >= CARD_SECONDS) {
    items.push({ type: 'card', variant: autoBumper, brand, seconds: CARD_SECONDS });
    left -= CARD_SECONDS;
  }
  // Station ID modes use station IDs first and other bumper clips only for
  // time the IDs can't fill; channel mode rotates through both.
  let tiers = [];
  if (autoBumper === 'channel') tiers = [bumpers.filter((m) => m.kind === 'bumper' || m.kind === 'station_id')];
  else if (autoBumper !== 'hold') tiers = [bumpers.filter((m) => m.kind === 'station_id'), bumpers.filter((m) => m.kind === 'bumper')];
  const used = new Set();
  let guard = 0;
  while (left > 0 && guard++ < 20) {
    let cands = [];
    for (const tier of tiers) {
      cands = tier.filter((m) => !used.has(m.id) && m.durationSeconds > 0 && m.durationSeconds <= left);
      if (cands.length) break;
    }
    if (!cands.length) break;
    const longest = Math.max(...cands.map((m) => m.durationSeconds));
    const pick = weightedPick(cands.filter((m) => m.durationSeconds === longest).map((m) => ({ ...m, weight: 1 })), rng);
    used.add(pick.id);
    items.push({ type: 'bumper', id: pick.id, seconds: pick.durationSeconds, media: pick });
    left -= pick.durationSeconds;
  }
  if (left > 0) items.push({ type: 'hold', seconds: left });
  return items;
}

// Fills one break with real ads for the moment it plays.
//   brk      { at, pieces }
//   ads      eligible ads: { id, title, durationSeconds, weight, house, brand, ... }
//   bumpers  approved channel clips: { id, title, kind, durationSeconds, ... }
// Returns { booked, items, adsSeconds, bumperSeconds, holdSeconds, cardSeconds }
// where items play in order and their seconds add up to `booked` exactly.
export function fillBreak(brk, { ads = [], bumpers = [], roundTo = DEFAULT_ROUND, mergeAdjacent = true, autoBumper = 'station_id', rng = Math.random } = {}) {
  const booked = bookedSeconds(brk, roundTo);
  const used = new Set();
  const items = [];
  let adsTotal = 0;
  let brand = null;
  const place = (ad) => {
    used.add(ad.id);
    items.push({ type: 'ad', id: ad.id, seconds: ad.durationSeconds, ad });
    adsTotal += ad.durationSeconds;
  };
  const pick = (cands) => weightedPick(cands.filter((a) => !used.has(a.id) && a.durationSeconds > 0), rng);

  // Group the pieces: pinned ads are fixed; fillable sections next to each
  // other become one pool when the merge setting is on.
  const pools = [];
  let run = null;
  for (const p of brk && Array.isArray(brk.pieces) ? brk.pieces : []) {
    if (p.kind === 'pinned') { run = null; pools.push({ kind: 'pinned', piece: p }); continue; }
    if (mergeAdjacent && run) { run.pieces.push(p); run.seconds += pieceSeconds(p); continue; }
    run = { kind: 'pool', pieces: [p], seconds: pieceSeconds(p) };
    pools.push(run);
  }

  // Pinned ads are spoken for before any section draws, so a fallback
  // earlier in the break can't use one up.
  const reserved = new Set();
  for (const pool of pools) {
    if (pool.kind !== 'pinned') continue;
    const ad = ads.find((a) => a.id === pool.piece.adId);
    if (ad && !reserved.has(ad.id)) { reserved.add(ad.id); used.add(ad.id); }
  }

  for (let pool of pools) {
    if (pool.kind === 'pinned') {
      const ad = ads.find((a) => a.id === pool.piece.adId);
      if (ad && reserved.has(ad.id)) {
        reserved.delete(ad.id);
        used.delete(ad.id);
        place(ad);
        if (!brand && ad.brand) brand = ad.brand;
        continue;
      }
      // The pinned ad is gone (paused, deleted): its seconds become an exact section.
      pool = { kind: 'pool', pieces: [{ kind: 'exact', seconds: pool.piece.seconds }], seconds: pool.piece.seconds };
    }
    const single = pool.pieces.length === 1 ? pool.pieces[0] : null;
    let left = pool.seconds;
    if (single && single.kind === 'exact') {
      const ad = pick(ads.filter((a) => a.durationSeconds === single.seconds)) || houseFallback(ads, used, left, rng);
      if (ad) { place(ad); left -= ad.durationSeconds; }
    } else if (single && single.kind === 'range') {
      const ad = pick(ads.filter((a) => a.durationSeconds >= single.min && a.durationSeconds <= single.max)) || houseFallback(ads, used, left, rng);
      if (ad) { place(ad); left -= ad.durationSeconds; }
    } else {
      // A flex block, or merged sections: pack ads of any length until nothing fits.
      let guard = 0;
      while (left > 0 && guard++ < 50) {
        const ad = pick(ads.filter((a) => a.durationSeconds <= left));
        if (!ad) break;
        place(ad);
        left -= ad.durationSeconds;
      }
    }
  }

  const tailItems = fillBumpers(booked - adsTotal, { bumpers, autoBumper, brand, rng });
  const all = [...items, ...tailItems];
  const sum = (type) => all.filter((i) => i.type === type).reduce((s, i) => s + i.seconds, 0);
  return { booked, items: all, adsSeconds: adsTotal, bumperSeconds: sum('bumper'), cardSeconds: sum('card'), holdSeconds: sum('hold') };
}

// How many eligible ads could fill a piece today (shown on the palette).
export function eligibleCount(piece, ads) {
  return (ads || []).filter((a) => adFitsPiece(a, piece)).length;
}
