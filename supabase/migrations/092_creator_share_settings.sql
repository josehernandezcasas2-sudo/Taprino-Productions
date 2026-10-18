-- 092: Creator Share numbers from the admin page, collect reminders,
-- reversed payout transfers (Jose, 2026-10-18).

-- 1. Numbers edited on /admin/creator-money. A change that pays creators
--    less waits 30 days (Terms section 5); until then it sits here as
--    { numbers, effectiveAt, setBy, setAt, adverse, favourable } and the
--    Terms page shows it. getShareSettings() applies it once the date
--    passes and stamps creator_share_changed_at (the Terms' "updated").
alter table site_settings add column if not exists creator_share_next jsonb;
alter table site_settings add column if not exists creator_share_changed_at timestamptz;
comment on column site_settings.creator_share_next is 'A scheduled change to the Creator Share numbers: { numbers: { shareCents, bonusCents, payoutMinimumCents, referralBonusMonths }, effectiveAt, setBy, setAt, adverse[], favourable[] }. Applied by getShareSettings() once effectiveAt has passed.';

-- 2. Which "time to collect" reminders a creator who left has had
--    ('60', '30', '7' days before collect_until), so the daily cron
--    sends each one once.
alter table creator_standing add column if not exists reminders_sent text[] not null default '{}';

-- 3. A payout transfer reversed in the Stripe dashboard (transfer.reversed):
--    how much came back. The webhook writes an 'adjustment' line for the
--    difference so the credits are owed again.
alter table creator_payouts add column if not exists reversed_cents integer not null default 0 check (reversed_cents >= 0);
alter table creator_payouts add column if not exists reversed_at timestamptz;
