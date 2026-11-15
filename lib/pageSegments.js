// Pure, no imports: the optional catch-all pages (pages/crew/calls/[[...id]].js,
// pages/messages/[[...id]].js) read one segment at most. Any other address
// under them answers 404 (2026-11-15): a segment with a dot, or more
// segments than the page uses, is refused.
export function segmentsRefused(segments, max = 1) {
  if (segments === undefined || segments === null) return false;
  const list = Array.isArray(segments) ? segments : [segments];
  if (list.length > max) return true;
  return list.some((s) => String(s).includes('.'));
}
