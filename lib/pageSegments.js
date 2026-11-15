// Pure, no imports: the optional catch-all pages (pages/crew/calls/[[...id]].js,
// pages/messages/[[...id]].js) read one segment at most. Any other address
// under them answers 404: the middleware leaves out every address that ends
// like a file (`.css`, `.png`…), so `/crew/calls/x.css` used to render the
// whole board with the beta door, the suspension bounce, the AI-crawler
// refusal and the no-index header all skipped (security fix of 2026-11-15).
// A segment with a dot, or more segments than the page uses, is refused.
export function segmentsRefused(segments, max = 1) {
  if (segments === undefined || segments === null) return false;
  const list = Array.isArray(segments) ? segments : [segments];
  if (list.length > max) return true;
  return list.some((s) => String(s).includes('.'));
}
