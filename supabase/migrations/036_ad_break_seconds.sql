-- Explicit, admin/creator-configured ad break timestamps per episode,
-- replacing reliance on whatever the ad server's own VMAP response
-- happens to define (which the default house-ads VAST endpoint doesn't
-- provide at all — it's a single linear ad, not a pod schedule). Stored
-- as an array of second-offsets into the video; [0] means pre-roll only,
-- which is the default for anything that hasn't set this explicitly.
alter table episodes add column if not exists ad_break_seconds jsonb not null default '[0]';
comment on column episodes.ad_break_seconds is 'Second-offsets into the video where an ad break should play. [0] = pre-roll only (default). Multiple values = pre-roll + mid-rolls.';
