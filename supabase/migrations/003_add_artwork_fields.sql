-- Adds real artwork fields, separate from `hero_image` (which is a
-- fallback for the hero carousel when no trailer video exists) and from
-- Cloudflare's own auto-generated video-frame thumbnail (which is just a
-- processing-status preview on the creator dashboard, not intentional art).
--
-- poster    — 2:3 portrait, used on genre library poster grids
-- thumbnail — 16:9 landscape, used on homepage rows and episode cards
--
-- Both are added to `series` as well as `episodes`, since a series card
-- (on the homepage and in genre rows) represents the whole show, not one
-- episode, and needs its own artwork rather than borrowing episode 1's.
--
-- Safe to run even if columns already exist (IF NOT EXISTS).

alter table episodes add column if not exists poster text;
alter table episodes add column if not exists thumbnail text;

alter table series add column if not exists poster text;
alter table series add column if not exists thumbnail text;
