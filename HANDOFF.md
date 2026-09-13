# Studio Tapa TV — Project Handoff

Paste this whole document as context when starting a new Claude Code session on this repo (`~/taprino-ott`), or keep it as `HANDOFF.md` in the repo root for Claude Code to read directly.

---

## The goal

Studio Tapa TV (studiotapatv.site) is an indie OTT streaming platform for Studio Tapa / Studio Taprino's own content — films, series, podcasts, and short-form vertical video. It's built and operated solo by Jose, who also runs two related DBAs under the same LLC: Studio Tapa (a Shopify sticker/paper-goods store) and Post Puppeteers (client video production).

The platform's real differentiator isn't just streaming — it's meant to double as a way for creators to get funded directly by the audience watching them. That takes two forms:
- **Pitch Room**: a donation-style funding model (closer to YouTube live-stream donations than Kickstarter-style rewards) where people back a project to see it get made, with Studio Tapa taking a platform cut. This is a real, partially-built feature — see "Current state" below.
- **Advertiser system**: self-serve ad accounts with admin-reviewed ad creative, so the platform can also carry paid advertising.

The site is still in active development — most of it is real and working, but it has not launched publicly yet. Test/placeholder content is still live in a few places, and Clerk auth is still on development keys.

---

## What we're using (stack)

- **Framework**: Next.js 14, Pages Router
- **Hosting/deploy**: Vercel (auto-deploys on push to the connected branch)
- **Database**: Supabase (Postgres) — migrations are tracked as numbered `.sql` files in `supabase/migrations/`, run manually in the Supabase SQL Editor
- **Auth**: Clerk (currently on development keys, not yet swapped to production)
- **Video hosting**: Cloudflare Stream — uploads go directly from the browser to Cloudflare via TUS (`tus-js-client`), not proxied through our own server
- **Payments**: Stripe (currently wired for subscription/billing metadata only — no real charges flow through Pitch Room donations or ad budgets yet; see "Outstanding" below)
- **Analytics**: Upstash Redis
- **Email**: Resend (transactional) and Brevo (newsletter)
- **E-commerce**: a separate Shopify store (studiotapa.com) for the Studio Tapa merch DBA — not yet integrated into this codebase; as of this handoff, that Shopify store's API access is blocked by a billing/plan issue that needs resolving on the Shopify side before any integration work can start there.

### Old workflow vs. new workflow
Until now, development happened in Claude.ai chat: Claude would generate code in a sandbox, zip the changed files, and Jose would download, extract via Git Bash (`unzip -o [path] -d ~/taprino-ott`), commit, and push manually. **This project is now moving to Claude Code**, which works directly in the real `~/taprino-ott` repo — no more zip/download/extract round-trips, and it can run `npm run dev` so design changes are visible live in the browser.

---

## Current state of the site (what's actually built)

**Core CMS / content**: episode and series creation/editing, an audit log of admin actions, a channel scheduler for a looping linear channel, and a creator applications intake pipeline. This layer is solid and has been working for a while.

**Creator Studio** (`/creator`): type-specific submission flow (Film/Series/Podcast/Short/Vertical/Pitch), a series-review pipeline (creators propose series, admin approves/rejects), server-side draft autosave on longer forms, and a creator-facing analytics dashboard (7/30/90-day + all-time views).

**Podcasts**: inline video playback on podcast episode pages, and real Apple Podcasts/Spotify-compatible RSS feeds per show.

**Advertiser system**: self-serve ad account creation, ad submission with video upload and duration auto-detection, an admin review queue, and budget top-ups. Schema is real and tested; **no real Stripe charge happens yet** — budgets are recorded, not billed.

