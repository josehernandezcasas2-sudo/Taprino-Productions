-- 126 — account types (Jose, 2026-11-18: "I want the user to pick the user
-- types … creator, crew, cast, and studio", "have them have multiple",
-- "have the question skippable, this will default to a normal user/watch
-- user"; the canvas https://claude.ai/artifact/GxAa8Qj57oQRuBF7c5xo4q).
--
-- A person ticks any of the four types; one of them is their main, which
-- decides what people see first on their profile. None ticked = here to
-- watch. The sign-up question is asked once (account_type_asked_at);
-- skipping it stamps the date and leaves the list empty.
--
-- Columns only (no new table, so no row level security line is owed).
-- Safe to run again. Nothing moves money; no plan reads these.
begin;

alter table public.user_profiles add column if not exists account_types text[] not null default '{}';
alter table public.user_profiles add column if not exists main_type text;
alter table public.user_profiles add column if not exists account_type_asked_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'user_profiles_account_types_check') then
    alter table public.user_profiles add constraint user_profiles_account_types_check
      check (account_types <@ array['creator', 'crew', 'cast', 'studio']::text[] and cardinality(account_types) <= 4);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'user_profiles_main_type_check') then
    alter table public.user_profiles add constraint user_profiles_main_type_check
      check (main_type is null or main_type = any (account_types));
  end if;
end $$;

comment on column public.user_profiles.account_types is 'Public. The account types the person ticked: creator, crew, cast, studio (any of them; empty = here to watch). A type is a label and an order on the profile; uploading still needs the creator role. Migration 126.';
comment on column public.user_profiles.main_type is 'Public. The type people see first on the profile; one of account_types, or null when none is ticked. Migration 126.';
comment on column public.user_profiles.account_type_asked_at is 'When the person answered or skipped the "What brings you here?" question; null = not asked yet. Migration 126.';

-- PostgREST reads the new columns at once.
notify pgrst, 'reload schema';

commit;

-- What 126 changed (one row).
select
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'user_profiles' and column_name in ('account_types', 'main_type', 'account_type_asked_at')) as profile_columns_expect_3,
  (select count(*) from pg_constraint where conname in ('user_profiles_account_types_check', 'user_profiles_main_type_check')) as checks_expect_2;
