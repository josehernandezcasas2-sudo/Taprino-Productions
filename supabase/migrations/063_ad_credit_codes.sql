-- Ad credit codes: admin-generated, single-use codes that grant a fixed
-- dollar amount of ad credits when redeemed by a signed-in advertiser
-- on their Ad Manager dashboard. Same shape as promo_codes (migration
-- 041) for temporary subscription access — this is that same "give
-- someone something for free, no card, no checkout" pattern, just
-- crediting an ad_accounts row instead of extending a user_profiles
-- expiry date.
create table if not exists ad_credit_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  amount_cents integer not null check (amount_cents > 0),
  note text,               -- e.g. "Given to a launch-week sponsor"
  created_by text,         -- admin's email, for accountability
  created_at timestamptz not null default now(),
  redeemed_by_account_id uuid references ad_accounts(id),
  redeemed_by_email text,  -- for admin visibility without a join
  redeemed_at timestamptz,
  noted boolean not null default false
);

-- Same reasoning as promo_codes' index: a code typed in the wrong case
-- shouldn't fail for no real reason.
create unique index if not exists ad_credit_codes_code_upper_idx on ad_credit_codes (upper(code));
create index if not exists ad_credit_codes_redeemed_by_idx on ad_credit_codes (redeemed_by_account_id);

comment on table ad_credit_codes is
  'Single-use codes an admin generates that credit a fixed dollar amount to whichever ad account redeems them. See lib/adCreditCodes.js.';
comment on column ad_credit_codes.noted is
  'Admin-only bookkeeping checkbox, same as promo_codes.noted — has this code been written down / handed out? No effect on redemption.';
