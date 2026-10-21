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
