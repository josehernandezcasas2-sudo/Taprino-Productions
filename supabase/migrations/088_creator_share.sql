-- Creator Share (mockups/creator-share-v1.html, creator-share-v2.html and
-- the playable creator-share-play.html, 2026-10-17): a slice of every paid
-- membership that the member points at up to 10 creators ("their lineup"),
-- with a default rule that spends it for them until they pick (what they
-- watched in the last 30 days, else the site-wide pool by views); a
-- referral bonus for the creator whose link or code brought a member, paid
-- on every renewal of that subscription; and tips from fans to one creator.
--
-- Three money lanes, kept apart on purpose:
--   * earnings — member share + referral bonus (+ an ad share later).
--     Membership money sits in the LLC's own Stripe balance; each paid
--     invoice becomes one ledger line per creator; on the 1st one Connect
--     transfer per creator settles the lines (creator_payouts).
--   * tips — destination charges straight into the creator's Express
--     account at the moment of the tip (the shape Pitch Room uses).
--   * backing — Pitch Room, already built (pitch_donations).
-- Only earnings lines move money by transfer. Tips and backing lines are
-- mirrors so the creator's Money page can show every lane in one place.
--
-- Amounts and rules are site_settings with the proposed defaults ($2 / $4 /
-- $2 share, $1 / $2 / $1 bonus, 5% tip cut, $10 payout minimum, 30-day
-- last-click referral window, 90-day resubscribe grace, credit unclaimed
-- for 12 months returns to the pool); Jose decides the real numbers.
-- Tables only: nothing reads or writes them yet. Run after 087.

-- 1. Stripe customer → member. The Clerk user carries stripeCustomerId
--    (lib/clerkStripeLink.js) but nothing maps a customer back to a user,
--    and an invoice.paid webhook arrives with only the customer id.
create table if not exists member_customers (
  stripe_customer_id text primary key,
  user_id text not null,
  mode text not null default 'live' check (mode in ('live', 'test')),
  created_at timestamptz not null default now()
);
create index if not exists member_customers_user_idx on member_customers (user_id);
comment on table member_customers is 'Reverse lookup for Stripe webhooks: which member a Stripe customer belongs to. Written when the customer is linked.';

-- 2. The lineup: who a member's share goes to. At most 10 rows per member
--    (trigger below), never yourself. weight only matters when the member
--    turned on "set my own shares" (user_profiles.lineup_mode = custom);
--    with equal shares every row counts as 1.
create table if not exists member_lineups (
  user_id text not null,
  creator_id text not null,
  weight integer not null default 1 check (weight between 1 and 5),
  position integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (user_id, creator_id),
  check (user_id <> creator_id)
);
create index if not exists member_lineups_creator_idx on member_lineups (creator_id);
comment on table member_lineups is 'Creator Share: the up-to-10 creators a member points their membership share at. Snapshot at each renewal; editing never moves money already split.';

create or replace function member_lineups_cap() returns trigger language plpgsql as $$
begin
  if (select count(*) from member_lineups where user_id = new.user_id) >= 10 then
    raise exception 'A lineup holds at most 10 creators' using errcode = 'check_violation';
  end if;
  return new;
end
$$;
drop trigger if exists member_lineups_cap_trg on member_lineups;
create trigger member_lineups_cap_trg before insert on member_lineups
  for each row execute function member_lineups_cap();

-- 3. Referral attribution: one row per subscription, locked on its first
--    paid invoice (never on a $0 or trial invoice). ended_at is set when the
--    subscription is cancelled (a resubscribe within referral_grace_days
--    reopens it); voided_at is an admin decision (fraud, creator removed).
create table if not exists member_referrals (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  creator_id text not null,
  stripe_subscription_id text not null unique,
  source text not null default 'link' check (source in ('link', 'code')),
  code text,
  locked_at timestamptz not null default now(),
  ended_at timestamptz,
  voided_at timestamptz,
  voided_by text,
  void_reason text,
  created_at timestamptz not null default now(),
  check (user_id <> creator_id)
);
create index if not exists member_referrals_creator_idx on member_referrals (creator_id, ended_at);
create index if not exists member_referrals_user_idx on member_referrals (user_id);
comment on table member_referrals is 'Which creator''s link or code brought a member. Pays referral_bonus_cents on every paid invoice of that subscription while ended_at and voided_at are null.';

-- 4. Creator codes (optional — only if fans get a welcome discount): one
--    Stripe promotion code per creator on the site-wide welcome coupon.
--    A code on an invoice attributes the member even when the link cookie
--    is gone. Separate from promo_codes (comped access, migration 041).
create table if not exists creator_codes (
  creator_id text primary key,
  code text not null unique,
  stripe_promotion_code_id text unique,
  active boolean not null default true,
  uses integer not null default 0,
  created_at timestamptz not null default now()
);

