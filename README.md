# Taprino Transmission

A working freemium OTT starter for Studio Taprino: free episodes play with a real
pre-roll ad (Google IMA SDK), premium episodes are gated behind a Stripe
subscription ("Cipher Circle"), and a fan-signal panel captures emails for your
list. No database — Stripe is the single source of truth for membership.

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
   Environment Variables (same four from `.env.local.example`), then redeploy.
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

## Cost summary

| Piece | Cost |
|---|---|
| Hosting (Vercel free tier) | $0/mo |
| Stripe | $0 to set up; ~2.9% + $0.30 per successful charge |
| Google IMA SDK + Ad Manager | Free; you earn a share of ad revenue once approved |
| Video hosting (Cloudflare Stream) | ~$5 per 1,000 minutes viewed — scales with usage, not a flat fee |
| Fan list (Notion) | Free on your existing plan |

Nothing here has a fixed monthly bill until you're already making money from
either subscriptions or ad views.
