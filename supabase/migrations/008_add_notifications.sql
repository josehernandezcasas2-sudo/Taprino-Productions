-- In-app notifications for creators — episode approved/rejected, a
-- deletion request resolved, an artwork change approved/denied, or a
-- video replacement sending an episode back into review. Written by the
-- same admin-action endpoints that write to audit_log (see lib/notify.js).
--
-- Series-related actions do NOT generate notifications: series have no
-- owner column (see series-media.js's own comment on why), so there's no
-- single creator to notify when a series-level change is resolved. Only
-- episode-based actions have a submitted_by to notify.

create extension if not exists pgcrypto;

create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  type text not null,
  message text not null,
  episode_id text,
  read boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_notifications_user_id on notifications(user_id, read);
create index if not exists idx_notifications_created_at on notifications(created_at);
