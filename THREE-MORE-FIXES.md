# Patch — Join button, live-stream auto-hide controls, and one thing worth checking

## The "Join Studio Tapa +" button — a real service worker bug, found and fixed

The console showed `Failed to fetch at sw.js` for the navigation to
`/account`. Traced it to a real gap: when a live network fetch fails *and*
nothing's cached yet for that page — true the first time anyone visits
`/account` in a given browser — the fallback tried to hand the browser
`undefined` instead of an actual cached Response, which produces exactly
this "Failed to fetch" error. Fixed to re-throw properly when there's
truly nothing to fall back to, so the browser's own native error handling
takes over instead of a broken worker silently eating the failure.

**Separately, found while checking this area (not the cause of the button
issue, but a real bug):** on the account page, one string used regular
quotes instead of a template literal — `{SITE.premiumTier}` was sitting
inside plain text and rendering as the literal characters `{SITE.
premiumTier}` rather than "Studio Tapa +". Fixed.

## Auto-hide controls — VOD already had it, live stream didn't

Checked both players. `VideoPlayer.js` (regular episodes) already has a
complete, working auto-hide implementation — controls fade 3 seconds after
the mouse stops moving during playback, and mouse movement or a touch
brings them right back. `LiveVideoPlayer.js` had this hardcoded to always
show. Ported the exact same pattern over — same timing, same behavior,
just built for the live player's own state instead of sharing code (this
component is deliberately separate from the VOD player already, for
reasons documented in its own file).

**Not touched:** the channel player. Different constraints (no seek,
read-only progress) — worth doing too if you want it, just didn't want to
assume that was included in "video and live stream."

## The footer — I need one thing confirmed before I can tell what's wrong

I checked my reference copy directly — the edge-to-edge footer fix from a
few rounds back is still there, unchanged. Given how many pushes have hit
snags recently (the .env.local.example issue, the reset), it's worth
confirming: **did the content-lifecycle push from two rounds ago actually
succeed?** If that push never went through, the footer fix (and everything
else in that batch) simply isn't live yet — which would fully explain
what you're seeing, and needs nothing further from me, just getting that
push through. If it did succeed and the footer still doesn't reach the
edges, tell me and I'll look at the actual live HTML rather than guess.

## Files changed
`components/LiveVideoPlayer.js`, `pages/account.js`, `public/sw.js`
