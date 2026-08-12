# Patch — the linear channel (Plan A, built with Plan B in mind)

## Run this migration

`supabase/migrations/014_add_channel_schedule.sql`

## What this is

A continuously-playing, looping channel of your free episodes — tune in
any time at `/channel` and see whatever's "on," the way a real TV channel
works, not an on-demand list. Zero new infrastructure: this is the
client-computes-its-position trick from the live-stream ad breaks, applied
to an entire playlist instead of just ad timing.

**How the loop works:** the admin builds an ordered list of episodes. The
system knows when the loop started and how long each episode runs, so
"what's on right now" is pure arithmetic — elapsed time since the loop
started, modulo the total loop length. Every viewer gets the same answer
because it's computed **server-side** and handed to them as a snapshot
(`lib/channelSchedule.js`, `getChannelState`) — not left to each viewer's
own device clock, which would let two people watching "the same" channel
see different programs if either clock were wrong.

I unit-tested this math directly before wiring anything to it — six
hand-computed cases including a program boundary, a full wrap-around past
the end of the loop, and a clock running backward — all matched.

## The one real constraint: free-tier only

Enforced **server-side** in `addEpisodeToSchedule`, not just hidden from
the admin UI. A scheduled premium episode would either need real per-viewer
entitlement checks built into channel playback, or would leak Cipher
Circle video to anyone who tunes in — neither is acceptable, so it's a hard
rule: only free, published episodes can go on the schedule.

## Built with Plan B in mind

Everything here is designed so upgrading to a true server-side stitched
channel (Plan B — Eyevinn's Channel Engine / VOD2Live, or similar) later
is additive, not a rewrite:

- The schedule data itself (ordered episodes + durations) is exactly what
  a real channel-engine service would also need — nothing here is
  client-player-specific.
- `channel_settings` is a deliberate singleton (`id` always `1`) — the
  honest v1 scope is one channel. The comment in the migration says
  plainly what a second channel would need instead (a proper `channels`
  table with schedule rows foreign-keyed to it), so that's a schema
  *addition* later, not a redesign.
- `getChannelState()` is the one place "what's on now" is computed — if
  you ever swap in a real stitching service, this is the function that
  changes; nothing else needs to know how the answer was produced.

## New files

- `supabase/migrations/014_add_channel_schedule.sql`
- `lib/channelSchedule.js` — CRUD + the core scheduling computation
- `pages/api/admin/channel/schedule.js`, `schedule-update.js`,
  `settings.js`, `restart.js`
- `pages/api/channel/now.js` — public, polled by the player
- `components/ChannelPlayer.js` — a third player, deliberately separate
  from `VideoPlayer` (VOD) and `LiveVideoPlayer` (broadcast). It shares
  pieces with both but its actual state machine — "re-derive what should
  be on from the server, on a timer" — didn't belong wedged into either.
- `pages/channel.js`, `pages/admin/channel.js`

## Modified

- `lib/videoMetadata.js` — `parseRuntimeToSeconds`, the inverse of the
  existing `formatRuntime`. Unit-tested against real and malformed input
  (including `"99:99"`, empty strings, and non-numeric text) — all handled
  by returning `null` rather than guessing, since a guessed duration would
  quietly desync the whole channel.
- `pages/admin.js` — link to `/admin/channel`
- `pages/index.js` — an "On the channel" banner when something's
  scheduled, next to the live-stream one if both are active
- `styles/globals.css` — appended

## How ad breaks work here

Unlike the live stream (ads on a timer), the channel's natural boundary is
already exactly where an ad break belongs: **between programs.** When one
episode ends, a house ad plays, then the next scheduled episode loads —
recomputed fresh from the server, not just "advance to the next index," so
a slow ad or a throttled tab can't cause creeping drift over a long
session. Toggle at `/admin/channel`.

## What to test

- Schedule 2–3 short free episodes, confirm `/channel` plays the right one
  at the right offset when you load it partway through
- Wait for a program to end naturally — confirm it cuts to a house ad,
  then picks up the next scheduled episode from wherever it should
  actually be by then (not from 0:00, unless that's genuinely where it is)
- Try scheduling a premium episode — should be rejected with a clear
  message
- Try scheduling an episode with a malformed or missing runtime — should
  be rejected rather than silently scheduled with a wrong duration
- Reorder with the up/down buttons, remove an entry, confirm positions
  stay contiguous (no gaps)
- Hit "Restart from the top," confirm the loop resets
- Load `/channel` with an empty schedule — clean "nothing scheduled" state,
  not an error

## Known follow-ups

- No admin preview before publishing a schedule change — edits go live
  for real viewers as soon as they're computed on the next request
- Safety-net drift correction polls every 45s; a very short program (well
  under a minute) could plausibly overlap the ad-break-then-reload cycle
  in an edge case — worth watching if you schedule very short clips
- This is genuinely Plan A: not frame-perfect synced across viewers, since
  each one independently loads and seeks its own copy of the current
  program. See LIVE-STREAMING-NOTES.md and the conversation this came
  from for what Plan B (true single shared stream) would need
