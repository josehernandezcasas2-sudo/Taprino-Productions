-- 091: Creator standing — payout holds and departures (Terms section 5,
-- decided by Jose 2026-10-18).
--
-- A hold stops a creator's payouts while we look into suspected fraud,
-- for up to 90 days (hold_until); credits keep arriving, nothing is
-- transferred. Past hold_until the hold lapses on its own and the next
-- batch pays them unless the credits were cancelled (a negative
-- 'adjustment' line in creator_ledger).
--
-- A departure (left_at) is a creator who withdrew their work, closed
-- their account, or was suspended. From then on no new member share or
-- referral bonus is credited to them; what they'd earned stays theirs
-- and is paid in full, even under the minimum, until collect_until
-- (left_at + 90 days, extendable by agreement). After that the next
-- batch moves the balance to the site-wide pool: one negative 'forfeit'
-- line for them and 'pool_share' lines for the other creators by views.

create table if not exists creator_standing (
  creator_id text primary key,
  hold_reason text,
  hold_started_at timestamptz,
  hold_until timestamptz,
  held_by text,
  leaving_reason text check (leaving_reason in ('withdrew', 'closed', 'suspended')),
  left_at timestamptz,
  collect_until timestamptz,
  left_by text,
  forfeited_at timestamptz,
  forfeited_cents integer,
  note text,
  updated_at timestamptz not null default now()
);
comment on table creator_standing is 'Payout holds (suspected fraud, up to 90 days) and departures (withdrew / closed / suspended: 90 days to collect, then the balance goes to the site-wide pool). One row per creator; absent = in good standing.';

alter table creator_ledger drop constraint if exists creator_ledger_kind_check;
alter table creator_ledger add constraint creator_ledger_kind_check
  check (kind in ('member_share', 'referral', 'ad_share', 'adjustment', 'reversal', 'payout', 'tip', 'backing', 'forfeit', 'pool_share'));
