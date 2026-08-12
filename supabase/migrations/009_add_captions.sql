-- Captions / subtitles.
--
-- Two ways a caption track can reach a viewer, and both are supported:
--
--   1. Uploaded to Cloudflare Stream against the video itself. Cloudflare
--      then advertises it inside the HLS manifest, and the player picks it
--      up automatically with no database involvement at all. This is the
--      better route when it's available.
--
--   2. A standalone .vtt file URL stored here, rendered as a <track> on the
--      video element. This is the fallback for self-hosted mp4s and for
--      captions produced after a video was already published.
--
-- captions_url is nullable because most existing rows won't have one, and an
-- episode without captions must keep playing exactly as it does today.
alter table episodes add column if not exists captions_url text;
alter table episodes add column if not exists captions_language text default 'en';
alter table episodes add column if not exists captions_label text default 'English';

comment on column episodes.captions_url is
  'Public URL to a WebVTT caption file. Null when captions live on Cloudflare Stream, or when there are none yet.';
