# Patch — live streaming, with ad breaks

## Run this migration

`supabase/migrations/013_add_live_streams.sql`

## What this is

A real live-streaming feature: an admin dashboard to create a broadcast and
get RTMPS credentials for OBS (or any RTMPS encoder), a public `/live` page,
and automatic house-ad breaks during the broadcast — using the exact same
ad system from the earlier patches, unmodified.

**Cost:** nothing new. Cloudflare Stream bills live at the identical rate as
VOD — $5/1,000 minutes stored, $1/1,000 minutes delivered, no separate
ingest or encoding line item. Confirmed against Cloudflare's current
published pricing before building this, not assumed.

## How to go live

1. `/admin/live` → fill in a title, create the stream
2. You get back a server URL and stream key — paste into OBS: Settings →
   Stream → Custom → Server / Stream Key
3. Start streaming in OBS, confirm your preview looks right
4. Come back to `/admin/live` and press **Go live to viewers**

Step 4 is deliberately a separate, explicit action from step 2. Cloudflare
can report a live input's connection state, and the admin page shows that
as a hint — but it is **not** what controls whether a stream is public.
See "One thing I could not verify" below for why.

## How the ad breaks work — read this part

Breaks are **time-based, computed independently by every viewer's player**,
not pushed from a server. Each stream has a `started_at` timestamp and an
interval (default 10 minutes); every connected player does the same math —
"how many intervals have elapsed since the stream started" — and cuts to a
house ad the moment its own count falls behind.

This is what keeps it genuinely free to run: no websocket server, no Redis
pub-sub, nothing pushing signals to connected viewers. It's also the honest
trade-off to know about: breaks land on a shared clock, not on a producer's
cue. You can't press a button mid-broadcast and have every viewer's ad start
that exact second — that would need a small polling or pub-sub channel on
top of this, which is a real, buildable next step if it turns out to matter,
just not built here.

A viewer joining partway through a stream doesn't get hit with a catch-up ad
the instant the page loads — their own break schedule starts counting from
when *they* joined, not from the stream's start.

When a break fires: the live HLS connection is torn down, the house-ads VAST
tag plays through the same IMA machinery as VOD, and when it ends a fresh
connection is made to the same live manifest — which naturally rejoins at
the current live edge, not wherever the stream was when the break started.
That's correct behavior for live; falling behind and needing to "catch up"
would be wrong.

## One thing I could not verify — and how the design accounts for it

Cloudflare's exact response shape for a live input's connection status
(`lib/cloudflareLive.js`, `getLiveInputStatus`) is documented, but I have no
way to test it against a real, actively-broadcasting Cloudflare account from
this environment. The field is parsed defensively with fallbacks, but if it
turns out to be named or nested differently than expected, worst case it
just shows "unknown" on the admin dashboard.

That's why going live is a deliberate, separate admin action rather than
something automatically triggered by detecting a connection: **nothing
about what viewers see depends on that field being correct.** You decide
when you're actually broadcasting and press the button yourself.

## The recording

Cloudflare automatically records every live session to a normal on-demand
video (`recording: { mode: 'automatic' }` in `createLiveInput`). That
recording is **not** automatically found or attached to anything —
Cloudflare Stream's API for looking up a live input's resulting recording
wasn't something I could verify the exact shape of either, so rather than
guess, this is manual: find the recording's video UID in your Cloudflare
Stream dashboard after a broadcast, then use the existing **"Add episode by
Cloudflare UID"** admin flow (built for the firewall-fallback case) to
publish it as a real episode, if you want to keep it.

## New files

- `supabase/migrations/013_add_live_streams.sql`
- `lib/cloudflareLive.js` — create/status/delete for Cloudflare live inputs
- `lib/liveStreams.js` — the one "what's live right now" query, shared by
  the SSR page and the polled API so they can't drift apart
- `pages/api/admin/live/create.js`, `go-live.js`, `end.js`, `status.js`
- `pages/api/live/current.js` — public, polled every 20s by `/live`
- `components/LiveVideoPlayer.js` — a deliberately separate component from
  the VOD player; live has no duration, no seek, no resume position, and a
  different ad model, and threading all of that through the VOD player's
  existing state machine risked destabilizing something that already works
- `pages/live.js`, `pages/admin/live.js`

## Modified

- `pages/admin.js` — link to `/admin/live`
- `pages/index.js` — a "Live now" banner when a stream is active, so
  viewers can actually discover it without knowing the URL
- `styles/globals.css` — appended

## What to test

- Create a stream, confirm the RTMPS URL/key display and the "show/hide
  key" toggle work
- Connect OBS, confirm the Cloudflare status hint eventually shows
  something other than "unknown" (informational only — don't gate
  anything on it)
- Press "Go live," confirm `/live` shows it within ~20 seconds (the poll
  interval) without a manual refresh
- Let a break fire (or temporarily set a short interval to test faster) —
  confirm it cuts to a house ad and rejoins live afterward, not frozen or
  stuck
- Press "End stream," confirm `/live` reflects that within ~20 seconds too
- Load `/live` with nothing live — should show a clean "nothing live right
  now" state, not an error

## Known follow-ups

- No admin-triggered "play a break right now" — time-based only, as
  explained above
- No automatic recording lookup — manual, via the existing UID-entry flow
- No live chat, no viewer count
- Only one stream can be "current" at a time by design (simplest useful
  version); the schema doesn't prevent more, but the site only ever shows
  the most recently started one
