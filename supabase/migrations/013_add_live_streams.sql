-- Live streaming. Each row is one broadcast "show" — the admin creates one
-- before going live, gets back an RTMPS server + key for OBS (or any RTMPS
-- encoder), and explicitly flips it to 'live' once they've confirmed
-- they're actually connected and broadcasting.
--
-- That "explicitly flips" part is deliberate: Cloudflare can report a live
-- input's connection state, but that's used here only as an informational
-- hint on the admin dashboard, not as the switch that puts a stream in
-- front of viewers. Only an admin action does that — see
-- pages/api/admin/live/go-live.js.
create table if not exists live_streams (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  genre text,
  cloudflare_uid text not null,          -- the Cloudflare Stream live input's uid
  status text not null default 'idle',   -- idle (created, not yet live) | live | ended
  ads_enabled boolean not null default true,
  ad_break_seconds int not null default 600,  -- how often a house ad break is inserted
  started_at timestamptz,
  ended_at timestamptz,
  -- Filled in manually for now, not auto-detected — see LIVE-STREAMING-NOTES.md
  -- for why. Cloudflare auto-records every live session to a normal VOD
  -- video; once you have that video's uid, this is where it's noted, and
  -- from there the existing admin "add episode by Cloudflare UID" flow
  -- turns it into a real episode if you want the recording kept.
  recording_uid text,
  created_by text,
  created_at timestamptz not null default now()
);

create index if not exists live_streams_status_idx on live_streams (status);

comment on table live_streams is
  'One row per broadcast. At most one should be status=live at a time — enforced by application logic (pages/api/admin/live/go-live.js ends any other live row first), not a database constraint, since a brief overlap during a switchover is harmless.';
