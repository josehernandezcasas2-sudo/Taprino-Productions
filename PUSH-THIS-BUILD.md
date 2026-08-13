# Full build — creator model change + two real bug fixes

## Verify by CONTENT after extracting, before pushing

```bash
cd ~/path/to/taprino-ott
git status
unzip -o ~/Downloads/taprino-full-build.zip -d .
```

Then run all six. First five must be **> 0**, the last must be **0**:

```bash
grep -c "src: e.src" pages/api/admin/library.js
grep -c "creator_applications" pages/api/apply.js
grep -c "repair-playback-urls" pages/api/admin/repair-playback-urls.js || grep -c "cloudflarePlaybackUrl" pages/api/admin/repair-playback-urls.js
grep -c "Submit your work" components/HeaderNav.js
grep -c "Access-Control-Allow-Credentials" pages/api/house-ads/vast.js
grep -c "setGenreOpen" components/HeaderNav.js
```

Then:
```bash
npm install && git add . && git commit -m "Application intake replaces self-serve upload; fix src mapping and playback URLs" && git push
```

## 1. Why your Cloudflare video ID "didn't save" — it always did

`pages/api/admin/library.js` **fetched** `src` from the database but then
**dropped it** when building the response. So the edit modal received
`undefined` every time and honestly reported "no video attached" — for
episodes that had one saved perfectly well the whole time. The save path
was never broken; the read path just never handed the field back.

One line. This is the actual cause of the symptom you described.

## 2. Why video won't play — the broken URLs are baked into your database

Fixing `CLOUDFLARE_STREAM_CUSTOMER_CODE` in Vercel only affects URLs
written **from that point on**. Every episode saved while it was wrong
still has the doubled, malformed URL sitting in its `src` column:

```
customer-customer-CODE.cloudflarestream.com.cloudflarestream.com/UID/...
```

Good news: the video UID survives intact inside that mess, so this is
automatically repairable — no re-entering IDs by hand.

**After you've fixed the env var in Vercel and redeployed**, run this once
from the browser console, signed in as admin:

```js
await fetch('/api/admin/repair-playback-urls', { method: 'POST' })
  .then(r => r.json()).then(console.log)
```

It rebuilds every Cloudflare URL correctly (including trailer and
audio-description URLs, which were malformed the same way), and refuses to
run at all if the env var still looks wrong — so it can't make things worse.

## 3. About the hero not playing video — this is by design, not a bug

`lib/heroCandidates.js` deliberately passes **only** `trailerSrc` to the
hero, never an episode's real `src`, with an explicit security comment
saying so. The reasoning: full episodes shouldn't be silently playable
from the homepage, bypassing the tier/paywall check.

So the hero plays a **trailer** if one exists, or a static `heroImage` if
set, and otherwise shows the thumbnail with nothing to play. That's exactly
the behaviour you're seeing.

To get motion in the hero, either upload a trailer for that episode, or set
a `hero_image`. If you'd rather the hero just play the full episode for
free-tier titles, that's a deliberate policy change and I'd rather you
decide it explicitly than have me quietly flip it.

## 4. Creator model: self-serve upload → application intake

**New:** `/apply` — a public form (no account needed, no file upload) where
creators describe their work and link to files wherever they already live.
`/admin/applications` — review queue with new/reviewing/accepted/declined
and a mailto link to reply.

**Nav changed:** "Submit an Episode" is gone. Signed-out visitors and
creators alike now see "Submit your work" → `/apply`. Existing creators
keep "Your numbers" (analytics).

**Deliberately NOT deleted:** everything under `pages/api/creator/` and
`pages/creator.js` still exist on disk, just unlinked from navigation. That
means no data loss, existing creators' submissions and analytics are
untouched, and this is reversible if you change your mind. Say the word and
I'll delete them properly — I didn't want to make that call unilaterally.

**Run migration `015_add_submissions_applications.sql`** for `/apply` to work.
