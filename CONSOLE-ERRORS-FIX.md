# Patch — three real bugs from your latest console dump, plus one config fix

## 1. House ads were completely broken — CORS, not a real ad problem

```
Access to fetch at '.../api/house-ads/vast' from origin 'https://imasdk.googleapis.com'
has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present
```

Google's IMA SDK runs from `imasdk.googleapis.com` and fetches your VAST
endpoint **cross-origin** — that's just how ad tags work, every real ad
network's endpoint sends CORS headers for exactly this reason. I missed
this when building `/api/house-ads/vast.js` originally. Fixed now — added
`Access-Control-Allow-Origin: *` to it and to the impression/click tracking
endpoints too, since IMA fetches those cross-origin as well. Nothing
sensitive in any of these responses, so there's no security cost to this.

This also very likely explains the `AbortError: play() request was
interrupted by pause()` noise on the episode page — once the ad request
was failing, the fail-open logic and the content player were both trying
to start/stop playback in quick succession. Should resolve as a side
effect of this fix; nothing else changed there.

## 2. The service worker had no business touching cross-origin requests

```
The FetchEvent for '...clerk.browser.js' resulted in a network error...
Uncaught (in promise) TypeError: Failed to fetch at sw.js:63
```

`sw.js`'s fetch handler was only skipping `/api/` paths and non-GET
requests — it had no same-origin check at all. That means **every**
cross-origin request anywhere on the page — Clerk's own auth script,
Cloudflare Stream's video manifests, Google's ad SDK — was being funneled
through our caching logic, which was never built to handle traffic that
isn't this app's own. Added one line: skip anything whose origin doesn't
match the site's own. Cross-origin requests now go straight to the network
exactly as if no service worker were installed, which is the only correct
behavior for traffic this file was never meant to reason about.

## 3. `setGenreOpen is not defined` — the bug from a few messages back

Finally shipped the fix I diagnosed earlier: `HeaderNav.js` had a leftover
call to `setGenreOpen`, a state setter that no longer exists in the
component. It fired on every click anywhere on the site. Removed.

## 4. This one needs a config change in Vercel, not code

```
customer-customer-6lw3ib81r72mjyar.cloudflarestream.com.cloudflarestream.com
```

Notice `customer-` and `.cloudflarestream.com` each appear **twice**. The
code builds this URL as:
```
https://customer-${CLOUDFLARE_STREAM_CUSTOMER_CODE}.cloudflarestream.com/...
```
So if `CLOUDFLARE_STREAM_CUSTOMER_CODE` in Vercel is set to the **full
subdomain** (`customer-6lw3ib81r72mjyar.cloudflarestream.com`) instead of
just the **code** (`6lw3ib81r72mjyar`), you get exactly this doubled,
broken URL. I reproduced it character-for-character to confirm before
writing this up — it's not a guess.

**Fix, in Vercel → Settings → Environment Variables:**
Find `CLOUDFLARE_STREAM_CUSTOMER_CODE` and change its value to **just**
the code portion — the part between `customer-` and `.cloudflarestream.com`
in any existing video URL from your Cloudflare dashboard. Using your log as
the example, that's:
```
6lw3ib81r72mjyar
```
Not the full URL, not the full subdomain — just that string. Save, and
Vercel will prompt you to redeploy for the env var change to take effect.

## Files changed

- `pages/api/house-ads/vast.js`, `impression.js`, `click.js`
- `public/sw.js`
- `components/HeaderNav.js`

## What to test after deploying

- Play a free episode — the house ad pre-roll should actually load and
  play now, no CORS error in console
- Click anywhere on the site, check console — no more `setGenreOpen` error
- Reload a couple of times — Clerk sign-in should behave normally, no
  "failed to load Clerk" errors
- After fixing the env var and redeploying: open "Ashton's cut" (or
  whichever episode hit the malformed URL) and confirm it actually plays
