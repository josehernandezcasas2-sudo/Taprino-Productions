-- Rejection reason, shown to the advertiser on their own dashboard so a
-- rejected ad tells them what to actually fix before resubmitting,
-- instead of just "Rejected" with no explanation.
alter table house_ads add column if not exists rejection_reason text;
comment on column house_ads.rejection_reason is 'Set by admin when review_status is set to rejected. Shown to the advertiser on their dashboard.';

-- Distinguishes an advertiser deliberately pausing their own approved ad
-- from active=false meaning "the system stopped this" (ran out of
-- credits, or hit its own budget_total_cents cap). Without this, buying
-- more credits would resume an ad the advertiser paused on purpose,
-- since add_ad_credits() below otherwise has no way to tell the two
-- apart.
alter table house_ads add column if not exists paused_by_advertiser boolean not null default false;
comment on column house_ads.paused_by_advertiser is 'True only when the advertiser paused this specific ad themselves via the dashboard — never set by increment_house_ad_impression()''s automatic pausing. add_ad_credits() only resumes ads where this is false.';

-- Only change from migration 061's version: the resume condition now
-- also requires paused_by_advertiser = false, so a credits top-up never
-- overrides an advertiser's own deliberate pause.
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
    and paused_by_advertiser = false
    and (budget_total_cents is null or budget_spent_cents < budget_total_cents);
end;
$$;
