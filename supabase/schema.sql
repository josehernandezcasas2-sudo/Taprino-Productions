-- Taprino Transmission — initial schema
-- Run this once in Supabase's SQL editor (Project -> SQL Editor -> New query).
--
-- This replaces lib/episodes.js and lib/series.js as the real source of
-- truth for content. The `status` column is the whole point of this
-- migration: creator submissions land as 'pending' and are invisible to
-- the public site until an admin approves them.

create table if not exists series (
  id text primary key,
  name text not null,
  description text,
  trailer_src text,
  hero_image text
);

create table if not exists episodes (
  id text primary key,
  title text not null,
  description text,
  tier text not null default 'free' check (tier in ('free', 'premium')),
  genre text,
  main_genre text,
  content_type text not null check (content_type in ('series', 'movie', 'short', 'vertical', 'podcast')),
  series_id text references series(id),
  season int,
  series_order int,
  artist text,
  runtime text,
  video_type text default 'html5',
  src text,
  trailer_src text,
  hero_image text,
  featured boolean not null default false,

  -- The approval workflow. 'approved' is the only status the public site
  -- will ever query for — everything else stays invisible until an admin
  -- acts on it.
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  submitted_by text,          -- Clerk user id of the creator who submitted this
  rejection_reason text,      -- shown back to the creator if rejected
  reviewed_by text,           -- Clerk user id of the admin who approved/rejected
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

-- Speeds up the two queries the public site will run constantly: "give me
-- everything approved" and "give me everything approved in this series."
create index if not exists idx_episodes_status on episodes(status);
create index if not exists idx_episodes_series on episodes(series_id) where series_id is not null;

-- Row Level Security is enabled on principle (defense in depth), even
-- though every access path in this app goes through the server-side
-- service role key, which bypasses RLS entirely. If anything ever DOES
-- query these tables directly from the browser in the future, this means
-- it fails closed by default instead of silently exposing everything.
alter table episodes enable row level security;
alter table series enable row level security;
