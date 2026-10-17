-- 089: Studio money — the studio's own sweeps from the platform's Stripe
-- balance to the bank (mockups/studio-money-v1.html, signed off
-- 2026-10-17). The balance minus what has to stay (creators' unpaid
-- credits, advertisers' unserved prepaid credits, a refund reserve and
-- named earmarks for films) is what can leave. Every sweep freezes that
-- calculation; every difference between Stripe and our tables is kept
-- with its explanation.

-- 1. A sweep: one Stripe payout from the platform balance to the bank.
create table if not exists studio_sweeps (
  id uuid primary key default gen_random_uuid(),
  cents integer not null check (cents > 0),
  stripe_payout_id text unique,
  status text not null default 'pending' check (status in ('pending', 'in_transit', 'paid', 'failed', 'canceled')),
  failed_reason text,
  -- The reconciliation window this sweep closed.
  period_from timestamptz,
  period_to timestamptz not null default now(),
  -- The calculation as it stood: balance, obligations, lanes, differences.
  breakdown jsonb not null default '{}'::jsonb,
  discrepancy_cents integer not null default 0,
  note text,
  created_by text,
  created_at timestamptz not null default now(),
  arrival_on date,
  paid_at timestamptz
);
create index if not exists studio_sweeps_created_idx on studio_sweeps (created_at desc);
comment on table studio_sweeps is 'Studio money: each payout from the platform Stripe balance to the studio bank, with the calculation that produced it frozen in breakdown.';

-- 2. Earmarks: the studio's own money kept in Stripe on purpose (a film's
--    finishing costs, a Pitch Room match). Lowers what can leave; never
--    touches what creators are owed.
create table if not exists studio_earmarks (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  cents integer not null check (cents > 0),
  note text,
  created_by text,
  created_at timestamptz not null default now(),
  released_at timestamptz,
  released_by text
);
create index if not exists studio_earmarks_open_idx on studio_earmarks (created_at) where released_at is null;

-- 3. Explanations for differences between Stripe and our records in the
--    current period. Closed (sweep_id set) by the sweep that ends the period.
create table if not exists studio_adjustments (
  id uuid primary key default gen_random_uuid(),
  cents integer not null,
  explanation text not null,
  sweep_id uuid references studio_sweeps (id) on delete set null,
  created_by text,
  created_at timestamptz not null default now()
);
create index if not exists studio_adjustments_open_idx on studio_adjustments (created_at) where sweep_id is null;

-- 4. Advertiser credit purchases, so the Stripe charge can be matched to
--    a record (add_ad_credits only moves the balance). Written by the
--    webhook from here on.
create table if not exists ad_credit_purchases (
  id uuid primary key default gen_random_uuid(),
  ad_account_id uuid not null,
  stripe_checkout_session_id text unique,
  stripe_payment_intent_id text,
  amount_cents integer not null check (amount_cents >= 0),
  created_at timestamptz not null default now()
);
create index if not exists ad_credit_purchases_created_idx on ad_credit_purchases (created_at desc);

-- 5. The rules (edited on /admin/money).
alter table site_settings add column if not exists studio_sweep_day integer not null default 5 check (studio_sweep_day between 1 and 28);
alter table site_settings add column if not exists studio_sweep_mode text not null default 'confirm' check (studio_sweep_mode in ('confirm', 'auto'));
alter table site_settings add column if not exists studio_reserve_percent numeric not null default 5;
alter table site_settings add column if not exists studio_reserve_days integer not null default 90;
alter table site_settings add column if not exists studio_reserve_floor_cents integer not null default 30000;
alter table site_settings add column if not exists studio_tolerance_cents integer not null default 2500;
alter table site_settings add column if not exists studio_tolerance_percent numeric not null default 1;
comment on column site_settings.studio_sweep_mode is 'confirm = the page proposes the amount on the sweep day and an admin presses the button; auto = the cron sends it.';
