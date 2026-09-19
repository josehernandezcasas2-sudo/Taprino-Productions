-- Backs the admin-curated lane of the vertical Discover feed's 3-1-3
-- interleave (lib/verticalFeed.js): 3 random units, 1 admin-curated
-- unit, 3 personalized units, repeating. A unit (standalone clip or
-- whole series) counts as curated if any of its episodes carry this
-- flag. Defaults false so nothing changes until admin actually curates
-- something — with zero curated content, that lane simply falls back to
-- the random pool (see pickFromLane in lib/verticalFeed.js).
alter table episodes add column if not exists discover_curated boolean not null default false;

comment on column episodes.discover_curated is 'Admin-curated for the vertical Discover feed''s dedicated curated slot (every 4th card in the 3-random/1-curated/3-personal cycle). Only meaningful for content_type = vertical.';
