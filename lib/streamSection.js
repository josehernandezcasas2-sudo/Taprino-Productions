// Which pages count as "the Stream side" of the site, for anything that
// needs to visually distinguish Stream from Connect — currently just
// HeaderNav's Connect/Stream kicker. A superset of MobileTabBar's "Watch"
// tab match (adds /stream itself, plus the episode/series/podcast detail
// pages you land on from watching) rather than reusing that match
// directly, since the two answer different questions: "is the Watch tab
// the active tab" vs "is this the Stream half of the site."
//
// The rule (Jose, 2026-10-28, after a page-by-page pass): a page is Stream
// when what's on it is something to watch — the library home, Live TV,
// the type/genre/collection shelves, podcasts, vertical, a title or a
// series, and the viewer's own My List and My Recs, which hold titles.
// Everything else is Connect: the Notice Board, people (profiles, Crew
// Call, Messages), Pitch Room, Locations, Productions, Resources, Film
// University, the account and creator pages, the legal pages, and every
// admin page (the staff tools — Admin Portal, the scheduler, the ad
// curator — are Connect, Jose's call). The app's TopNav.js isStreamRoute
// mirrors this list.
export function isStreamPath(pathname, query = {}) {
  return (
    pathname === '/stream' ||
    pathname === '/live' ||
    pathname === '/live/[slug]' ||
    // Every /type/<x> browse page (series, movie, short, vertical,
    // podcast) is the library — they used to flip the header to Connect.
    pathname === '/type/[type]' ||
    pathname === '/genre/[genre]' ||
    pathname === '/collection/[slug]' ||
    pathname === '/podcasts' ||
    pathname === '/podcasts/[id]' ||
    pathname === '/vertical/browse' ||
    pathname === '/episode/[id]' ||
    pathname === '/series/[id]' ||
    // Saved titles and recommended titles: lists of things to watch, so
    // the header next to them offers Series/Films/Vertical/Podcasts, not
    // Crew Call and Locations (they sat on Connect until 2026-10-28).
    pathname === '/wishlist' ||
    pathname === '/recs'
  );
}
