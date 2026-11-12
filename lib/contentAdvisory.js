import { requiredAgeFor, ADULT_AGE } from './ageGate';

// The content advisory (Jose, 2026-10-20): a network-style card over the
// first seconds of playback, separate from the rating itself. Series get
// one whatever their rating (it says "suitable for all audiences" when
// that's the case); films, shorts and podcasts only when they're 13+ or
// unrated. Nothing for titles with no rating and no type (Film University
// lessons). Client-safe: lib/ageGate.js has no server imports.
export const ADVISORY_MS = 5000;

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
export const FLASHING_HEADLINE = 'This programme contains flashing lights that may affect viewers with photosensitive epilepsy.';
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
