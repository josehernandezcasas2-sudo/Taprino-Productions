-- Optional custom cover for a video post (see 067_posts.sql) — without
-- one, lib/posts.js falls back to whichever frame Cloudflare Stream
-- auto-grabs from the video itself.
alter table posts add column if not exists thumbnail_url text;
