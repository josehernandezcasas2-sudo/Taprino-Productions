// Postgres LIKE/ILIKE treats % and _ as wildcards (and \ as the escape),
// so anything a person typed must go through this before it reaches
// .ilike() — otherwise "A%" matches every code starting with A. Escaped,
// .ilike(col, likeLiteral(text)) is a plain case-insensitive equality.
//
// PostgREST also reads `*` in a like/ilike pattern as `%` (an alias, so a
// pattern needs no URL encoding), and has no way to ask for a literal `*`.
// It is escaped here as well, so it can never act as a wildcard: `\*`
// reaches Postgres as an escaped character either way. A lookup that must
// answer "the same text, nothing else" (an email, a handle) answers no
// match at all for a value with a `*` (hasLikeStar), since it can't be
// asked for exactly (2026-11-15).
export function likeLiteral(s) {
  return String(s).replace(/[\\%_*]/g, (c) => `\\${c}`);
}

export function hasLikeStar(s) {
  return String(s).includes('*');
}
