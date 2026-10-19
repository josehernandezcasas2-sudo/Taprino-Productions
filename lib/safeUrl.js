// Links people type in (portfolios, file links, an advertiser's click-
// through) are only ever web addresses. Anything else, javascript: above
// all, must never become an href: React still renders javascript: URLs,
// and one clicked by an admin runs in the admin's session.

// The URL, trimmed, if it's an http(s) address; otherwise null.
export function httpUrlOrNull(raw, max = 2000) {
  if (raw == null) return null;
  const s = String(raw).trim().slice(0, max);
  if (!s) return null;
  try {
    const u = new URL(s);
    return u.protocol === 'https:' || u.protocol === 'http:' ? s : null;
  } catch {
    return null;
  }
}

export function isHttpUrl(raw) {
  return httpUrlOrNull(raw) !== null;
}
