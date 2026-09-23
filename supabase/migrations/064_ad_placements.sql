-- Which surface(s) an ad is eligible to show on. Null or empty means
-- "everywhere" — the safe default so an advertiser who doesn't think
-- about placement still gets full reach, rather than accidentally
-- showing nowhere. Before this column existed, every approved ad (an
-- advertiser's or admin's own house ad) sat in one single undifferentiated
-- pool with zero way to control where it actually appeared.
alter table house_ads add column if not exists placements text[];
comment on column house_ads.placements is
  'Which surfaces this ad is eligible for: any of main_player, live_tv, vertical_discover. Null/empty means all placements. Checked in lib/houseAds.js pickActiveHouseAd().';
