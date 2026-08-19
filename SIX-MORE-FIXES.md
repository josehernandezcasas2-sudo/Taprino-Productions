# Patch — footer, genre icons table, Continue Watching sizing, full-bleed player, ads toggle

## 1. Footer — proven correct, likely a caching issue on your end

I rendered it myself and measured the actual pixel coordinates at a
1920px-wide viewport: `left: 0, right: 1920` — exactly edge to edge, zero
gap either side. Screenshot attached showing the measurement.

If your live site still shows it constrained after this deploys, that's
very likely your browser holding onto an old cached copy of `globals.css`
specifically (not the whole page — CSS files get cached aggressively).
Try a hard refresh (Ctrl+Shift+R) or the DevTools "Clear site data" step
from a few rounds back before assuming it's still broken.

## 2. Genre icons — the migration was never run

`Could not find the table 'public.genre_icons'` means exactly that —
`016_add_genre_icons.sql` exists in the repo but was never executed in
Supabase. Run this in the SQL Editor:

```sql
create table if not exists genre_icons (
  genre text primary key,
  image_url text not null,
  updated_at timestamptz not null default now()
);
```

## 3. Continue Watching sizing — found and fixed

Real bug: `GenreRow`'s cards are wrapped in `<div className="card-wrap
row-card">`, and `.row-card` is what fixes card width at 190px in a
horizontal row. My `ContinueWatchingRow` never included that wrapper —
just the bare card — so it had no matching width constraint. Added it.

## 4. Video player now full-bleed on the watch page

Pulled the player out of the constrained `.player-card` container into
its own edge-to-edge wrapper, sitting outside `.stage` the same way the
homepage hero already does — video touches the screen edges, while the
title/description/controls stay in a normal reading column underneath.
Same treatment for the "locked, join to watch" panel when it's showing
instead of the player.

## 5. Per-episode ads toggle — built end to end

New `ads_enabled` column, defaults to `true` (nothing changes for existing
content). Checkbox added in **both** places you asked for — the edit
modal, and the manual "add new content" form. When off, that episode never
shows an ad regardless of tier. Premium episodes never show ads either
way, so the checkbox visibly notes when it's a no-op there.

**Needs migration `018_add_ads_enabled.sql`.**

## Files changed
`components/ContinueWatchingRow.js`, `components/ManualEpisodeForm.js`,
`components/AdminEditEpisodeModal.js`, `pages/episode/[id].js`,
`lib/publicEpisodes.js`, `pages/api/admin/library.js`,
`pages/api/admin/edit-episode.js`, `pages/api/admin/manual-episode.js`,
`styles/globals.css`

## New
`supabase/migrations/018_add_ads_enabled.sql`

## Run before/after deploying
1. `016_add_genre_icons.sql` (if not already run — check Table Editor first)
2. `018_add_ads_enabled.sql`
