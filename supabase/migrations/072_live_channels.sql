-- Live channels: /live becomes a channel selector, starting with TapaTV.
--
-- What airs on a channel at any moment, in priority order:
--   1. a live broadcast on that channel (live_streams.channel_id, status 'live')
--   2. that day's slots from a PUBLISHED week (channel_slots, layer 'week')
--   3. the channel's default schedule for that weekday (layer 'default')
--   4. the channel's loop (channel_schedule), only for gaps the default leaves
--
-- Run once in the Supabase SQL editor. Safe to re-run.

/* ---------------- channels ---------------- */

create table if not exists channels (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  number int not null unique,
  description text,
  logo_url text,            -- square, shown in the channel selector
  image_url text,           -- 16:9, channel card + off-air screen
  visibility text not null default 'draft' check (visibility in ('draft', 'public')),
  loop_started_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into channels (slug, name, number, description, visibility)
values ('tapatv', 'TapaTV', 1, 'Studio Tapa''s main channel.', 'public')
on conflict (slug) do nothing;

-- Content Schedulers assigned to maintain a channel. Admin-managed only.
create table if not exists channel_schedulers (
  channel_id uuid not null references channels(id) on delete cascade,
  user_id text not null,
  created_at timestamptz not null default now(),
  primary key (channel_id, user_id)
);
create index if not exists channel_schedulers_user_idx on channel_schedulers (user_id);

/* ---------------- the loop becomes per-channel ---------------- */

alter table channel_schedule add column if not exists channel_id uuid references channels(id) on delete cascade;
update channel_schedule set channel_id = (select id from channels where slug = 'tapatv') where channel_id is null;
alter table channel_schedule alter column channel_id set not null;
drop index if exists channel_schedule_position_idx;
create unique index if not exists channel_schedule_channel_position_idx on channel_schedule (channel_id, position);
-- the old one-row-per-episode rule was global; per channel now
alter table channel_schedule drop constraint if exists channel_schedule_episode_id_key;

-- carry the old singleton loop start over so the loop doesn't jump
update channels c set loop_started_at = s.loop_started_at
from channel_settings s
where c.slug = 'tapatv' and s.id = 1;

/* ---------------- channel-only uploads (bumpers, station IDs, shows) ---------------- */
-- A scheduler's upload that only ever plays on channels. Uploads meant for
-- on-demand too go through the normal creator submission flow instead.
create table if not exists channel_media (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null,
  title text not null,
  kind text not null default 'bumper' check (kind in ('bumper', 'station_id', 'promo', 'show')),
  src text,
  video_provider text not null default 'cloudflare',
  duration_seconds int,
  thumbnail text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  rejection_reason text,
  reviewed_by text,
  reviewed_at timestamptz,
  moderation_hold boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists channel_media_owner_idx on channel_media (owner_id);

/* ---------------- schedule slots ---------------- */

create table if not exists channel_slots (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references channels(id) on delete cascade,
  layer text not null check (layer in ('week', 'default')),
  air_date date,            -- layer 'week': the calendar date (channel time)
  day_of_week text check (day_of_week in ('monday','tuesday','wednesday','thursday','friday','saturday','sunday')),  -- layer 'default'
  start_time time not null, -- channel time (America/Los_Angeles)
  duration_seconds int not null check (duration_seconds > 0),
  kind text not null check (kind in ('episode', 'media', 'ad_break', 'live', 'series_continue', 'series_rerun', 'series_pinned')),
  episode_id text references episodes(id) on delete cascade,
  media_id uuid references channel_media(id) on delete cascade,
  series_id text references series(id) on delete cascade,
  pin_episode_id text references episodes(id) on delete set null,   -- series_pinned: always starts here
  rerun_of uuid references channel_slots(id) on delete cascade,      -- series_rerun: replays this block
  title text,               -- kind 'live': what the guide shows
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint channel_slots_layer_fields check (
    (layer = 'week' and air_date is not null and day_of_week is null) or
    (layer = 'default' and day_of_week is not null and air_date is null)
  ),
  constraint channel_slots_kind_fields check (
    (kind = 'episode' and episode_id is not null) or
    (kind = 'media' and media_id is not null) or
    (kind = 'ad_break') or
    (kind = 'live') or
    (kind in ('series_continue', 'series_pinned') and series_id is not null) or
    (kind = 'series_rerun' and series_id is not null and rerun_of is not null)
  )
);
create index if not exists channel_slots_week_idx on channel_slots (channel_id, air_date) where layer = 'week';
create index if not exists channel_slots_default_idx on channel_slots (channel_id, day_of_week) where layer = 'default';

-- A date uses its 'week' slots only once that week (Monday start) is published.
create table if not exists channel_weeks (
  channel_id uuid not null references channels(id) on delete cascade,
  week_start date not null,
  published_at timestamptz,
  published_by text,
  primary key (channel_id, week_start)
);

-- Where a "Continue" series block is up to. next_episode_id is the first
-- episode it plays on as_of_date; the engine moves it forward only for days
-- the block actually aired.
create table if not exists channel_block_progress (
  slot_id uuid primary key references channel_slots(id) on delete cascade,
  next_episode_id text references episodes(id) on delete set null,
  as_of_date date not null,
  updated_at timestamptz not null default now()
);

-- The old day-of-week schedule becomes TapaTV's default schedule.
insert into channel_slots (channel_id, layer, day_of_week, start_time, duration_seconds, kind, episode_id)
select c.id, 'default', w.day_of_week, w.start_time,
       coalesce(w.ad_duration_seconds, 1800),
       case when w.slot_type = 'ad_break' then 'ad_break' else 'episode' end,
       w.episode_id
from weekly_schedule_slots w
cross join channels c
where c.slug = 'tapatv'
  and not exists (select 1 from channel_slots s where s.channel_id = c.id and s.layer = 'default');
-- (episode durations from the old table are re-read from the episode's runtime by
-- the app the first time the default schedule is opened; 1800 is only a floor.)

-- Broadcasts belong to a channel.
alter table live_streams add column if not exists channel_id uuid references channels(id) on delete set null;
update live_streams set channel_id = (select id from channels where slug = 'tapatv') where channel_id is null;

/* ---------------- creator opt-in ---------------- */

alter table episodes add column if not exists channel_opt_in boolean not null default false;
alter table series add column if not exists channel_opt_in boolean not null default false;
-- Everything that existed before this shipped is Studio Tapa's own content:
-- opted in. Dated, so re-running this file never opts in anyone's later uploads.
update episodes set channel_opt_in = true where created_at < '2026-10-07';
update series set channel_opt_in = true where created_at < '2026-10-07';

/* ---------------- moderation ---------------- */

-- true = pulled from on-demand and every channel until reviewed
alter table episodes add column if not exists moderation_hold boolean not null default false;
alter table series add column if not exists moderation_hold boolean not null default false;

-- Viewer reports. One per account per title.
create table if not exists content_reports (
  id uuid primary key default gen_random_uuid(),
  target_type text not null check (target_type in ('episode', 'series', 'channel_media')),
  target_id text not null,
  reporter_id text not null,
  reason text not null,
  status text not null default 'open' check (status in ('open', 'dismissed', 'upheld')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  unique (target_type, target_id, reporter_id)
);
create index if not exists content_reports_target_idx on content_reports (target_type, target_id) where status = 'open';
create index if not exists content_reports_reporter_idx on content_reports (reporter_id, created_at);

-- Admin flags. An open flag (resolved_at null) pulls the content.
create table if not exists content_flags (
  id uuid primary key default gen_random_uuid(),
  target_type text not null check (target_type in ('episode', 'series', 'channel_media')),
  target_id text not null,
  reason text not null,
  note text,
  flagged_by text not null,
  email_owner boolean not null default true,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by text,
  resolution text check (resolution in ('restored', 'removed'))
);
create index if not exists content_flags_open_idx on content_flags (target_type, target_id) where resolved_at is null;

-- Per-title settings: "ignore reports" keeps a spam-reported title running.
create table if not exists content_moderation (
  target_type text not null,
  target_id text not null,
  reports_ignored boolean not null default false,
  updated_by text,
  updated_at timestamptz not null default now(),
  primary key (target_type, target_id)
);

-- Reporters over the monthly limit (50) land here. Their reports stop
-- counting until an admin reviews them.
create table if not exists reporter_reviews (
  user_id text primary key,
  status text not null default 'flagged' check (status in ('flagged', 'cleared', 'muted', 'banned')),
  reason text,
  flagged_at timestamptz not null default now(),
  reviewed_by text,
  reviewed_at timestamptz
);

/* ---------------- RLS (service role only, as everywhere else) ---------------- */
alter table channels enable row level security;
alter table channel_schedulers enable row level security;
alter table channel_media enable row level security;
alter table channel_slots enable row level security;
alter table channel_weeks enable row level security;
alter table channel_block_progress enable row level security;
alter table content_reports enable row level security;
alter table content_flags enable row level security;
alter table content_moderation enable row level security;
alter table reporter_reviews enable row level security;
