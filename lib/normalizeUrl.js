// Guarantees an absolute URL with a protocol. Without this, a bare
// "example.com" typed into any URL field renders as a RELATIVE link in
// an <a href> — browsers resolve it against the current page instead of
// treating it as an external site, so "Shop" or "Fund this project"
// would silently open studiotapatv.site/example.com instead of the
// intended destination. Used everywhere a user-typed URL gets persisted.
export function normalizeUrl(url) {
  if (!url) return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}
