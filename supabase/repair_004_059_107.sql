-- Repair: migrations 004, 059 and 107 (2026-11-04).
--
-- supabase/check_migrations.sql, run on 2026-11-04, answered NOT RUN for
-- these three. What each one being missing does on the site today:
--   004  the two indexes that find deletion requests quickly (the columns
--        are there; only speed is lost)
--   059  episodes.video_provider: the admin's "add an episode by hand"
--        form (/api/admin/manual-episode) writes it, so every save there
--        fails with "column video_provider does not exist"
--   107  "Shot here" (location_credits) and the Studio Tapa rate on a
--        place (locations.studio_rate_cents / studio_rate_note): credits
--        are never saved and a host's studio rate is dropped on save
--
-- This is the three files as they were written, in order, plus the one
-- line migration 112 asks of every table made after it (row level
-- security on; nothing but the site's own server key can then read it).
-- Every statement is "if not exists", so it is safe to run more than once
-- and it leaves alone anything that is already there. Paste all of it
-- into the Supabase SQL Editor and press Run; then run
-- check_migrations.sql again, which should answer
-- "every migration through 118 is in".

begin;

-- 004 — deletion requests ----------------------------------------------------
alter table episodes add column if not exists deletion_requested boolean not null default false;
alter table episodes add column if not exists deletion_reason text;
alter table episodes add column if not exists deletion_requested_at timestamptz;

alter table series add column if not exists deletion_requested boolean not null default false;
alter table series add column if not exists deletion_reason text;
alter table series add column if not exists deletion_requested_at timestamptz;

create index if not exists idx_episodes_deletion_requested on episodes(deletion_requested) where deletion_requested = true;
create index if not exists idx_series_deletion_requested on series(deletion_requested) where deletion_requested = true;

-- 059 — which platform an episode's video is on (informational) -------------
alter table episodes add column if not exists video_provider text not null default 'cloudflare';

comment on column episodes.video_provider is 'Which platform src''s HLS URL was generated for: cloudflare, bunny, or mux. Informational only — the player itself is provider-agnostic.';

-- 107 — "Shot here" + the Studio Tapa rate ------------------------------------
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

-- 112's rule for a table made after it: locked to the site's server key.
alter table location_credits enable row level security;
revoke all on table location_credits from anon, authenticated;

commit;

-- What is there now (one row each; every "present" should read true).
select 'index idx_episodes_deletion_requested' as object, to_regclass('public.idx_episodes_deletion_requested') is not null as present
union all select 'index idx_series_deletion_requested', to_regclass('public.idx_series_deletion_requested') is not null
union all select 'column episodes.video_provider', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'episodes' and column_name = 'video_provider')
union all select 'table location_credits', to_regclass('public.location_credits') is not null
union all select 'column locations.studio_rate_cents', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'locations' and column_name = 'studio_rate_cents')
union all select 'row level security on location_credits', exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = 'location_credits' and c.relrowsecurity);
