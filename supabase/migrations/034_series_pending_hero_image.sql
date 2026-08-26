-- Series had no way to stage a hero image change at all — poster,
-- thumbnail, and trailer already go through the pending_* + admin
-- approval pattern, but the hero image (used as the SeriesHero background
-- on a show's own page) could only ever be set directly in the database.
alter table series add column if not exists pending_hero_image text;
