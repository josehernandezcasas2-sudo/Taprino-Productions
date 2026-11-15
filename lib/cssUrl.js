// Client-safe, no imports: the one way a picture's address goes into CSS
// (a `backgroundImage` in a style object, server-rendered into the page's
// HTML). An address someone else typed or uploaded must never be able to
// end the url() and write CSS of its own (a full-page overlay with a fake
// sign-in, say — security fix of 2026-11-15), so the value is always
// quoted, a `"` or `\` inside it is escaped, and a newline or other
// control character becomes a CSS escape instead of ending the string.
// Anything that isn't a picture address — an http(s) URL, a path on this
// site, or a local preview (blob:, data:image/…) the browser made from a
// picked file — becomes `none`.
const ALLOWED = /^(?:https?:\/\/|blob:|data:image\/[a-z0-9.+-]+[;,])/i;

export function cssUrlAllowed(value) {
  if (typeof value !== 'string') return false;
  const v = value.trim();
  if (!v) return false;
  if (v.startsWith('/')) return !v.startsWith('//') && !v.startsWith('/\\');
  return ALLOWED.test(v);
}

export function cssUrl(value) {
  if (!cssUrlAllowed(value)) return 'none';
  const v = value.trim()
    .replace(/[\\"]/g, (c) => `\\${c}`)
    .replace(/[\u0000-\u001f\u007f]/g, (c) => `\\${c.charCodeAt(0).toString(16)} `);
  return `url("${v}")`;
}
