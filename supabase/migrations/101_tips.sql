-- 101: Tips (fan support lane), built 2026-10-24 from the signed-off canvas.
-- The table itself came with migration 088 (creator_tips: amount, cut,
-- creator payout, fee cover, note, show_name, Stripe ids, status). This
-- adds what backing and bookings got in 096 for chargebacks, lets a tip
-- sit in `disputed`, and gives creators an optional fiscal-sponsor link
-- (Jose, 2026-10-24: a tip is not a donation unless the creator points
-- fans at a fiscal sponsor who can take one).

alter table creator_tips drop constraint if exists creator_tips_status_check;
alter table creator_tips add constraint creator_tips_status_check
  check (status in ('pending', 'completed', 'failed', 'refunded', 'disputed'));

alter table creator_tips add column if not exists dispute_id text;
alter table creator_tips add column if not exists dispute_status text check (dispute_status in ('open', 'won', 'lost'));
alter table creator_tips add column if not exists disputed_at timestamptz;
alter table creator_tips add column if not exists dispute_amount_cents integer;
alter table creator_tips add column if not exists dispute_transfer_id text;
alter table creator_tips add column if not exists clawback_cents integer not null default 0;
alter table creator_tips add column if not exists clawback_at timestamptz;
alter table creator_tips add column if not exists returned_cents integer not null default 0;
alter table creator_tips add column if not exists returned_at timestamptz;
alter table creator_tips add column if not exists returned_transfer_id text;
alter table creator_tips add column if not exists dispute_closed_at timestamptz;
-- The creator was emailed about this tip (at most one email per tipper
-- per day; the notification always).
alter table creator_tips add column if not exists emailed_at timestamptz;
create index if not exists creator_tips_intent_idx on creator_tips (stripe_payment_intent_id) where stripe_payment_intent_id is not null;
create index if not exists creator_tips_dispute_idx on creator_tips (dispute_status) where dispute_status is not null;

-- Optional on a creator's profile: "Tax-deductible gifts go through
-- <name>" with a link, shown in the tip sheet and on the profile.
alter table user_profiles add column if not exists fiscal_sponsor_name text;
alter table user_profiles add column if not exists fiscal_sponsor_url text;
comment on column user_profiles.fiscal_sponsor_url is 'Optional link to the creator''s fiscal sponsor; the only way a payment through the site counts as a donation (Terms, Tips).';
