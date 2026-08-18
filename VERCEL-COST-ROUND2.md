# Further Vercel cost investigation

## WO-6 turns out to be moot

The work order assumes `next/image` is in use and drives Fast Origin
Transfer. Checked directly: **`next/image` isn't used anywhere in this
codebase.** Every image is a plain `<img>` tag. There's also no
`next.config.js` at all, so there's no image-domains config to speak of
either.

So there's nothing to convert, and Vercel Image Optimization isn't costing
you anything — it was never in the request path. Whatever's driving Fast
Origin Transfer, it isn't this.

## Found and fixed: homepage GSSP had two unnecessary sequential awaits

`getAccountContext(req)` and (when Redis is configured) `getViewCounts()`
were both fetched **after** the page's main `Promise.all`, even though
neither depends on anything in it — account context doesn't need episode
data, and view counts don't need account data. They were stacking latency
that could have overlapped instead.

Folded both into the same parallel batch. Same values, same logic,
nothing else changed — just less time spent idle waiting on I/O that
didn't need to happen in sequence. Fluid compute bills for how long a
function is actually running, including time spent awaiting a response, so
shortening that window is a direct, if modest, saving on your busiest page.

## Checked and confirmed correct — not touched

**The episode page's "awaited" Redis write.** At first glance this looks
like exactly the kind of blocking call worth removing. It isn't — the
comment already there is accurate, not aspirational: `recordView` swallows
its own errors internally (verified in `lib/redis.js`), so it can't throw
and break the page. It's awaited specifically because Vercel can freeze a
serverless function's background work the moment the response is sent —
an un-awaited call risks silently never completing. This is a deliberate,
correct tradeoff against a real platform constraint, not a bug to fix.

**`middleware.js`.** Matches Clerk's own published recommended pattern
exactly, including explicitly force-including API routes rather than
relying on a general static-file exclusion to happen to cover them. Correct
as written.

**No server-side media proxying anywhere in `pages/api/`** — confirmed by
grep. Whatever's contributing to origin transfer, it isn't a route
re-streaming Cloudflare or Supabase media through a Vercel function.

## What I'd actually check next, and can't from here

I don't have access to your Vercel dashboard, so I can't see the real
breakdown of what's driving Fast Origin Transfer or the remaining
invocation count. The verification steps in the original work order are
still the right next move:

1. Deploy this, close every tab, wait 30 minutes
2. Vercel → Observability → Functions → sort by Invocations, 24h window
3. If invocations are still high with the site closed, capture the top
   route from Functions and the top path from Edge Requests and send them
   over — that's server-side or bot traffic, not anything client-side
   left to fix, and I'd want to see the actual route before guessing
   further.

## Files changed
`pages/index.js` only.
