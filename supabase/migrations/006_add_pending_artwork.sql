-- Closes a real approval gap: poster/thumbnail changes on an already-
-- live episode, and ALL series-level trailer/poster/thumbnail changes,
-- previously took effect immediately with no admin review at all —
-- unlike new submissions, deletions, and video replacement, which all
-- already require approval.
--
-- These pending_* columns are staging areas. A creator's upload writes
-- here, not to the live poster/thumbnail/trailer_src columns — so public
-- reads (lib/publicEpisodes.js, lib/episodes.js, lib/series.js) are
-- completely unaffected by an unapproved change, since they never look at
-- these columns at all. An admin approving the change is what actually
-- copies pending_* into the live column; denying just clears pending_*
-- (see pages/api/admin/resolve-artwork.js for both).
--
-- Episodes only stage when already approved/live — an episode still
-- awaiting its first review doesn't need a second approval gate, since
-- its artwork is just part of that same pending review. Series have no
-- equivalent "not live yet" state to lean on, so series changes always
-- stage, every time.

alter table episodes add column if not exists pending_poster text;
alter table episodes add column if not exists pending_thumbnail text;

alter table series add column if not exists pending_poster text;
alter table series add column if not exists pending_thumbnail text;
alter table series add column if not exists pending_trailer_src text;
