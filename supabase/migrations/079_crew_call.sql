-- Crew Call (/crew on the web, Discover → Crew Call in the app): the
-- Connect side's network. Everyone with an account gets a working card —
-- what they do, what gear they have, where they are, whether they're
-- free — and the directory finds people by role, gear and distance.
-- No money moves through any of this ("just have it"): gear flags say
-- whether the owner brings it, lends it, or wants to be asked.
--
-- Cards are their own table rather than more columns on user_profiles so
-- the profile selectors (lib/userProfiles.js) don't grow another
-- missing-column fallback; lib/crewCards.js joins the two by user_id.
-- Service-role only, like every other table here (no RLS).

create table if not exists crew_cards (
  user_id text primary key,
  -- From lib/crewOptions.js CREW_ROLES; a card with no roles and no gear
  -- stays off the directory.
  roles text[] not null default '{}',
  -- Where they're based, as the geocoder returned it (lib/geocode.js):
  -- "Long Beach, CA" plus the point the distance filter measures from.
  -- Only the label is shown; lat/lng never leave the server.
  place_label text,
  city text,
  region text,
  country text,
  lat double precision,
  lng double precision,
  travel_miles integer not null default 25,
  remote_ok boolean not null default false,
  availability text not null default 'open' check (availability in ('open', 'booked')),
  booked_until date,
  -- Day rate, whole dollars, optional. Shown to signed-in viewers only.
  rate_min integer,
  rate_max integer,
  languages text[] not null default '{}',
  -- Off = keep the card on the profile but out of the directory.
  listed boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table crew_cards is 'Crew Call working cards: roles, base, travel radius, availability, rate. One per account.';
create index if not exists crew_cards_listed_idx on crew_cards (listed, updated_at desc);

create table if not exists crew_gear (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references crew_cards (user_id) on delete cascade,
  category text not null,
  name text not null,
  -- brings | lends | ask (lib/crewOptions.js GEAR_FLAGS)
  flag text not null default 'brings' check (flag in ('brings', 'lends', 'ask')),
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
comment on table crew_gear is 'Gear listed on a working card. Replaced wholesale on every card save.';
create index if not exists crew_gear_user_idx on crew_gear (user_id, sort_order);

-- Outside credits, typed in by hand. Released titles on Studio Tapa are
-- credits automatically (lib/userProfiles.js getCreditedWork) and are
-- never stored here.
create table if not exists crew_credits (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references crew_cards (user_id) on delete cascade,
  title text not null,
  role text,
  year integer,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
comment on table crew_credits is 'Hand-entered credits for work outside Studio Tapa, shown under the automatic ones.';
create index if not exists crew_credits_user_idx on crew_credits (user_id, sort_order);

-- lib/geocode.js answers, so a place name is only ever sent to the map
-- service once. `query` is "q:<typed text>" or "r:<lat>,<lng>".
create table if not exists geocode_cache (
  query text primary key,
  results jsonb not null,
  created_at timestamptz not null default now()
);
comment on table geocode_cache is 'Cached place lookups for Crew Call (OpenStreetMap Nominatim). Safe to truncate.';
