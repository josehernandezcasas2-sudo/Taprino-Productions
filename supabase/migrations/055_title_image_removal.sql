-- Separate boolean rather than overloading pending_title_image_url,
-- since that column's existing meaning ("a new image is staged") can't
-- also mean "remove the existing one" without becoming ambiguous — null
-- already means "no change pending" there. This flag lets a creator
-- request removal (reverting the hero to the plain text title) through
-- the same staged-approval flow as every other series artwork change,
-- without changing what the existing column means.
alter table series add column if not exists pending_title_image_removal boolean not null default false;
comment on column series.pending_title_image_removal is 'True when a creator has requested the title image be removed (revert to text), awaiting admin approval via resolve-artwork.js.';
