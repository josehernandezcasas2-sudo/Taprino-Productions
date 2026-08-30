-- Release year for episodes and series/shows. Nullable and optional —
-- existing content has no value here and shouldn't be forced to guess one.
-- Stored as a plain integer (not a date) since only the year is ever shown
-- or collected; a full date would invite a form asking for a month/day
-- nobody has a reliable answer for.
alter table episodes add column if not exists release_year integer;
alter table series add column if not exists release_year integer;

comment on column episodes.release_year is 'The year this title was made/released, as entered by the creator or admin. Optional.';
comment on column series.release_year is 'The year this show/series first released, as entered by the creator or admin. Optional.';
