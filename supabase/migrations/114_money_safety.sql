-- 114: money safety (security round 2, 2026-10-28).
--
-- 1. Secured crew pay (migration 110) was the one money path with no
--    review on either side and a release the poster alone controlled: two
--    fresh accounts could turn a stolen card into a Connect payout in two
--    days and leave the chargeback with the studio. Now:
--      hold_until        a release waits (lib/crewPayRules.js
--                        releaseHoldDays: a young poster or worker, or a
--                        worker's first payout through the site) until this
--                        date; the daily cron releases what is due.
--      claim/claimed_at  a release or refund claims the row before it
--                        calls Stripe, so "worked" and a refund racing each
--                        other can't both move money.
--      reversed_cents/at a released transfer reversed in the Stripe
--                        Dashboard (the documented remedy for a lost
--                        dispute) is recorded on the row.
-- 2. Buy to own (migration 097) had no chargeback lane at all: a disputed
--    sale left the buyer owning the title and the creator keeping their
--    share. The purchases table gets the same dispute columns as backing
--    (096) and tips (101), and the status 'disputed' (only 'completed'
--    rows grant playback, so a disputed sale stops playing by itself).
-- 3. A membership chargeback the studio wins used to leave the creators'
--    reversed credits reversed: restored_at marks the payment whose
--    credits were given back (lib/creatorShare.js restoreMembershipCharge).

alter table crew_payments
  add column if not exists hold_until timestamptz,
  add column if not exists claim text,
  add column if not exists claimed_at timestamptz,
  add column if not exists reversed_cents integer,
  add column if not exists reversed_at timestamptz;
comment on column crew_payments.hold_until is 'A release waits until this moment (a young account or a first payout); null = no hold.';
comment on column crew_payments.claim is 'release | refund while that call to Stripe is in flight; cleared when it lands or fails.';
create index if not exists crew_payments_hold_idx on crew_payments (hold_until) where status = 'held' and hold_until is not null;

alter table purchases
  add column if not exists dispute_id text,
  add column if not exists dispute_status text,
  add column if not exists disputed_at timestamptz,
  add column if not exists dispute_amount_cents integer,
  add column if not exists dispute_closed_at timestamptz,
  add column if not exists dispute_transfer_id text,
  add column if not exists clawback_cents integer not null default 0,
  add column if not exists clawback_at timestamptz,
  add column if not exists returned_cents integer not null default 0,
  add column if not exists returned_at timestamptz,
  add column if not exists returned_transfer_id text;
alter table purchases drop constraint if exists purchases_status_check;
alter table purchases
  add constraint purchases_status_check
  check (status in ('pending', 'completed', 'failed', 'refunded', 'disputed'));
create index if not exists purchases_dispute_idx on purchases (dispute_id) where dispute_id is not null;
comment on column purchases.dispute_status is 'open | won | lost once the buyer''s bank disputes the charge; a disputed sale no longer grants playback.';

alter table member_payments
  add column if not exists restored_at timestamptz;
comment on column member_payments.restored_at is 'A disputed payment the studio won: the creators'' reversed credits were given back at this moment.';

-- Migration 112 locked every table; this one creates none, but keep the
-- rule visible: anything new ends with row level security on.
alter table crew_payments enable row level security;
alter table purchases enable row level security;
alter table member_payments enable row level security;
