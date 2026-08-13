-- Creator applications.
--
-- Replaces the self-serve upload model with a Netflix-style intake: anyone
-- can apply with details about their work and a link to where the files
-- live (Drive, Dropbox, WeTransfer, Frame.io, wherever they already keep
-- them). The studio then reviews, requests the files through whatever
-- channel suits, QCs them, and ingests into the CMS by hand.
--
-- Deliberately NO file upload on this table. That's the entire point of the
-- change — in-app upload was the unreliable part, and a link to a file the
-- applicant already has somewhere is both more robust and lets them send
-- broadcast-quality masters far larger than any browser upload would
-- tolerate.
create table if not exists creator_applications (
  id uuid primary key default gen_random_uuid(),

  -- Who's applying. No account required — this is open to the public, so
  -- there's no user id to key off of.
  name text not null,
  email text not null,
  portfolio_url text,

  -- What they're offering
  title text not null,
  logline text not null,
  description text,
  content_type text,          -- 'film' | 'series' | 'other'
  main_genre text,
  runtime text,
  completion_status text,     -- 'finished' | 'in_progress' | 'concept'

  -- Where the actual files live. A link, never an upload.
  media_link text,
  media_notes text,           -- format, codec, resolution, password, etc.

  -- Studio-side review
  status text not null default 'new',   -- new | reviewing | accepted | declined
  admin_notes text,
  reviewed_by text,
  reviewed_at timestamptz,

  created_at timestamptz not null default now()
);

create index if not exists creator_applications_status_idx on creator_applications (status);
create index if not exists creator_applications_created_idx on creator_applications (created_at desc);

comment on table creator_applications is
  'Public intake for creators wanting their work on Taprino. Studio reviews, then ingests files manually — there is intentionally no upload path here.';
