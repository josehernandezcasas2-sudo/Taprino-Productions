-- Elevator pitch section — a listing of projects seeking funding. Studio
-- Tapa never handles money here: this is a curated directory with an
-- outbound link to the creator's own project/funding page, same pattern
-- as episodes.funding_url. Admin-created entries are approved immediately
-- (an admin adding it IS the approval); status stays flexible so a future
-- public submission form can default new entries to 'pending' instead.
create table if not exists pitches (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  logline text not null,
  description text,
  project_url text not null,
  creator_name text,
  creator_email text,
  status text not null default 'approved' check (status in ('pending', 'approved', 'rejected')),
  submitted_by text,
  reviewed_by text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists pitches_status_idx on pitches (status, created_at desc);
comment on table pitches is
  'Elevator pitch listings — projects seeking funding, with an outbound link to the creator''s own project page. No money changes hands on Studio Tapa itself.';

alter table site_settings add column if not exists elevator_pitch_enabled boolean not null default false;
comment on column site_settings.elevator_pitch_enabled is
  'Shows/hides the "Pitch Room" nav link and public /pitches page. Off by default until there''s real content to show.';
