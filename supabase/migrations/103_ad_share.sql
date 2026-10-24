-- 103: Ad share (Jose, 2026-10-24; canvas "Suspension, push and ad
-- share", last board). Creators get a share of what advertisers paid for
-- the ads that played inside their titles: 50% of the credit served
-- (site_settings.ad_share_percent, edited with the Creator Share numbers
-- and under the same 30-day rule for a decrease), attributed to the
-- episode the ad played in, credited on the 1st for the month before as
-- creator_ledger lines of kind 'ad_share' and paid in the same batch as
-- member support. House ads, bumpers, members' ad-free plays and ads
-- inside podcasts earn nothing (podcasts get the studio's own audio ads
-- later); a studio-owned title keeps everything.

-- One row per ad per episode per surface per day: how many times it
-- played there and what the advertiser's credit paid for those plays
-- (0 for a house ad). Written by record_ad_impression() from the
-- impression pixel (/api/house-ads/impression?ad=&episode=&surface=).
create table if not exists ad_impression_days (
  ad_id uuid not null,
  episode_id uuid not null,
  surface text not null,                 -- preroll | vod | live
  day date not null,
  impressions integer not null default 0,
  credit_cents numeric not null default 0,
  primary key (ad_id, episode_id, surface, day)
);
create index if not exists ad_impression_days_day_idx on ad_impression_days (day);
create index if not exists ad_impression_days_episode_idx on ad_impression_days (episode_id, day);

-- Counts one play. The cost is the ad's own per-impression rate when an
-- advertiser is behind it (the same number increment_house_ad_impression
-- draws from their credit balance), nothing for the studio's house ads.
create or replace function record_ad_impression(p_ad uuid, p_episode uuid, p_surface text)
returns void
language plpgsql
as $$
declare
  cost numeric := 0;
begin
  select case when ad_account_id is null then 0 else coalesce(cost_per_impression_cents, 0) end
    into cost
    from house_ads
   where id = p_ad;
  if not found then
    return;
  end if;
  insert into ad_impression_days (ad_id, episode_id, surface, day, impressions, credit_cents)
  values (p_ad, p_episode, p_surface, current_date, 1, cost)
  on conflict (ad_id, episode_id, surface, day) do update
    set impressions = ad_impression_days.impressions + 1,
        credit_cents = ad_impression_days.credit_cents + excluded.credit_cents;
end;
$$;

-- The share, as a whole percent of the credit served.
alter table site_settings add column if not exists ad_share_percent integer not null default 50;

-- An ad_share ledger line says which title earned it, how many ads it
-- carried, and the month it covers (one line per title per month; the
-- line's id is derived from those two so a re-run can't credit twice).
alter table creator_ledger add column if not exists episode_id uuid;
alter table creator_ledger add column if not exists units integer;
alter table creator_ledger add column if not exists period text;
create index if not exists creator_ledger_ad_share_idx on creator_ledger (period) where kind = 'ad_share';
