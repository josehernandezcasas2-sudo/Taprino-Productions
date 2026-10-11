// Whether a parent series hides its episodes from the public: pulled for
// review, being deleted, or not approved. lib/publicEpisodes.js and
// lib/episodes.js both apply it so the catalogue and a direct episode
// lookup agree (deleting a series used to leave its episodes in search,
// Continue Watching and recs). Pre-053 rows have no status and count as
// approved.
export function seriesHidden(series) {
  if (!series) return false;
  return Boolean(series.moderation_hold || series.deletion_requested || (series.status && series.status !== 'approved'));
}
