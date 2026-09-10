-- A "title image" is a stylized PNG logo treatment of a title (the way a
-- movie or show's own logo art is often used in place of a plain text
-- title in a hero banner) — optional and separate from poster/thumbnail/
-- hero_image, which are photographic/key-art fields, not logo text art.
-- Scoped to the hero banner only for now: when set, the hero shows this
-- image instead of the plain text title; every other place a title is
-- shown (cards, lists, page <title> tags, alt text, search) keeps using
-- the existing plain text field untouched.
alter table episodes add column if not exists title_image_url text;
alter table series add column if not exists title_image_url text;
comment on column episodes.title_image_url is 'Optional PNG logo treatment of the title, shown in place of plain text in the hero banner only.';
comment on column series.title_image_url is 'Optional PNG logo treatment of the title, shown in place of plain text in the hero banner only.';

-- Series artwork changes are staged for admin approval (see pending_poster/
-- pending_thumbnail), never applied directly — this follows that same
-- established pattern rather than writing straight to title_image_url,
-- so a creator-submitted title image goes through the same review as
-- every other piece of series artwork.
alter table series add column if not exists pending_title_image_url text;
comment on column series.pending_title_image_url is 'Staged title image awaiting admin approval via resolve-artwork.js, same pattern as pending_poster.';
