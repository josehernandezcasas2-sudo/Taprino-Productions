# Patch — your own ad system (house ads)

## Run this migration

`supabase/migrations/011_add_house_ads.sql` — creates the `house_ads` table
and two small Postgres functions for atomic impression/click counting.

## What this actually is

A real, working ad system: your player already speaks pure VAST through
Google's IMA SDK, so this builds the other end — an ad tag URL that serves
your own promos as valid VAST XML instead of a third-party network's.

**No approval process. No minimum traffic. No account setup with anyone.**
It works the moment you add one ad in the admin dashboard.

## Where things live

- `/admin/house-ads` — the dashboard: add ads, see impressions/clicks/CTR,
  pause or delete
- `/api/house-ads/vast` — the ad tag itself. This is what plays in the
  player.
- `/api/house-ads/impression` and `/api/house-ads/click` — tracking pixels,
  fired automatically by the IMA SDK per the URLs embedded in the VAST
  response. Nothing to wire up by hand.

## How it turns on

**Nothing to configure.** `NEXT_PUBLIC_AD_TAG_URL` was previously hardcoded
to Google's public IMA sample tag. It now defaults to your own
`/api/house-ads/vast` whenever that env var is unset. If you had it set to
something already, this doesn't touch that — remove the env var (or leave
it, and set it later to a real network's tag when you have one) to switch.

With zero house ads added yet, the endpoint returns a valid *empty* VAST
document rather than an error or a 404 — the IMA SDK reads that as "no ad
this time" and plays content straight through. Free episodes are silently
ad-free until you add your first ad, which is the correct default, not a
bug to notice and panic about.

## How a click actually works

VAST separates two things, and this respects that split on purpose:

- **`<ClickThrough>`** — the real destination. Set directly to your
  `click_url`. A viewer who clicks goes straight there.
- **`<ClickTracking>`** — a separate, count-only pixel hitting our own
  `/api/house-ads/click`. It never redirects anywhere; it only increments a
  counter.

So nobody's click is ever routed *through* our servers on the way to your
shop — that would add a hop and a failure point for no reason. The
`/click` endpoint purely counts.

## The one real constraint: video size

House-ad video is **not** routed through Cloudflare Stream, on purpose —
VAST wants a direct, playable MP4 file, not an HLS manifest, and there's no
piracy concern for your own promotional clip that justifies the signed-URL
machinery episodes use. It's stored as a plain file instead, uploaded
inline through the admin form.

That simplicity has a real cost: the upload goes through a single request,
not a resumable one, so it's capped at **8MB**. A well-compressed 10–20
second 720p promo fits comfortably; a longer or higher-bitrate one won't.

If you outgrow that later, the fix is routing house-ad video through
Cloudflare Stream with downloads enabled (the same infrastructure episodes
already use) — a real follow-up, not built now, to keep this patch shippable
and correct rather than half-built against a platform limit I couldn't
verify live.

## What to test

1. Go to `/admin/house-ads`, add one ad — a short clip, a real click URL,
   duration fills in automatically once you choose the file
2. Play any **free** episode. The house ad should play as the pre-roll.
3. Check `/admin/house-ads` again — impressions should have incremented
4. Click the ad during playback — should go straight to your click URL,
   and clicks should increment on the dashboard
5. Pause the ad, refresh the episode page, confirm no ad plays (falls
   through to content immediately)
6. Delete all ads, confirm episodes still play cleanly with no ad and no
   console error

## Known follow-ups

- No orphan-cleanup wiring for deleted ads' video files yet — they're left
  in storage. Fine at house-ad scale; worth adding if this bucket grows.
- No scheduling (start/end dates) — an ad is either active or it isn't.
- Single ad per break, matching what the Google sample tag was already
  doing — no ad pods (multiple ads back-to-back) yet.
