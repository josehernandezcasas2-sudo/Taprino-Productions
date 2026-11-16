-- 125 — A refund the poster asks for on secured crew pay waits three
-- days so the crew member can say the job happened; a self refund of a
-- bought title can't race a download (written 2026-11-16).
--
-- Jose, 2026-11-16: "Yes, hold the money for any disputes" (round 3's open
-- decision: a no-show or a cancellation on paid crew work refunded the
-- poster at once, with no way for the worker to answer).
--
--   * crew_payments.refund_due_at
--       The poster said the job didn't happen, cancelled it or took the
--       person off it: the money stays held and goes back to the poster
--       after this moment (three days on), unless the crew member contests
--       it first. Null = no refund asked.
--   * crew_payments.refund_kind            no_show | cancelled | unbooked
--   * crew_payments.refund_asked_cents     what goes back (the whole charge
--                                          for a no-show, less the card fee
--                                          otherwise), fixed when asked
--   * crew_payments.refund_asked_by / refund_asked_at
--   * crew_payments.contested_at / contest_note
--       The crew member said the job happened (and why, 1,000 characters):
--       the money stays held until a full admin decides.
--   * crew_payments.contest_decision       refund | release
--   * crew_payments.contest_decided_at / contest_decided_by
--   * purchases.refund_started_at
--       A buyer's own refund is being made: a download of what the
--       purchase covers is refused while it is set, and the refund looks
--       for downloads only after setting it, so the two can't both win.
--
-- Columns only; no row changes and nothing anyone sees changes. Safe to
-- run more than once. Before it has run the code reads every one of these
-- as absent: a refund the poster asks for is not made at all (the money
-- stays held and the studio is emailed to settle it), and a self refund
-- checks downloads as it did before.

begin;

alter table public.crew_payments add column if not exists refund_due_at timestamptz;
alter table public.crew_payments add column if not exists refund_kind text;
alter table public.crew_payments add column if not exists refund_asked_cents integer;
alter table public.crew_payments add column if not exists refund_asked_by text;
alter table public.crew_payments add column if not exists refund_asked_at timestamptz;
alter table public.crew_payments add column if not exists contested_at timestamptz;
alter table public.crew_payments add column if not exists contest_note text;
alter table public.crew_payments add column if not exists contest_decision text;
alter table public.crew_payments add column if not exists contest_decided_at timestamptz;
alter table public.crew_payments add column if not exists contest_decided_by text;
comment on column public.crew_payments.refund_due_at is 'The poster asked for the money back: it goes back after this moment (three days on) unless the crew member contests it. Null = no refund asked. Migration 125.';
comment on column public.crew_payments.refund_kind is 'Why the poster asked: no_show | cancelled | unbooked. Migration 125.';
comment on column public.crew_payments.refund_asked_cents is 'What goes back to the poster, fixed when they asked. Migration 125.';
comment on column public.crew_payments.contested_at is 'The crew member said the job happened: the money stays held until a full admin decides. Migration 125.';
comment on column public.crew_payments.contest_note is 'What the crew member told the studio (1,000 characters). Migration 125.';
comment on column public.crew_payments.contest_decision is 'refund (back to the poster) | release (to the crew member). Migration 125.';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'crew_payments_refund_kind_check') then
    alter table public.crew_payments add constraint crew_payments_refund_kind_check check (refund_kind is null or refund_kind in ('no_show', 'cancelled', 'unbooked'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'crew_payments_refund_asked_cents_check') then
    alter table public.crew_payments add constraint crew_payments_refund_asked_cents_check check (refund_asked_cents is null or refund_asked_cents >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'crew_payments_contest_note_len') then
    alter table public.crew_payments add constraint crew_payments_contest_note_len check (contest_note is null or char_length(contest_note) <= 1000);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'crew_payments_contest_decision_check') then
    alter table public.crew_payments add constraint crew_payments_contest_decision_check check (contest_decision is null or contest_decision in ('refund', 'release'));
  end if;
end $$;

-- The daily step reads the refunds whose three days are up.
create index if not exists crew_payments_refund_due_idx on public.crew_payments (refund_due_at) where status = 'held' and refund_due_at is not null;

alter table public.purchases add column if not exists refund_started_at timestamptz;
comment on column public.purchases.refund_started_at is 'A buyer''s own refund is in flight: downloads of what this purchase covers are refused while it is set. Migration 125.';

-- PostgREST reads the new columns at once.
notify pgrst, 'reload schema';

commit;

-- What 125 changed (one row).
select
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'crew_payments' and column_name in ('refund_due_at', 'refund_kind', 'refund_asked_cents', 'refund_asked_by', 'refund_asked_at', 'contested_at', 'contest_note', 'contest_decision', 'contest_decided_at', 'contest_decided_by')) as crew_payment_columns_expect_10,
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'purchases' and column_name = 'refund_started_at') as purchase_column_expect_1;
