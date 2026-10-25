-- Distribution + screeners (Connect, 2026-10-25).
--
-- A production gets a distribution page for its owner: a festival tracker
-- (where it's going, deadlines, fees, what came back), the premiere, a
-- press kit and trailer link, and a checklist that reads the rest of the
-- site (release linked, Buy to own priced, early screening, "Shot here"
-- credits). Screeners: private, watermarked links to an episode's video
-- for programmers, press and distributors — each one labelled, expiring,
-- view-capped, revocable, with every open logged and the owner told.
-- Service-role only (no RLS).

alter table productions add column if not exists festivals jsonb not null default '[]'::jsonb;
alter table productions add column if not exists distribution_notes text;
alter table productions add column if not exists press_kit_url text;
alter table productions add column if not exists trailer_url text;
alter table productions add column if not exists premiere_on date;
alter table productions add column if not exists premiere_note text;

create table if not exists screeners (
  id uuid primary key default gen_random_uuid(),
  production_id uuid not null references productions (id) on delete cascade,
  -- The episode whose video plays (the owner's own; may still be pending review).
  episode_id text not null,
  token text not null unique,
  -- Who it's for ("Sundance programmers", "Jane at Oscilloscope").
  label text not null,
  recipient_email text,
  expires_at timestamptz not null,
  max_views integer not null default 10 check (max_views between 1 and 500),
  views integer not null default 0,
  last_viewed_at timestamptz,
  revoked_at timestamptz,
  created_by text not null,
  created_at timestamptz not null default now()
);
comment on table screeners is 'Private watermarked screener links to a production''s video: labelled, expiring, view-capped, revocable.';
create index if not exists screeners_production_idx on screeners (production_id, created_at desc);

create table if not exists screener_views (
  id uuid primary key default gen_random_uuid(),
  screener_id uuid not null references screeners (id) on delete cascade,
  viewed_at timestamptz not null default now(),
  -- A salted hash of the viewer's address, never the address itself.
  ip_hash text,
  user_agent text
);
create index if not exists screener_views_screener_idx on screener_views (screener_id, viewed_at desc);
