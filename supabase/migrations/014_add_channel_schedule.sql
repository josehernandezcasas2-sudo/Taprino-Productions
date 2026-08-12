-- The linear channel: an ordered, looping list of free-tier episodes that
-- plays continuously, the same way a real TV channel does — tune in any
-- time and see whatever's "on."
--
-- Deliberately a continuous loop rather than a fixed clock-time schedule
-- (a real "at 9pm, Episode 3 airs" grid). A loop is what every viewer's
-- position can be computed from with nothing but "when did the loop start"
-- and "how long is each program" — no separate guide data to keep in sync,
-- and simple enough for one admin to actually maintain. A fixed-time grid
-- is the natural next step if this becomes popular; the schema doesn't
-- block it, but isn't trying to be it yet.
create table if not exists channel_schedule (
  id uuid primary key default gen_random_uuid(),
  position int not null,
  episode_id uuid not null references episodes(id) on delete cascade,
  -- Cached from the episode's runtime at the moment it's added, not
  -- re-parsed on every request. Two reasons: schedule math runs on every
  -- viewer's page load and poll, so it shouldn't depend on re-parsing free
  -- text each time; and if an episode's runtime is edited later, the
  -- schedule keeps using the duration it was scheduled with rather than
  -- silently reflowing every program after it.
  duration_seconds numeric not null,
  created_at timestamptz not null default now()
);
create unique index if not exists channel_schedule_position_idx on channel_schedule (position);

-- Singleton settings row (id is always 1). One channel for now — the
-- honest v1 scope. A real second channel later would want this to become
-- a proper channels table with schedule rows foreign-keyed to it, rather
-- than stretching this singleton to cover more than one; noted here so
-- that migration is an addition, not a rewrite, if it's ever needed.
create table if not exists channel_settings (
  id int primary key default 1,
  loop_started_at timestamptz not null default now(),
  ads_enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  constraint channel_settings_singleton check (id = 1)
);
insert into channel_settings (id) values (1) on conflict (id) do nothing;

comment on table channel_schedule is
  'Ordered, looping playlist for the linear channel at /channel. Position must stay contiguous from 0 — maintained by application logic in lib/channelSchedule.js, not a database constraint.';
comment on table channel_settings is
  'Singleton (id=1 always). loop_started_at is the reference point every viewer computes "what should be on now" from — resetting it (see the admin restart action) restarts the loop from the top.';
