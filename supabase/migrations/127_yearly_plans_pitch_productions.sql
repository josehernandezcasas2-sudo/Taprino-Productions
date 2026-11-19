-- 127 — yearly Stream plans, credited month by month; one production per
-- pitch (written 2026-11-19).
--
-- Jose, 2026-11-19: "yes, yearly should be 10 months plan for price. Lets
-- add the yearly versions for all the subscriptions we have" and, on how a
-- yearly member's creators are paid, "have the credit go month by month.
-- this allows the user to change who they support after each month";
-- "any approved pitch can become a production and continue getting
-- funding", "one production per pitch, they should be tied with content".
--
--   * member_payments.months / months_credited / next_month_at / stopped_at
--       A yearly invoice is one payment for 12 months of the creator share.
--       The first month is credited when it is paid, as a monthly invoice
--       is; the daily cron credits each of the other 11 on its date, split
--       by the member's picks (or watching) that month. A refund or a
--       dispute stops the months not yet credited. Every row written before
--       127 is a monthly payment already credited: months 1, months_credited 1.
--
--   * productions: one live production per pitch
--       A unique index on the pitch a production grew out of. A database
--       that already has two productions naming one pitch keeps the oldest
--       link and unlinks the newer ones (named in a notice; the productions
--       themselves stay).
--
-- Columns and an index only (no new table, so no row level security line
-- is owed). Safe to run again.
begin;

alter table public.member_payments add column if not exists months smallint not null default 1;
alter table public.member_payments add column if not exists months_credited smallint not null default 1;
alter table public.member_payments add column if not exists next_month_at timestamptz;
alter table public.member_payments add column if not exists stopped_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'member_payments_months_check') then
    alter table public.member_payments add constraint member_payments_months_check check (months in (1, 12));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'member_payments_months_credited_check') then
    alter table public.member_payments add constraint member_payments_months_credited_check check (months_credited >= 0 and months_credited <= months);
  end if;
end $$;

comment on column public.member_payments.months is '1 for a monthly invoice, 12 for a yearly one. Migration 127.';
comment on column public.member_payments.months_credited is 'How many of the months have had their creator share credited (the first at payment, the rest by the daily cron). Migration 127.';
comment on column public.member_payments.next_month_at is 'When the next month''s share is due; null once every month is credited or the payment stopped. Migration 127.';
comment on column public.member_payments.stopped_at is 'A refund or dispute stopped the months not yet credited. Migration 127.';

create index if not exists member_payments_next_month_idx on public.member_payments (next_month_at) where next_month_at is not null;

-- One production per pitch: unlink newer duplicates first.
do $$
declare
  n integer;
begin
  with ranked as (
    select id, row_number() over (partition by project_id order by created_at, id) as rn
    from public.productions
    where project_type = 'pitch' and project_id is not null and status <> 'removed'
  )
  update public.productions p
     set project_type = null, project_id = null, project_title = null, updated_at = now()
    from ranked r
   where p.id = r.id and r.rn > 1;
  get diagnostics n = row_count;
  if n > 0 then
    raise notice '127: % production(s) named a pitch another production already had; their pitch link was removed (the productions stay).', n;
  end if;
end $$;

create unique index if not exists productions_one_per_pitch_uq
  on public.productions (project_id)
  where project_type = 'pitch' and project_id is not null and status <> 'removed';

-- PostgREST reads the new columns at once.
notify pgrst, 'reload schema';

commit;

-- What 127 changed (one row).
select
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'member_payments' and column_name in ('months', 'months_credited', 'next_month_at', 'stopped_at')) as member_payment_columns_expect_4,
  (select count(*) from pg_indexes where schemaname = 'public' and indexname in ('member_payments_next_month_idx', 'productions_one_per_pitch_uq')) as indexes_expect_2;
