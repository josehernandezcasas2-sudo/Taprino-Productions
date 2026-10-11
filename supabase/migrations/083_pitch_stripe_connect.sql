-- Pitch Room donations become real money through Stripe Connect
-- (Express accounts; destination charges with an application fee).
-- Decisions (Jose, 2026-10-11):
--   * the donor covers Stripe's processing fee on top of their donation,
--     so the creator's payout and the platform cut are both figured on
--     the amount the donor meant to give (amount_cents), never reduced
--     by card fees;
--   * keep-what-you-raise, no deadline gate — a series keeps taking
--     donations to continue;
--   * refunds are admin-only and otherwise final;
--   * minimum donation $1.
-- Run after 082.

-- 1. One Stripe Express account per creator (not per pitch). Flags are
--    mirrored from Stripe's account.updated webhook; charges_enabled is
--    the one that gates real donations.
create table if not exists creator_payout_accounts (
  user_id text primary key,
  stripe_account_id text not null unique,
  details_submitted boolean not null default false,
  charges_enabled boolean not null default false,
  payouts_enabled boolean not null default false,
  -- Stripe's requirements.currently_due, so the creator card can say
  -- what's still missing instead of a bare "not ready".
  requirements_due text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table creator_payout_accounts is 'Stripe Connect (Express) account per creator. pitches.creator_stripe_account_id is a copy taken when admin enables funding on a pitch.';

-- 2. Donations: the Checkout session that created them, the processing
--    fee the donor covered, and the lifecycle timestamps. The existing
--    check (platform_cut_cents + creator_payout_cents = amount_cents)
--    still holds: the fee cover sits beside the donation, not inside it.
alter table pitch_donations add column if not exists stripe_checkout_session_id text;
create unique index if not exists pitch_donations_session_idx on pitch_donations (stripe_checkout_session_id) where stripe_checkout_session_id is not null;
alter table pitch_donations add column if not exists fee_cover_cents integer not null default 0;
alter table pitch_donations add column if not exists total_charged_cents integer;
alter table pitch_donations add column if not exists stripe_charge_id text;
alter table pitch_donations add column if not exists completed_at timestamptz;
alter table pitch_donations add column if not exists refunded_at timestamptz;
alter table pitch_donations add column if not exists refunded_by text;
alter table pitch_donations add column if not exists refund_reason text;
alter table pitch_donations add column if not exists failed_reason text;
create index if not exists pitch_donations_status_idx on pitch_donations (pitch_id, status);
comment on column pitch_donations.fee_cover_cents is 'Stripe processing fee added on top of amount_cents and paid by the donor. total_charged_cents = amount_cents + fee_cover_cents.';
comment on column pitch_donations.status is 'pending = Checkout open; completed = paid (the only status that counts toward totals); failed = session expired or payment failed; refunded = admin refund, reverses the transfer and the platform fee.';

-- Minimum $1. NOT VALID so rows recorded before this migration (test
-- donations of any size) don't block it; new rows are checked.
alter table pitch_donations drop constraint if exists pitch_donations_min_amount;
alter table pitch_donations add constraint pitch_donations_min_amount check (amount_cents >= 100) not valid;

-- 3. Rows recorded before Stripe existed were never charged: nothing was
--    paid, so they must not count. Totals now count completed only.
update pitch_donations
set status = 'failed', failed_reason = 'recorded before Stripe Connect; no charge was made'
where status = 'pending' and stripe_checkout_session_id is null;

-- 4. Site-wide default platform cut, pre-filled when admin enables
--    funding on a pitch (admin can still change it per pitch; each
--    donation locks in the pitch's rate at donation time as before).
alter table site_settings add column if not exists pitch_platform_cut_percent numeric not null default 5;
comment on column site_settings.pitch_platform_cut_percent is 'Default platform cut (%) offered when enabling in-platform funding on a pitch. Per-pitch value lives on pitches.platform_cut_percent.';

-- 5. Webhook idempotency: Stripe retries deliveries, and a donation must
--    never be completed (or credited) twice. Each event id is recorded
--    once; a repeat is acknowledged and ignored.
create table if not exists stripe_events (
  id text primary key,
  type text not null,
  received_at timestamptz not null default now()
);
