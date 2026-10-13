-- Where the banner photo and the avatar photo sit in their frames, set by
-- the account page's Reposition mode (web + app). CSS-style "x% y%";
-- null = centred, which is what every existing profile keeps.
alter table user_profiles add column if not exists banner_position text;
alter table user_profiles add column if not exists avatar_position text;

comment on column user_profiles.banner_position is 'Focal point of the banner photo as "x% y%" (background-position); null = centre.';
comment on column user_profiles.avatar_position is 'Focal point of the avatar photo inside its circle as "x% y%"; null = centre.';
