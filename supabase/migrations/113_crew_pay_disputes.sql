-- 113: chargebacks on secured crew pay (2026-10-28).
--
-- A crew payment is a plain charge into the studio's balance (no
-- destination), so a dispute from the poster's bank pulls the money from
-- the studio. lib/paymentDisputes.js now knows the table:
--   held      → 'disputed' while the bank decides (nothing can be released);
--               won → back to 'held'; lost → 'refunded' with the bank's reason.
--   released  → the worker was already paid: the dispute is recorded and
--               the admin emailed; nothing is taken back automatically.
-- Same columns as the other disputed tables (migration 096).

alter table crew_payments
  add column if not exists dispute_id text,
  add column if not exists dispute_status text,
  add column if not exists disputed_at timestamptz,
  add column if not exists dispute_amount_cents integer,
  add column if not exists dispute_closed_at timestamptz;

alter table crew_payments drop constraint if exists crew_payments_status_check;
alter table crew_payments
  add constraint crew_payments_status_check
  check (status in ('pending_payment', 'held', 'disputed', 'released', 'refunded', 'cancelled', 'failed'));

-- A disputed row is still the live one for its response (no second funding).
drop index if exists crew_payments_live_response_idx;
create unique index if not exists crew_payments_live_response_idx
  on crew_payments (response_id)
  where status in ('pending_payment', 'held', 'disputed', 'released');

create index if not exists crew_payments_dispute_idx on crew_payments (dispute_id) where dispute_id is not null;

-- Migration 112 locked every table; this one creates none, but keep the
-- rule visible: anything new ends with row level security on.
alter table crew_payments enable row level security;
