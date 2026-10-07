-- The scheduler's "ads between shows" setting, per channel: when a block is
-- placed or dragged to land after another show, it snaps this many seconds
-- later, and the gap plays ads and bumpers (lib/channelPlan.js treats any
-- gap under five minutes as ads). 0 means shows butt up flush.
alter table channels add column if not exists ad_gap_seconds integer not null default 120;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'channels_ad_gap_seconds_check') then
    alter table channels add constraint channels_ad_gap_seconds_check check (ad_gap_seconds >= 0 and ad_gap_seconds < 300);
  end if;
end $$;
