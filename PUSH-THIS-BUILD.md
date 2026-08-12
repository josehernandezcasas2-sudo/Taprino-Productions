# Full build — read this before extracting

The last two attempts each had files that silently didn't make it into the
live deploy, even though they were confirmed present in the zip. This time,
verify by **content**, not just by whether the file exists — a stale file
still "exists," it just has the wrong contents inside it, which is exactly
what happened to `public/sw.js` and `components/AdminEditEpisodeModal.js`
last time.

## Extract — Terminal only, still, no Finder

```bash
cd ~/path/to/taprino-ott
git status                      # stop if this shows unexpected local changes
cd .. && cp -r taprino-ott taprino-ott-backup-$(date +%Y%m%d-%H%M) && cd taprino-ott
unzip -o ~/Downloads/taprino-full-build.zip -d .
```

## Verify by CONTENT before committing — this is the step that would have
## caught last time's problem

Run every one of these. Each should print a number **greater than 0**.
If any prints `0`, that specific file did not actually get replaced —
stop, tell me which one, and don't push yet.

```bash
grep -c "isCacheable" public/sw.js
grep -c "admin-video-status" components/AdminEditEpisodeModal.js
grep -c "Access-Control-Allow-Credentials" pages/api/house-ads/vast.js
grep -c "src," pages/api/admin/library.js
grep -c "setGenreOpen" components/HeaderNav.js
```

That last one is the one that should print **`0`** — its whole point is
confirming the bad reference is gone, not present.

## Then push

```bash
npm install
git add .
git commit -m "House ads CORS fix, service worker cross-origin fix, admin modal redesign"
git push
```

## The Cloudflare env var — separate from any of this, still needs doing
## in Vercel directly, not in the code

If you haven't already: **Vercel → Settings → Environment Variables** →
`CLOUDFLARE_STREAM_CUSTOMER_CODE` → change the value to just the code
itself (e.g. `6lw3ib81r72mjyar`), not the full subdomain. Save, then
redeploy for it to take effect. Nothing in this zip can fix that one — it
lives entirely in Vercel's dashboard.

## What changed in this specific patch

- **CORS, corrected properly this time.** The first fix (`Access-Control-
  Allow-Origin: *`) was necessary but not sufficient — the browser also
  rejects `*` specifically when a request's credentials mode is
  `include`, which is what your second error showed. Fixed by reflecting
  the actual requesting origin back instead of using the wildcard.
- Everything from the previous two patches, unchanged: the service worker
  cross-origin skip, the `setGenreOpen` removal, the admin edit modal
  redesign + video-status check, `src` added to the admin library query.

## What to test after deploying

- Play a free episode — house ad should load with no CORS error in console
  at all now (check for both the old error and the new wildcard-specific
  one — neither should appear)
- Open the edit modal on any episode — should show the redesigned styled
  form with the video-status banner at the top, not the old plain-white-box
  version
- Click anywhere on the site — no `setGenreOpen` error in console
