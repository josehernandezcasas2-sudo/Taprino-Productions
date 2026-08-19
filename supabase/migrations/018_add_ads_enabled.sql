-- Per-episode ad override, independent of tier. Previously ads were purely
-- tier-driven (free = ads, premium = none) — this adds a third state: a
-- specific free episode can be marked ad-free (a promo, a short teaser,
-- anything where an ad would hurt more than it earns), without touching
-- its tier or pricing at all.
alter table episodes add column if not exists ads_enabled boolean not null default true;
comment on column episodes.ads_enabled is 'Independent of tier — lets a free episode be marked ad-free without changing its price.';
