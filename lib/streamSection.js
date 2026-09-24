// Which pages count as "the Stream side" of the site, for anything that
// needs to visually distinguish Stream from Connect — currently just
// HeaderNav's Connect/Stream kicker. A superset of MobileTabBar's "Watch"
// tab match (adds /stream itself, plus the episode/series/podcast detail
// pages you land on from watching) rather than reusing that match
// directly, since the two answer different questions: "is the Watch tab
// the active tab" vs "is this the Stream half of the site."
export function isStreamPath(pathname, query = {}) {
  return (
    pathname === '/stream' ||
    (pathname === '/type/[type]' && (query.type === 'series' || query.type === 'movie')) ||
    pathname === '/podcasts' ||
    pathname === '/podcasts/[id]' ||
    pathname === '/vertical/browse' ||
    pathname === '/episode/[id]' ||
    pathname === '/series/[id]'
  );
}
