// Season art and the newest season as the hero (migration 122; Jose,
// 2026-11-12: "when a new season comes out, the newest season image/art
// come out as the hero image. have that as toggle in the series
// dashboard/settings").
//
// A show keeps one 16:9 landscape picture per season:
//   series.season_art          the live ones: [{ number: 2, image: "https://…" }]
//   series.pending_season_art  what waits for approval on a live show:
//                              [{ number: 2, image: "https://…" | null }]
//                              (null image = removing that season's art);
//                              null when nothing waits
//   series.newest_season_hero  the switch, on by default: while it is on
//                              and the newest released season (the highest
//                              season number with at least one public
//                              episode) has live art, that art is the
//                              show's hero image — the series page and the
//                              browse heroes. Otherwise the show's own hero
//                              art, as before.
// A waiting picture never reaches a viewer: only season_art is read for
// the hero, and only the live list rides on the public show.
//
// Pure and client-safe, and it imports nothing, so the app's copy
// (mobile/src/lib/seasonArt.js) is this file word for word below its
// header: scripts/test-season-art.mjs checks that and runs every case on
// both. Change both together.

export const SEASON_ART_MAX_SEASON = 9999;
// How many seasons a show keeps art for (the season labels' cap).
export const SEASON_ART_MAX = 100;
// How many new pictures (or removals) one save carries: Edit show's body
// is capped at 10 MB, and every picture is a data URL in it.
export const SEASON_ART_PER_SAVE = 4;
export const SEASON_ART_122_MSG = 'Season art needs a database update (migration 122).';

const IMAGE_MAX = 2000;

function own(o, k) {
  return Boolean(o) && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k);
}

function pick(o, camel, snake) {
  if (own(o, camel)) return o[camel];
  if (own(o, snake)) return o[snake];
  return undefined;
}

function seasonNumber(v) {
  const n = typeof v === 'string' && /^\s*\d+\s*$/.test(v) ? Number(v) : v;
  return Number.isInteger(n) && n > 0 && n <= SEASON_ART_MAX_SEASON ? n : null;
}

