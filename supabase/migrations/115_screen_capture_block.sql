-- 115 — the admin switch for the app's screenshot block (2026-10-30).
--
-- The app keeps screenshots and screen recording off its playback screens
-- (mobile/src/lib/captureBlock.js). Until now the only way to switch that
-- off was SCREEN_CAPTURE_BLOCK=off in Vercel; this column puts the switch
-- on Admin → Settings → Protection ("Block screenshots and screen
-- recording in the app"), on by default. The code reads a missing column
-- as on, so nothing changes until this runs; the switch's save reports the
-- missing column until then. The Vercel variable stays as a kill switch
-- that keeps the block off whatever this says.
--
-- Re-runnable. No new table, so nothing for row level security to cover
-- (site_settings already has it from 112).

alter table site_settings
  add column if not exists screen_capture_block boolean not null default true;
