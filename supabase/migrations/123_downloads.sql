-- 123 — Downloads in the app (written 2026-11-14).
--
-- Jose, 2026-11-14: "I want users to be able to download and view their
-- download page from the tab bar … if they have something downloaded, and
-- they are offline, they can still view it as long as they have the
-- subscription, once the month is over and if they haven't connected, make
-- sure they have to connect back" and "let's add this feature for premium
-- and sponsor. Let's also add a section in admin to toggle this feature on
-- and off, with an eventual lock on."
--
--   * site_settings.downloads_enabled   the admin switch. Off until a full
--                                       admin turns it on (Admin → Downloads).
--   * site_settings.downloads_locked    the lock on that switch: while it is
--                                       on nobody can flip the switch, and
--                                       only a full admin can unlock.
--   * episodes.downloads_allowed        the creator's switch per title,
--                                       "Allow downloads in the app". On
--                                       unless they turn it off.
--   * download_devices                  the phones an account downloads on
--                                       (two at a time): the app's own
--                                       random id, the phone's name, when it
--                                       last checked in. A phone taken off
--                                       the list keeps its row (removed_at).
--   * downloads                         one row per copy on a phone: which
--                                       title, why it may play ('member' =
--                                       the plan, 'owned' = bought), until
--                                       when without the phone connecting,
--                                       and how it ended ('removed' by the
--                                       phone, 'revoked' by the site). The
--                                       row is written when the phone first
--                                       asks for the title; it has no date
--                                       (licensed_until) until the file is
--                                       ready and its link has gone out.
--
-- Columns and two tables; no existing row changes. Safe to run more than
-- once. Before it has run the switch reads as off, every title reads as
-- allowing downloads, and the routes answer "needs a database update
-- (migration 123)". The rules are lib/downloadRules.js.

begin;

-- 1. The admin switch and its lock.
alter table public.site_settings add column if not exists downloads_enabled boolean not null default false;
alter table public.site_settings add column if not exists downloads_locked boolean not null default false;
comment on column public.site_settings.downloads_enabled is 'Admin → Downloads: Premium and Sponsor members, and buyers of a title, can keep it in the app to watch offline. Off until a full admin turns it on. Migration 123.';
comment on column public.site_settings.downloads_locked is 'Admin → Downloads: while true nobody can flip downloads_enabled; only a full admin unlocks it. Migration 123.';

-- 2. The creator's switch per title.
alter table public.episodes add column if not exists downloads_allowed boolean not null default true;
comment on column public.episodes.downloads_allowed is 'The creator''s switch "Allow downloads in the app". False: no new download, and copies on phones are removed at their next check-in. Migration 123.';

-- 3. The phones.
create table if not exists public.download_devices (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  device_id text not null,
  name text,
  platform text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  removed_at timestamptz,
  constraint download_devices_user_device_uq unique (user_id, device_id),
  constraint download_devices_device_id_check check (device_id ~ '^[A-Za-z0-9_-]{16,80}$'),
  constraint download_devices_platform_check check (platform is null or platform in ('ios', 'android'))
);
comment on table public.download_devices is 'Phones an account downloads on (the app''s own random id per install). removed_at = taken off the list; the row is kept and comes back if that phone downloads again. Migration 123.';

-- 4. The copies.
create table if not exists public.downloads (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  device_id text not null,
  episode_id text not null,
  basis text not null,
  status text not null default 'active',
  licensed_until timestamptz,
  ended_at timestamptz,
  bytes bigint,
  created_at timestamptz not null default now(),
  renewed_at timestamptz,
  removed_at timestamptz,
  revoke_reason text,
  constraint downloads_basis_check check (basis in ('member', 'owned')),
  constraint downloads_status_check check (status in ('active', 'removed', 'revoked'))
);
comment on table public.downloads is 'One row per copy of a title on a phone. basis: member (the plan) or owned (bought). licensed_until: plays offline until then; null while the phone has asked for the title and its file is still being made. ended_at: the first check-in at which the plan no longer carried downloads. status: active, removed (the phone no longer holds it) or revoked (the site took it back; revoke_reason says why — limit = the row was taken back at once because a limit was met, and counts for nothing). Migration 123.';

-- One live copy per phone and title; ended rows are kept as history.
create unique index if not exists downloads_active_uq on public.downloads (user_id, device_id, episode_id) where status = 'active';
create index if not exists downloads_episode_idx on public.downloads (episode_id);
-- An account's newest rows, whatever became of them: the new copies it
-- asked for in the last hour and day (30 and 60) are counted from these.
create index if not exists downloads_user_created_idx on public.downloads (user_id, created_at desc);

-- Migration 112's rule: every new table is locked to the site's own server key.
alter table public.download_devices enable row level security;
alter table public.downloads enable row level security;
revoke all on table public.download_devices from anon, authenticated;
revoke all on table public.downloads from anon, authenticated;

-- PostgREST picks the new columns and tables up at once.
notify pgrst, 'reload schema';

commit;

-- What is there now (one row).
select
  (select downloads_enabled from public.site_settings where id = 1) as downloads_on_expect_false_on_first_run,
  (select downloads_locked from public.site_settings where id = 1) as switch_locked_expect_false_on_first_run,
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'episodes' and column_name = 'downloads_allowed') as title_switch_column_expect_1,
  (select count(*) from public.episodes where downloads_allowed = false) as titles_switched_off,
  (select relrowsecurity from pg_class where oid = 'public.download_devices'::regclass) as phones_row_level_security_expect_true,
  (select relrowsecurity from pg_class where oid = 'public.downloads'::regclass) as copies_row_level_security_expect_true,
  (select count(*) from pg_indexes where schemaname = 'public' and indexname = 'downloads_active_uq') as one_copy_per_phone_index_expect_1,
  (select count(*) from pg_indexes where schemaname = 'public' and indexname = 'downloads_user_created_idx') as newest_rows_index_expect_1,
  (select count(*) from public.download_devices where removed_at is null) as phones,
  (select count(*) from public.downloads where status = 'active') as copies_on_phones;
