-- 124 — Removals held a month, titles brought back, every change on a live
-- title reviewed, a booking keeps the policy it was paid under
-- (written 2026-11-15).
--
-- Jose, 2026-11-15: "withdrawn titles can come back whenever possible but
-- need to have a certain requirement, we only hold the data up to a month
-- if there is no purchase. If it goes to just streaming, or just the tv,
-- then yes, it can be withdrawn completely, unless otherwise mentioned that
-- we can store the data for later use"; "make sure any caption change or
-- anything to change the series/live titles needs review"; "a booking
-- policy / cancellation must be given notification and cannot account to a
-- live booking after payment, they continue with what they signed not with
-- the new policy".
--
--   * episodes.purge_after / series.purge_after
--       A removed title nobody bought is taken off the site at once and its
--       files are kept until this moment (30 days), then deleted for good
--       by the daily clean-up. Null = not waiting to be deleted (a live
--       title, one kept for its buyers, or one kept for later).
--   * episodes.keep_after_removal / series.keep_after_removal
--       The owner asked us to keep the files for later when they asked for
--       the removal: the title is taken off the site and nothing is
--       deleted. False unless they ask.
--   * episodes.restore_requested_at / series.restore_requested_at
--   * episodes.restore_reason / series.restore_reason
--       The owner asked to bring a removed title back (and why). It comes
--       back once someone on the team approves it.
--   * episodes.pending_fields / series.pending_fields
--       Details of a live title that wait for review (captions, genre,
--       credits, links…), as { field: value }. The live values stay until
--       the change is approved. Null = nothing waiting.
--   * location_requests.cancellation_policy
--       The cancellation policy a booking was paid under. A refund always
--       follows it; a host's later change to the listing's policy doesn't
--       reach a paid booking. Bookings already paid before this migration
--       get the listing's policy as it stands today (the best record
--       there is).
--
-- Columns only, plus the backfill above; no row is removed and nothing
-- anyone can watch changes. Safe to run more than once. Before it has run
-- the code reads every one of these as absent: a removal is deleted at
-- once as before, nothing can be brought back, a change to a live title's
-- details answers "needs a database update (migration 124)", and a refund
-- reads the listing's policy.

begin;

alter table public.episodes add column if not exists purge_after timestamptz;
alter table public.episodes add column if not exists keep_after_removal boolean not null default false;
alter table public.episodes add column if not exists restore_requested_at timestamptz;
alter table public.episodes add column if not exists restore_reason text;
alter table public.episodes add column if not exists pending_fields jsonb;
comment on column public.episodes.purge_after is 'A removed title nobody bought: its files are deleted for good after this moment (30 days after the removal). Null = not waiting to be deleted. Migration 124.';
comment on column public.episodes.keep_after_removal is 'The owner asked for the files to be kept for later when they asked for the removal. Migration 124.';
comment on column public.episodes.restore_requested_at is 'The owner asked to bring this removed title back; it returns once the team approves. Migration 124.';
comment on column public.episodes.restore_reason is 'Why the owner wants it back (optional, 1,000 characters). Migration 124.';
comment on column public.episodes.pending_fields is 'Details of a live title waiting for review, { field: value }; the live values stay until approved. Null = nothing waiting. Migration 124.';

alter table public.series add column if not exists purge_after timestamptz;
alter table public.series add column if not exists keep_after_removal boolean not null default false;
alter table public.series add column if not exists restore_requested_at timestamptz;
alter table public.series add column if not exists restore_reason text;
alter table public.series add column if not exists pending_fields jsonb;
comment on column public.series.purge_after is 'A removed show nobody bought anything of: its files are deleted for good after this moment (30 days after the removal). Migration 124.';
comment on column public.series.keep_after_removal is 'The owner asked for the files to be kept for later. Migration 124.';
comment on column public.series.restore_requested_at is 'The owner asked to bring this removed show back; it returns once the team approves. Migration 124.';
comment on column public.series.restore_reason is 'Why the owner wants it back (optional). Migration 124.';
comment on column public.series.pending_fields is 'Details of a live show waiting for review, { field: value }. Migration 124.';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'episodes_restore_reason_len') then
    alter table public.episodes add constraint episodes_restore_reason_len check (restore_reason is null or char_length(restore_reason) <= 1000);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'series_restore_reason_len') then
    alter table public.series add constraint series_restore_reason_len check (restore_reason is null or char_length(restore_reason) <= 1000);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'episodes_pending_fields_object') then
    alter table public.episodes add constraint episodes_pending_fields_object check (pending_fields is null or jsonb_typeof(pending_fields) = 'object');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'series_pending_fields_object') then
    alter table public.series add constraint series_pending_fields_object check (pending_fields is null or jsonb_typeof(pending_fields) = 'object');
  end if;
end $$;

-- The daily clean-up reads the titles whose time is up.
create index if not exists episodes_purge_after_idx on public.episodes (purge_after) where purge_after is not null;
create index if not exists series_purge_after_idx on public.series (purge_after) where purge_after is not null;
-- The review queue reads the titles waiting to come back.
create index if not exists episodes_restore_requested_idx on public.episodes (restore_requested_at) where restore_requested_at is not null;
create index if not exists series_restore_requested_idx on public.series (restore_requested_at) where restore_requested_at is not null;

alter table public.location_requests add column if not exists cancellation_policy text;
comment on column public.location_requests.cancellation_policy is 'The cancellation policy this booking was paid under (flexible | moderate | strict); refunds follow it, whatever the listing says later. Migration 124.';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'location_requests_cancellation_policy_check') then
    alter table public.location_requests add constraint location_requests_cancellation_policy_check check (cancellation_policy is null or cancellation_policy in ('flexible', 'moderate', 'strict'));
  end if;
end $$;

-- Bookings already paid: the listing's policy as it stands today.
update public.location_requests r
   set cancellation_policy = l.cancellation
  from public.locations l
 where l.id = r.location_id
   and r.cancellation_policy is null
   and r.status in ('paid', 'done');

-- PostgREST reads the new columns at once.
notify pgrst, 'reload schema';

commit;

-- What 124 changed (one row).
select
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'episodes' and column_name in ('purge_after', 'keep_after_removal', 'restore_requested_at', 'restore_reason', 'pending_fields')) as episode_columns_expect_5,
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'series' and column_name in ('purge_after', 'keep_after_removal', 'restore_requested_at', 'restore_reason', 'pending_fields')) as series_columns_expect_5,
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'location_requests' and column_name = 'cancellation_policy') as booking_column_expect_1,
  (select count(*) from public.location_requests where status in ('paid', 'done') and cancellation_policy is null) as paid_bookings_without_a_policy_expect_0;
