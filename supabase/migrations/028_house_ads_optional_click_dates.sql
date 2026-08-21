-- House ads: click-through link becomes optional (some ads are pure
-- brand/awareness, nothing to click through to), and a start/end date
-- window lets an ad automatically stop serving without an admin having to
-- remember to manually deactivate it.
alter table house_ads alter column click_url drop not null;
alter table house_ads add column if not exists start_date date;
alter table house_ads add column if not exists end_date date;
comment on column house_ads.start_date is 'Ad won''t be served before this date. Null = no start restriction.';
comment on column house_ads.end_date is 'Ad automatically stops being served after this date. Null = runs indefinitely.';
