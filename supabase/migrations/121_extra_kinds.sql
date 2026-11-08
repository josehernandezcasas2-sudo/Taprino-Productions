-- 121 — What kind of extra (written 2026-11-08).
--
-- Jose, 2026-11-08: add kinds of extras, "but have it all under extras".
-- The kind is only a label: every extra stays in the one Extras tab, row
-- and shelf where it is today (the series page's "With the show" and
-- "After S1 E3 · …" groups included). An uploader picks Making-of, Behind
-- the scenes, Deleted scene, Interview, Bloopers, Commentary or Teaser, or
-- Other and types their own ("Table read", "Music video"). Cards then read
-- "MAKING-OF · 6 MIN" and the extra's own page says the same word; with no
-- kind (and Other left empty) they read "Extra", exactly as before.
--
--   episodes.extra_kind  a preset's id ('making-of', 'behind-the-scenes',
--                        'deleted-scene', 'interview', 'bloopers',
--                        'commentary', 'teaser') or the uploader's own
--                        words, or null. The site cleans every write first
--                        (lib/extraKinds.js normalizeExtraKind: no control
--                        or invisible characters, no angle brackets, at
--                        most 40 characters); the check below is the
--                        backstop on the length.
--
-- One column on a table migration 112 already locked to the site's own
-- server key; no table is made, no row changes, nothing is copied. Safe to
-- run more than once. Before it has run, the site reads every extra as
-- having no kind ("Extra") and the editors show the field greyed with
-- "needs a database update (migration 121)"; everything else works as
-- before.

begin;

alter table public.episodes add column if not exists extra_kind text;

-- At most 40 characters, and never only spaces (empty means no kind:
-- null). Added once; a second run finds it and leaves it.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.episodes'::regclass and conname = 'episodes_extra_kind_length'
  ) then
    alter table public.episodes add constraint episodes_extra_kind_length
      check (extra_kind is null or (char_length(extra_kind) between 1 and 40 and btrim(extra_kind) <> ''));
    raise notice '121: episodes.extra_kind added, with its length check (1 to 40 characters).';
  else
    raise notice '121: episodes.extra_kind and its length check were already there; nothing changed.';
  end if;
end $$;

comment on column public.episodes.extra_kind is 'What kind of extra a bonus title is: a preset id (making-of, behind-the-scenes, deleted-scene, interview, bloopers, commentary, teaser) or the uploader''s own words (1-40 characters). Null reads "Extra". Only a label: extras all stay under Extras. Migration 121.';

-- PostgREST picks the new column up at once.
notify pgrst, 'reload schema';

commit;

-- What is there now (one row). On the first run no extra has a kind yet.
select
  (select count(*) from information_schema.columns
     where table_schema = 'public' and table_name = 'episodes' and column_name = 'extra_kind')            as new_column_expect_1,
  (select count(*) from pg_constraint
     where conrelid = 'public.episodes'::regclass and conname = 'episodes_extra_kind_length')             as length_check_expect_1,
  (select count(*) from public.episodes where content_type = 'bonus')                                     as extras,
  (select count(*) from public.episodes where extra_kind is not null)                                     as with_a_kind,
  (select relrowsecurity from pg_class where oid = 'public.episodes'::regclass)                           as row_level_security_expect_true;
