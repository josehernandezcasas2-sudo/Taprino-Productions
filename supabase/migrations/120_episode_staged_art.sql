-- 120 — A live episode's new title image and trailer wait for approval
-- (the series revamp, slice 3a; written 2026-11-05).
--
-- Jose, 2026-11-04 (question 25): "the change should wait for approval".
-- On a live episode the title, the poster, the still and a new video file
-- already wait in pending_* columns while what is live keeps showing. A
-- show already keeps a waiting title image (pending_title_image_url), a
-- waiting removal of it (pending_title_image_removal) and a waiting trailer
-- (pending_trailer_src); an episode had nowhere to keep those three, so the
-- show page refused them on a live episode. These are the same three
-- columns on episodes:
--   pending_title_image_url      a new title image (PNG) waiting
--   pending_title_image_removal  "show the name as text again" waiting
--   pending_trailer_src          a new trailer (a Cloudflare address) waiting
-- An admin approves or denies each one (Admin → Shows → the show's
-- "Waiting for approval" card, or Library & queues); a denied file goes to
-- the orphaned-media list like every other dropped file.
--
-- Columns only, on a table migration 112 already locked to the site's own
-- server key: no row changes, nothing is copied. Safe to run more than
-- once. Before it has run, the site refuses those two changes on a live
-- episode with "needs a database update (migration 120)" and everything
-- else works as before.

begin;

alter table public.episodes add column if not exists pending_title_image_url text;
alter table public.episodes add column if not exists pending_title_image_removal boolean not null default false;
alter table public.episodes add column if not exists pending_trailer_src text;

comment on column public.episodes.pending_title_image_url is 'A new title image waiting for approval on a live episode; title_image_url stays live until then. Migration 120.';
comment on column public.episodes.pending_title_image_removal is 'True while removing the title image (the name shows as text again) waits for approval on a live episode. Migration 120.';
comment on column public.episodes.pending_trailer_src is 'A new trailer waiting for approval on a live episode; trailer_src keeps playing until then. Migration 120.';

-- Migration 112's rule. This creates no table; the line costs nothing.
alter table public.episodes enable row level security;

-- PostgREST picks the new columns up at once.
notify pgrst, 'reload schema';

commit;

-- What is there now (one row). On the first run every "waiting" count is 0.
select
  (select count(*) from information_schema.columns
     where table_schema = 'public' and table_name = 'episodes'
       and column_name in ('pending_title_image_url', 'pending_title_image_removal', 'pending_trailer_src')) as new_columns_expect_3,
  (select count(*) from public.episodes where pending_title_image_url is not null) as title_images_waiting,
  (select count(*) from public.episodes where pending_title_image_removal)        as title_image_removals_waiting,
  (select count(*) from public.episodes where pending_trailer_src is not null)     as trailers_waiting,
  (select relrowsecurity from pg_class where oid = 'public.episodes'::regclass)   as row_level_security_expect_true;
