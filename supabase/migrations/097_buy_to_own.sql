-- 097: Buy to own (Jose, 2026-10-19; mockup: the "Buy to own" canvas).
-- A viewer buys a film, an episode or a whole series outright and keeps
-- it: ad-free, playable on the website and in the app, through any
-- creator-side takedown, expiry or the creator leaving. The creator sets
-- the price, an admin approves it; a sale (a percentage off for a while)
-- needs no review. Money is a destination charge to the creator's
-- Express account, like Pitch Room backing: Stripe's card fee comes off
-- first, the studio keeps purchase_platform_cut_percent of the rest.
-- A buyer can refund themselves within purchase_refund_days while they
-- have watched less than purchase_refund_watch_percent of the title;
-- after that refunds are admin-only and final.

alter table site_settings add column if not exists purchase_platform_cut_percent numeric not null default 20 check (purchase_platform_cut_percent >= 0 and purchase_platform_cut_percent <= 100);
alter table site_settings add column if not exists purchase_min_cents integer not null default 99 check (purchase_min_cents >= 50);
alter table site_settings add column if not exists purchase_max_cents integer not null default 2999 check (purchase_max_cents >= purchase_min_cents);
alter table site_settings add column if not exists purchase_refund_days integer not null default 14 check (purchase_refund_days >= 0);
alter table site_settings add column if not exists purchase_refund_watch_percent numeric not null default 10 check (purchase_refund_watch_percent >= 0 and purchase_refund_watch_percent <= 100);

-- 1. One price per title (an episode or a whole series). price_cents is
--    the approved price in force; pending_cents waits for review (a
--    change keeps the old price live until approved). status: off = not
--    for sale, pending = first price awaiting review, on = for sale,
--    rejected = the first price was refused (rejection_note says why).
create table if not exists title_prices (
  id uuid primary key default gen_random_uuid(),
  target_type text not null check (target_type in ('episode', 'series')),
  target_id uuid not null,
  creator_id text not null,
  price_cents integer check (price_cents is null or price_cents >= 50),
  pending_cents integer check (pending_cents is null or pending_cents >= 50),
  status text not null default 'pending' check (status in ('off', 'pending', 'on', 'rejected')),
  requested_at timestamptz,
  reviewed_by text,
  reviewed_at timestamptz,
  rejection_note text,
  sale_percent integer check (sale_percent is null or (sale_percent >= 1 and sale_percent <= 90)),
  sale_ends_at timestamptz,
  sale_members_only boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (target_type, target_id)
);
create index if not exists title_prices_creator_idx on title_prices (creator_id);
create index if not exists title_prices_pending_idx on title_prices (requested_at) where pending_cents is not null;
comment on table title_prices is 'Buy to own: the creator''s price for a film, episode or series. price_cents is live once approved; pending_cents is a price (or change) awaiting admin review; a sale lowers the live price until sale_ends_at without review.';

-- 2. Every purchase, one row each. A series purchase covers every episode
--    of the series, now and later. The split is frozen at purchase time:
--    fee_cents = Stripe's card fee, creator_cents = what the creator
--    received (0 for a studio-owned title), platform_cents = the
--    application fee (the studio's share plus the card fee it pays).
--    watched_max maps episode id -> furthest second reached, for the
--    refund rule.
create table if not exists purchases (
  id uuid primary key default gen_random_uuid(),
  buyer_id text not null,
  buyer_email text,
  target_type text not null check (target_type in ('episode', 'series')),
  target_id uuid not null,
  creator_id text not null,
  title text,
  price_cents integer not null check (price_cents >= 0),
  paid_cents integer not null check (paid_cents >= 0),
  sale_percent integer,
  credit_cents integer not null default 0 check (credit_cents >= 0),
  fee_cents integer not null default 0 check (fee_cents >= 0),
  creator_cents integer not null default 0 check (creator_cents >= 0),
  platform_cents integer not null default 0 check (platform_cents >= 0),
  house boolean not null default false,
  stripe_checkout_session_id text,
  stripe_payment_intent_id text,
  stripe_charge_id text,
  status text not null default 'pending' check (status in ('pending', 'completed', 'failed', 'refunded')),
  completed_at timestamptz,
  failed_reason text,
  refunded_at timestamptz,
  refunded_by text,
  refund_reason text,
  refund_kind text check (refund_kind is null or refund_kind in ('self', 'admin', 'takedown', 'stripe')),
  watched_max jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (creator_cents + platform_cents = paid_cents)
);
create unique index if not exists purchases_session_idx on purchases (stripe_checkout_session_id) where stripe_checkout_session_id is not null;
create index if not exists purchases_buyer_idx on purchases (buyer_id, status);
create index if not exists purchases_target_idx on purchases (target_type, target_id, status);
create index if not exists purchases_creator_idx on purchases (creator_id, status, completed_at);
comment on table purchases is 'Buy to own. Only completed rows grant access; a refund (self within the window, admin, takedown) takes it away. The split is frozen when the Checkout session is made.';

-- 3. A title with buyers can't be deleted: confirming its deletion
--    request withdraws it instead (hidden from the catalogue, video kept,
--    still playable for owners). withdrawn_at marks that; the deletion
--    request flag stays set so it stays hidden.
alter table episodes add column if not exists withdrawn_at timestamptz;
alter table series add column if not exists withdrawn_at timestamptz;
comment on column episodes.withdrawn_at is 'Set instead of deleting when the title has buyers (Buy to own): off the catalogue, video kept, playable for owners.';
