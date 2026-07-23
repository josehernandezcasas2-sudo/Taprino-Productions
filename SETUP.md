# Taprino Transmission — Setup Guide

This covers what's needed to get the current codebase running, including
everything built across recent sessions: artwork fields, the creator
dashboard, series-level media, the deletion-request flow, and the admin
dashboard additions (stats, library management, creator roster).

## 1. Database

**If this is a brand-new Supabase project:** run `supabase/schema.sql` in
the SQL editor. It already includes every column from all four migrations
below — you don't need to run the migrations separately on a fresh install.

**If you already have a running database from before this round of
changes:** run these in order, in Supabase's SQL editor:

1. `supabase/migrations/002_remove_category.sql`
2. `supabase/migrations/003_add_artwork_fields.sql` — adds `poster` /
   `thumbnail` to `episodes` and `series`
3. `supabase/migrations/004_add_deletion_requests.sql` — adds
   `deletion_requested` / `deletion_reason` / `deletion_requested_at` to
   both tables

All of them are safe to re-run (`IF NOT EXISTS` / `IF EXISTS` guards), so
running one twice by accident won't break anything.

## 2. Supabase Storage

No manual bucket setup needed. The first time anyone uploads a poster or
thumbnail (via the creator form, series media form, or an admin edit), the
app checks for a bucket named `episode-art` and creates it automatically
(public, 6MB file limit). If you'd rather create it yourself ahead of
time, that's the exact name and settings to use.

## 3. Environment variables

| Variable | Used for |
|---|---|
| `SUPABASE_URL` | Database + storage connection |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-side Supabase access (never exposed to the browser) |
| `CLERK_SECRET_KEY` | Auth — server side |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Auth — client side |
| `CLOUDFLARE_ACCOUNT_ID` | Video hosting (Cloudflare Stream) |
| `CLOUDFLARE_API_TOKEN` | Video hosting |
| `CLOUDFLARE_STREAM_CUSTOMER_CODE` | Builds playback URLs |
| `STRIPE_SECRET_KEY` | Cipher Circle premium membership |
| `STRIPE_PRICE_ID` | Which Stripe price the membership checkout uses |
| `STRIPE_WEBHOOK_SECRET` | Verifies incoming Stripe webhook events |
| `UPSTASH_REDIS_REST_URL` | View counts (also used for episode-level analytics on the creator dashboard) |
| `UPSTASH_REDIS_REST_TOKEN` | Same as above |
| `RESEND_API_KEY` | Sends the "new series drop" notification emails |
| `RESEND_FROM_EMAIL` | From-address for those emails |
| `ADMIN_NOTIFY_SECRET` | Protects the notify-series-drop endpoint from being triggered by anyone but you |
| `NOTION_TOKEN` / `NOTION_DATABASE_ID` | Newsletter signup logging |
| `NEXT_PUBLIC_AD_TAG_URL` | Optional — only relevant if you're running ads on free-tier playback |

## 4. Getting yourself admin access

There's deliberately no in-app way to self-promote to admin — the very
first admin has to be set directly in Clerk:

1. Clerk dashboard → **Users** → your account
2. Edit **public metadata**, set it to `{"role": "admin"}`
3. Sign out and back in (or just reload) — `/admin` should now load instead
   of redirecting you to the homepage

From there, granting creator access to anyone else (Moonbeam, Olaga, etc.)
is done through the **Creator access** card on `/admin` itself — no more
manual Clerk edits needed for that part.

## 5. Route map (what exists right now)

**Public**
- `/` — homepage
- `/genre/[genre]`, `/type/[type]`, `/series/[id]`, `/episode/[id]`
- `/account`, `/wishlist`

**Creator** (`role: creator` or `admin`)
- `/creator` — upload shorts/episodes, track submissions, request deletion
- `/creator/series` — series-level trailer/artwork, series deletion requests

**Admin** (`role: admin`)
- `/admin` — stats, full library (search + edit any episode/status), pending
  review queue, pending deletions (episodes + series), creator roster,
  grant/revoke access

## 6. Known gaps — not bugs, just not built yet

- **Confirming a deletion doesn't clean up Cloudflare or Storage.** The
  database row is removed, but the actual video file on Cloudflare Stream
  and any uploaded images stay put. Fine until storage costs start to
  matter; a follow-up job would need to call Cloudflare's delete-video API
  and remove the Supabase Storage objects.
- **Series have no ownership.** Any creator can set artwork or request
  deletion on any series, not just ones they've contributed episodes to —
  intentional for a small trusted roster, but worth tightening if the
  roster grows.
- **Hero rotation has a toggle, not a management view.** The admin library
  edit modal has an "eligible for hero rotation" checkbox, but there's no
  dedicated screen showing the full current pool or letting you manually
  prioritize one episode over another.
- **A pre-existing duplicate Vercel project** and, at one point, **a
  syntax error in `lib/episodes.js`** were flagged as loose ends in an
  earlier session. The file compiles cleanly now in every build done
  during this round of work, so the syntax error isn't reproducing — but
  the duplicate Vercel project wasn't something this round of changes
  touched, so it's likely still sitting there unresolved.
