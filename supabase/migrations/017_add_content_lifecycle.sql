-- Content lifecycle: start/end availability dates, plus the admin-tunable
-- windows that turn those dates into "New Releases" and "Leaving Soon"
-- rows. Deliberately reuses the EXISTING deletion_requested mechanism for
-- the actual removal step, rather than inventing a parallel one — once
-- available_until passes, an episode gets deletion_requested = true set
-- automatically (see pages/api/cron/expire-content.js), which already:
--   - hides it from getPublicEpisodes() / getAllSeries() (both already
--     filter deletion_requested = false)
--   - surfaces it in the existing /admin pending-deletions queue
--   - lets admin "confirm" (permanently delete) or "deny" (keep it live,
--     clearing the flag) via the existing resolve-deletion endpoint
-- "Stay or go" was already built. This just feeds it automatically.

alter table episodes add column if not exists available_from timestamptz;
alter table episodes add column if not exists available_until timestamptz;
alter table series add column if not exists available_from timestamptz;
alter table series add column if not exists available_until timestamptz;

create index if not exists episodes_available_until_idx on episodes (available_until) where available_until is not null;
create index if not exists series_available_until_idx on series (available_until) where available_until is not null;

-- Singleton settings row, same pattern as channel_settings (id = 1).
create table if not exists content_lifecycle_settings (
  id int primary key default 1,
  new_release_days int not null default 14,
  leaving_soon_days int not null default 7,
  updated_at timestamptz not null default now(),
  constraint content_lifecycle_settings_singleton check (id = 1)
);
insert into content_lifecycle_settings (id, new_release_days, leaving_soon_days)
values (1, 14, 7)
on conflict (id) do nothing;

comment on column episodes.available_from is 'When this episode should start counting as a "new release." Null = no new-release window tracking.';
comment on column episodes.available_until is 'When this episode should leave. Null = stays indefinitely. Once passed, a scheduled job flags it for deletion review.';
