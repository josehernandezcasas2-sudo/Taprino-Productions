-- Audio description + accessibility metadata.
--
-- Audio description is a separate narration track describing what happens
-- visually, for blind and low-vision viewers. WCAG 2.1 requires it at Level
-- AA for prerecorded video.
--
-- Implemented as a SEPARATE VIDEO, not a second audio stream on the same
-- file. Two reasons: HLS multi-audio-track switching is inconsistently
-- supported across browsers, and — more practically — a described version is
-- usually produced as its own export anyway, with pauses extended to fit the
-- narration. So the player offers it as an alternate version the viewer can
-- switch to, which is also how Netflix and the BBC handle it.
alter table episodes add column if not exists audio_description_src text;

-- Free-text accessibility notes shown under the description, e.g. "contains
-- flashing lights between 2:10 and 2:20". Content warnings of this kind are
-- an accessibility matter for photosensitive viewers, not just a courtesy.
alter table episodes add column if not exists accessibility_notes text;

-- Flags surfaced as badges under the video so viewers know before pressing
-- play, rather than finding out three minutes in.
alter table episodes add column if not exists has_flashing_lights boolean default false;
alter table episodes add column if not exists transcript_url text;

comment on column episodes.audio_description_src is
  'Playback URL for an audio-described version of this episode. Null when none exists.';
comment on column episodes.has_flashing_lights is
  'Warns photosensitive viewers before playback. WCAG 2.3.1 relates to the risk this covers.';
