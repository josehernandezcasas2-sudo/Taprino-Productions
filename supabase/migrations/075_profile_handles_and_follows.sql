-- Public @handles for profiles. A profile URL used to be the raw Clerk
-- id (/profile/user_3I4ylh...), which is ugly to share and impossible to
-- remember. A handle is optional: /profile/<handle> resolves to the
-- person, and every existing /profile/<user_id> link keeps working (the
-- page accepts either). Case-insensitive uniqueness via a partial index,
-- same pattern as display_name in migration 035.
alter table user_profiles add column if not exists handle text;
create unique index if not exists user_profiles_handle_lower_idx
  on user_profiles (lower(handle))
  where handle is not null;
comment on column user_profiles.handle is 'Public — optional @handle used in the profile URL (/profile/<handle>). 3-30 chars, letters/digits/underscore.';

-- Profile banner: the backdrop behind the avatar at the top of the
-- profile page. Either a photo (banner_url, uploaded like the avatar) or
-- a solid color (banner_color, a #rrggbb hex). Photo wins when both are
-- set; neither set = the site's default gradient.
alter table user_profiles add column if not exists banner_url text;
alter table user_profiles add column if not exists banner_color text;
comment on column user_profiles.banner_url is 'Public — profile page backdrop photo. Null = use banner_color or the default.';
comment on column user_profiles.banner_color is 'Public — profile page backdrop solid color (#rrggbb) when there is no banner photo.';

-- Creator follows. Same shape as pitch_saves/pitch_likes: one row per
-- (follower, followed), the pair's uniqueness makes toggling idempotent,
-- and follower counts come straight from the table — no counter column
-- to keep in sync. Keyed on Clerk user ids (text), like everything else.
create table if not exists user_follows (
  follower_id text not null,
  followed_id text not null,
  created_at timestamptz not null default now(),
  primary key (follower_id, followed_id),
  check (follower_id <> followed_id)
);
create index if not exists user_follows_followed_id_idx on user_follows (followed_id);
comment on table user_follows is 'Who follows whom. follower_id follows followed_id. Drives the Follow button and counts on public profiles.';
