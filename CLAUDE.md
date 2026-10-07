# Taprino Productions — Studio Tapa TV

Indie OTT streaming platform (studiotapatv.site) for Studio Tapa / Studio Taprino content: films, series, podcasts, short-form vertical video ("Snippets"). Built and run solo by Jose under an LLC that also runs Studio Tapa (Shopify stickers/paper goods) and Post Puppeteers (client video production). Not launched publicly yet.

Differentiator: creators get funded by their audience — **Pitch Room** (donation-style funding, platform takes a cut) and a self-serve **advertiser system** with admin-reviewed ad creative.

Repo: https://github.com/josehernandezcasas2-sudo/Taprino-Productions (branch `main`, Vercel auto-deploys on push).

## Layout

- Web app (repo root): Next.js 14, **Pages Router**, plain JS. `pages/`, `components/`, `lib/` (data + helpers), `contexts/`, `styles/`, `middleware.js`.
- `supabase/migrations/NNN_name.sql`: numbered migrations, run **manually** in the Supabase SQL Editor (latest: 073). Never assume one is applied; features fail with "table not found" until it is.
- `mobile/`: Expo SDK 57 / React Native 0.86 app, Expo Router in `mobile/src/app/`, plain JS. Calls the web app's API via `mobile/src/lib/api.js` (add a new `pages/api/*` route when a screen needs data `getServerSideProps` currently provides). Bottom nav (`mobile/src/components/BottomNav.js`) mirrors `MobileTabBar.js`'s full site map (Home/Discover/Watch/Account groups) even where the destination screen is still a placeholder — check what's actually built before assuming a nav entry has real content behind it. Colors/spacing/radii live in `mobile/src/lib/theme.js`, pulled from `styles/globals.css`'s real `:root` values, not invented. A Figma file (https://www.figma.com/design/4bWVu8cjMI1otCAyvSxs5T) holds a matching design system (variables, Nav/Tab Bar components, reference pages) built from the same code — edits there get manually ported back into both codebases on request, there's no live sync. Real device testing is via Expo Go on Jose's iPhone; the Expo CLI on this PC and Expo Go must both be signed into the same Expo account ("studiotapa237") or opening the project fails.
- Live channels (`/live`, TapaTV is CH 01): the rules for what airs live in `lib/channelPlan.js` (pure, tested by `node scripts/test-channel-plan.mjs`); `lib/channelEngine.js` loads data and answers "what's on." Order: live broadcast > published week > default schedule > loop. Slots take whole minutes (a 27:40 title fills a 28-minute slot; the rest is ads), and gaps under 5 minutes play ads instead of the loop. Scheduler at `/schedule` (tablet/computer only; phones get a note): edits a draft of the whole week/default view and saves it in one go through `/api/schedule/save` (`saveDays` in `lib/scheduleAdmin.js`); drag/resize/ad-break rules in `lib/scheduleLayout.js` (pure, tested by `node scripts/test-schedule-layout.mjs`), drawn by `components/ScheduleTimeline.js`. Channels at `/admin/channels`, moderation (flags, reports, `moderation_hold`) in `lib/moderation.js` and `/admin/content`. Every public episode/series query filters `moderation_hold = false`; keep that in any new public query.
- Pitch Room Discover (`/pitches/discover`) is an elevator: each pitch is a floor, `components/PitchElevator.js` renders the cab/doors/buttons/flippable card, the page owns the ride state. Riding is a swipe on the card (left/right/up = next floor, right also likes, down = hold for a second-look round; tap either face to flip; no floor indicator); the right plate reacts (Save = `pitch_saves` follow, Share, Like = `pitch_likes`, migration 073). Web keyboard: ↑ next, ↓ back a floor, H hold, F flip, S save, L like. Ride progress is `/api/pitch-swipe-progress` (with `floorIndex`). The mobile app has the same elevator (`mobile/src/components/PitchElevator.js`, `mobile/src/app/pitches/discover.js`) fed by `/api/pitch-discover-feed`. Saved pitches show on `/wishlist` and the app's My List (`/api/wishlist-feed`).
- Root `*.md` files (HANDOFF, DEPLOY_NOTES, *-NOTES) are historical session notes. HANDOFF.md has the fullest product background but is partly dated.

## Stack

Clerk (auth; **live/production keys**, same account works across web and mobile — the mobile app calls web API routes with a Bearer token from `useAuth().getToken()`, which `getAuth(req)` on the server accepts the same way it reads a session cookie), Supabase Postgres (server-side only, service-role key), Cloudflare Stream (direct browser TUS uploads; playback is signed HLS via `/api/stream-token`, provider-agnostic by design so swapping in Bunny.net later needs no player changes), Stripe (subscription metadata only; **no real charges yet**), Upstash Redis (analytics), Resend (transactional email), Brevo (newsletter). Env vars: see `.env.local.example`.

## Commands

```bash
npm run dev              # web on :3000
npm run build            # web production build
cd mobile && npx expo start
cd mobile && npx expo install <pkg>   # never plain npm add in mobile
```

Mobile: Expo APIs change every SDK. Check `mobile/AGENTS.md` and the versioned docs (https://docs.expo.dev/versions/v57.0.0/) before writing Expo/RN code. Keep non-route code out of `mobile/src/app/`. Not built for real devices/stores yet — that's `eas build`/`eas submit` (EAS handles iOS/Android signing automatically), not needed until there's an app worth shipping.

## How Jose likes to work

- **Mockups and sign-off before building** anything with real visual/design decisions.
- One thing at a time: build, verify completely, then move on.
- Flag real bugs found along the way, even out of scope; call out scope creep explicitly.
- Be honest about built vs. not built. Don't assume something is done because it was discussed.
- Verify UI changes in the browser (dev server) rather than asking Jose to check.
- When a feature ships on the website, the mobile app usually gets the same change (see the About redesign commit).

## Known open items

- Real payments unbuilt: ad budget Stripe Checkout, Pitch Room donations need Stripe Connect (donations record as "pending").
- Legal pages: `SITE.mailingAddress` placeholder, revenue-share clause needs numbers from Jose, Pitch Room missing from Terms.
- Some test/placeholder content still live; a tablet-breakpoint layout bug is flagged but unfixed.
- PWA install button shows instructions instead of using `beforeinstallprompt` on Chrome/Android.
- Shopify (studiotapa.com) integration blocked on a billing/plan issue on the Shopify side.
- Live channels on mobile (`mobile/src/app/live/`, Watch → Live TV) play without ads: scheduled ad breaks show a countdown card and the between-program break is skipped, until the mobile IMA ads work lands.
- Mobile app: most `BottomNav` destinations are still `ComingSoon` placeholders (Stream, Watch Series/Movies/Podcasts/Vertical, Pitch/Vertical Discover, My List, My Work) — only Home, Pitch Room, Account, About, and single-episode playback are real. Ad breaks (house-ads VAST feed is ready; needs a mobile Google IMA SDK integration, deliberately paused), captions, and watch-progress saving aren't built for mobile playback yet. Mobile still uses the system default font everywhere, not the site's real Space Grotesk/Fraunces/IBM Plex Mono.

## Memory

Cross-session preferences and decisions live in Claude's auto-memory for this project. Put stable project facts here in CLAUDE.md instead.
