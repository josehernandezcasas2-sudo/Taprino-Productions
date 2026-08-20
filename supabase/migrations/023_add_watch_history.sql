-- Previously Watched — a real persistent history, separate from
-- watch_progress (which is deliberately transient: it only tracks
-- resume position for in-progress episodes, and clears itself the moment
-- something's finished, by design). This table is where "finished"
-- actually goes, so My List can show it.
--
-- Keyed by Clerk user_id, not Stripe customer id, since this is a
-- signed-in-account feature and shouldn't depend on someone having a
-- Stripe customer record at all — free/comped accounts have neither
-- historically, and there's no reason watch history should require one.
create table if not exists watch_history (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  episode_id text not null,
  watched_at timestamptz not null default now(),
  unique (user_id, episode_id)
);
create index if not exists watch_history_user_idx on watch_history (user_id, watched_at desc);
comment on table watch_history is
  'Previously Watched — recorded once an episode crosses ~95% watched. One row per user+episode; re-watching just bumps watched_at rather than duplicating.';

-- Funding link — an outbound link to the creator's own funding page
-- (Kickstarter, their own site, etc.). Studio Tapa never handles the money
-- itself here; this is just a pointer out, same spirit as the elevator
-- pitch section's "back to project website" link.
alter table episodes add column if not exists funding_url text;
alter table series add column if not exists funding_url text;
comment on column episodes.funding_url is 'Outbound link to the creator''s own funding page for this project, if any.';
comment on column series.funding_url is 'Outbound link to the creator''s own funding page for this series, if any.';
