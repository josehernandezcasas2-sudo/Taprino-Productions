// Postgres LIKE/ILIKE treats % and _ as wildcards (and \ as the escape),
// so anything a person typed must go through this before it reaches
// .ilike() — otherwise "A%" matches every code starting with A. Escaped,
// .ilike(col, likeLiteral(text)) is a plain case-insensitive equality.
export function likeLiteral(s) {
  return String(s).replace(/[\\%_]/g, (c) => `\\${c}`);
}
