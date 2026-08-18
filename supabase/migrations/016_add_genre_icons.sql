-- Lets admin replace a genre's emoji with an uploaded image, without a code
-- change. Genres with no row here fall back to the built-in emoji map in
-- components/GenreBrowseRow.js — this table only needs a row for genres
-- that have actually been customized.
create table if not exists genre_icons (
  genre text primary key,
  image_url text not null,
  updated_at timestamptz not null default now()
);

comment on table genre_icons is
  'Admin-uploaded replacements for the default emoji genre icons. Missing genre = use the emoji fallback.';
