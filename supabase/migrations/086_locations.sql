-- Locations (Connect → Locations, mockups/locations-v1.html, signed off
-- 2026-10-13): people who hold the keys to a place list it; productions
-- request dates at the posted rate or make an offer; the host accepts,
-- counters or declines; the booking is paid through the site.
--
-- Decisions (Jose, 2026-10-13):
--   * money moves through the site: Stripe Checkout, destination charge
--     to the host's Connect account (the same creator_payout_accounts row
--     creators use for backing), the platform keeps a cut;
--   * platform cut 10% of the booking, taken from the host's side; the
--     producer pays the booking plus Stripe's card fee (same as backing);
--   * anyone signed in can list a place, but it goes public only once an
--     admin has checked the host is the owner / works there (proof);
--   * hourly rate + day rate + "make a deal" (offers) all exist.
-- Run after 085. Service-role only, no RLS, like every other table.

create table if not exists locations (
  id uuid primary key default gen_random_uuid(),
  host_id text not null,
  title text not null,
  -- lib/locationRules.js LOCATION_TYPES
  kind text not null,
  description text,
  -- Where, as the geocoder returned it (same shape as crew_cards). The
  -- neighbourhood/city shows publicly and the distance filter uses the
  -- point; the street address and access notes are shown only to a
  -- producer whose booking is paid.
  place_label text,
  city text,
  region text,
  country text,
  lat double precision,
  lng double precision,
  address text,
  access_notes text,
  -- The space
  sq_ft integer,
  outdoor_sq_ft integer,
  rooms text,
  ceiling_ft numeric,
  crew_max integer,
  hours_from text,
  hours_to text,
  -- Tick-box facts scouts filter on (lib/locationRules.js FEATURES keys)
  features text[] not null default '{}',
  windows_face text,
  best_light text,
  power text,
  sound text,
  -- Rates, in cents. Any of hourly/day may be null; deals_ok lets a
  -- producer send their own number. All null + deals_ok = "make a deal".
  hourly_cents integer,
  min_hours integer not null default 4,
  half_day_cents integer,
  day_cents integer,
  day_hours integer not null default 10,
  overtime_cents integer,
  cleaning_cents integer,
  weekend_pct integer not null default 0,
  deals_ok boolean not null default true,
  cancellation text not null default 'moderate' check (cancellation in ('flexible', 'moderate', 'strict')),
  rules text,
  permit_help text not null default 'you_handle' check (permit_help in ('host_handles', 'host_helps', 'you_handle', 'none_needed')),
  coi_required boolean not null default false,
  -- Verification: who the host is to this place, and the proof an admin
  -- looked at (deed, lease, utility bill, a letter from the owner).
  ownership text not null default 'owner' check (ownership in ('owner', 'works_here', 'permission')),
  proof_url text,
  proof_note text,
  verified boolean not null default false,
  verified_at timestamptz,
  verified_by text,
  -- pending = waiting on admin; listed = public; paused = host hid it;
  -- rejected = admin said no (reason shown to the host); removed = gone.
  status text not null default 'pending' check (status in ('pending', 'listed', 'paused', 'rejected', 'removed')),
  rejection_reason text,
  reviewed_at timestamptz,
  reviewed_by text,
  moderation_hold boolean not null default false,
  cover_url text,
  shoots_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table locations is 'Places to shoot in, listed by their hosts. Public once admin-approved (status listed); the street address is private until a booking is paid.';
create index if not exists locations_public_idx on locations (status, updated_at desc);
create index if not exists locations_host_idx on locations (host_id, created_at desc);

create table if not exists location_photos (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references locations (id) on delete cascade,
  url text not null,
  caption text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists location_photos_loc_idx on location_photos (location_id, sort_order);

-- Days the host has blocked by hand (booked days come from requests).
create table if not exists location_blocked_dates (
  location_id uuid not null references locations (id) on delete cascade,
  day date not null,
  primary key (location_id, day)
);

-- A production's request for dates. One row carries the whole lifecycle:
-- requested → (countered) → accepted → paid → done, or declined /
-- expired / cancelled / refunded along the way. The money split is
-- locked in when the request is created (or countered), never re-read.
create table if not exists location_requests (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references locations (id) on delete cascade,
  producer_id text not null,
  host_id text not null,
  starts_on date not null,
  ends_on date not null,
  hours_from text,
  hours_to text,
  hours_per_day integer not null default 10,
  crew_size integer,
  vehicles integer,
  project_type text check (project_type in ('pitch', 'series')),
  project_id text,
  project_title text,
  shooting text,
  message text,
  -- posted = the host's rates priced it; offer = the producer's number
  pricing text not null default 'posted' check (pricing in ('posted', 'offer')),
  -- What the producer pays for the place (before cleaning), the cleaning
  -- fee, and the split of the whole booking. host_payout + platform_cut
  -- = subtotal + cleaning; the producer also covers the card fee on top.
  subtotal_cents integer not null default 0,
  cleaning_cents integer not null default 0,
  platform_cut_cents integer not null default 0,
  host_payout_cents integer not null default 0,
  fee_cover_cents integer not null default 0,
  total_charged_cents integer not null default 0,
  cut_percent numeric not null default 10,
  -- A counter from the host replaces subtotal_cents once accepted.
  counter_cents integer,
  counter_note text,
  status text not null default 'requested' check (status in ('requested', 'countered', 'accepted', 'declined', 'expired', 'cancelled', 'paid', 'done', 'refunded')),
  responds_by timestamptz,
  thread_id uuid references dm_threads (id) on delete set null,
  accepted_at timestamptz,
  declined_at timestamptz,
  decline_reason text,
  cancelled_at timestamptz,
  cancelled_by text,
  paid_at timestamptz,
  stripe_checkout_session_id text,
  stripe_payment_intent_id text,
  refunded_at timestamptz,
  refund_cents integer,
  refund_reason text,
  refunded_by text,
  -- After the last day the host says how it went. as_agreed is the
  -- confirmed shoot that counts on both records and adds the credit.
  outcome text check (outcome in ('as_agreed', 'damage', 'no_show', 'cancelled')),
  outcome_note text,
  outcome_at timestamptz,
  outcome_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table location_requests is 'Booking requests. Only status paid/done block the calendar; only outcome as_agreed counts as a hosted shoot.';
create index if not exists location_requests_loc_idx on location_requests (location_id, starts_on);
create index if not exists location_requests_host_idx on location_requests (host_id, status, created_at desc);
create index if not exists location_requests_producer_idx on location_requests (producer_id, created_at desc);
create unique index if not exists location_requests_session_idx on location_requests (stripe_checkout_session_id) where stripe_checkout_session_id is not null;

-- One line each way after a shoot that went as agreed.
create table if not exists location_endorsements (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references location_requests (id) on delete cascade,
  from_user_id text not null,
  to_user_id text not null,
  line text not null check (char_length(line) between 1 and 200),
  would_again boolean not null default true,
  created_at timestamptz not null default now(),
  unique (request_id, from_user_id)
);
create index if not exists location_endorsements_to_idx on location_endorsements (to_user_id, created_at desc);

-- Site-wide cut on bookings (Jose: 10%). Each request locks in the
-- rate in effect when it was priced.
alter table site_settings add column if not exists location_platform_cut_percent numeric not null default 10;
comment on column site_settings.location_platform_cut_percent is 'Platform cut (%) of a location booking, taken from the host''s side. Each request stores the rate it was priced at.';

-- Listings can be reported and flagged like titles, calls and profiles.
alter table content_reports drop constraint if exists content_reports_target_type_check;
alter table content_reports add constraint content_reports_target_type_check check (target_type in ('episode', 'series', 'channel_media', 'profile', 'call', 'location'));
alter table content_flags drop constraint if exists content_flags_target_type_check;
alter table content_flags add constraint content_flags_target_type_check check (target_type in ('episode', 'series', 'channel_media', 'profile', 'call', 'location'));
