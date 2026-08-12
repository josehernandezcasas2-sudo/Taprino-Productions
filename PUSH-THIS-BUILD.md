# This is the full current build — not a patch

Everything from this whole conversation, layered together into one
complete copy of the project: mobile tab bar, custom video player with
signed URLs, legal pages, creator analytics, accessibility (captions +
audio description), video-by-link import, the house-ads system (direct
upload and Cloudflare-catalogue), live streaming, and the linear channel.

Every file in this zip compiles cleanly — I ran a full syntax check across
every `.js` file in `pages/`, `lib/`, `components/`, and `contexts/` right
before packaging it, not just the files touched in the most recent patch.

## How to push this

You said you haven't pushed much since we started, so the simplest and
safest path is to **replace your local project folder's contents with
this**, rather than try to hand-merge nine patches on top of each other.

```bash
# 1. Go to where your local clone lives
cd ~/path/to/taprino-ott

# 2. Make sure you're not about to lose anything of your own.
#    If this shows changes YOU made locally that weren't part of any
#    patch I gave you, stop and tell me before continuing.
git status

# 3. Back up just in case (cheap insurance, costs nothing)
cd ..
cp -r taprino-ott taprino-ott-backup-$(date +%Y%m%d)
cd taprino-ott

# 4. Unzip this build over your project folder, replacing files
unzip -o ~/Downloads/taprino-full-build.zip -d .
#    (adjust the source path to wherever this zip actually downloaded)

# 5. Reinstall dependencies — nothing new was added, but this keeps
#    node_modules in sync with package.json regardless
npm install

# 6. Commit everything as one push
git add .
git commit -m "Add player, legal pages, accessibility, house ads, live streaming, and channel"
git push
```

Vercel will pick up the push automatically if it's connected to this repo,
the same as always.

## Run these migrations, in order, before or right after you push

In your Supabase project's SQL editor, run whichever of these you haven't
already applied — they're numbered and safe to run in sequence:

```
009_add_captions.sql
010_add_audio_description.sql
011_add_house_ads.sql
012_add_house_ad_cloudflare_uid.sql
013_add_live_streams.sql
014_add_channel_schedule.sql
```

All additive — nullable columns and new tables only. Nothing here alters
or drops anything that already exists, so there's no destructive step to
be careful about.

## One manual step after deploying — not optional

Signed URLs protect nothing until you run this once, signed in as admin,
from your browser console on the live site:

```js
await fetch('/api/admin/sync-stream-protection', { method: 'POST' })
  .then(r => r.json()).then(console.log)
```

This is what actually turns on Cloudflare's `requireSignedURLs` for every
premium episode. Skipping it means the player *looks* like it's protecting
premium video, but the old permanent public URLs still work for anyone who
has them.

## Everything else — README pointers

Each feature has its own detailed notes file, all included in this zip at
the project root, in case you want the full reasoning behind any one of
them without digging through the chat history:

- `SIGNED-URLS-SETUP.md` — the player rebuild
- `LEGAL-AND-ACCESSIBILITY-NOTES.md` — terms/privacy/cookies, captions v1
- `CAPTIONS-AND-AD-NOTES.md` — caption uploads, audio description
- `VIDEO-LINK-IMPORT-NOTES.md` — importing video by URL
- `DOMAIN-CHECKLIST.md` — what actually needs a real domain vs. doesn't
- `HOUSE-ADS-NOTES.md` — your own ad system
- `HOUSE-ADS-CLOUDFLARE-CATALOGUE.md` — the resumable-upload upgrade
- `LIVE-STREAMING-NOTES.md` — RTMPS broadcasting + timed ad breaks
- `CHANNEL-NOTES.md` — the linear/looping channel

## If `git push` gives you trouble

Paste me the exact error and I'll walk through it with you.
