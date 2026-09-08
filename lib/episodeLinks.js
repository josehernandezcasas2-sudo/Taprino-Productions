// The one correct destination for "browse to this content" clicks,
// used everywhere a card/row/list links to something. Podcasts route to
// their show page (/podcasts/[seriesId]) rather than the generic episode
// page — /episode/[id] has no podcast-specific handling at all (no audio
// player for audio-only episodes, no show/host grouping), so landing
// there for podcast content was a real, previously-shipped bug across
// several pages, not a one-off typo in a single file.
//
// Series episodes still go to /episode/[id] here (that page handles
// series correctly, with season/episode navigation) — only podcasts get
// redirected to a different page entirely.
export function episodeHref(ep) {
  if (ep.contentType === 'podcast' && ep.seriesId) {
    return `/podcasts/${ep.seriesId}`;
  }
  return `/episode/${ep.id}`;
}
