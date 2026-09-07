-- A true day/time schedule, distinct from the existing channel_schedule
-- table (which is a continuously-looping playlist, not tied to specific
-- days or times at all). This coexists with the loop rather than
-- replacing it: any hour with no explicit slot falls back to whatever
-- the loop would be playing, so the channel never goes dead just because
-- a given day/time hasn't been scheduled yet.
create table if not exists weekly_schedule_slots (
  id uuid primary key default gen_random_uuid(),
  day_of_week text not null check (day_of_week in ('monday','tuesday','wednesday','thursday','friday','saturday','sunday')),
  start_time time not null,
  slot_type text not null check (slot_type in ('episode', 'ad_break')),
  episode_id text references episodes(id) on delete cascade,
  ad_duration_seconds integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint slot_type_fields_match check (
    (slot_type = 'episode' and episode_id is not null and ad_duration_seconds is null) or
    (slot_type = 'ad_break' and episode_id is null and ad_duration_seconds is not null)
  )
);
create index if not exists weekly_schedule_slots_day_idx on weekly_schedule_slots (day_of_week, start_time);

comment on table weekly_schedule_slots is 'Day/time TV-guide-style schedule for the Live TV channel. All times are in the fixed channel timezone (America/Los_Angeles), same for every viewer, like a real broadcast schedule — not converted per-viewer.';
