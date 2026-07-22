# Taprino Transmission

A working freemium OTT starter for Studio Taprino: free episodes play with a real
pre-roll ad (Google IMA SDK), premium episodes are gated behind a Stripe
subscription ("Cipher Circle"), and a fan-signal panel captures emails for your
list. Real email + password login via Clerk; Stripe still tracks who's
actually paying — no separate database for either.

It's also installable like an app (see "Becoming an app" below) — this was
added so the path to a real mobile app later doesn't require a rebuild.

## You just unzipped this. Do these things in order.

1. **Install Node.js** if you don't have it: https://nodejs.org (get the LTS version).
2. **Unzip and open a terminal in the `taprino-ott` folder.**
3. Run the "Run it locally" steps below — confirm it works on your machine first.
4. **Put it on GitHub**: create a free repo at https://github.com/new, then from
   inside the folder:
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin <your new repo's URL>
   git push -u origin main
   ```
5. **Deploy it**: go to https://vercel.com/new, sign in with GitHub, import the
   repo. Vercel auto-detects Next.js — no config needed. It'll give you a live
   `.vercel.app` URL immediately, still on the free tier.
6. **Add your real environment variables** in the Vercel project's Settings →
   Environment Variables (everything from `.env.local.example`, most importantly
   your Clerk keys — the app won't build without those), then redeploy.
7. **Connect your domain** in Settings → Domains once you're happy with it.

Steps 1–3 you can do today with zero accounts. Steps 4–7 take maybe 20 minutes
whenever you're ready to go live.

## Run it locally (5 minutes, $0)

```bash
npm install
cp .env.local.example .env.local
npm run dev
```

Open http://localhost:3000. Out of the box, before you touch any config:

- Free episodes play Google's public sample videos with Google's public sample
  ad tag — you'll see a real pre-roll ad run through the real IMA SDK.
- Premium episodes show the "Join the Cipher Circle" lock screen. Clicking it
  will show an error until you add Stripe keys below — that's expected.
- The signup form in the sidebar actually writes to `signals.local.json` in
  the project root when Notion isn't configured. Open that file after
  submitting the form to see it.

## Wire up Stripe (free to set up, only costs anything when someone pays)

1. Create a free account at https://dashboard.stripe.com/register
2. Go to **Product catalog** → create a "Cipher Circle" product with a
   recurring monthly price. Copy the Price ID (`price_...`).
3. Go to **Developers → API keys** and copy your test **Secret key**
   (`sk_test_...`).
4. Go to **Developers → Webhooks** → add an endpoint pointing at
   `https://yourdomain.com/api/webhook` (or use the Stripe CLI locally —
   see below) subscribed to `checkout.session.completed`,
   `customer.subscription.deleted`, and `invoice.payment_failed`. Copy the
   signing secret (`whsec_...`).
5. Generate a random signing secret for the membership cookie:
   `openssl rand -hex 32`
6. Fill all four into `.env.local`.

To test webhooks locally, install the Stripe CLI and run:
```bash
stripe listen --forward-to localhost:3000/api/webhook
```

Use Stripe's test card `4242 4242 4242 4242`, any future expiry, any CVC —
the whole subscribe → unlock loop works end to end in test mode with zero
real money moving.

## Swap in your real video files

Edit `lib/episodes.js`. Each episode just needs a `src` — a direct URL to an
mp4 or an HLS manifest. Recommended hosts, both pay only for what you use:

- **Cloudflare Stream** — around $5 per 1,000 minutes stored + delivered.
  Good default; supports signed URLs if you later want extra protection on
  premium videos beyond the Stripe gate.
- **Mux** — similar pricing, nicer analytics.
- Free option to start: unlisted YouTube videos embedded via `iframe` — YouTube
  handles hosting and even some monetization for you, at the cost of losing
  control over the ad experience described below.

## Swap in your real ad tag

Once you're approved for Google Ad Manager (or another network offering VAST
tags), set `NEXT_PUBLIC_AD_TAG_URL` in `.env.local` to your tag URL. Until
then, the app uses Google's own public sample tag, so the ad-break UX is
fully testable before you have real ad inventory.

## Swap in real fan-list storage

If you set `NOTION_TOKEN` and `NOTION_DATABASE_ID` in `.env.local`, signups
write straight into that Notion database instead of the local JSON file —
a natural fit if you're already running an Artist Hub in Notion. Adjust the
property names in `pages/api/subscribe.js` to match your database's schema.
Alternatively, swap that function for a Mailchimp or ConvertKit API call.

## Set up view tracking (Upstash Redis)

This is what actually decides which episode or series wins the homepage
hero slot — real view counts, not a manually flipped `featured: true` flag.
It also backs the rate limiting on a few API routes (view tracking itself,
login attempts, newsletter signups). Worth treating as a real setup step,
not an optional extra you can skip indefinitely.

1. Sign up free at https://upstash.com — no card required.
2. Create a Redis database (any region close to your Vercel deployment is
   fine).
3. From its dashboard, copy the REST URL and REST token into `.env.local`
   as `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`.

Free tier: 500,000 commands/month, 256MB storage — comfortably covers an
indie-scale site. The code still degrades gracefully to the manual
`featured` flag if these two env vars are ever missing or Redis has a
momentary outage — that's a resilience fallback, not an invitation to skip
setting this up for real.

