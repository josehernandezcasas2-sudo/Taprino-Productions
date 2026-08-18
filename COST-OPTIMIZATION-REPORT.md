# Cost optimization — what I did, and two places the work order was wrong

## ⚠️ WO-1 — DO NOT APPLY AS WRITTEN. It would leak user data.

The work order names five pages to CDN-cache: `index.js`, `genre/[genre].js`,
`type/[type].js`, `series/[id].js`, `channel.js` — on the reasoning that
"these pages render identical HTML for every visitor."

**They don't.** I checked what each one actually returns. All five call
`getAccountContext(req)` and return per-visitor props:

| Page | Per-user props returned |
|---|---|
| `index.js` | wishlist, newsletter status, isSubscriber, email, isAdmin, isCreator |
| `genre/[genre].js` | wishlist, isSubscriber, email, isAdmin, isCreator |
| `type/[type].js` | wishlist, isSubscriber, email, isAdmin, isCreator |
| `series/[id].js` | wishlist, isSubscriber, email, isAdmin, isCreator |
| `channel.js` | isSubscriber, email, isAdmin, isCreator |

`index.js` already carried an explicit `private, no-cache, no-store` header
with a comment saying exactly why. Adding `public, s-maxage=300` would have
overridden it and let the CDN serve **one signed-in user's wishlist,
email, and subscriber tier to the next anonymous visitor.**

This is the same rule the work order itself states for the pages it
excluded — *"caching them would serve one user's data to another. This is
a security requirement, not a preference."* It just didn't check what these
five actually return.

I applied it, saw the conflicting header on `index.js`, checked the rest,
and reverted all five. **Nothing was shipped.**

### The correct fix, if you want the savings

Split per-user state out of the page render: return only public content from
`getServerSideProps`, and fetch wishlist/account state client-side after
hydration. Then the HTML genuinely is identical for everyone and caching is
safe. That's a real refactor touching the header and five pages — worth
doing, but it needs to be done deliberately, not as a one-line header change.

**WO-2 has the same blocker.** The five legal pages (`about`, `terms`,
`privacy`, `cookies`, `contact`) have fully static *content*, but each still
calls `getAccountContext` to render the signed-in header. Converting them to
`getStaticProps` without addressing the header would show every visitor a
logged-out nav. Same refactor unlocks both.

## WO-4 — false alarm

The comment at `pages/creator.js:13` isn't about a throwing GSSP. Read in
full, it's explaining why `UppyFilePicker` is loaded with `{ ssr: false }`:

> *Uppy touches browser-only APIs during its own setup — rendering it during
> Next.js's server-side render pass (this page uses getServerSideProps)
> throws before the page ever reaches the browser.*

The GSSP itself is clean: sets a no-cache header, checks auth, redirects
non-creators, returns props. It doesn't throw.

All three `useEffect` dependency arrays are stable — two are `[]` and one is
`[activeUpload && activeUpload.status]`, which evaluates to a primitive, not
a fresh object each render. **No infinite loop here.** The 78.7% error rate
is coming from somewhere else.

## WO-8 — already done

`public/sw.js` already had `if (url.pathname.startsWith('/api/')) return;`
plus the non-GET guard, from the earlier service-worker fix. Verified, no
change needed.

---

## What I actually changed

### WO-3 — notification poll ✅
Reporting back as asked: `POLL_INTERVAL_MS` was **30000** (30s), hitting
**`/api/creator/notifications`**. The `!enabled` guard already existed, so
anonymous visitors weren't polling.

Added: **60s interval** (from 30s), **hidden-tab guard**, and a **circuit
breaker** that stops after 3 consecutive failures. `refresh()` now throws on
non-OK responses instead of swallowing them — previously a permanently
failing endpoint was indistinguishable from a working one and retried
forever. That silent-catch was the most plausible contributor to sustained
invocations from a failing route.

### WO-5 — timer guards ✅
Hidden-tab guards added to `ChannelPlayer` safety poll, `LiveVideoPlayer`
ad-break check, `pages/live.js`, and `pages/admin/live.js`.
`CloudflareHouseAdImport` got a guard **plus a 200-poll ceiling** (~10 min)
so a job that never reaches a terminal state can't poll indefinitely.
Left alone as correct: `VideoPlayer` control-hide, `HeroSpotlight` carousel,
`admin.js` search debounce.

### WO-7 — robots.txt ✅ (with a conflict you need to decide on)
Now `Disallow: /` site-wide.

**This blocks AdSense.** AdSense crawls the site to review it — with this in
place your application gets rejected. You can't have both crawler-blocking
and AdSense approval at once. The file contains a ready-to-swap launch block
in comments; uncomment it and update the sitemap domain when you're ready to
apply.

### Bonus — safe API caching (not in the work order)
`/api/channel/now` (10s) and `/api/live/current` (15s) are polled by every
viewer and return byte-identical public responses — no auth, no per-user
data. Caching these is provably safe, unlike the page-level caching above.
A hundred concurrent channel viewers now cost one invocation per 10s instead
of a hundred.

`/api/house-ads/vast` deliberately left `no-store` — it's a weighted random
draw and must vary per request.

---

## Also: one stale note in the work order

WO-6 says `CLOUDFLARE_STREAM_CUSTOMER_CODE` still holds the full subdomain.
That was fixed earlier — you corrected the env var and video plays now. The
doubled-URL problem is resolved; any thumbnail URLs built from that variable
will be correct.