**Pitch Room donations** (the newest major piece): the original model was self-reported funding numbers with an external "Fund this project" link. This has been extended with a real, in-platform, database-tracked donation system:
- A `pitch_donations` table enforces at the database level that a donation's platform cut + creator payout always equals the total charged.
- Admin can enable funding on any approved pitch and set its platform-cut percentage, with live totals shown in the admin review list.
- The public pitch page shows a real running total and a working donation form.
- **No real Stripe Connect integration exists yet** — donations record as "pending" with an honest on-page note that real payment processing is coming. This is the single biggest piece of unfinished plumbing: nothing here actually moves money yet.

**Homepage**: still on the original layout in production. A separate, extensive round of visual exploration has happened (see "Design direction" below) but **none of it has been built into real code yet** — it's all static PNG/HTML mockups for Jose to react to.

**Legal pages** (`/terms`, `/privacy`): mostly real, but `SITE.mailingAddress` is still a literal placeholder, and the revenue-share clause covering creator ad/subscription payouts is still placeholder text pending real numbers from Jose (split %, calculation method, minimum payout, payment schedule). The Pitch Room's donation model is not yet mentioned in the Terms of Service at all.

---

## What's outstanding / expected next

Roughly in order of what likely matters most:

1. **Run any not-yet-applied Supabase migrations.** A batch of 14 (numbered 044–057) was outstanding as of this handoff and was handed to Jose as a single idempotent SQL file to run — worth double-checking in Supabase that they're actually applied, since a few features (ad accounts, title images, Pitch Room donations) will hard-fail with "table not found" errors until they are.
2. **Real payment integration** for both ad budgets (a one-time Stripe Checkout charge per budget top-up — no Connect needed) and Pitch Room donations (needs Stripe Connect, since creators receive payouts minus the platform cut). Schema on both is ready; the actual charge-and-webhook wiring is not built.
3. **Homepage redesign.** Multiple visual directions have been mocked up (dark olive/brass "streaming shelf" layouts, and a separate widget-dashboard/magazine-style direction with per-content-type widgets, an ad placement slot, genre-filter pills, and a "Trending now" widget). Nothing has been decided or built yet — this is a live open decision, not a settled plan.
4. **Legal page completion** — needs Jose to supply a mailing address and the four revenue-share numbers before that section can be finished; Pitch Room needs its own short section added to the Terms.
5. **PWA install button** — currently shows instructions instead of triggering an install. On Chrome/Edge/Android this is fixable with a real one-click install via the `beforeinstallprompt` event; iOS Safari has no equivalent API, so instructions are unavoidable there specifically, no matter what.
6. **Production readiness housekeeping**: Clerk is still on development keys, a couple of pieces of placeholder/test content are still live, and a documented tablet-breakpoint layout bug has been flagged across multiple sessions without being fixed yet.
7. **Shopify integration**, if wanted — blocked right now on a billing/plan issue on the studiotapa.com store itself (API access is currently refused for that reason). Once resolved, either a simple outbound "Shop" link or a deeper Storefront-API-powered in-app shop are both realistic options.

---

## What we expect to use going forward

- **Claude Code**, working directly in `~/taprino-ott`, replacing the old zip-handoff workflow. Design iteration in particular should get faster since changes can be viewed live via `npm run dev` instead of a full round-trip.
- **Supabase SQL Editor** for running migrations manually, as before.
- **Vercel** for deploys, unchanged — push to the connected branch still auto-deploys.
- Possible future additions raised but not yet adopted: a Shopify connector (once the store's billing issue is resolved), Canva for real design assets (podcast art, Pitch Room thumbnails — currently flat placeholder blocks in mockups), and Notion as a more searchable home for planning docs than the current scattered Google Docs.

---

## How Jose likes this project run (carried over, still applies)

- Mockups before building anything with real visual/design decisions — explicit sign-off before code gets written.
- Build one thing, verify it completely, package it, then move to the next — not everything at once.
- Flag real bugs found along the way, even outside the current task's scope, rather than only doing the literal ask.
- Give an honest, direct assessment of what's actually built vs. what still needs work — no assuming something is done because it was discussed.
- Call out scope creep explicitly rather than silently expanding a task.
