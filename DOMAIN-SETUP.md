# Domain setup — every service that needs it, and exactly where

You mentioned buying a domain through Vercel and possibly already adding
it. If you bought it *through* Vercel, it's likely already attached to the
project and DNS is handled automatically — that's the one advantage of
buying there rather than at a separate registrar.

**Check first:** Vercel → your project → **Settings → Domains**. If your
domain is listed with a green "Valid Configuration", step 1 is already done
and you can skip to step 2.

---

## 1. Vercel — attach it and make it primary

**Settings → Domains**

- Add the domain if it isn't listed
- Add both `yourdomain.com` and `www.yourdomain.com`; set one as primary
  and Vercel redirects the other automatically
- Wait for "Valid Configuration" before touching anything below — every
  other service verifies against a live domain, so doing them first just
  means redoing them

## 2. Clerk — production mode ⚠️ this one signs everyone out

**Clerk Dashboard → your app → Domains**, then switch the instance from
Development to Production.

Clerk issues **new keys** when you do this. Copy both into Vercel →
Settings → Environment Variables, replacing the existing values:

- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- `CLERK_SECRET_KEY`

Then redeploy. **Every existing session is invalidated** — you and anyone
else signed in will need to log in again, once. Expected, not a bug.

This also clears the "Clerk has been loaded with development keys" console
warning you've been seeing.

## 3. Stripe — webhook endpoint

**Stripe Dashboard → Developers → Webhooks → Add endpoint**

- URL: `https://yourdomain.com/api/webhook`
- Events: the same ones your existing endpoint listens for (checkout and
  subscription events)
- Copy the new **signing secret** into `STRIPE_WEBHOOK_SECRET` in Vercel

Leave the old `.vercel.app` endpoint in place until you've confirmed the
new one fires — Stripe is happy with multiple endpoints, and deleting the
old one first means a window where subscription updates silently don't
land.

## 4. Resend — verify the sending domain

**Resend Dashboard → Domains → Add Domain**

Add `studiotapa.com` (or whichever domain the mail should come from), then
add the DNS records it gives you — SPF and DKIM at minimum. If the domain
is on Vercel DNS, add them under Vercel → Settings → Domains → your domain
→ DNS Records.

Until this verifies, `/api/notify-series-drop` silently does nothing rather
than failing loudly — so nothing breaks meanwhile, it just doesn't send.

Then set `RESEND_FROM_EMAIL` in Vercel to something on that verified domain
(e.g. `hello@studiotapa.com`).

## 5. Google AdSense — resubmit

Once the domain is live and pointing at the site, submit **the custom
domain**, not the `.vercel.app` URL. Being on a free subdomain is one of
the most common rejection triggers.

Also confirm `https://yourdomain.com/ads.txt` loads and shows your
publisher ID.

## 6. `lib/siteConfig.js` — set `productionDomain`

```js
productionDomain: 'https://yourdomain.com',
```

Used for canonical URLs. The sitemap derives its origin from the incoming
request instead, so it's already correct on any host — this is belt and
braces for metadata.

## 7. `public/robots.txt` — update the sitemap line

It currently points at the `.vercel.app` URL. Change to:
```
Sitemap: https://yourdomain.com/sitemap.xml
```

## 8. Google Search Console — verify and submit

Not required, but it's how you find out whether Google can actually crawl
the site, and AdSense review goes better on a site Google has already
indexed. Add the property, verify (Vercel DNS makes this a one-record job),
and submit `https://yourdomain.com/sitemap.xml`.

---

## Needs nothing — genuinely domain-agnostic

**Supabase, Cloudflare Stream, Upstash Redis.** Nothing in this codebase
hardcodes a URL for any of them, and none care what host the site runs on.
No action, now or later.
