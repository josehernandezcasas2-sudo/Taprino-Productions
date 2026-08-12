# Patch — house ads via Cloudflare, for a real catalogue

## Run this migration

`supabase/migrations/012_add_house_ad_cloudflare_uid.sql` — one nullable
column, additive only.

(Requires `011_add_house_ads.sql` from the previous patch already applied.)

## What changed

The admin house-ads form now offers two ways to add a clip, side by side:

- **Quick upload** — the original path. Inline, instant, capped at 8MB.
  Still there, still the fastest option for a short simple clip.
- **Import via Cloudflare** — new. Resumable TUS upload, no practical size
  limit, the same infrastructure episodes already use. This is the one
  worth using for building out an actual catalogue over time rather than
  one-off clips.

Nothing about how ads are *served* changed — `/api/house-ads/vast` still
serves a plain MP4 `<MediaFile>` either way. The difference is only in how
that MP4 gets created.

## Why this needed a bridge, not just "point at Cloudflare"

Cloudflare Stream's native playback is HLS — great for episodes, but VAST
wants a direct, playable file, not an adaptive manifest. Cloudflare's
"downloads" feature is the bridge: enable it on a video, wait for
Cloudflare to produce a plain MP4 rendition, then use that URL exactly like
any other MediaFile. `ensureCloudflareDownloadUrl()` in
`lib/cloudflareUpload.js` drives that whole sequence — kicks it off,
reports progress, hands back the final URL once it's ready.

That's also why this is a real wait, not instant: a clip goes through two
stages after upload — Cloudflare transcoding it (same as an episode), then
generating the downloadable version (a second step that only starts once
the first finishes). The import UI shows which stage it's in rather than
one undifferentiated spinner.

## Security note

The admin's browser only ever learns a Cloudflare `uid` and polls a status
endpoint for it — never a raw URL it could hand back to the server. When
the ad is actually created, `pages/api/admin/house-ads.js` looks up the
playable URL **fresh, from Cloudflare, server-side** rather than trusting
anything the client sent. There's no way a crafted request could point a
house ad at an arbitrary external file.

## New files

- `pages/api/admin/house-ads-cloudflare-upload-url.js` — admin-gated,
  mirrors the creator upload-URL endpoint, 2GB ceiling (generous —
  these are your own promos, not arbitrary uploads)
- `pages/api/admin/house-ads-cloudflare-status.js` — polled while
  Cloudflare processes; reports `transcoding` → `preparing_download` →
  `ready`
- `components/CloudflareHouseAdImport.js` — the upload + polling UI,
  deliberately self-contained rather than hooked into the shared
  `UploadContext` creator uploads use. An admin adding to the catalogue is
  expected to stay on the page for one upload; that context exists
  specifically to survive a creator navigating away mid-upload, which
  doesn't apply here.

## Modified

- `lib/cloudflareUpload.js` — `enableCloudflareDownloads`,
  `getCloudflareDownloadStatus`, `ensureCloudflareDownloadUrl` appended;
  `getCloudflareVideoStatus` now also returns `duration` when known, so a
  Cloudflare-imported ad can skip manual duration entry
- `pages/api/admin/house-ads.js` — accepts `cloudflareUid` as an
  alternative to `videoBase64`
- `components/HouseAdForm.js` — the two-mode toggle
- `styles/globals.css` — appended

## What to test

- Upload a >8MB clip through "Import via Cloudflare" — quick upload would
  reject it; this path shouldn't
- Watch the stage labels progress: uploading → processing → preparing the
  download → ready
- Confirm duration pre-fills once ready, and that you can still override it
- Create the ad, confirm it plays as a pre-roll same as any quick-uploaded
  one
- Try submitting before the Cloudflare import finishes — should be blocked
  with a clear message, not silently fail
