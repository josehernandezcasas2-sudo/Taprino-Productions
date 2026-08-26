// Minimum viewer age required for each rating, following standard MPAA
// (movie) and TV Parental Guidelines conventions. This is deliberately
// conservative where a rating is ambiguous:
// - TV-Y7 literally means "directed to older children, age 7+" — it is
//   NOT the same as TV-Y (all ages), a distinction worth getting right.
// - "Not Rated" has no classification to go on at all. Rather than treat
//   unrated content as automatically safe for anyone, it's treated the
//   same as the most restrictive named rating (17+) — the safer failure
//   mode for a feature whose stated purpose is keeping content away from
//   kids by default, not maximizing how much is visible.
export const MIN_AGE_BY_RATING = {
  'G': 0,
  'TV-Y': 0,
  'TV-G': 0,
  'PG': 0,
  'TV-PG': 0,
  'TV-Y7': 7,
  'PG-13': 13,
  'TV-14': 14,
  'R': 17,
  'NC-17': 17,
  'TV-MA': 17,
  'Not Rated': 17
};

// viewerAge of null/undefined means "unknown" — no profile age set, or
// signed out entirely. Unknown age only clears ratings with no age
// requirement at all; anything requiring 7+ or higher is hidden until an
// age has actually been provided and clears the bar. This is the fail-safe
// direction on purpose: an unset age should never be treated as "assume
// adult."
export function meetsAgeRequirement(viewerAge, rating) {
  const required = MIN_AGE_BY_RATING[rating];
  // A rating this app doesn't recognize shouldn't silently pass through
  // unrestricted - treat it the same as "Not Rated".
  const minAge = required === undefined ? MIN_AGE_BY_RATING['Not Rated'] : required;
  if (minAge === 0) return true;
  if (viewerAge == null) return false;
  return viewerAge >= minAge;
}

// Applied to arrays of episodes (or anything with a `.rating` field) at
// the specific pages where people actually browse/discover content.
// Deliberately NOT baked into getPublicEpisodes() unconditionally — most
// of that function's 30+ call sites are admin tools, sitemaps, and
// static pages that have no viewer-age context and shouldn't need one;
// this only runs where a page has explicitly resolved a viewer age and
// asked for it.
export function filterByAgeRating(items, viewerAge) {
  if (!Array.isArray(items)) return items;
  return items.filter((item) => meetsAgeRequirement(viewerAge, item.rating));
}
