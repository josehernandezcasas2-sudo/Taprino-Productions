-- Tracks media that's become orphaned — no longer referenced by any row
-- in `episodes` or `series`, but not actually removed from Cloudflare
-- Stream or Supabase Storage. This happens in a few places: confirming a
-- deletion request, replacing an episode's video, or replacing poster/
-- thumbnail artwork (the old file's path always changes, since
-- lib/artworkUpload.js writes each upload to a fresh path).
--
-- This is visibility-plus-cleanup, not just a log: rows here get an
-- actual "delete it now" action in the admin UI (see
-- pages/api/admin/cleanup-orphan.js), which calls Cloudflare's or
-- Supabase's real delete API and then removes the row. Nothing here auto-
-- deletes on its own — an admin has to act on each one.

-- Supabase projects normally have this enabled already; harmless if so.
create extension if not exists pgcrypto;

create table if not exists orphaned_media (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('cloudflare_video', 'storage_image')),
  reference text not null,   -- Cloudflare video uid, or Supabase Storage path
  reason text not null,      -- e.g. "episode deleted", "video replaced", "artwork replaced"
  context text,              -- e.g. the episode/series title, for a human reading the list later
  created_at timestamptz not null default now()
);

create index if not exists idx_orphaned_media_created_at on orphaned_media(created_at);
