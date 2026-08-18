# WO-1 and WO-2 — done, but not as written. Plus WO-4 findings.

## ⚠️ WO-1 as written would have leaked user data

**I did not apply it as specified.** The work order says these five pages
"render identical HTML for every visitor." They don't.

All five return `email`, `isSignedIn`, `isSubscriber`, `isAdmin`, and
`wishlist` in their props. Adding `Cache-Control: public, s-maxage=300`
would let Vercel's CDN serve the first visitor's rendered HTML — **their
email address, wishlist, and admin status** — to every subsequent visitor
for five minutes.

That's the exact failure the document itself warns about for `/admin` and
`/account`. It just misidentified which pages are personalized.
`pages/index.js` even carried a comment explaining this, directly above the
line the work order asked to replace:

```js
// Personalized per visitor (newsletter status, wishlist, subscriber tier) —
// never let a browser, proxy, or CDN cache this...
res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
```

### What I did instead

Session-aware caching. Signed-out visitors get a cached response; anyone
with a session cookie gets `no-store` as before:

```js
const hasSession = Boolean(req.headers.cookie && /__session|__clerk/.test(req.headers.cookie));
if (hasSession) {
  res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
} else {
  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
  res.setHeader('Vary', 'Cookie');
}
```

`Vary: Cookie` is what keeps the two populations in separate cache entries —
without it the CDN would still risk crossing them. Verified present on all
ten pages.

**This captures essentially all of the intended saving.** Signed-out traffic
is the overwhelming majority, and it's all of the bot and crawler traffic
that's driving the invocation count. Signed-in users are a handful of people.

`channel.js` got 60s rather than 300s — what's on air genuinely changes as
programmes roll over, so a stale five minutes would show the wrong thing.

## WO-2 — flagged as the document asked

The work order said: *"if a GSSP reads req.headers for locale or auth
state, flag it rather than converting."*

All five legal pages do exactly that — they fetch account context so the
header nav renders correctly for signed-in users. Converting to
`getStaticProps` would break the header on every legal page.

So same session-aware treatment, with a **1-hour TTL** (legal text changes
a few times a year) and 24h stale-while-revalidate. Same saving, no
regression.

## WO-4 — investigated, hypothesis doesn't hold

**The line 13 comment is not about a throwing GSSP.** Read in context, it
explains why `UppyFilePicker` is dynamically imported with `ssr: false`:

```js
// getServerSideProps) throws before the page ever reaches the browser.
// { ssr: false } skips that entirely: the component only ever renders
// client-side, after hydration.
const UppyFilePicker = dynamic(() => import('../components/UppyFilePicker'), { ssr: false });
```

The actual GSSP (line 29) is healthy: sets no-store, checks `isCreator`,
redirects non-creators. No throw path.

**All three effects have stable dependencies:**
- line 166 — `[]`
- line 253 — `[]`
- line 259 — `[activeUpload && activeUpload.status]`, which evaluates to a
  string or `undefined`. A primitive, so stable. Not an object literal.

**No infinite re-render loop here.** The 78.7% error rate is coming from
somewhere else — worth capturing the top erroring route from Vercel's
Functions view rather than guessing further.

## Already done in this copy — verify against your repo

WO-3 (60s poll + `document.hidden` + creator-only), WO-5 (guards on
ChannelPlayer, LiveVideoPlayer, live.js, admin/live.js), WO-7 (robots
`Disallow: /`), and WO-8 (`/api/` skip in sw.js) are **already present**.

Since you've pushed since my last build, confirm these are in your repo too
before assuming they're live.

## Not done: WO-6

Cloudflare images. Genuinely the largest piece, and the work order is right
that it should come last. Also worth noting its own warning: fix
`CLOUDFLARE_STREAM_CUSTOMER_CODE` in Vercel first or the thumbnails will
404.

## Files in this patch — 10, additive only
`pages/index.js`, `pages/genre/[genre].js`, `pages/type/[type].js`,
`pages/series/[id].js`, `pages/channel.js`, `pages/about.js`,
`pages/terms.js`, `pages/privacy.js`, `pages/cookies.js`,
`pages/contact.js`
