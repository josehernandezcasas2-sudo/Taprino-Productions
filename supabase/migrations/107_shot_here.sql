-- "Shot here" + the Studio Tapa rate (Connect, 2026-10-25).
--
-- A place on Locations can carry the released titles that were shot
-- there, linked to the title's page both ways. A credit arrives in one
-- of two ways: a paid booking that went as agreed, for a production whose
-- release is linked (the host already confirmed the shoot, so it's
-- approved on its own), or a claim from the title's maker, which the host
-- approves or declines. Every title page shows "Shot at …"; every listing
-- shows what was shot there.
--
-- The Studio Tapa rate: a host can post a lower day rate for productions
-- on Studio Tapa. A request linked to a production is quoted at it.

create table if not exists location_credits (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references locations (id) on delete cascade,
  host_id text not null,
  -- Who put it here: the producer / creator claiming it, or the host.
  claimed_by text not null,
  release_type text not null check (release_type in ('episode', 'series')),
  release_id text not null,
  release_title text,
  production_id uuid references productions (id) on delete set null,
  request_id uuid references location_requests (id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined')),
  note text,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  unique (location_id, release_type, release_id)
);
comment on table location_credits is 'Released titles shot at a place. approved = on the listing and the title page.';
create index if not exists location_credits_loc_idx on location_credits (location_id, status);
create index if not exists location_credits_release_idx on location_credits (release_type, release_id) where status = 'approved';
create index if not exists location_credits_host_idx on location_credits (host_id) where status = 'pending';

alter table locations add column if not exists studio_rate_cents integer;
alter table locations add column if not exists studio_rate_note text;
