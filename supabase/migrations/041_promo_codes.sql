-- Promo/gift codes: admin-generated, single-use codes that grant temporary
-- Studio Tapa + access when redeemed by a signed-in user on /account.
-- Distinct from comped_access (migration 019) — that's a permanent,
-- admin-only allowlist with no user-facing redemption step and no expiry.
-- This is the "give someone a free month" flow instead.
create table if not exists promo_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  duration_days integer not null check (duration_days > 0),
  note text,               -- e.g. "Handed out at the film festival booth"
  created_by text,         -- admin's email, for accountability
  created_at timestamptz not null default now(),
  redeemed_by text,        -- Clerk user_id, null until used
  redeemed_by_email text,  -- for admin visibility without a Clerk lookup
  redeemed_at timestamptz
);

-- Case-insensitive matching — same reasoning as comped_access's email
-- index: a code typed in the wrong case shouldn't fail for no real reason.
create unique index if not exists promo_codes_code_upper_idx on promo_codes (upper(code));
create index if not exists promo_codes_redeemed_by_idx on promo_codes (redeemed_by);

comment on table promo_codes is
  'Single-use codes an admin generates that grant temporary Studio Tapa + access when redeemed. See lib/promoCodes.js.';

-- The user's current promo-access expiration. Checked at login alongside
-- comped_access and Stripe (see lib/accountContext.js). A single indexed
-- column here, keyed by the same user_id as the rest of user_profiles, is
-- a fast primary-key lookup on every page load — recomputing this by
-- aggregating promo_codes on every request would mean an extra
-- aggregation query on every single page view instead of one row read.
alter table user_profiles add column if not exists promo_access_expires_at timestamptz;
comment on column user_profiles.promo_access_expires_at is
  'When this user''s redeemed-code access runs out. Redeeming a second code while one is still active extends from the later of now() or this value, rather than overwriting it.';
