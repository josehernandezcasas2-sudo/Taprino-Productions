-- Podcasts can carry audio, video, or both — not an either/or media_type
-- enum. A podcast episode is "complete" once it has at least one of
-- audio_url or the existing video src; when both are present, the player
-- offers a Listen/Watch toggle instead of forcing a single mode.
alter table episodes add column if not exists audio_url text;
comment on column episodes.audio_url is
  'Audio file URL (hosted on our own storage after import) for podcast episodes. Independent of src (video) — a podcast episode can have either, or both.';

-- Podcast "shows" reuse the exact same series-grouping mechanism as video
-- series (name, poster, description, ordered episodes) — no schema change
-- needed there, series_id/season/series_order already exist on episodes
-- and were only ever gated to content_type='series' at the FORM level,
-- not the database level.
