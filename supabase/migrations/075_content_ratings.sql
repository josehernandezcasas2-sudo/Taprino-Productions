-- Content ratings as data: the standard MPAA and TV Parental Guidelines
-- list seeded here, plus any custom rating an admin adds on /admin/ratings.
-- min_age drives the age gate (lib/ageGate.js); image_url is the PNG bug
-- the channel player shows in the corner when a program starts.
create table if not exists content_ratings (
  code text primary key,
  label text not null,
  min_age integer not null default 17 check (min_age >= 0 and min_age <= 21),
  image_url text,
  sort integer not null default 100,
  is_custom boolean not null default false,
  updated_at timestamptz not null default now()
);

insert into content_ratings (code, label, min_age, sort) values
  ('G', 'General audiences', 0, 10),
  ('PG', 'Parental guidance suggested', 0, 20),
  ('PG-13', 'Parents strongly cautioned', 13, 30),
  ('R', 'Restricted', 17, 40),
  ('NC-17', 'Adults only', 17, 50),
  ('TV-Y', 'All children', 0, 60),
  ('TV-Y7', 'Directed to older children', 7, 70),
  ('TV-G', 'General audience', 0, 80),
  ('TV-PG', 'Parental guidance suggested', 0, 90),
  ('TV-14', 'Parents strongly cautioned', 14, 100),
  ('TV-MA', 'Mature audience only', 17, 110),
  ('Not Rated', 'No rating', 17, 120)
on conflict (code) do nothing;
