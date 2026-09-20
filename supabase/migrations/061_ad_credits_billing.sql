-- Adjustable, site-wide ad billing rate. Stored as CPM in cents (600 =
-- $6.00 per 1,000 impressions) rather than a raw per-impression cents
-- value, since a whole-dollar CPM is what admin actually thinks in and
-- edits, and a true per-impression rate would be an awkward fraction of
-- a cent. The admin review modal converts this to a per-impression
-- dollar figure only when pre-filling the rate field for a new ad — an
-- ad that's already been reviewed keeps whatever rate it was actually
-- approved at, never silently re-priced by a later change here.
alter table site_settings add column if not exists ad_cpm_cents integer not null default 600;
comment on column site_settings.ad_cpm_cents is 'Default ad billing rate in cents per 1,000 impressions (CPM). Only affects the default admin sees when reviewing a new ad — an already-approved ad keeps its own locked-in cost_per_impression_cents regardless of later changes here.';

-- Real precision bug from migration 056, worth fixing now rather than
-- leaving it: cost_per_impression_cents is numeric (a $6 CPM works out
-- to 0.6 cents per impression, a genuine fraction), but
-- budget_spent_cents was declared integer. Every single impression
-- would round that fractional add to a whole cent before storing it,
-- so an ad's actual tracked spend would drift away from
-- impressions x rate the longer it ran. Widening this to numeric here
-- fixes it going forward without needing a data backfill — existing
-- integer values convert losslessly.
alter table house_ads alter column budget_spent_cents type numeric;

-- The shared credit pool an advertiser buys into once and draws from
-- across every approved ad on their account — see the rewritten
-- increment_house_ad_impression() below for how spending actually comes
-- out of this rather than a separate prepaid cap per ad. Numeric for
-- the same fractional-cents reason as budget_spent_cents above.
alter table ad_accounts add column if not exists credit_balance_cents numeric not null default 0;
comment on column ad_accounts.credit_balance_cents is 'Shared prepaid balance across every approved ad on this account. Topped up via Stripe checkout (add_ad_credits below); drawn down by increment_house_ad_impression() as impressions serve.';

-- Same impression/click counting as before, now with real billing
-- wired to the ACCOUNT's shared credit balance rather than a per-ad
-- prepaid cap. house_ads.budget_total_cents survives as an *optional*
-- per-ad ceiling an advertiser can still set at submission — a cap
-- that ad specifically stops at even if the account still has credits
-- available. Leaving it null just means that ad draws freely from the
-- shared pool until the pool itself runs out.
--
-- Admin's own house ads (ad_account_id is null) are completely
-- unaffected by any of this — the credit-balance branch below only
-- runs for a row that actually has an ad_account_id, so a house ad
-- with no advertiser behind it behaves exactly as it always has.
create or replace function increment_house_ad_impression(target_id uuid)
returns void
language plpgsql
as $$
declare
  ad house_ads%rowtype;
  rate_cents numeric;
  remaining_balance numeric;
begin
  update house_ads
  set impressions = impressions + 1,
      budget_spent_cents = budget_spent_cents + coalesce(cost_per_impression_cents, 0)
  where id = target_id
  returning * into ad;

  -- This ad's own optional cap, if it set one — stops just this ad,
  -- regardless of how much the account's shared balance still has.
  if ad.budget_total_cents is not null and ad.budget_spent_cents >= ad.budget_total_cents and ad.active then
    update house_ads set active = false where id = target_id;
  end if;

  -- Advertiser-submitted ad: draw the same per-impression cost out of
  -- the account's shared credit balance, and if that balance has now
  -- run out, pause every other still-active approved ad on the same
  -- account too — not just this one. A depleted shared pool means
  -- none of that advertiser's ads should keep serving, regardless of
  -- which one happened to be running when it hit zero.
  if ad.ad_account_id is not null then
    rate_cents := coalesce(ad.cost_per_impression_cents, 0);

    update ad_accounts
    set credit_balance_cents = credit_balance_cents - rate_cents
    where id = ad.ad_account_id
    returning credit_balance_cents into remaining_balance;

    if remaining_balance <= 0 then
      update house_ads
      set active = false
      where ad_account_id = ad.ad_account_id
        and review_status = 'approved'
        and active = true;
    end if;
  end if;
end;
$$;

-- Tops up an account's shared credit balance (called from the Stripe
-- webhook once a credits purchase actually completes — see
-- pages/api/webhook.js) and resumes any ad that had paused purely
-- because the balance ran dry. Deliberately does NOT resume an ad that
-- stopped because it hit its own budget_total_cents cap — that's the
-- advertiser's own intentional limit for that specific ad, not
-- something a general top-up should override. amount_cents is integer
-- since it always comes straight from a Stripe payment amount (Stripe
-- charges in whole cents), added into the numeric balance column
-- without any precision loss.
create or replace function add_ad_credits(target_account_id uuid, amount_cents integer)
returns void
language plpgsql
as $$
begin
  update ad_accounts
  set credit_balance_cents = credit_balance_cents + amount_cents
  where id = target_account_id;

  update house_ads
  set active = true
  where ad_account_id = target_account_id
    and review_status = 'approved'
    and active = false
    and (budget_total_cents is null or budget_spent_cents < budget_total_cents);
end;
$$;
