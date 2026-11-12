-- 122 — Notes wait for review, season art, who was the studio, sales tax on
-- memberships / backings / bookings, and web push (written 2026-11-12).
--
-- Jose, 2026-11-12:
--   * "make sure descriptions and notes wait for review" — on a live title a
--     new description already has somewhere to wait (pending_description,
--     migration 030); the page notes (migration 118) did not, so they went up
--     at once. pending_page_notes is that place: null = nothing waiting, an
--     empty string = "clear the notes" waiting.
--   * "when a new season comes out, the newest season image/art come out as
--     the hero image. have that as toggle" — series.season_art holds the live
--     art per season ([{ "number": 2, "image": "https://…" }]),
--     series.pending_season_art what waits for approval on a live show
--     ([{ "number": 2, "image": "https://…" }] or "image": null for a
--     removal), and series.newest_season_hero the switch (on: the hero shows
--     the newest released season's art when it has some).
--   * "lets fix the money edge cases" — creator_ledger.studio records, when a
--     line is written, whether the account it credits was the studio's own
--     (a full admin) at that moment; null = written before 122, read as the
--     account's role now (what the code did until 122).
--   * "lets add taxes on memberships, backing and bookings" — the tax Stripe
--     added on top of each payment (tax_cents), and for a backing or a booking
--     how the money was split: 'fee' (an application fee, as before 122) or
--     'transfer' (a fixed amount transferred to the creator or host, so the
--     tax stays with the studio, which owes it, as title sales already do).
--     site_settings holds the three switches and the booking's tax code.
--   * "lets also add the web push notifications" — web_push_subscriptions
--     keeps one row per browser that said yes.
--
-- Columns and one table; no row changes. Safe to run more than once. Before
-- it has run the site keeps working as it does today (notes go up at once,
-- no season art, no tax, no web push) and the pages that need it say
-- "needs a database update (migration 122)".

begin;

-- 1. Page notes wait for review on a live title.
alter table public.episodes add column if not exists pending_page_notes text;
comment on column public.episodes.pending_page_notes is 'New page notes waiting for approval on a live title (an empty string = clearing the notes waits); page_notes stays live until then. Migration 122.';

-- 2. Season art and the newest-season hero.
alter table public.series add column if not exists season_art jsonb not null default '[]'::jsonb;
alter table public.series add column if not exists pending_season_art jsonb;
alter table public.series add column if not exists newest_season_hero boolean not null default true;
comment on column public.series.season_art is 'Live art per season: [{ "number": 1, "image": "https://…" }]. Migration 122.';
comment on column public.series.pending_season_art is 'Season art waiting for approval on a live show: [{ "number": 2, "image": "https://…" | null }] (null = removing it). Null when nothing waits. Migration 122.';
comment on column public.series.newest_season_hero is 'On: the show''s hero uses the newest released season''s art when that season has some. Migration 122.';

-- 3. Who was the studio when a ledger line was written.
alter table public.creator_ledger add column if not exists studio boolean;
comment on column public.creator_ledger.studio is 'True when the account this line credits was the studio''s own (a full admin) when the line was written; false when it wasn''t; null = written before migration 122 (read as the account''s role now). Migration 122.';

-- 4. Sales tax on memberships, backings and bookings.
alter table public.member_payments add column if not exists tax_cents integer not null default 0;
alter table public.pitch_donations add column if not exists tax_cents integer not null default 0;
alter table public.pitch_donations add column if not exists split text not null default 'fee';
alter table public.location_requests add column if not exists tax_cents integer not null default 0;
alter table public.location_requests add column if not exists split text not null default 'fee';

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.member_payments'::regclass and conname = 'member_payments_tax_cents_check') then
    alter table public.member_payments add constraint member_payments_tax_cents_check check (tax_cents >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.pitch_donations'::regclass and conname = 'pitch_donations_tax_cents_check') then
    alter table public.pitch_donations add constraint pitch_donations_tax_cents_check check (tax_cents >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.pitch_donations'::regclass and conname = 'pitch_donations_split_check') then
    alter table public.pitch_donations add constraint pitch_donations_split_check check (split in ('fee', 'transfer'));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.location_requests'::regclass and conname = 'location_requests_tax_cents_check') then
    alter table public.location_requests add constraint location_requests_tax_cents_check check (tax_cents >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.location_requests'::regclass and conname = 'location_requests_split_check') then
    alter table public.location_requests add constraint location_requests_split_check check (split in ('fee', 'transfer'));
  end if;
end $$;

comment on column public.member_payments.tax_cents is 'Sales tax Stripe added on top of this invoice (Stripe Tax). Never part of the creators'' share. Migration 122.';
comment on column public.pitch_donations.tax_cents is 'Sales tax Stripe added on top of this backing (usually 0: a backing is a cash donation). Migration 122.';
comment on column public.pitch_donations.split is 'fee = the studio''s cut was an application fee (before 122, or tax off); transfer = the creator''s share was a fixed transfer, so any tax stays with the studio. Migration 122.';
comment on column public.location_requests.tax_cents is 'Sales tax Stripe added on top of this booking. Migration 122.';
comment on column public.location_requests.split is 'fee = the studio''s cut was an application fee (before 122, or tax off); transfer = the host''s share was a fixed transfer, so any tax stays with the studio. Migration 122.';

alter table public.site_settings add column if not exists tax_memberships boolean not null default true;
alter table public.site_settings add column if not exists tax_backings boolean not null default true;
alter table public.site_settings add column if not exists tax_bookings boolean not null default false;
alter table public.site_settings add column if not exists tax_booking_code text;

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.site_settings'::regclass and conname = 'site_settings_tax_booking_code_check') then
    alter table public.site_settings add constraint site_settings_tax_booking_code_check
      check (tax_booking_code is null or tax_booking_code ~ '^txcd_[0-9]{8}$');
  end if;
end $$;

comment on column public.site_settings.tax_memberships is 'Stripe Tax on membership Checkouts (tax on top where the studio is registered). Migration 122.';
comment on column public.site_settings.tax_backings is 'Stripe Tax on backings, coded as a cash donation (txcd_90000001). Migration 122.';
comment on column public.site_settings.tax_bookings is 'Stripe Tax on location bookings; needs tax_booking_code. Migration 122.';
comment on column public.site_settings.tax_booking_code is 'The Stripe product tax code for a location booking (txcd_ + 8 digits), chosen by the studio. Migration 122.';

-- 5. Web push: one row per browser that said yes.
create table if not exists public.web_push_subscriptions (
  endpoint text primary key,
  user_id text not null,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  disabled_at timestamptz,
  disabled_reason text
);
create index if not exists web_push_subscriptions_user_idx on public.web_push_subscriptions (user_id) where disabled_at is null;
comment on table public.web_push_subscriptions is 'Browsers that accepted web push, one row per push endpoint. A gone endpoint (404/410) is disabled, never deleted. Migration 122.';

-- Migration 112's rule: every new table is locked to the site's own server key.
alter table public.web_push_subscriptions enable row level security;
revoke all on table public.web_push_subscriptions from anon, authenticated;

-- PostgREST picks the new columns and the table up at once.
notify pgrst, 'reload schema';

commit;

-- What is there now (one row).
select
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'episodes' and column_name = 'pending_page_notes') as notes_column_expect_1,
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'series'
     and column_name in ('season_art', 'pending_season_art', 'newest_season_hero')) as season_columns_expect_3,
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'creator_ledger' and column_name = 'studio') as ledger_column_expect_1,
  (select count(*) from information_schema.columns where table_schema = 'public'
     and ((table_name = 'member_payments' and column_name = 'tax_cents')
       or (table_name = 'pitch_donations' and column_name in ('tax_cents', 'split'))
       or (table_name = 'location_requests' and column_name in ('tax_cents', 'split'))
       or (table_name = 'site_settings' and column_name in ('tax_memberships', 'tax_backings', 'tax_bookings', 'tax_booking_code')))) as tax_columns_expect_9,
  (select relrowsecurity from pg_class where oid = 'public.web_push_subscriptions'::regclass) as push_table_row_level_security_expect_true,
  (select count(*) from public.web_push_subscriptions) as browsers_signed_up;
