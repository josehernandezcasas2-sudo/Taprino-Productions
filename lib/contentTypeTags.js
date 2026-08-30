// Single source of truth for the small content-type label shown on
// library cards and the episode page ("Movie", "Short", "Vertical",
// "Podcast", "Bonus content"). This used to be duplicated across five
// different files (pages/index.js, genre/[genre].js, collection/[slug].js,
// components/GenreRow.js, and pages/episode/[id].js), each with its own
// slightly different — and in most cases incomplete — version. Two of
// those copies only ever checked for 'movie' and silently mislabeled
// vertical, podcast, and bonus content as "Short".
//
// The key doubles as the CSS class name (see .type-line.* and
// .content-type-tag.* in globals.css) — keep them in sync if this changes.
export const CONTENT_TYPE_LABEL = {
  movie: 'Movie',
  short: 'Short',
  vertical: 'Vertical',
  podcast: 'Podcast',
  bonus: 'Bonus content'
};

// Always returns a valid { key, label } pair, even for an unrecognized or
// missing contentType, so callers never have to handle "undefined" text.
export function contentTypeTag(contentType) {
  const key = CONTENT_TYPE_LABEL[contentType] ? contentType : 'short';
  return { key, label: CONTENT_TYPE_LABEL[key] };
}
