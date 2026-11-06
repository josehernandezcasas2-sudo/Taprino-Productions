import { creditLines, normalizeCredits, runnerOf } from './showRules';
import { getPublicProfilesByIds, profilePath } from './userProfiles';

// The credit lines viewers read on a series page and an episode page
// (decision 20; slice 4): "Made by Mara Reyes" (or "Hosted by" on a
// podcast), then the optional Studio and Producer, in the order the show's
// owner chose — lib/showRules.js creditLines, the same rule the editors'
// "On the page: …" preview uses. Server only (it reads profiles).
//
// publicCreditLines({ episode, series, fallbackArtist }) →
//   [{ key: 'maker' | 'studio' | 'producer', label, name, href }]
// where `href` is the account's profile ("/profile/marareyes") when that
// line belongs to an account with a profile, else null. A linked
// account's id never leaves the server (only its profile link does).
// When no Made by line comes out (a show from before owners were stored,
// with no artist anywhere) and `fallbackArtist` is given, a plain
// "Made by <fallbackArtist>" line goes first. When the profiles can't be
// read, the lines keep their typed names and drop the ones that only had
// an account's name.
//
// The answer also carries, out of JSON's sight, `profiles` (the read
// profiles by id) for notesFrom below.
function idOf(c) {
  return c && c.userId ? c.userId : null;
}

export async function publicCreditLines({ episode = null, series = null, fallbackArtist = null } = {}) {
  const own = normalizeCredits(episode ? episode.credits : null);
  const shows = normalizeCredits(series ? series.credits : null);
  // normalizeCredits drops a non-enumerable id on its copy; read the ids
  // from the objects themselves (lib/series.js creditsWithHiddenIds).
  const rawId = (obj, key) => (obj && obj.credits && obj.credits[key] ? idOf(obj.credits[key]) : null);
  const makerId = runnerOf(series) || (episode ? episode.submittedBy || episode.submitted_by || null : null);
  const ids = [
    makerId,
    rawId(episode, 'studio') || idOf(own.studio),
    rawId(episode, 'producer') || idOf(own.producer),
    rawId(series, 'studio') || idOf(shows.studio),
    rawId(series, 'producer') || idOf(shows.producer)
  ].filter(Boolean);
  let profiles = {};
  try {
    profiles = ids.length ? await getPublicProfilesByIds(ids) : {};
  } catch (err) {
    console.error('publicCreditLines profiles:', err && err.message);
    profiles = {};
  }
  const real = (id) => (id && profiles[id] && !profiles[id].isPlaceholder ? profiles[id] : null);
  const names = (id) => {
    const p = real(id);
    return p ? p.displayName : null;
  };
  const lines = creditLines(withIds(episode), withIds(series), names).map((line) => {
    const p = real(line.userId);
    // The Made by line's account is the show's runner (or the uploader);
    // its words may be a typed artist. It links to that account only when
    // the words are that account's name — a contributor's "Made by Dee
    // Park" on Mara's show never links to Mara. A Studio or Producer line
    // with a linked account links (the owner picked that account for it).
    const linked = p && (line.key !== 'maker' || String(p.displayName || '').trim() === String(line.name || '').trim());
    return { key: line.key, label: line.label, name: line.name, href: linked ? profilePath(p) : null };
  });
  if (!lines.some((l) => l.key === 'maker') && typeof fallbackArtist === 'string' && fallbackArtist.trim()) {
    lines.unshift({ key: 'maker', label: 'Made by', name: fallbackArtist.trim(), href: null });
  }
  Object.defineProperty(lines, 'profiles', { value: profiles, enumerable: false });
  return lines;
}

// creditLines reads ids through normalizeCredits, which keeps `userId`
// only when it is an own enumerable property's value; hand it a copy whose
// credits carry the ids in the open (server side only, never returned).
function withIds(obj) {
  if (!obj || typeof obj !== 'object' || !obj.credits || typeof obj.credits !== 'object') return obj;
  const credits = { ...obj.credits };
  for (const key of ['studio', 'producer']) {
    const c = obj.credits[key];
    if (c && typeof c === 'object') credits[key] = { name: c.name ?? null, userId: c.userId ?? null };
  }
  const copy = { ...obj, credits };
  // Keep the fields creditLines reads that may be non-enumerable.
  if (obj.submittedBy !== undefined && copy.submittedBy === undefined) copy.submittedBy = obj.submittedBy;
  return copy;
}

// Whose notes an episode's own page shows ("Notes from Mara"): the Made by
// line's first word when that line links to an account whose display name
// is the line's text, else the whole Made by text, else null.
export function notesFrom(lines, profiles = lines && lines.profiles) {
  const maker = (lines || []).find((l) => l && l.key === 'maker');
  if (!maker || !maker.name) return null;
  if (maker.href && profiles) {
    const p = Object.values(profiles).find((x) => x && !x.isPlaceholder && profilePath(x) === maker.href);
    if (p && p.displayName && p.displayName.trim() === maker.name.trim()) return maker.name.trim().split(/\s+/)[0];
  }
  return maker.name;
}