function imageUrl(v) {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s || s.length > IMAGE_MAX || !/^https?:\/\/[^\s"'<>]+$/i.test(s)) return null;
  return s;
}

function parseList(raw) {
  let list = raw;
  if (typeof list === 'string') {
    try {
      list = JSON.parse(list);
    } catch (err) {
      return [];
    }
  }
  return Array.isArray(list) ? list : [];
}

// The live list, cleaned: one picture per season (the first one listed
// wins), sorted by season; anything else is dropped.
export function normalizeSeasonArt(raw) {
  const out = [];
  for (const entry of parseList(raw)) {
    const number = seasonNumber(entry && entry.number);
    const image = imageUrl(entry && entry.image);
    if (!number || !image || out.some((x) => x.number === number)) continue;
    out.push({ number, image });
  }
  return out.sort((a, b) => a.number - b.number).slice(0, SEASON_ART_MAX);
}

// What waits, cleaned: a picture, or null for a removal.
export function normalizePendingSeasonArt(raw) {
  const out = [];
  for (const entry of parseList(raw)) {
    const number = seasonNumber(entry && entry.number);
    if (!number || out.some((x) => x.number === number)) continue;
    const image = entry && entry.image === null ? null : imageUrl(entry && entry.image);
    if (entry && entry.image !== null && !image) continue;
    out.push({ number, image });
  }
  return out.sort((a, b) => a.number - b.number).slice(0, SEASON_ART_MAX);
}

// The column's value for a waiting list: null when nothing waits.
export function pendingColumnValue(list) {
  const clean = normalizePendingSeasonArt(list);
  return clean.length ? clean : null;
}

export function seasonArtEntry(list, number) {
  const n = seasonNumber(number);
  if (!n) return null;
  return (Array.isArray(list) ? list : []).find((x) => x && x.number === n) || null;
}

// Whether a show row has migration 122's columns (a row read with
// select('*'), or the camelCase show).
export function hasSeasonArtColumns(show) {
  return own(show, 'season_art') || own(show, 'seasonArt');
}

// The switch: on unless it says off (a show from before 122 reads as on).
export function newestSeasonHeroOn(show) {
  return pick(show, 'newestSeasonHero', 'newest_season_hero') !== false;
}

// --- which season is out -------------------------------------------------------

function timeOf(v) {
  if (v === null || v === undefined || v === '') return null;
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? t : null;
}

// Does this episode count as released? The callers pass the public
// episodes (lib/publicEpisodes.js); a row that says otherwise — a status
// other than approved, held, its removal asked for, withdrawn, an extra,
// or not out yet — doesn't count.
export function countsAsReleased(ep, now = Date.now()) {
  if (!ep || typeof ep !== 'object') return false;
  if (pick(ep, 'contentType', 'content_type') === 'bonus') return false;
  const status = pick(ep, 'status', 'status');
  if (status !== undefined && status !== null && status !== 'approved') return false;
  if (pick(ep, 'held', 'moderation_hold') === true) return false;
  if (pick(ep, 'deletionRequested', 'deletion_requested') === true) return false;
  if (timeOf(pick(ep, 'withdrawnAt', 'withdrawn_at')) !== null) return false;
  const from = timeOf(pick(ep, 'availableFrom', 'available_from'));
  if (from !== null && from > now) return false;
  return true;
}

// The highest season number with at least one released episode (an
// episode without a season is Season 1), or null when nothing is out.
export function newestReleasedSeason(episodes, now = Date.now()) {
  let best = null;
  for (const ep of Array.isArray(episodes) ? episodes : []) {
    if (!countsAsReleased(ep, now)) continue;
    const s = seasonNumber(pick(ep, 'season', 'season')) || 1;
    if (best === null || s > best) best = s;
  }
  return best;
}

// The hero's season art: { season, image } while the switch is on and the
// newest released season has live art; else null (the show's own hero
// art stands). `episodes` = the show's public episodes. A waiting picture
// is never looked at.
export function seasonHero(show, episodes, now = Date.now()) {
  if (!show || typeof show !== 'object' || !newestSeasonHeroOn(show)) return null;
  const art = normalizeSeasonArt(pick(show, 'seasonArt', 'season_art'));
  if (art.length === 0) return null;
  const season = newestReleasedSeason(episodes, now);
  if (!season) return null;
  const entry = seasonArtEntry(art, season);
  return entry ? { season, image: entry.image } : null;
}

// The show's hero image: the newest season's art when it applies, else
// its own hero image (or null).
export function showHeroImage(show, episodes, now = Date.now()) {
  const hero = seasonHero(show, episodes, now);
  if (hero) return hero.image;
  const own = pick(show, 'heroImage', 'hero_image');
  return typeof own === 'string' && own ? own : null;
}

// --- the editors ---------------------------------------------------------------

// One row per season the show has — its episodes', its labels', and any
// season that has (or waits for) art — with what is live and what waits.
//   seasons = [{ number, label }] (the show's seasons with their words)
//   → [{ number, label, live, staged, removal }]
export function seasonArtRows({ seasons = [], live = [], pending = [] } = {}) {
  const art = normalizeSeasonArt(live);
  const waits = normalizePendingSeasonArt(pending);
  const labels = new Map();
  for (const s of Array.isArray(seasons) ? seasons : []) {
    const n = seasonNumber(s && s.number);
    if (n && !labels.has(n)) labels.set(n, s && typeof s.label === 'string' && s.label ? s.label : `Season ${n}`);
  }
  const numbers = [...new Set([...labels.keys(), ...art.map((x) => x.number), ...waits.map((x) => x.number)])].sort((a, b) => a - b);
  return numbers.map((number) => {
    const l = seasonArtEntry(art, number);
    const w = seasonArtEntry(waits, number);
    return {
      number,
      label: labels.get(number) || `Season ${number}`,
      live: l ? l.image : null,
      staged: w && w.image ? w.image : null,
      removal: Boolean(w && w.image === null)
    };
  });
}

// The field a change waiting for one season goes by in "Waiting for
// approval" (lib/stagedChanges.js): 'seasonArt:2'.
export function seasonArtField(number) {
  const n = seasonNumber(number);
  return n ? `seasonArt:${n}` : null;
}

export function seasonOfArtField(field) {
  const m = typeof field === 'string' ? /^seasonArt:(\d{1,4})$/.exec(field) : null;
  return m ? seasonNumber(Number(m[1])) : null;
}

export function isSeasonArtField(field) {
  return seasonOfArtField(field) !== null;
}

// --- the changes ---------------------------------------------------------------

// What a save asks for, cleaned: [{ number, image } | { number, remove:
// true }] where image is the uploaded picture's address. Throws an Error
// with the line to show for anything that can't be saved.
export function checkSeasonArtChanges(raw, { allowed = null } = {}) {
  if (!Array.isArray(raw)) throw new Error('Season art is a list of seasons.');
  if (raw.length === 0) return [];
  if (raw.length > SEASON_ART_PER_SAVE) throw new Error(`Up to ${SEASON_ART_PER_SAVE} seasons’ art in one save — save these, then the rest.`);
  const out = [];
  for (const entry of raw) {
    const number = seasonNumber(entry && entry.number);
    if (!number) throw new Error('Which season?');
    if (out.some((x) => x.number === number)) throw new Error(`Season ${number} is in there twice.`);
    if (allowed && !allowed.includes(number)) throw new Error(`The show has no Season ${number}.`);
    const remove = Boolean(entry && entry.remove === true);
    const hasPicture = Boolean(entry && typeof entry.imageBase64 === 'string' && entry.imageBase64);
    if (remove === hasPicture) throw new Error(`Season ${number}: upload a picture or remove it — one or the other.`);
    out.push(remove ? { number, remove: true } : { number, imageBase64: entry.imageBase64, fileName: typeof entry.fileName === 'string' ? entry.fileName.slice(0, 200) : null });
  }
  return out;
}

// Applies cleaned changes, each with its uploaded `image` (or remove), to
// the live and waiting lists. mode 'direct' puts them live at once (a
// waiting change for that season is dropped); 'staged' sets what waits.
//   → { live, pending, orphans: [address], applied: [number],
//       staged: [number], notices: [line] }
// Throws an Error with the line for a removal of nothing.
export function applySeasonArtChanges({ live = [], pending = [], changes = [], mode = 'direct' } = {}) {
  let art = normalizeSeasonArt(live);
  let waits = normalizePendingSeasonArt(pending);
  const orphans = [];
  const applied = [];
  const staged = [];
  const notices = [];
  for (const c of changes) {
    const number = seasonNumber(c && c.number);
    if (!number) continue;
    const l = seasonArtEntry(art, number);
    const w = seasonArtEntry(waits, number);
    const image = c.remove ? null : imageUrl(c.image);
    if (!c.remove && !image) continue;
    if (mode === 'staged') {
      if (c.remove) {
        if (!l) {
          if (!w) throw new Error(`Season ${number} has no art to remove.`);
          // Nothing live: taking it out is taking the waiting one back.
          if (w.image) orphans.push(w.image);
          waits = waits.filter((x) => x.number !== number);
          notices.push(`The Season ${number} art that was waiting is taken back.`);
          continue;
        }
        if (w && w.image) {
          orphans.push(w.image);
          notices.push(`Removing the Season ${number} art replaces the picture that was waiting.`);
        }
        waits = [...waits.filter((x) => x.number !== number), { number, image: null }];
      } else {
        if (w && w.image) {
          orphans.push(w.image);
          notices.push(`The new Season ${number} art replaces the one that was waiting.`);
        }
        waits = [...waits.filter((x) => x.number !== number), { number, image }];
      }
      staged.push(number);
    } else {
      if (w && w.image) orphans.push(w.image);
      if (w) waits = waits.filter((x) => x.number !== number);
      if (c.remove) {
        if (!l) {
          if (!w) throw new Error(`Season ${number} has no art to remove.`);
          applied.push(number);
          continue;
        }
        orphans.push(l.image);
        art = art.filter((x) => x.number !== number);
      } else {
        if (l && l.image !== image) orphans.push(l.image);
        art = [...art.filter((x) => x.number !== number), { number, image }];
      }
      applied.push(number);
    }
  }
  return { live: normalizeSeasonArt(art), pending: normalizePendingSeasonArt(waits), orphans, applied, staged, notices };
}

// The team's decision on the waiting art of some seasons: approve puts it
// live (a removal takes the live one down), deny drops it.
//   → { live, pending, orphans: [{ image, why }], decided: [number] }
// Throws an Error when a season has nothing waiting.
export function decideSeasonArtEntries({ live = [], pending = [], seasons = [], approve = false } = {}) {
  let art = normalizeSeasonArt(live);
  let waits = normalizePendingSeasonArt(pending);
  const orphans = [];
  const decided = [];
  for (const raw of seasons) {
    const number = seasonNumber(raw);
    const w = number ? seasonArtEntry(waits, number) : null;
    if (!w) throw new Error('Nothing is waiting on this one any more. Reload the list.');
    const l = seasonArtEntry(art, number);
    if (approve) {
      if (w.image) {
        if (l && l.image !== w.image) orphans.push({ image: l.image, why: `Season ${number} art change approved (old picture)` });
        art = [...art.filter((x) => x.number !== number), { number, image: w.image }];
      } else if (l) {
        orphans.push({ image: l.image, why: `Season ${number} art removal approved` });
        art = art.filter((x) => x.number !== number);
      }
    } else if (w.image) {
      orphans.push({ image: w.image, why: `Season ${number} art change denied` });
    }
    waits = waits.filter((x) => x.number !== number);
    decided.push(number);
  }
  return { live: normalizeSeasonArt(art), pending: normalizePendingSeasonArt(waits), orphans, decided };
}

// The owner takes back what waits for one season.
//   → { pending, orphan: address | null } — throws when nothing waits.
export function cancelSeasonArtEntry(pending, number) {
  const waits = normalizePendingSeasonArt(pending);
  const w = seasonArtEntry(waits, number);
  if (!w) throw new Error('Nothing is waiting for approval there.');
  return { pending: waits.filter((x) => x.number !== w.number), orphan: w.image || null };
}

// Every picture a show row holds for its seasons, live and waiting (a
// removed show's files go to Orphaned media).
export function seasonArtImages(show) {
  const live = normalizeSeasonArt(pick(show, 'seasonArt', 'season_art')).map((x) => x.image);
  const waits = normalizePendingSeasonArt(pick(show, 'pendingSeasonArt', 'pending_season_art')).map((x) => x.image).filter(Boolean);
  return [...new Set([...live, ...waits])];
}

// "Season 2 art" / "Season 2 · The Return art" in the editors and the
// admin's list; `label` is the season's own words (seasonLabel).
export function seasonArtLabel(number, label = null) {
  return `${label || `Season ${number}`} art`;
}
