# Domain checklist

Every place a domain is referenced or configured, found by grepping the
actual codebase — not a generic list. Two columns: what to do **now**, on
whatever domain (or Vercel's free `.vercel.app` subdomain) you're using
today, and what to redo **later** when you switch to your real domain.

Vercel supports multiple domains per project simultaneously, and lets you
swap which one is primary at any time — so buying and wiring up a cheap
placeholder now, then adding the real one later, costs you about 20 minutes
of reconfiguration, not a rebuild.

## Now — works on any domain, including `*.vercel.app`

- [ ] **Vercel project** — deploy normally. `yourproject.vercel.app` works
      for everything below immediately, no purchase required.
- [ ] **Clerk (development mode)** — already works against a `.vercel.app`
      URL or `localhost`. This is the mode you're in today; nothing to
      change yet.
- [ ] **Supabase, Upstash, Cloudflare Stream** — none of these care what
      domain the site is on. Nothing to do here, ever, regardless of domain.
- [ ] **Stripe test mode** — checkout and the customer portal both work
      against any URL, including `localhost`, because Stripe redirects
      back to whatever URL your server tells it to.

## When you register the real domain

- [ ] **Buy the domain.** Roughly $10–15/year for a `.com` — Cloudflare
      sells them at cost, which is the cheapest common source.
- [ ] **Point it at Vercel.** Vercel project → Settings → Domains → Add.
      Vercel gives you the exact DNS records to create at your registrar.
- [ ] **Clerk → production mode.** Requires a real domain (`.vercel.app`
      doesn't qualify). Clerk dashboard → switch application to production
      → it issues new `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` /
      `CLERK_SECRET_KEY` values → update those two in Vercel's environment
      variables. This invalidates every existing session — everyone signs
      in again once, including you.
- [ ] **Stripe webhook endpoint.** Dashboard → Webhooks → add
      `https://yourdomain.com/api/webhook` → copy the new signing secret
      into `STRIPE_WEBHOOK_SECRET` in Vercel. The old one (pointed at
      `.vercel.app`, if you had one registered) can stay or be deleted;
      Stripe doesn't mind multiple endpoints existing.
- [ ] **Resend → production sending.** Resend dashboard → add and verify
      the domain (a DNS TXT record, same pattern as Vercel's). Until this
      is done, `/api/notify-series-drop` silently no-ops rather than
      failing — see `pages/api/notify-series-drop.js` — so nothing breaks in the meantime,
      it just doesn't send.
- [ ] **AdSense application.** Requires a real domain — this is blocked
      entirely until you have one, regardless of anything else here.
- [ ] **`.env.local.example`** — the webhook comment on line 12 already
      says `https://yourdomain.com/api/webhook`; nothing to change there,
      it's already written as a placeholder.
- [ ] **`public/manifest.json`** — no domain reference at all (checked).
      Nothing to update for "add to home screen" / PWA install.
- [ ] **Open Graph / Twitter card images** (`pages/index.js`,
      `pages/episode/[id].js`) — currently reference `/og-image.png` as a
      relative path, which resolves against whatever domain the page is
      served from automatically. Nothing to hardcode or change.
- [ ] **Legal pages** — `[MAILING ADDRESS]` and `[CONTACT EMAIL]` in
      `pages/terms.js`, `pages/privacy.js`, `pages/cookies.js` aren't
      domain-dependent, but you'll likely want an `@yourdomain.com` address
      once you have one rather than a personal inbox.

## What genuinely doesn't need to change

Supabase, Cloudflare Stream, Upstash Redis, and Stripe test mode are all
domain-agnostic — nothing in this codebase hardcodes a URL for any of them.
The only things gated on a real domain are Clerk production, Stripe's
webhook *endpoint registration* (not Stripe itself), Resend's sending
domain, and AdSense.
