// Combined movie (MPAA) and TV (TV Parental Guidelines) ratings. One list
// covers both since a single form can't always know in advance whether
// what's being submitted is a film or a TV-style episode — the person
// filling it out just picks whichever actually applies.
//
// This is the built-in list. The live list, with any custom ratings an
// admin added and the PNG bug for each, comes from lib/ratings.js on the
// server and /api/ratings in the browser (components/RatingOptions.js);
// both fall back to this until migration 076 is in.
export const STANDARD_RATINGS = [
  { code: 'G', label: 'General audiences', minAge: 0 },
  { code: 'PG', label: 'Parental guidance suggested', minAge: 0 },
  { code: 'PG-13', label: 'Parents strongly cautioned', minAge: 13 },
  { code: 'R', label: 'Restricted', minAge: 17 },
  { code: 'NC-17', label: 'Adults only', minAge: 17 },
  { code: 'TV-Y', label: 'All children', minAge: 0 },
  { code: 'TV-Y7', label: 'Directed to older children', minAge: 7 },
  { code: 'TV-G', label: 'General audience', minAge: 0 },
  { code: 'TV-PG', label: 'Parental guidance suggested', minAge: 0 },
  { code: 'TV-14', label: 'Parents strongly cautioned', minAge: 14 },
  { code: 'TV-MA', label: 'Mature audience only', minAge: 17 },
  { code: 'Not Rated', label: 'No rating', minAge: 17 }
];

export const CONTENT_RATINGS = STANDARD_RATINGS.map((r) => r.code);
