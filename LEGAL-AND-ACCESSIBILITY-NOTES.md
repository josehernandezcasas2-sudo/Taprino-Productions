# Patch — legal pages, creator analytics, accessibility

## Before you publish the legal pages

**These are templates, not legal advice.** I wrote them against what this
codebase actually does, so they're accurate rather than generic boilerplate —
but nobody qualified has reviewed them.

Search all three files for square brackets and fill in:

- `[CONTACT EMAIL]` — a real inbox you monitor
- `[MAILING ADDRESS]` — required for most ad networks and payment processors
- `[JURISDICTION]` — presumably California
- `[REVENUE SHARE TERMS]` in `terms.js` §5 — **leave the work unpublished until
  this is filled in.** Don't launch creator payouts against a placeholder.

The section most worth paying a lawyer to read is Terms §5 (creator licensing).
It's currently written as a *non-exclusive licence to stream* rather than an
assignment of copyright — creators keep ownership. That's the fairer default and
the easier one to widen later with consent. It's also the clause that determines
whether you can legally distribute revenue, so it connects directly to the
funding question you paused.

## New files

- `pages/terms.js`, `pages/privacy.js`, `pages/cookies.js`
- `components/LegalLayout.js`
- `pages/creator/analytics.js` — creator dashboard
- `pages/api/creator/analytics.js`
- `pages/_document.js`
- `supabase/migrations/009_add_captions.sql`

## Modified

- `lib/redis.js` — daily view buckets appended
- `lib/episodes.js` — exposes `submittedBy` and caption fields
- `components/VideoPlayer.js` — captions, CC button, `c` shortcut
- `pages/_app.js` — skip link
- `pages/episode/[id].js` — records daily views, renders caption track
- `pages/creator.js` — link to analytics
- 11 pages — `id="main-content"` and footer legal links
- `styles/globals.css` — appended

## Run the migration

```sql
-- supabase/migrations/009_add_captions.sql
```

Additive and nullable — existing episodes are unaffected and keep playing.

## Creator analytics

View counts were already reaching the creator API and showing per card. What was
missing was the aggregate: totals, a 7/30/90-day trend, period-over-period
change, and per-episode share.

Redis previously stored only a running total — it could say "1,204 views" but not
whether that was 1,200 at launch and 4 since. Daily buckets now record the shape
over time, hashed by day with a 400-day expiry, one extra write per view.

**Trends start from today.** Historical daily data doesn't exist retroactively,
so the chart fills in over the coming weeks. All-time totals are correct now.

## Accessibility

Fixed:
- **`<html lang="en">`** — there was no `_document.js`, so the attribute was
  missing entirely. WCAG 2.1 Level A failure (3.1.1); screen readers were
  guessing the language.
- **Skip link** — keyboard users had to tab the entire header on every page.
- **`<main id="main-content">`** landmarks on 7 pages.
- **Captions** — CC button, settings menu entry, `c` to toggle. Reads tracks
  from the HLS manifest (captions uploaded to Cloudflare) *or* from a stored
  `.vtt` URL. Both paths supported; neither required.

Still open:
- No caption upload UI for creators yet — the column exists but nothing writes
  to it. Cloudflare's `/stream/{uid}/captions/{lang}` endpoint is the cleaner
  route and needs no database round trip.
- Audio descriptions for blind viewers (WCAG AA) — not started.
- Colour contrast across the site hasn't been formally measured.

## About the domain

You mentioned funds. A `.com` runs roughly $10–15 **per year** — Cloudflare sells
them at cost. It's the single cheapest thing blocking Clerk production, Resend
production, and AdSense approval simultaneously. Worth a second look if the
assumption was that it costs more.
