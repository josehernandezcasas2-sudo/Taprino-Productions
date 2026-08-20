-- Extends site_settings (see 021) with two more toggles that belong in the
-- same "site-wide switches" bucket: hiding the Live TV nav link entirely,
-- and overriding the search icon the same way genre icons can already be
-- overridden with an uploaded image instead of an emoji.
alter table site_settings add column if not exists live_tv_enabled boolean not null default true;
alter table site_settings add column if not exists search_icon_url text;
comment on column site_settings.live_tv_enabled is
  'Shows/hides the "Live TV" nav link (the /channel looping playlist) site-wide. On by default since the channel already exists and works.';
comment on column site_settings.search_icon_url is
  'Optional uploaded image replacing the search icon emoji in the header, same idea as genre_icons. Null = use the default emoji.';
