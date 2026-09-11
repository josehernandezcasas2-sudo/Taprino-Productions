-- Advertiser accounts are deliberately NOT part of the Clerk role system
-- (admin/sub_admin/creator) used elsewhere in this app. That system is
-- built specifically so no one can ever self-assign a role from the
-- browser — a real security boundary, not an oversight. An ad account is
-- a much lower-privilege, self-service concept (closer to "has a
-- wishlist" than "can manage content"), so it lives as its own table any
-- signed-in user can create a row in, leaving Clerk's role field
-- reserved for the higher-trust roles it already protects.
create table if not exists ad_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id text not null unique,
  company_name text not null,
  contact_email text not null,
  status text not null default 'active',  -- active | suspended (admin can suspend a bad actor)
  created_at timestamptz not null default now()
);
create index if not exists ad_accounts_user_id_idx on ad_accounts (user_id);
comment on table ad_accounts is 'Self-service advertiser accounts. Not a Clerk role — any signed-in user can create one.';

-- Extending house_ads rather than creating a parallel table: the VAST
-- generation, weighted selection, and impression/click tracking already
-- built for admin's own house ads is exactly the serving mechanism an
-- advertiser-submitted ad needs too. ad_account_id is nullable so every
-- existing row (admin's own promos) is unambiguously distinct from a
-- future advertiser-submitted one without needing a backfill.
alter table house_ads add column if not exists ad_account_id uuid references ad_accounts(id);
create index if not exists house_ads_ad_account_id_idx on house_ads (ad_account_id);

-- Separate from the existing `active` boolean on purpose: `active` is an
-- on/off toggle for something already cleared to run (admin flips this
-- for scheduling, pausing, etc.); `review_status` is whether it's been
-- cleared to run at all. An advertiser-submitted ad can be `active=true,
-- review_status='pending'` right after submission (the advertiser's own
-- default state) and pickActiveHouseAd() must never select it until
-- review_status='approved', regardless of the active flag.
alter table house_ads add column if not exists review_status text not null default 'approved';
comment on column house_ads.review_status is 'pending | approved | rejected. Existing rows (admin''s own house ads) default to approved so nothing already live is affected.';

alter table house_ads add column if not exists submitted_by text;
alter table house_ads add column if not exists reviewed_by text;
alter table house_ads add column if not exists reviewed_at timestamptz;

-- Budget tracking without any real payment connected yet, per this
-- session's scoping: an advertiser sets their own cap when submitting;
-- admin sets the actual rate during review (an advertiser choosing their
-- own rate would be the equivalent of letting them set their own price).
-- Cents throughout to avoid floating-point money bugs.
alter table house_ads add column if not exists budget_total_cents integer;
alter table house_ads add column if not exists budget_spent_cents integer not null default 0;
alter table house_ads add column if not exists cost_per_impression_cents numeric;
comment on column house_ads.budget_total_cents is 'Advertiser-set spending cap in cents. Null for admin''s own house ads, which have no budget concept.';
comment on column house_ads.cost_per_impression_cents is 'Admin-set rate used to increment budget_spent_cents per impression. Null until admin sets it during review.';

-- Loose JSONB rather than dedicated columns per criterion — targeting
-- rules are exactly the kind of thing likely to grow new dimensions
-- (content type, genre, tier, time of day...) before this table's shape
-- would otherwise need touching again for each one.
alter table house_ads add column if not exists targeting jsonb;

create index if not exists house_ads_review_status_idx on house_ads (review_status);

-- Same increment as before, plus budget accounting: when a rate is set,
-- each impression counts against the ad's budget, and an ad that's just
-- exhausted its budget is auto-deactivated so it stops being served
-- without needing a separate scheduled job to notice and flip it off.
create or replace function increment_house_ad_impression(target_id uuid)
returns void
language plpgsql
as $$
declare
  ad house_ads%rowtype;
begin
  update house_ads
  set impressions = impressions + 1,
      budget_spent_cents = budget_spent_cents + coalesce(cost_per_impression_cents, 0)
  where id = target_id
  returning * into ad;

  if ad.budget_total_cents is not null and ad.budget_spent_cents >= ad.budget_total_cents and ad.active then
    update house_ads set active = false where id = target_id;
  end if;
end;
$$;
