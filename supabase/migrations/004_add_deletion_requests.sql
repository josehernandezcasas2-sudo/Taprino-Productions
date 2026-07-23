-- Deletion requests are NOT an immediate hard delete — a creator can
-- request that an episode or series be taken down, with a required
-- reason, but the actual row removal only happens when an admin confirms
-- it (see pages/api/admin/resolve-deletion.js). This mirrors the same
-- "creator proposes, admin decides" shape as the episode approval flow.
--
-- deletion_requested = true immediately hides the item from public reads
-- (see lib/publicEpisodes.js, lib/episodes.js, lib/series.js) even before
-- an admin acts on it — a creator asking for their own content to come
-- down shouldn't have to wait on a review cycle for that part.
--
-- Safe to run even if columns already exist (IF NOT EXISTS).

alter table episodes add column if not exists deletion_requested boolean not null default false;
alter table episodes add column if not exists deletion_reason text;
alter table episodes add column if not exists deletion_requested_at timestamptz;

alter table series add column if not exists deletion_requested boolean not null default false;
alter table series add column if not exists deletion_reason text;
alter table series add column if not exists deletion_requested_at timestamptz;

create index if not exists idx_episodes_deletion_requested on episodes(deletion_requested) where deletion_requested = true;
create index if not exists idx_series_deletion_requested on series(deletion_requested) where deletion_requested = true;
