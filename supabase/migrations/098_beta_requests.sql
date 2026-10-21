-- 098: Private beta (Jose, 2026-10-21; mockup: the "Private beta gate" canvas).
-- While PRIVATE_BETA=on, the door at /welcome has a "Request an invite"
-- form. One row per email; an admin invites (a Clerk invitation, which
-- is what lets the address create an account while sign-ups are
-- restricted) or dismisses from /admin/invites. Invitations themselves
-- live in Clerk, not here; the note an admin types when inviting is kept
-- here by email so the Invites page can show it next to Clerk's row.

create table if not exists beta_requests (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  kind text not null default 'viewer' check (kind in ('viewer', 'creator', 'crew')),
  note text,
  status text not null default 'waiting' check (status in ('waiting', 'invited', 'dismissed')),
  admin_note text,
  invitation_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by text
);

create index if not exists beta_requests_status_idx on beta_requests (status, created_at desc);
