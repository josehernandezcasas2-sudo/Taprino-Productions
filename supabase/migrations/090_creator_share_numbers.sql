-- 090: Creator Share numbers (Jose, 2026-10-18).
-- Member share per renewal: Standard $2.00, Premium $3.50, Sponsor $1.50.
-- Referral bonus per renewal: Standard $1.00, Premium $1.50, Sponsor $0.50,
-- paid for the first 12 months of a referred membership (counted from its
-- first paid invoice), not for as long as it lasts.
-- Payout minimum: $25.

alter table site_settings add column if not exists referral_bonus_months integer not null default 12 check (referral_bonus_months >= 0);
comment on column site_settings.referral_bonus_months is 'How many months from a referred membership''s first paid invoice its renewals earn the referrer a bonus. 0 = no limit.';

alter table site_settings alter column creator_share_cents set default '{"standard": 200, "premium": 350, "sponsor": 150}';
alter table site_settings alter column referral_bonus_cents set default '{"standard": 100, "premium": 150, "sponsor": 50}';
alter table site_settings alter column creator_payout_minimum_cents set default 2500;

update site_settings set
  creator_share_cents = '{"standard": 200, "premium": 350, "sponsor": 150}',
  referral_bonus_cents = '{"standard": 100, "premium": 150, "sponsor": 50}',
  creator_payout_minimum_cents = 2500,
  referral_bonus_months = 12
where id = 1;
