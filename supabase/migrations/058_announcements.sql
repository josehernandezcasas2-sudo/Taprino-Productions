-- Backs the homepage "Announcements" carousel (pages/index.js) and its
-- admin management page (pages/admin/announcements.js). Unlike most
-- content on this site, an announcement isn't an episode/series/pitch —
-- it's a short, admin-authored post that can optionally point at one of
-- those things (or anywhere else), so link_url is a plain text field
-- rather than a foreign key: it needs to hold an internal path
-- ("/pitches/<id>") just as often as a full external URL.
create table if not exists announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text,
  image_url text,
  link_url text,
  -- Lets admin pull an announcement from rotation without deleting it —
  -- useful for something that was time-bound ("applications open through
  -- Friday") without losing the record or its audit trail.
  is_active boolean not null default true,
  -- Manual curation order, not recency — an admin announcing something
  -- big usually wants it first regardless of when the routine ones went
  -- up. Defaults new rows to the front (see the app-side insert logic)
  -- rather than the back, since a freshly-written announcement is
  -- normally the one an admin most wants seen first.
  sort_order integer not null default 0,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists announcements_active_order_idx
  on announcements (is_active, sort_order, created_at desc);

comment on table announcements is 'Admin-authored homepage announcements. link_url is a free-text path/URL, not a foreign key, since an announcement can point at a pitch, series, episode, external link, or nothing at all.';
