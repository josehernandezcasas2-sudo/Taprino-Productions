# Patch — content lifecycle (dates, New Releases, Leaving Soon, auto-expiry) + Continue Watching

## What this reuses rather than reinvents

The "pending deletion, decide if it stays or goes" step you described
already existed as a complete, working system — `deletion_requested`,
`deletion_reason`, the pending-deletions admin queue, and a confirm/deny
resolve endpoint that either permanently deletes (with orphaned-media
tracking) or restores it with a notification back to the creator. None of
that got rebuilt. The expiry cron just sets the same flag your existing
system already knows how to handle.

## New: two dates per episode/series

`Available from` / `Available until` — both optional, both date pickers in
the admin edit modal. Leave both blank and nothing about that title's
lifecycle changes at all.

## New: admin-configurable windows

`/admin/content-lifecycle` — "New release window" and "leaving soon
window," each in days, with quick presets (1 week / 2 weeks / 1 month for
new releases; 3 days / 1 week / 2 weeks for leaving soon) plus a plain
number field for anything else. Same page shows what's currently leaving
soon and — if the scheduled check hasn't run yet — what's expired but not
flagged, with a "run it now" button for testing without waiting a day.

## New: the actual automation

A Vercel Cron job (`vercel.json`, daily at 6am UTC) hits
`/api/cron/expire-content`, which finds anything past its `available_until`
and sets `deletion_requested = true` with the reason "Availability window
ended." It does **not** delete anything itself — it only routes expired
content into the review queue you already had, so a person still makes
the final call, same as any other deletion request.

**Needs a new env var: `CRON_SECRET`.** Generate one the same way as
`ADMIN_NOTIFY_SECRET`:
```bash
openssl rand -hex 32
```
Add it to both `.env.local` and Vercel's environment variables (Production).
Vercel automatically sends it as a Bearer token on the scheduled trigger —
nothing else to configure. The endpoint also accepts a plain signed-in
admin session, so you can test it manually from `/admin/content-lifecycle`
without waiting for the schedule.

## New: Continue Watching

Added to the top of the homepage, above New Releases and Leaving Soon.
Reuses your existing Stripe-metadata-based progress tracking — no new
storage. **Signed-in users only** — anonymous progress lives in the
browser's localStorage, which isn't reachable during server-side
rendering the way the rest of this site works, so it's a genuinely
different code path, not a small extension of this one. Worth building
separately later if you want it for signed-out viewers too.

Each card shows a thin progress bar under the thumbnail, driven by
`resumeSeconds / total runtime` — reuses the runtime parser already built
for the channel scheduler.

## Files changed
`pages/index.js`, `pages/admin.js`, `pages/api/admin/library.js`,
`pages/api/admin/edit-episode.js`, `components/AdminEditEpisodeModal.js`,
`styles/globals.css`

## New
`supabase/migrations/017_add_content_lifecycle.sql`,
`lib/contentLifecycle.js`, `lib/continueWatching.js`,
`components/ContinueWatchingRow.js`,
`pages/api/admin/lifecycle-settings.js`,
`pages/api/cron/expire-content.js`, `pages/admin/content-lifecycle.js`,
`vercel.json`

## After deploying
1. Run migration `017_add_content_lifecycle.sql`
2. Add `CRON_SECRET` to `.env.local` and Vercel
3. Set a start/end date on one test episode, confirm it shows in New
   Releases / Leaving Soon appropriately
4. From `/admin/content-lifecycle`, try "run it now" on something you've
   deliberately backdated past its end date, confirm it lands in Pending
   Deletions on the main admin page
