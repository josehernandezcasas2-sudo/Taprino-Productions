-- Crew pay through Stripe (Connect, 2026-10-25).
--
-- A paid crew/casting call can be "pay secured": the poster names the
-- rate per person for the job and, once someone is booked, funds that
-- person through Stripe Checkout. The money lands in Studio Tapa's
-- balance and is released to the worker's Connect account (the same
-- creator_payout_accounts row backers and hosts use) when the poster
-- confirms they worked. "Didn't happen" refunds the poster in full;
-- unbooking a funded person refunds everything but the card fee.
-- Studio Tapa's service fee (site_settings.crew_pay_cut_percent) and the
-- card processing cover are charged on top of the rate, so the worker
-- gets exactly the rate posted. Optional per call; off by default.
-- Service-role only (no RLS).

alter table crew_calls add column if not exists pay_secured boolean not null default false;
-- Per person, for the whole job (not per day).
alter table crew_calls add column if not exists pay_rate_cents integer check (pay_rate_cents is null or pay_rate_cents >= 0);

alter table site_settings add column if not exists crew_pay_cut_percent numeric(5,1) not null default 8;

create table if not exists crew_payments (
  id uuid primary key default gen_random_uuid(),
  call_id uuid not null references crew_calls (id) on delete cascade,
  -- One payment per booked response; a cancelled one is replaced by a new row.
  response_id uuid not null references crew_responses (id) on delete cascade,
  poster_id text not null,
  worker_id text not null,
  -- What the worker receives.
  amount_cents integer not null check (amount_cents > 0),
  -- Studio Tapa's service fee, on top of the rate.
  cut_percent numeric(5,1) not null default 0,
  platform_cut_cents integer not null default 0 check (platform_cut_cents >= 0),
  -- Card processing cover, on top as well (lib/donationMath.js feeCoverCents).
  fee_cover_cents integer not null default 0 check (fee_cover_cents >= 0),
  total_charged_cents integer not null check (total_charged_cents >= amount_cents),
  -- pending_payment: Checkout started · held: paid, waiting for "worked it"
  -- · released: transferred to the worker · refunded · cancelled (never paid)
  -- · failed
  status text not null default 'pending_payment' check (status in ('pending_payment', 'held', 'released', 'refunded', 'cancelled', 'failed')),
  stripe_checkout_session_id text,
  stripe_payment_intent_id text,
  stripe_charge_id text,
  stripe_transfer_id text,
  stripe_refund_id text,
  paid_at timestamptz,
  -- Set when the job is confirmed but the worker has no payout account yet;
  -- the account.updated webhook releases it once they do.
  release_requested_at timestamptz,
  released_at timestamptz,
  refunded_at timestamptz,
  refunded_cents integer,
  refund_reason text,
  failed_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table crew_payments is 'Pay secured on a crew call: the poster funds a booked person; held by the studio and released to the worker''s Connect account when the poster confirms they worked.';
create index if not exists crew_payments_call_idx on crew_payments (call_id, created_at desc);
create index if not exists crew_payments_response_idx on crew_payments (response_id, status);
create index if not exists crew_payments_worker_idx on crew_payments (worker_id, status);
create index if not exists crew_payments_session_idx on crew_payments (stripe_checkout_session_id);
create index if not exists crew_payments_pi_idx on crew_payments (stripe_payment_intent_id);
-- Only one live payment per response (pending/held/released); cancelled,
-- refunded and failed rows can pile up behind it.
create unique index if not exists crew_payments_live_response_idx on crew_payments (response_id) where status in ('pending_payment', 'held', 'released');
