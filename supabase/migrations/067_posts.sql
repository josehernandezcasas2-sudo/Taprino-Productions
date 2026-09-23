-- Lightweight social-style posts — separate from the `episodes` table on
-- purpose. Episodes carry a heavy editorial pipeline (genre, runtime,
-- artist, admin review before going live) that doesn't fit a quick post
-- or a short vertical clip someone wants live immediately. Posts publish
-- instantly, no review step.
--
-- kind = 'post'  -> caption + optional photo (image_url)
-- kind = 'video' -> caption + a vertical video (video_uid/video_src),
--                   capped client- and server-side at 5 minutes
create table if not exists posts (
  id text primary key,
  user_id text not null,
  kind text not null check (kind in ('post', 'video')),
  caption text,
  image_url text,
  video_uid text,
  video_src text,
  duration_seconds numeric,
  status text not null default 'published',
  created_at timestamptz not null default now()
);

create index if not exists posts_created_at_idx on posts (created_at desc);
create index if not exists posts_user_id_idx on posts (user_id, created_at desc);
create index if not exists posts_kind_status_idx on posts (kind, status, created_at desc);
