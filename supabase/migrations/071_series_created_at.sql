-- series never had a created_at column (episodes always has, see
-- schema.sql) — lib/userProfiles.js's getFeaturedCreators() assumed it
-- did and has been erroring on the series half of that query on every
-- single homepage load since it was written. reviewed_at (migration 053)
-- isn't a safe substitute: it's null for every series that existed
-- before that migration and for anything that hasn't gone through the
-- new review flow, which is most of what's currently live.
alter table series add column if not exists created_at timestamptz not null default now();
