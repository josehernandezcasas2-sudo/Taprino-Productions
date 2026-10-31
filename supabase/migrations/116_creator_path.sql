-- The creator path (2026-10-31): apply with the film itself, Accept puts it
-- live, and Creator Studio's three-step submit keeps a server-side draft.
--
-- creator_applications: the master is uploaded with the application
-- (Cloudflare Stream, tagged with the applicant, signed URLs from the
-- first byte). Accept creates the episode (and the show, for a series or
-- podcast) as approved + released, grants Creator Studio and emails "it's
-- live"; Decline deletes the video; Hold sends the one thing to fix.
alter table creator_applications add column if not exists video_uid text;
alter table creator_applications add column if not exists video_state text;      -- uploading | processing | ready | error | deleted
alter table creator_applications add column if not exists video_name text;
alter table creator_applications add column if not exists video_bytes bigint;
alter table creator_applications add column if not exists upload_url text;       -- the one-time TUS address, kept so a stopped upload can resume
alter table creator_applications add column if not exists runtime_seconds integer;
alter table creator_applications add column if not exists poster text;           -- optional, sent from the status card; else cut from the film on Accept
alter table creator_applications add column if not exists thumbnail text;
alter table creator_applications add column if not exists episode_id text;       -- the title Accept created (episodes.id)
alter table creator_applications add column if not exists held_at timestamptz;

create index if not exists creator_applications_video_idx on creator_applications (video_uid);

comment on column creator_applications.status is 'new | reviewing | held (one thing to fix, decision_note says what) | accepted | declined';
comment on column creator_applications.video_state is 'uploading (the browser is still sending it) | processing (Cloudflare has it) | ready | error | deleted (declined)';
comment on column creator_applications.episode_id is 'Set when Accept created the title from the uploaded master; null for an application that only linked to its files (Accept then grants Creator Studio and the creator uploads there).';

-- Creator Studio's submit page saves as the creator goes: the form so far,
-- the master's upload (which starts the moment the file is dropped) and
-- the optional trailer. One row per unfinished submission; deleted when
-- it is sent for review or discarded.
create table if not exists creator_drafts (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  form jsonb not null default '{}'::jsonb,
  video_uid text,
  video_state text,          -- uploading | processing | ready | error
  video_name text,
  video_bytes bigint,
  upload_url text,
  runtime_seconds integer,
  trailer_uid text,
  trailer_state text,
  trailer_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists creator_drafts_user_idx on creator_drafts (user_id, updated_at desc);

comment on table creator_drafts is 'An unfinished Creator Studio submission: the form so far and the upload in flight. Removed when submitted or discarded.';

-- Migration 112's rule: every new table is locked to the service role.
alter table creator_drafts enable row level security;
