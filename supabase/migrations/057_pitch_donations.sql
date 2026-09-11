-- Extends the existing Pitch Room (migrations 025/026) with real,
-- in-platform donations rather than the external-link model those
-- migrations deliberately chose to avoid handling money directly. That
-- choice was specifically about lowering securities risk for an
-- INVESTMENT-style offering — this is a donation/reward model instead
-- (a backer supports a project to see it get made, no equity or
-- promised financial return), which sits in a fundamentally different,
-- much lower-regulatory-risk category (same bucket as Kickstarter/
-- Indiegogo, not Reg CF equity crowdfunding). Worth reflecting "this is
-- a donation, not an investment" in the actual terms of service text
-- when that gets written, but it does not require SEC registration the
-- way equity-based crowdfunding would.
--
-- funding_goal/funding_raised already exist (migration 026) but are
-- explicitly self-reported and untracked. This migration doesn't
-- repurpose those fields — funding_raised stays as whatever a creator
-- self-reports for a still-external campaign, while a real,
-- platform-tracked total is computed from pitch_donations directly
-- whenever funding_enabled is true, so the two models can't be
-- conflated or one silently corrupt the other's numbers.
alter table pitches add column if not exists funding_enabled boolean not null default false;
comment on column pitches.funding_enabled is 'True once admin has approved this pitch for real, in-platform donations. False means it still uses the original external project_url model.';

alter table pitches add column if not exists platform_cut_percent numeric;
comment on column pitches.platform_cut_percent is 'Set by admin when enabling in-platform funding. Locked in per-donation at donation time (see pitch_donations.platform_cut_cents), so a later change here never retroactively affects past donations.';

-- Nullable — a creator without a connected Stripe account can still have
-- funding_enabled=true set by admin (e.g. while they're mid-onboarding),
-- but no real charge should ever be attempted until this is set. Real
-- Stripe Connect integration (onboarding flow, actual charges, payouts)
-- is a separate, later piece of work — this column exists now so the
-- schema doesn't need touching again once that's built.
alter table pitches add column if not exists creator_stripe_account_id text;

create table if not exists pitch_donations (
  id uuid primary key default gen_random_uuid(),
  pitch_id uuid not null references pitches(id) on delete cascade,
  donor_user_id text not null,
  donor_email text,
  amount_cents integer not null,
  -- Locked in from pitches.platform_cut_percent at the moment of
  -- donation, not read live from the pitch row — the whole point of
  -- storing this per-donation rather than computing it on read is that
  -- admin changing the platform's cut later must never rewrite what a
  -- past donation actually cost or paid out.
  platform_cut_cents integer not null,
  creator_payout_cents integer not null,
  stripe_payment_intent_id text,
  -- pending until a real Stripe integration exists to move it to
  -- completed/refunded/failed; nothing currently transitions this state.
  status text not null default 'pending' check (status in ('pending', 'completed', 'refunded', 'failed')),
  created_at timestamptz not null default now(),
  check (amount_cents > 0),
  check (platform_cut_cents + creator_payout_cents = amount_cents)
);
create index if not exists pitch_donations_pitch_idx on pitch_donations (pitch_id, created_at desc);
create index if not exists pitch_donations_donor_idx on pitch_donations (donor_user_id);
comment on table pitch_donations is 'Real, tracked donations to an in-platform-funding-enabled pitch. amount_cents = platform_cut_cents + creator_payout_cents always, enforced at the database level.';