## Deploying

Push this to a GitHub repo and import it at https://vercel.com/new — free
tier covers this comfortably. Add the same environment variables from
`.env.local` in the Vercel project settings, then update your Stripe webhook
endpoint to point at your real Vercel URL.

## Becoming an app

This is a real path, not a rebuild — you're already partway there.

**Right now, free:** the app ships with a manifest and service worker. Once
it's deployed to a real HTTPS domain (Vercel gives you one automatically), a
visitor can tap "Add to Home Screen" on iOS or "Install app" on Android/desktop
Chrome, and it opens full-screen with an icon like any other app, works
offline for the shell, and remembers the person's Cipher Circle membership.
No app store review, no developer account, no extra cost. This is genuinely
how a lot of small OTT products operate at your stage.

**Later, if you want App Store / Play Store listings:** wrap this exact
codebase with [Capacitor](https://capacitorjs.com) (free, open source). It
takes your existing Next.js build and packages it into a real iOS/Android app
shell — you don't rewrite the app, you wrap it. At that point the costs become:
- Apple Developer Program: $99/year (required to publish on the App Store)
- Google Play Console: $25 one-time
- Your Stripe/IMA/Notion logic keeps working exactly as-is inside the wrapper

Recommended order: launch as a PWA first, see if people actually use it and
whether Cipher Circle memberships justify the effort, *then* pay for the app
store wrapper once that's proven. Going straight to native stores before
validating the free tier is the most common way solo creators burn money on
this kind of project.

## Accounts, login, and subscription settings

Login is now real email + password, handled entirely by **Clerk**
(clerk.com) — no database for that on your end, Clerk owns it. Stripe still
tracks who's actually paying, same as before; the two are linked
automatically the first time someone checks out or manages their account
(see `lib/clerkStripeLink.js` if you want the details).

**Two things to turn on:**

1. **Clerk** (required — the app won't build without these): sign up free
   at https://clerk.com, create an application, make sure Email + Password
   is enabled as a sign-in option, then copy your Publishable Key and Secret
   Key into `.env.local` as `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and
   `CLERK_SECRET_KEY`. Free up to 10,000 monthly active users.

2. **Stripe Customer Portal** (for "manage subscription" — cancel, update
   card, view invoices): go to
   https://dashboard.stripe.com/test/settings/billing/portal and save the
   page once with the defaults. Until you do this once, "Manage subscription"
   will error.

Joining the Cipher Circle now requires being signed in first — under the
old magic-link system, checkout could happen anonymously since the email
itself doubled as the login credential. With real passwords there's no
equivalent, so `/api/create-checkout-session` requires an existing signed-in
account; the "Join the Cipher Circle" button opens Clerk's sign-in modal
first if you're not already signed in.

Visit `/account` to see the settings page: membership status, "Manage
subscription," "Log out," and sign in/sign up if you're not already.

Resend is still used for the new-episode notification emails (see below) —
just no longer needed for login itself.

## Notifying people when a new episode drops

Anyone can save a whole series to their wishlist (♡ on a series card, or on
the series hub page) — that's what makes them eligible for an email when a
new episode goes up. There's no automated pipeline watching for new
episodes; you trigger the email yourself whenever you actually publish one:

```bash
curl -X POST https://yourdomain.com/api/notify-series-drop \
  -H "Content-Type: application/json" \
  -d '{"seriesId": "cipher-lore", "secret": "YOUR_ADMIN_NOTIFY_SECRET"}'
```

That emails everyone who wishlisted that series (and hasn't opted out of
communications), using the same Resend setup as the sign-in links. Requires
`ADMIN_NOTIFY_SECRET` set in your environment — treat it like a password,
don't share it or commit it.

**Scale note, worth knowing**: this works by checking every Stripe customer's
wishlist metadata one by one, since Stripe's API can't search inside a
comma-separated field. Perfectly fine at hundreds to low thousands of
members. If Cipher Circle ever grows well past that, this specific piece —
not the rest of the app — is where you'd want a real database instead.

**Push notifications, if people install the app**: genuinely possible, and
doesn't require a native app — the PWA's existing service worker can receive
real push notifications via the browser's Push API (Chrome, Edge, Firefox,
and now Safari all support it), using the free `web-push` library and no
paid push service. It's a real, separate build (storing push subscriptions,
a service worker `push` event handler, a trigger endpoint) — not included
here yet. Ask for it as a next step whenever you want it.

## Cost summary

| Piece | Cost |
|---|---|
| Hosting (Vercel free tier) | $0/mo |
| Stripe | $0 to set up; ~2.9% + $0.30 per successful charge |
| Clerk (login) | Free up to 10,000 monthly active users |
| Supabase (content database) | Free tier covers this comfortably at indie scale |
| Google IMA SDK + Ad Manager | Free; you earn a share of ad revenue once approved |
| Video hosting (Cloudflare Stream) | ~$5 per 1,000 minutes viewed — scales with usage, not a flat fee |
| Upstash Redis (view tracking) | Free tier: 500K commands/month |
| Fan list (Notion) | Free on your existing plan |

Nothing here has a fixed monthly bill until you're already making money from
either subscriptions or ad views.
