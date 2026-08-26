-- Case-insensitive uniqueness on display_name — "Jose" and "jose" count
-- as the same name. A partial index (excluding NULLs) is the correct
-- Postgres pattern here: many users won't have set a display name yet,
-- and those NULLs must never collide with each other under uniqueness.
create unique index if not exists user_profiles_display_name_lower_idx
  on user_profiles (lower(display_name))
  where display_name is not null;
