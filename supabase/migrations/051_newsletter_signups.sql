-- A separate, site-wide newsletter signup, distinct from the existing
-- homepage-only SignalPanel (components/SignalPanel.js, pages/api/subscribe.js)
-- which asks about content preference and writes to Notion or a local
-- JSON file. This one is a plain "get updates from us" signup meant to
-- appear everywhere (footer), stored reliably in the database this app
-- already relies on for everything else — not a local JSON file, which
-- doesn't persist on Vercel's serverless filesystem between requests.
create table if not exists newsletter_signups (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  source text,
  synced_to_esp boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists newsletter_signups_created_idx on newsletter_signups (created_at desc);

comment on table newsletter_signups is 'Site-wide newsletter signups (footer form). synced_to_esp tracks whether this address has been pushed to whichever email-sending provider is configured, so a later provider switch can identify already-synced vs pending rows.';
