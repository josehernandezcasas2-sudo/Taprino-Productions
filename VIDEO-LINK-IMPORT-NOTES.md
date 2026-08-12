# Patch — import video by link, domain checklist

No migration needed. No new environment variables.

## The domain checklist

`DOMAIN-CHECKLIST.md` in this zip. Built by grepping the actual repo for
domain references rather than written generically — it separates what
works today on any domain (including Vercel's free `.vercel.app`) from
what's genuinely gated on owning the real one (Clerk production, Stripe's
webhook registration, Resend sending, AdSense).

The short version: you can register a cheap placeholder domain, or use
`.vercel.app`, and do everything except those four. Vercel supports
multiple domains per project and lets you swap the primary any time, so
buying the real domain later costs about 20 minutes of reconfiguration —
mainly Clerk issuing new keys, which signs everyone out once.

## Importing video by a link, instead of uploading

This is a genuinely different transfer, not a workaround bolted onto the
existing uploader. The complaint was that TUS's chunked PATCH requests get
blocked by some firewalls — the fix is to stop the creator's browser from
doing the transfer at all. Cloudflare's own infrastructure fetches the file
server-to-server instead.

**This is not the same as embedding the link.** The URL is used exactly
once, to pull the file into Cloudflare Stream. After that it's transcoded
and stored there like any normal upload — same HLS manifest, same
`sync-stream-protection` signed-URL system from the player patch, same
`nodownload` controls. The original link doesn't need to keep working
afterward, and nobody watching the episode ever sees or can reach it. A
creator's private Dropbox/Drive/WeTransfer link is never exposed to viewers.

**What works as a link:** a direct file URL — ends in `.mp4`/`.mov`/etc., or
a signed download link from Dropbox, Google Drive, WeTransfer, or S3 that
resolves straight to the file.

**What doesn't:** a page that merely *shows* a video, like a YouTube watch
URL. There's no single file at that address for Cloudflare to fetch — this
is about moving a file creators already have somewhere, not importing from
other platforms.

## New files

- `lib/urlValidation.js` — rejects private/internal addresses and malformed
  input before anything is sent onward (unit-tested against 10 cases,
  including localhost, private IP ranges, credentials-in-URL, and bad
  schemes — all passed)
- `pages/api/creator/import-video-url.js` — starts the Cloudflare import,
  rate-limited to 10/hour (tighter than regular uploads, since each call
  costs real Cloudflare storage on your account)
- `pages/api/creator/video-status.js` — polled while Cloudflare fetches
  and transcodes

## Modified

- `lib/cloudflareUpload.js` — `createCloudflareVideoFromUrl()` appended
- `contexts/UploadContext.js` — `startUrlImport()` added *alongside*
  `startUpload()`, not merged into it. The progress models are genuinely
  different (Cloudflare's own percentage, polled, vs. byte counts we
  control), and keeping them separate means this can't destabilize the
  existing TUS/basic-upload machinery, which already handles a lot of
  real-world flakiness on its own.
- `components/UploadStatusWidget.js` — an "importing" state, showing
  Cloudflare's fetch percentage when it reports one
- `pages/creator.js` — "Upload a file" / "Import from a link" toggle above
  the video picker
- `styles/globals.css` — appended

## What to test

- Paste a real direct `.mp4` URL, submit, confirm the widget shows
  "Importing from your link…" and the submission appears once done
- Paste a YouTube watch URL — should fail clearly at the Cloudflare step
  rather than hang
- Paste `http://localhost/x.mp4` or a private IP — rejected immediately,
  before any request to Cloudflare
- Confirm runtime is required in link mode (there's no file to
  auto-detect it from) and that submission blocks without it
- Confirm the resulting episode plays exactly like an uploaded one, and
  that `sync-stream-protection` still applies correctly if it's premium

## Known limitation

No trailer support for link imports yet — kept out of scope to ship this
cleanly. A creator using this path submits without a trailer for now.
