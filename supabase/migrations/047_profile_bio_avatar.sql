-- Completes the public profile fields that migration 031 anticipated
-- ("social_links... the natural next piece for a future creator profile
-- page") — bio and avatar_url are the two pieces that table was still
-- missing. Both public, same trust level as display_name and
-- social_links, unlike gender/age which stay private.
alter table user_profiles add column if not exists bio text;
alter table user_profiles add column if not exists avatar_url text;
comment on column user_profiles.bio is 'Public — shown on the user''s profile page. Not private like gender/age.';
comment on column user_profiles.avatar_url is 'Public — shown on the user''s profile page and anywhere their identity appears.';
