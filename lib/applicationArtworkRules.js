// Pure, no imports: where /admin/applications opens an applicant's poster
// and still (2026-11-16). They are kept in the private bucket until Accept
// (`private:apply-<id>-…`, lib/creatorApplications.js), and the page may be
// open for hours, so its rows carry a route that signs a fresh link each
// time it is opened (/api/admin/application-artwork, the team only) rather
// than a link that stops working after an hour. A public address (stored
// before 2026-11-16, or the title's own copy after Accept) stays as it is.
// Tested by scripts/test-round-nov16.mjs.

const PRIVATE_PREFIX = 'private:';
const isPrivate = (ref) => typeof ref === 'string' && ref.startsWith(PRIVATE_PREFIX) && ref.length > PRIVATE_PREFIX.length;

export const ARTWORK_KINDS = Object.freeze(['poster', 'thumbnail']);

export function applicationArtworkRoute(id, kind) {
  return `/api/admin/application-artwork?id=${encodeURIComponent(String(id))}&kind=${ARTWORK_KINDS.includes(kind) ? kind : 'poster'}`;
}

// A row with its two pictures as addresses the team's page can open.
export function withArtworkRoutes(row) {
  if (!row) return row;
  const route = (ref, kind) => (!ref ? null : isPrivate(ref) ? applicationArtworkRoute(row.id, kind) : ref);
  return { ...row, poster: route(row.poster, 'poster'), thumbnail: route(row.thumbnail, 'thumbnail') };
}
