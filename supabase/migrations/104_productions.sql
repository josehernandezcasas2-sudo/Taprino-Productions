-- Productions (Connect, 2026-10-25): the thing a shoot's crew calls,
-- location bookings, call sheets and credits hang off.
--
-- A production is a film / series / podcast / music video… someone on
-- Studio Tapa is making. Its owner (the host: producer or director) posts
-- Crew Call posts "for" it, books places under it, keeps a day-by-day
-- call sheet for the crew, and when the finished title is released on
-- Studio Tapa links it — at which point everyone confirmed as having
-- worked it gets the title on their profile and in their track record,
-- with the role they had. Hand-typed credits still never count; a
-- production credit counts only when the owner confirmed the work AND
-- the release is an approved title here (admins approve titles), so a
-- made-up production with no release earns nobody a tier.
-- Service-role only, like every other table (no RLS).

create table if not exists productions (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null,
  title text not null,
  logline text,
  kind text not null default 'short' check (kind in ('short', 'feature', 'series', 'documentary', 'podcast', 'music_video', 'commercial', 'vertical', 'other')),
  status text not null default 'prep' check (status in ('prep', 'shooting', 'post', 'released', 'archived', 'removed')),
  starts_on date,
  ends_on date,
  -- Home base, as the geocoder returned it (same shape as crew_calls).
  place_label text,
  city text,
  region text,
  country text,
  lat double precision,
  lng double precision,
  -- Optional link to the Pitch Room project or series it grew out of.
  project_type text check (project_type in ('pitch', 'series')),
  project_id text,
  project_title text,
  -- The released title it became, once it's out on Studio Tapa: an
  -- episode (film, short, podcast episode, snippet) or a series. Credits
  -- flow from this link.
  release_type text check (release_type in ('episode', 'series')),
  release_id text,
  release_title text,
  released_at timestamptz,
  -- Crew-facing notes (house style, comms, who to call); never public.
  notes text,
  -- public: on /productions and the owner's profile; crew: the crew and
  -- the owner only; private: the owner only.
  visibility text not null default 'public' check (visibility in ('public', 'crew', 'private')),
  moderation_hold boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table productions is 'A shoot (film, series, podcast…) that crew calls, location bookings, call sheets and credits hang off.';
create index if not exists productions_owner_idx on productions (owner_id, created_at desc);
create index if not exists productions_public_idx on productions (visibility, status, created_at desc) where moderation_hold = false;
create index if not exists productions_release_idx on productions (release_type, release_id) where release_id is not null;

-- Who's on it. Rows come from a booking on a linked Crew Call post
-- (response_id set; worked follows the call's outcome) or from the owner
-- adding someone by hand. worked = the owner (or an admin) confirmed
-- they did the job; hidden = the person took themselves off.
create table if not exists production_members (
  id uuid primary key default gen_random_uuid(),
  production_id uuid not null references productions (id) on delete cascade,
  user_id text not null,
  role text not null,
  response_id uuid references crew_responses (id) on delete set null,
  worked boolean not null default false,
  worked_at timestamptz,
  worked_by text,
  hidden boolean not null default false,
  added_by text not null,
  created_at timestamptz not null default now(),
  unique (production_id, user_id, role)
);
comment on table production_members is 'Crew on a production. worked + a linked approved release = a credit on the person''s profile and track record.';
create index if not exists production_members_user_idx on production_members (user_id, worked);
create index if not exists production_members_prod_idx on production_members (production_id, created_at);

-- Shoot days: the call sheet. Numbered by date (renumbered by the server
-- when days are added or removed). The place is either a Studio Tapa
-- listing the owner has a paid booking for (its address, access notes
-- and house rules come onto the sheet from the listing itself) or a
-- typed place + address. Addresses show to the crew only.
create table if not exists production_days (
  id uuid primary key default gen_random_uuid(),
  production_id uuid not null references productions (id) on delete cascade,
  day_no integer not null default 1,
  shoot_on date not null,
  call_time text,
  wrap_time text,
  location_id uuid references locations (id) on delete set null,
  location_request_id uuid references location_requests (id) on delete set null,
  place_label text,
  address text,
  parking text,
  scenes text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table production_days is 'Call sheet days of a production (who, where, when; addresses are crew-only).';
create index if not exists production_days_prod_idx on production_days (production_id, shoot_on, created_at);

-- Calls and location requests can belong to a production ("for
-- <production>" on the board, auto members on booking, auto shoot days
-- on a paid booking). The title is copied at post time and refreshed
-- when the production is renamed, like project_title.
alter table crew_calls add column if not exists production_id uuid references productions (id) on delete set null;
alter table crew_calls add column if not exists production_title text;
create index if not exists crew_calls_production_idx on crew_calls (production_id) where production_id is not null;
alter table location_requests add column if not exists production_id uuid references productions (id) on delete set null;
alter table location_requests add column if not exists production_title text;

-- Productions can be reported and flagged like calls and places.
alter table content_reports drop constraint if exists content_reports_target_type_check;
alter table content_reports add constraint content_reports_target_type_check check (target_type in ('episode', 'series', 'channel_media', 'profile', 'call', 'location', 'tip', 'production'));
alter table content_flags drop constraint if exists content_flags_target_type_check;
alter table content_flags add constraint content_flags_target_type_check check (target_type in ('episode', 'series', 'channel_media', 'profile', 'call', 'location', 'tip', 'production'));
