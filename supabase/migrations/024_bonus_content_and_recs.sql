-- Bonus content — BTS, trailers, extras, or anything else a creator wants
-- to attach under a series or movie/short. Reuses the episodes table and
-- all its existing upload/admin/playback machinery rather than building a
-- parallel system — a bonus item IS an episode, just one with
-- content_type='bonus' and a pointer to whatever it's attached under.
--
-- bonus_parent_type/bonus_parent_id are deliberately NOT foreign keys —
-- the parent can be either a series (bonus_parent_type='series',
-- bonus_parent_id references series.id) or a standalone movie/short
-- (bonus_parent_type='episode', bonus_parent_id references episodes.id),
-- and Postgres can't express a conditional foreign key across two tables
-- in one column. Validated at the API layer instead.
alter table episodes drop constraint if exists episodes_content_type_check;
alter table episodes add constraint episodes_content_type_check
  check (content_type in ('series', 'movie', 'short', 'vertical', 'podcast', 'bonus'));

alter table episodes add column if not exists bonus_parent_type text check (bonus_parent_type in ('series', 'episode'));
alter table episodes add column if not exists bonus_parent_id text;
create index if not exists episodes_bonus_parent_idx on episodes (bonus_parent_type, bonus_parent_id) where content_type = 'bonus';
comment on column episodes.bonus_parent_type is 'Only set when content_type=bonus — whether bonus_parent_id points at a series or a standalone episode.';
comment on column episodes.bonus_parent_id is 'Only set when content_type=bonus — the series.id or episodes.id this bonus content belongs under.';

-- Recommendations closeness — admin-tunable 0-10 dial controlling how far
-- "My Recs" wanders from a viewer's existing taste. 10 = very close
-- matches (same genre/artist as what they've liked), 0 = wide exploration
-- (mostly outside their usual pattern). See lib/recommendations.js.
alter table site_settings add column if not exists recommendation_closeness int not null default 6 check (recommendation_closeness between 0 and 10);
comment on column site_settings.recommendation_closeness is
  '0-10. 10 = recommendations closely match viewing history (genre/artist overlap). 0 = wide exploration, mostly outside their pattern. Default 6 leans toward familiar with room to explore.';
