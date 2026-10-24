-- 102: account suspensions and push tokens (Jose, 2026-10-24).
--
-- Suspension is the site's own, not Clerk's: a row here bounces the
-- person to /suspended (web) or the app's gate on every page load and
-- refuses every write (middleware.js, lib/suspensionGate.js), until it
-- is lifted or runs out. Sign-in keeps working so they can read why and
-- how to appeal; nothing is deleted. Scope 'tips' only switches tipping
-- off for them (the Tip button disappears; /api/tips/checkout refuses).
create table if not exists account_suspensions (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  scope text not null default 'all' check (scope in ('all', 'tips')),
  public_reason text not null,          -- what the person reads on the card
  note text,                            -- for the team only
  until_at timestamptz,                 -- null = until lifted
  cancel_membership boolean not null default false,
  created_by text not null,
  created_by_email text,
  created_at timestamptz not null default now(),
  lifted_at timestamptz,
  lifted_by text,
  lift_note text
);
create index if not exists account_suspensions_user_idx on account_suspensions (user_id) where lifted_at is null;
create index if not exists account_suspensions_recent_idx on account_suspensions (created_at desc);

-- Push notifications (the app): one row per device token. A token that
-- Expo reports as DeviceNotRegistered is disabled, never deleted, so the
-- admin can see what happened.
create table if not exists push_tokens (
  token text primary key,
  user_id text not null,
  platform text,                        -- ios | android
  device_name text,
  app_version text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  disabled_at timestamptz,
  disabled_reason text
);
create index if not exists push_tokens_user_idx on push_tokens (user_id) where disabled_at is null;
