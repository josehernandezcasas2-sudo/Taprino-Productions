-- Zoom for the banner and avatar photos, alongside 084's focal points:
-- a multiplier on the "cover" fit (1 = fill the frame exactly, 2 = twice
-- as close). Null = 1, which is what every existing profile keeps.
alter table user_profiles add column if not exists banner_zoom numeric(4,2);
alter table user_profiles add column if not exists avatar_zoom numeric(4,2);

comment on column user_profiles.banner_zoom is 'Zoom on the banner photo''s cover fit, 1–3; null = 1.';
comment on column user_profiles.avatar_zoom is 'Zoom on the avatar photo''s cover fit, 1–3; null = 1.';
