-- A refunded or disputed ad-credit purchase takes its credits back
-- (lib/studioMoney.js reverseAdCreditPurchase, from the Stripe webhook).
-- reversed_cents is how much of each purchase has been taken back so far,
-- so a replayed event can't take it twice; remove_ad_credits is the
-- mirror of add_ad_credits (migration 061) that doesn't switch ads back
-- on, and pauses them when the balance runs out. Safe to run twice.

alter table ad_credit_purchases add column if not exists reversed_cents integer not null default 0;
alter table ad_credit_purchases add column if not exists reversed_at timestamptz;
alter table ad_credit_purchases add column if not exists reverse_reason text;
create index if not exists ad_credit_purchases_pi_idx on ad_credit_purchases (stripe_payment_intent_id);

create or replace function remove_ad_credits(target_account_id uuid, amount_cents integer)
returns void
language plpgsql
as $$
declare
  remaining numeric;
begin
  update ad_accounts
  set credit_balance_cents = credit_balance_cents - amount_cents
  where id = target_account_id
  returning credit_balance_cents into remaining;

  if remaining is not null and remaining <= 0 then
    update house_ads set active = false
    where ad_account_id = target_account_id and active = true;
  end if;
end;
$$;