-- 5. One row per paid membership invoice: what the member paid, the share
--    and bonus locked in from site_settings at that moment, and how the
--    share was split (basis). Unique on the invoice id so a replayed
--    invoice.paid never splits twice (stripe_events guards the event id;
--    this guards the invoice itself).
create table if not exists member_payments (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  stripe_invoice_id text not null unique,
  stripe_subscription_id text,
  stripe_customer_id text,
  stripe_charge_id text,
  tier text not null check (tier in ('standard', 'premium', 'sponsor')),
  amount_cents integer not null check (amount_cents >= 0),
  share_cents integer not null default 0 check (share_cents >= 0),
  bonus_cents integer not null default 0 check (bonus_cents >= 0),
  -- picks = the lineup; watched = the 30-day watch history; pool = site-wide
  -- by views; none = nothing to split (share 0, or no eligible creator).
  basis text not null default 'none' check (basis in ('picks', 'watched', 'pool', 'none')),
  period_start timestamptz,
  period_end timestamptz,
  paid_at timestamptz not null default now(),
  -- reversed = refunded or disputed; its ledger lines get a reversal if
  -- they were still unpaid, otherwise the studio absorbs it.
  status text not null default 'split' check (status in ('split', 'reversed')),
  reversed_at timestamptz,
  reverse_reason text,
  created_at timestamptz not null default now()
);
create index if not exists member_payments_user_idx on member_payments (user_id, paid_at desc);
create index if not exists member_payments_charge_idx on member_payments (stripe_charge_id) where stripe_charge_id is not null;
create index if not exists member_payments_sub_idx on member_payments (stripe_subscription_id);
comment on table member_payments is 'Creator Share: every paid membership invoice and how its share was split. The member''s history line comes from here.';

-- 6. Tips: fan → one creator, passed through. Same arithmetic as donations:
--    amount_cents = platform_cut_cents + creator_payout_cents, the card fee
--    the fan covers sits beside it (fee_cover_cents), total_charged_cents
--    is what their card saw. Minimum $1; the maximum is a site setting.
create table if not exists creator_tips (
  id uuid primary key default gen_random_uuid(),
  creator_id text not null,
  tipper_id text not null,
  tipper_email text,
  amount_cents integer not null check (amount_cents >= 100),
  platform_cut_percent numeric not null,
  platform_cut_cents integer not null,
  creator_payout_cents integer not null,
  fee_cover_cents integer not null default 0,
  total_charged_cents integer,
  note text,
  note_hidden boolean not null default false,
  show_name boolean not null default false,
  stripe_checkout_session_id text,
  stripe_payment_intent_id text,
  stripe_charge_id text,
  status text not null default 'pending' check (status in ('pending', 'completed', 'failed', 'refunded')),
  completed_at timestamptz,
  refunded_at timestamptz,
  refunded_by text,
  refund_reason text,
  failed_reason text,
  created_at timestamptz not null default now(),
  check (creator_id <> tipper_id),
  check (platform_cut_cents + creator_payout_cents = amount_cents)
);
create unique index if not exists creator_tips_session_idx on creator_tips (stripe_checkout_session_id) where stripe_checkout_session_id is not null;
create index if not exists creator_tips_creator_idx on creator_tips (creator_id, status, created_at desc);
create index if not exists creator_tips_tipper_idx on creator_tips (tipper_id, created_at desc);
comment on table creator_tips is 'Fan support lane: one-time tips as destination charges to the creator''s Express account. Only completed counts; refunds are admin-only and final.';

-- 7. Payouts: one Connect transfer per creator per batch (the 1st), for
--    the earnings lines it covered (creator_ledger.payout_id). status
--    pending while the transfer is being created; failed keeps the lines
--    unpaid for the next run.
create table if not exists creator_payouts (
  id uuid primary key default gen_random_uuid(),
  creator_id text not null,
  period text not null,
  cents integer not null check (cents > 0),
  stripe_transfer_id text unique,
  status text not null default 'pending' check (status in ('pending', 'paid', 'failed')),
  failed_reason text,
  created_by text,
  created_at timestamptz not null default now(),
  paid_at timestamptz
);
create index if not exists creator_payouts_creator_idx on creator_payouts (creator_id, created_at desc);
create index if not exists creator_payouts_period_idx on creator_payouts (period, status);
comment on column creator_payouts.period is 'The month the batch settled, YYYY-MM. Also the Stripe transfer_group.';

