-- 096: chargebacks on Pitch backings and location bookings (Jose,
-- 2026-10-18, fix list #8 / j06). A disputed backing stops counting
-- toward the pitch and the creator's share is taken back while the bank
-- decides (paid back if we win); a disputed booking waits for an admin to
-- choose "take it back from the host" or "the studio absorbs it". The
-- money side lives in lib/paymentDisputes.js. Safe to run twice.

-- Backings: a new status, so every "completed only" total drops it.
-- Whatever Postgres named the old inline check, drop it by what it says.
do $$
declare c record;
begin
  for c in select conname from pg_constraint
    where conrelid = 'pitch_donations'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%status%' and pg_get_constraintdef(oid) ilike '%failed%'
  loop
    execute format('alter table pitch_donations drop constraint %I', c.conname);
  end loop;
end $$;
alter table pitch_donations add constraint pitch_donations_status_check
  check (status in ('pending', 'completed', 'refunded', 'failed', 'disputed'));

alter table pitch_donations add column if not exists dispute_id text;
alter table pitch_donations add column if not exists dispute_status text check (dispute_status in ('open', 'won', 'lost'));
alter table pitch_donations add column if not exists disputed_at timestamptz;
alter table pitch_donations add column if not exists dispute_amount_cents integer;
alter table pitch_donations add column if not exists dispute_closed_at timestamptz;
-- The creator's transfer for this charge, what was reversed out of it,
-- and what was paid back after a win.
alter table pitch_donations add column if not exists dispute_transfer_id text;
alter table pitch_donations add column if not exists clawback_cents integer not null default 0;
alter table pitch_donations add column if not exists clawback_at timestamptz;
alter table pitch_donations add column if not exists returned_cents integer not null default 0;
alter table pitch_donations add column if not exists returned_at timestamptz;
alter table pitch_donations add column if not exists returned_transfer_id text;

-- Bookings keep their status (the shoot may well have happened); the
-- dispute sits beside it, with the admin's decision.
alter table location_requests add column if not exists dispute_id text;
alter table location_requests add column if not exists dispute_status text check (dispute_status in ('open', 'won', 'lost'));
alter table location_requests add column if not exists disputed_at timestamptz;
alter table location_requests add column if not exists dispute_amount_cents integer;
alter table location_requests add column if not exists dispute_closed_at timestamptz;
alter table location_requests add column if not exists dispute_decision text check (dispute_decision in ('clawback', 'absorb'));
alter table location_requests add column if not exists dispute_decided_by text;
alter table location_requests add column if not exists dispute_decided_at timestamptz;
alter table location_requests add column if not exists dispute_transfer_id text;
alter table location_requests add column if not exists clawback_cents integer not null default 0;
alter table location_requests add column if not exists clawback_at timestamptz;
alter table location_requests add column if not exists returned_cents integer not null default 0;
alter table location_requests add column if not exists returned_at timestamptz;
alter table location_requests add column if not exists returned_transfer_id text;

create index if not exists pitch_donations_dispute_idx on pitch_donations (dispute_status) where dispute_status is not null;
create index if not exists location_requests_dispute_idx on location_requests (dispute_status) where dispute_status is not null;

comment on column pitch_donations.status is 'pending = Checkout open; completed = paid (the only status that counts toward totals); failed = session expired or payment failed; refunded = admin refund, reverses the transfer and the platform fee; disputed = the backer''s bank opened a chargeback (back to completed if we win).';
