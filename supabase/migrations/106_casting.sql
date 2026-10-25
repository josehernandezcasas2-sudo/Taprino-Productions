-- Casting (Connect, 2026-10-25): performer cards and casting calls.
--
-- A working card can be a performer card too: playing age, union status,
-- skills, a reel link and up to six headshots. The directory gets a Cast
-- tab over those. A call can be a casting call: a character, a short
-- description, playing age, union status, sides, whether a self-tape is
-- wanted and by when, and whether under-18s may apply (a guardian's
-- name and contact is then required on the response). Responders attach
-- a self-tape (a link, or a Cloudflare Stream upload from the website);
-- the poster shortlists and sets callbacks from the call page.
-- Service-role only, like every other table (no RLS).

-- Performer side of a card.
alter table crew_cards add column if not exists performer boolean not null default false;
alter table crew_cards add column if not exists playing_age_min integer;
alter table crew_cards add column if not exists playing_age_max integer;
alter table crew_cards add column if not exists union_status text check (union_status in ('non_union', 'sag_aftra', 'sag_eligible', 'other'));
alter table crew_cards add column if not exists skills text[] not null default '{}';
alter table crew_cards add column if not exists reel_url text;

create table if not exists crew_headshots (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references crew_cards (user_id) on delete cascade,
  url text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists crew_headshots_user_idx on crew_headshots (user_id, sort_order);

-- Casting calls.
alter table crew_calls add column if not exists kind text not null default 'crew' check (kind in ('crew', 'cast'));
alter table crew_calls add column if not exists character_name text;
alter table crew_calls add column if not exists character_desc text;
alter table crew_calls add column if not exists playing_age_min integer;
alter table crew_calls add column if not exists playing_age_max integer;
alter table crew_calls add column if not exists union_status text check (union_status in ('non_union', 'sag_aftra', 'sag_eligible', 'other'));
alter table crew_calls add column if not exists sides_url text;
alter table crew_calls add column if not exists self_tape_wanted boolean not null default false;
alter table crew_calls add column if not exists self_tape_due date;
alter table crew_calls add column if not exists minors_ok boolean not null default false;
create index if not exists crew_calls_kind_idx on crew_calls (kind) where status = 'open';

-- Responses to a casting call: the tape, the shortlist, the callback,
-- and the guardian when the performer is under 18.
alter table crew_responses add column if not exists self_tape_url text;
alter table crew_responses add column if not exists self_tape_uid text;
alter table crew_responses add column if not exists shortlisted boolean not null default false;
alter table crew_responses add column if not exists callback_at timestamptz;
alter table crew_responses add column if not exists minor boolean not null default false;
alter table crew_responses add column if not exists guardian_name text;
alter table crew_responses add column if not exists guardian_contact text;