-- 8. The ledger: every credit and debit per creator, one lane each.
--    cents is signed: credits positive, reversals and payouts negative.
--    moves_money is true only on the earnings lane (settled by transfer);
--    tips and backing lines are mirrors of creator_tips / pitch_donations
--    rows that already paid the creator at charge time.
create table if not exists creator_ledger (
  id uuid primary key default gen_random_uuid(),
  creator_id text not null,
  lane text not null check (lane in ('earnings', 'tips', 'backing')),
  kind text not null check (kind in ('member_share', 'referral', 'ad_share', 'adjustment', 'reversal', 'payout', 'tip', 'backing')),
  cents integer not null,
  moves_money boolean not null default true,
  member_id text,
  payment_id uuid references member_payments(id) on delete set null,
  referral_id uuid references member_referrals(id) on delete set null,
  tip_id uuid references creator_tips(id) on delete set null,
  donation_id uuid references pitch_donations(id) on delete set null,
  payout_id uuid references creator_payouts(id) on delete set null,
  reverses_id uuid references creator_ledger(id) on delete set null,
  basis text check (basis in ('picks', 'watched', 'pool')),
  note text,
  created_by text,
  created_at timestamptz not null default now(),
  check ((lane = 'earnings') = moves_money)
);
create index if not exists creator_ledger_creator_idx on creator_ledger (creator_id, created_at desc);
create index if not exists creator_ledger_payment_idx on creator_ledger (payment_id) where payment_id is not null;
create index if not exists creator_ledger_unpaid_idx on creator_ledger (creator_id) where lane = 'earnings' and payout_id is null;
comment on table creator_ledger is 'Creator Share ledger. A line belongs to exactly one lane; only earnings lines (moves_money) are settled by Connect transfers. Sum of unpaid earnings lines per creator = what the next batch owes them.';

-- 9. Site-wide amounts and rules (proposed defaults; edited on /admin).
alter table site_settings add column if not exists creator_share_cents jsonb not null default '{"standard": 200, "premium": 400, "sponsor": 200}';
alter table site_settings add column if not exists referral_bonus_cents jsonb not null default '{"standard": 100, "premium": 200, "sponsor": 100}';
alter table site_settings add column if not exists tip_platform_cut_percent numeric not null default 5;
alter table site_settings add column if not exists tip_max_cents integer not null default 50000;
alter table site_settings add column if not exists creator_payout_minimum_cents integer not null default 1000;
alter table site_settings add column if not exists referral_window_days integer not null default 30;
alter table site_settings add column if not exists referral_grace_days integer not null default 90;
alter table site_settings add column if not exists share_unclaimed_months integer not null default 12;
alter table site_settings add column if not exists creator_welcome_coupon_id text;
comment on column site_settings.creator_share_cents is 'Per paid tier, the flat amount of each renewal set aside for the member''s creators. Locked into member_payments.share_cents per payment.';
comment on column site_settings.referral_bonus_cents is 'Per paid tier, the flat amount paid on each renewal to the creator whose link or code brought the member. Locked into member_payments.bonus_cents.';
comment on column site_settings.creator_payout_minimum_cents is 'Unpaid earnings a creator needs before the monthly batch transfers them; under it carries over.';
comment on column site_settings.creator_welcome_coupon_id is 'Stripe coupon the per-creator promotion codes hang off. Null = no welcome discount, creator codes off.';

-- 10. Member preferences and the home-base shop link.
alter table user_profiles add column if not exists lineup_mode text not null default 'equal' check (lineup_mode in ('equal', 'custom'));
alter table user_profiles add column if not exists share_visible boolean not null default false;
alter table user_profiles add column if not exists shop_url text;
comment on column user_profiles.lineup_mode is 'equal = every lineup row gets the same share; custom = member_lineups.weight decides.';
comment on column user_profiles.share_visible is 'Let the creators in my lineup (and the ones I tip) see my name. Off = counted, anonymous.';
comment on column user_profiles.shop_url is 'Creator''s shop link for the Shop plate on their profile (a studiotapa.com collection until the Shopify integration exists).';

-- 11. A tip's note can be reported and flagged like everything else.
alter table content_reports drop constraint if exists content_reports_target_type_check;
alter table content_reports add constraint content_reports_target_type_check check (target_type in ('episode', 'series', 'channel_media', 'profile', 'call', 'location', 'tip'));
alter table content_flags drop constraint if exists content_flags_target_type_check;
alter table content_flags add constraint content_flags_target_type_check check (target_type in ('episode', 'series', 'channel_media', 'profile', 'call', 'location', 'tip'));
