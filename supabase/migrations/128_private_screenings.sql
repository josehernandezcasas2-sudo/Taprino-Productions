-- 128 — private screening links (written 2026-11-21).
--
-- Jose, 2026-11-21: creators of a film or a show make as many private links
-- as they want, "like a private screening link", each with its own
-- dashboard (how many opened it, who: a signed-in account or a guest), a
-- password, a start and an end ("so it doesn't get copied, re-screened, or
-- somebody does it over and over again"), limited to a country if they
-- choose; once a link stops working it is discarded or run again. Signed
-- off on the canvas https://claude.ai/artifact/BJ7dCjjTiHJiHayKFDSbVD.
--
-- They grow out of migration 109's production screeners, so it is one kind
-- of link, not two:
--
--   * screeners: a link now belongs to a title or a show
--       target_type / target_id (an episode or a show; every 109 row is its
--       own episode), scope (title | show | season | episodes), season,
--       episode_ids (a season's or a hand-picked list, kept as picked; null
--       for a title or a whole show), owner_id (who made it; every 109 row
--       is its production's owner), starts_at (109 rows: when they were
--       made), production_id and episode_id no longer required.
--       revoked_at stays "ended by its owner"; expires_at stays the end.
--
--   * screeners: the password and the rules for opening it
--       password_hash (scrypt, checked) and password_enc (the owner can read
--       it back on the link's page), password_set_at (anyone watching from
--       before a change is asked for the new one); access (anyone |
--       signed_in | named) with named_user_ids / named_emails; per_person_max,
--       one_screen, countries (ISO codes; empty = anywhere), notify (every |
--       first | daily | never); ended_notified_at, summary_sent_on,
--       guess_alerted_at for the daily step; run_from (the link it was run
--       again from); updated_at.
--       Every 109 row keeps working exactly as before until its date: no
--       password, anyone with the link, no per-person limit, any number of
--       screens, anywhere, told on every open.
--
--   * screener_views: who opened it
--       user_id (signed in) or device_key (a hashed cookie, for guests),
--       session_key (hashed; one open covers a visit), city / region /
--       country (from the connection, never the address), device ("iPhone ·
--       Safari"), what plays (episode_id, position), how much was watched
--       (watched: { episode: [seconds, duration] }, watched_seconds), and
--       last_beat_at / last_play_at for one screen at a time.
--
--   * screener_refusals (new): the tries a link turned away (a wrong
--       password, a country, a second screen, opens used up, not one of
--       the named people), for the link's dashboard and the lock after
--       five wrong passwords from one place in an hour. Row level security
--       on (migration 112's rule).
--
-- Safe to run again.
begin;

-- ---- screeners ---------------------------------------------------------------
alter table public.screeners alter column production_id drop not null;
alter table public.screeners alter column episode_id drop not null;

alter table public.screeners add column if not exists owner_id text;
alter table public.screeners add column if not exists target_type text not null default 'episode';
alter table public.screeners add column if not exists target_id text;
alter table public.screeners add column if not exists scope text not null default 'title';
alter table public.screeners add column if not exists season integer;
alter table public.screeners add column if not exists episode_ids text[];
alter table public.screeners add column if not exists starts_at timestamptz;
alter table public.screeners add column if not exists password_hash text;
alter table public.screeners add column if not exists password_enc text;
alter table public.screeners add column if not exists password_set_at timestamptz;
alter table public.screeners add column if not exists access text not null default 'anyone';
alter table public.screeners add column if not exists named_user_ids text[] not null default '{}';
alter table public.screeners add column if not exists named_emails text[] not null default '{}';
alter table public.screeners add column if not exists per_person_max integer;
alter table public.screeners add column if not exists one_screen boolean not null default false;
alter table public.screeners add column if not exists countries text[] not null default '{}';
alter table public.screeners add column if not exists notify text not null default 'every';
alter table public.screeners add column if not exists ended_notified_at timestamptz;
alter table public.screeners add column if not exists summary_sent_on date;
alter table public.screeners add column if not exists guess_alerted_at timestamptz;
alter table public.screeners add column if not exists run_from uuid;
alter table public.screeners add column if not exists updated_at timestamptz not null default now();

-- 109's rows: their own episode, their production's owner, open since they were made.
update public.screeners s set owner_id = p.owner_id from public.productions p where s.owner_id is null and p.id = s.production_id;
update public.screeners set target_id = episode_id where target_id is null and episode_id is not null;
update public.screeners set starts_at = created_at where starts_at is null;

alter table public.screeners alter column starts_at set default now();
alter table public.screeners alter column starts_at set not null;
do $$
begin
  if not exists (select 1 from public.screeners where owner_id is null) then
    alter table public.screeners alter column owner_id set not null;
  else
    raise notice '128: % screener(s) have no owner (their production has none); owner_id stays nullable', (select count(*) from public.screeners where owner_id is null);
  end if;
  if not exists (select 1 from public.screeners where target_id is null) then
    alter table public.screeners alter column target_id set not null;
  else
    raise notice '128: % screener(s) name no title; target_id stays nullable', (select count(*) from public.screeners where target_id is null);
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'screeners_target_type_check') then
    alter table public.screeners add constraint screeners_target_type_check check (target_type in ('episode', 'series'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'screeners_scope_check') then
    alter table public.screeners add constraint screeners_scope_check check (scope in ('title', 'show', 'season', 'episodes'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'screeners_access_check') then
    alter table public.screeners add constraint screeners_access_check check (access in ('anyone', 'signed_in', 'named'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'screeners_notify_check') then
    alter table public.screeners add constraint screeners_notify_check check (notify in ('every', 'first', 'daily', 'never'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'screeners_per_person_check') then
    alter table public.screeners add constraint screeners_per_person_check check (per_person_max is null or per_person_max between 1 and 20);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'screeners_window_check') then
    alter table public.screeners add constraint screeners_window_check check (expires_at > starts_at);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'screeners_named_size_check') then
    alter table public.screeners add constraint screeners_named_size_check check (coalesce(array_length(named_user_ids, 1), 0) + coalesce(array_length(named_emails, 1), 0) <= 50);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'screeners_countries_size_check') then
    alter table public.screeners add constraint screeners_countries_size_check check (coalesce(array_length(countries, 1), 0) <= 30);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'screeners_episode_ids_size_check') then
    alter table public.screeners add constraint screeners_episode_ids_size_check check (coalesce(array_length(episode_ids, 1), 0) <= 200);
  end if;
end $$;

comment on column public.screeners.target_type is 'What the link plays: an episode (a film, a short, any title of its own) or a show. Migration 128.';
comment on column public.screeners.scope is 'title (the episode), show (every episode, later ones included), season or episodes (kept as picked in episode_ids). Migration 128.';
comment on column public.screeners.password_hash is 'scrypt of the password, checked when someone opens the link; null on a link made before 128 (no password). Migration 128.';
comment on column public.screeners.password_enc is 'The password encrypted with the server''s key, so its owner can read it back. Migration 128.';
comment on column public.screeners.countries is 'ISO 3166 codes the link opens in, read from the connection; empty = anywhere. Migration 128.';
comment on column public.screeners.revoked_at is 'Ended by its owner (End it now); it never works again. Migrations 109 and 128.';

create index if not exists screeners_target_idx on public.screeners (target_type, target_id, created_at desc);
create index if not exists screeners_owner_idx on public.screeners (owner_id, created_at desc);
create index if not exists screeners_due_idx on public.screeners (expires_at) where ended_notified_at is null;

-- ---- screener_views ----------------------------------------------------------
alter table public.screener_views add column if not exists user_id text;
alter table public.screener_views add column if not exists device_key text;
alter table public.screener_views add column if not exists session_key text;
alter table public.screener_views add column if not exists city text;
alter table public.screener_views add column if not exists region text;
alter table public.screener_views add column if not exists country text;
alter table public.screener_views add column if not exists device text;
alter table public.screener_views add column if not exists episode_id text;
alter table public.screener_views add column if not exists position integer not null default 0;
alter table public.screener_views add column if not exists watched jsonb not null default '{}'::jsonb;
alter table public.screener_views add column if not exists watched_seconds integer not null default 0;
alter table public.screener_views add column if not exists last_beat_at timestamptz;
alter table public.screener_views add column if not exists last_play_at timestamptz;

comment on column public.screener_views.city is 'The city the connection came from (Vercel''s own reading), never an address. Migration 128.';
comment on column public.screener_views.device_key is 'A hash of a random cookie in the guest''s browser: the same guest opening it again. Migration 128.';
comment on column public.screener_views.session_key is 'A hash of the visit''s key: one open covers a visit. Migration 128.';

create unique index if not exists screener_views_session_uq on public.screener_views (session_key) where session_key is not null;
create index if not exists screener_views_playing_idx on public.screener_views (screener_id, last_play_at desc) where last_play_at is not null;
create index if not exists screener_views_person_idx on public.screener_views (screener_id, user_id, device_key);

-- ---- screener_refusals -------------------------------------------------------
create table if not exists public.screener_refusals (
  id uuid primary key default gen_random_uuid(),
  screener_id uuid not null references public.screeners (id) on delete cascade,
  reason text not null check (reason in ('password', 'locked', 'country', 'screen', 'opens', 'person_opens', 'named')),
  user_id text,
  device_key text,
  ip_hash text,
  device text,
  city text,
  region text,
  country text,
  at timestamptz not null default now()
);
comment on table public.screener_refusals is 'Tries a private screening link turned away (nothing played), for its dashboard and the wrong-password lock. Migration 128.';
create index if not exists screener_refusals_link_idx on public.screener_refusals (screener_id, at desc);
create index if not exists screener_refusals_lock_idx on public.screener_refusals (screener_id, ip_hash, at desc) where reason = 'password';

alter table public.screener_refusals enable row level security;

commit;

select
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'screeners' and column_name in ('target_type', 'target_id', 'scope', 'password_hash', 'access', 'countries', 'one_screen', 'notify')) as screener_columns_of_8,
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'screener_views' and column_name in ('user_id', 'device_key', 'session_key', 'city', 'watched', 'last_play_at')) as view_columns_of_6,
  (select count(*) from pg_tables where schemaname = 'public' and tablename = 'screener_refusals' and rowsecurity) as refusals_table_with_rls_of_1;
