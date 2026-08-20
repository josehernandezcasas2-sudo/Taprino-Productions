-- Content rating (TV/movie), shown to viewers alongside genre and runtime.
-- Deliberately a free-text column, not a check constraint — the combined
-- MPAA (movie) and TV Parental Guidelines lists below cover the common
-- case, but a constraint would block anything else (foreign ratings,
-- something the admin form doesn't anticipate) rather than just letting
-- it through. Validation happens at the API layer instead, where it's a
-- soft suggestion, not a hard wall.
alter table episodes add column if not exists rating text;
comment on column episodes.rating is
  'Content rating — movie (G, PG, PG-13, R, NC-17) or TV (TV-Y, TV-Y7, TV-G, TV-PG, TV-14, TV-MA), or Not Rated. Free text, validated softly at the API layer.';
