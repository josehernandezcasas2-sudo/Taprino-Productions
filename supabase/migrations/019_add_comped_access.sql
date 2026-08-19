-- Comped access: an admin-managed allowlist of email addresses that get
-- Studio Tapa + for free, no Stripe subscription required. This is for
-- people submitting work (students, etc.) who need to watch premium
-- content without paying — essentially an invite list, added and removed
-- by hand from the admin panel.
--
-- Matching is case-insensitive (emails are compared via lower()) since
-- Gmail and most providers treat casing as irrelevant, and a mismatch here
-- would silently lock someone out for no real reason.
create table if not exists comped_access (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  reason text,          -- e.g. "Fall 2026 intro to film class"
  granted_by text,       -- admin's email, for accountability
  created_at timestamptz not null default now()
);

create index if not exists comped_access_email_lower_idx on comped_access (lower(email));

comment on table comped_access is
  'Emails granted free Studio Tapa + access without a Stripe subscription. Checked at login in lib/accountContext.js. Remove a row to revoke.';
