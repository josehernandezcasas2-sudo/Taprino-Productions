-- Every admin action that changes something irreversible or affects
-- another person's content gets logged here: approve/reject (single and
-- bulk), confirm/deny deletion, approve/deny artwork changes, permanent
-- orphan cleanup, and granting/revoking creator access. Read-only from the
-- app's own perspective — nothing here is ever updated or deleted through
-- the app itself, only inserted.
--
-- admin_email is denormalized (copied at write time) rather than joined
-- from Clerk later — Clerk doesn't guarantee a past user id is still
-- resolvable to an email cheaply, and an audit log entry should still
-- read clearly even if that admin's account is later removed.

create extension if not exists pgcrypto;

create table if not exists audit_log (
  id uuid primary key default gen_random_uuid(),
  admin_id text not null,
  admin_email text,
  action text not null,
  target_type text not null,
  target_id text,
  details text,
  created_at timestamptz not null default now()
);

create index if not exists idx_audit_log_created_at on audit_log(created_at);
