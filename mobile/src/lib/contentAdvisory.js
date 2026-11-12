import { useEffect, useState } from 'react';
import { API_BASE_URL } from './api';

// Mirrors lib/contentAdvisory.js + the parts of lib/ageGate.js it needs:
// which titles get the advisory card after Play, and what it says. The
// live ratings list comes from /api/ratings (custom ratings carry their
// own minimum age and PNG bug); the table below is the fallback.
const MIN_AGE_BY_RATING = {
  G: 0, 'TV-Y': 0, 'TV-G': 0, PG: 0, 'TV-PG': 0, 'TV-Y7': 7, 'PG-13': 13, 'TV-14': 14, R: 17, 'NC-17': 17, 'TV-MA': 17, 'Not Rated': 17
};
const ADULT_AGE = 17;
export const ADVISORY_MS = 5000;

let shared = null;
export function useContentRatings() {
  const [list, setList] = useState(shared);
  useEffect(() => {
    if (shared) return undefined;
    let alive = true;
    fetch(`${API_BASE_URL}/api/ratings`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (alive && d && Array.isArray(d.ratings) && d.ratings.length) {
          shared = d.ratings;
          setList(d.ratings);
        }
      })
      .catch(() => {});
    return () => { alive = false; };
  }, []);
  return list;
}

export function requiredAgeFor(rating, ratings) {
  let required = MIN_AGE_BY_RATING[rating];
  if (Array.isArray(ratings)) {
    const live = ratings.find((r) => r.code === rating);
    if (live && Number.isFinite(live.minAge)) required = live.minAge;
  }
  return required === undefined ? MIN_AGE_BY_RATING['Not Rated'] : required;
}

export function advisoryFor(episode, ratings) {
  if (!episode) return null;
  const isSeries = episode.contentType === 'series';
  const rating = episode.rating || null;
  // No rating and no type (a Film University lesson): nothing to say. An
  // unrated film or short is a different thing — it's treated as 17+.
  if (!isSeries && !rating && !episode.contentType) return null;
  const code = rating || 'Not Rated';
  const minAge = requiredAgeFor(code, ratings);
  if (!isSeries && minAge < 13) return null;
  const live = Array.isArray(ratings) ? ratings.find((r) => r.code === code) : null;
  const level = minAge >= ADULT_AGE ? 'mature' : minAge >= 13 ? 'teen' : 'all';
  return {
    code,
    minAge,
    level,
    imageUrl: live && live.imageUrl ? live.imageUrl : null,
    kicker: rating ? (live && live.label ? live.label : null) : 'Not yet rated · treated as 17+',
    headline: level === 'mature'
      ? 'This program contains mature content.'
      : level === 'teen'
        ? 'This program may not be suitable for younger viewers.'
        : 'This program is suitable for all audiences.',
    line: level === 'all' ? null : 'Viewer discretion is advised.'
  };
}

// The flashing-lights warning (Jose, 2026-11-12: "add the flashing light
// warning on the film page and before the video plays, similar to how the
// tv rating is on some tvs"): a title marked has_flashing_lights
// (episode.hasFlashingLights) gets a photosensitivity card when the
// programme itself starts, and the video waits at its first frame under it
// until the card ends or the viewer dismisses it. Never for a trailer (the
// player passes no advisory for one).
export const FLASHING_KICKER = 'WARNING';
export const FLASHING_HEADLINE = 'This program contains flashing lights that may affect viewers with photosensitive epilepsy.';
export const DISCRETION_LINE = 'Viewer discretion is advised.';
export const FLASHING_CHIP = 'Flashing lights';

export function flashingLightsFor(episode) {
  if (!episode || episode.hasFlashingLights !== true) return null;
  return { kicker: FLASHING_KICKER, headline: FLASHING_HEADLINE, line: DISCRETION_LINE };
}

// The one card shown when the programme starts: the rating advisory
// (advisoryFor) and the flashing-lights warning on one card when a title
// has both, never two in a row. Null when there is nothing to say.
//   → { rating: advisoryFor's answer (its discretion line left to the
//       warning when both are there) | null, flashing: { kicker, headline,
//       line } | null, holds (the video waits at its first frame under the
//       card: the warning's), label (the card in one line, for a screen
//       reader) }
export function playbackAdvisoryFor(episode, ratings) {
  const rating = advisoryFor(episode, ratings);
  const flashing = flashingLightsFor(episode);
  if (!rating && !flashing) return null;
  const ratingPart = rating && flashing ? { ...rating, line: null } : rating;
  const words = [
    ratingPart ? `Rated ${ratingPart.code}.` : null,
    ratingPart ? ratingPart.headline : null,
    ratingPart && ratingPart.line ? ratingPart.line : null,
    flashing ? `Warning. ${flashing.headline}` : null,
    flashing ? flashing.line : null
  ].filter(Boolean);
  return { rating: ratingPart, flashing, holds: Boolean(flashing), label: words.join(' ') };
}
