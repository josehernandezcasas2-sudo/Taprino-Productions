-- Required for podcast RSS feeds: Apple/Spotify's <enclosure> tag needs
-- the audio file's exact byte length. importAudioFromUrl() (lib/audioUpload.js)
-- already computes this while uploading (buffer.length) but the value was
-- being discarded before it ever reached the database. Existing episodes
-- imported before this column existed will have audio_bytes = null; the
-- RSS feed generator falls back to a HEAD request for those specific
-- episodes so their feed entries still work, just with a small one-time
-- latency cost until they're re-saved.
alter table episodes add column if not exists audio_bytes integer;
comment on column episodes.audio_bytes is 'Exact byte length of the audio file, required for the RSS <enclosure length> attribute. Null for episodes imported before this column existed.';
