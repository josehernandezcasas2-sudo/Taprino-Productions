# Player rebuild — what changed and what you must do

## Files

**New**
- `pages/api/stream-token.js` — mints entitlement-checked playback tokens
- `pages/api/admin/sync-stream-protection.js` — one-shot catalog protection sync

**Rewritten**
- `components/VideoPlayer.js` — custom controls, gesture-triggered ads

**Modified**
- `lib/cloudflareUpload.js` — signed-URL helpers appended at the end
- `pages/episode/[id].js` — mints a signed URL for entitled premium viewers
- `styles/globals.css` — player styles appended at the end

No new environment variables. No schema migration.

## REQUIRED after deploying: run the protection sync once

Signing URLs protects nothing on its own. Until a video is marked
`requireSignedURLs` on Cloudflare's side, its plain
`/{uid}/manifest/video.m3u8` URL still plays for anyone who has it. Both
halves have to be true.

Sign in as an admin and run this once from the browser console on your site:

```js
await fetch('/api/admin/sync-stream-protection', { method: 'POST' })
  .then(r => r.json()).then(console.log)
```

It walks every episode, turns protection ON for premium and OFF for free, and
reports counts plus any failures. It's idempotent — re-run it any time you
change an episode's tier. (Wiring this into the tier-change path in
`edit-episode.js` is the obvious follow-up so it stops being manual.)

**Both directions matter.** An episode moved from premium back down to free
with protection still on plays as a black box for every free viewer, and it
fails silently. The sync handles that case too.

## What to test

**Free episode**
- Nothing happens until you press play — no ad fires on page load anymore
- Pre-roll plays, ad bar shows "Ad 1 of N" and a countdown
- Content resumes automatically when the ad finishes
- With an ad blocker on, the episode plays anyway (fails open, by design)

**Premium episode as a subscriber**
- Plays normally
- The `.m3u8` in the network tab is a long token, not a short uid
- Copy that URL into a private window: it plays *for now* but dies within
  4 hours, instead of working forever

**Premium episode as a non-subscriber**
- Lock panel, no src in the page source (unchanged)
- `POST /api/stream-token {episodeId}` returns 403

**Controls**
- Space/K play, ←/→ 10s, ↑/↓ volume, M mute, F fullscreen
- Controls auto-hide after 3s of playback, return on move/tap
- Quality menu lists real renditions once the manifest parses
- Tab through the controls — focus ring should be visible on each

**iPhone specifically**
- Fullscreen hands off to Apple's native player and our controls disappear.
  That's a platform limit, not a bug — every custom web player has it.

## Known follow-ups
- Captions/subtitles: no track UI yet. Add `<track>` elements plus a CC
  button when you have caption files.
- Signing currently costs one Cloudflare API call per premium page load. If
  that ever matters, switch to locally-signed JWTs using a Stream signing key
  (`POST /stream/keys`) — same URL shape, no per-play network call.
- Free episodes are intentionally unsigned, so their URLs remain shareable.
