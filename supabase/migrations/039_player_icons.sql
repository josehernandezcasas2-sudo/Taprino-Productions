-- Lets admin replace any of the player's default SVG icons with an
-- uploaded image, same pattern as genre_icons. icon_key is one of:
-- play, pause, volume_on, volume_muted, settings, fullscreen_enter,
-- fullscreen_exit. Missing rows fall back to the built-in SVG — that
-- fallback lives client-side in components/PlayerIcons.js, same as
-- genre icons falling back to emoji.
create table if not exists player_icons (
  icon_key text primary key,
  image_url text not null,
  updated_at timestamptz not null default now()
);
