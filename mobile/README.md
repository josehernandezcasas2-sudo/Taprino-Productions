# Studio Tapa TV — mobile app

A real native app (Expo / React Native), living alongside the Next.js site rather
than replacing it. It reuses the existing backend (Supabase, Clerk, Stripe, all of
`pages/api/*`) over HTTP — nothing server-side gets duplicated here. Only the
screens themselves are rebuilt, one at a time, using native components instead of
web CSS/HTML.

## Running it

```bash
cd mobile
npm install
npm start
```

That opens Expo's dev tools in your terminal with a QR code. From there:

- **On your phone (recommended — this is the real app):** install the free
  **Expo Go** app (App Store / Play Store), then scan the QR code. Your phone and
  PC need to be on the same Wi-Fi network. Reloads live as you edit code.
- **In a browser on your PC (fastest, good for quick checks):** run `npm run web`
  instead, or press `w` in the terminal after `npm start`. Note: a few native-only
  features (camera, push notifications, native video, etc.) won't work in the
  browser — treat it as a layout/logic preview, not a full test.
- **Android emulator on your PC (no phone needed):** install
  [Android Studio](https://developer.android.com/studio), create a virtual device,
  then press `a` in the terminal after `npm start`.
- **iOS simulator:** requires a Mac — not available on Windows. Physical iPhone +
  Expo Go is the way to test iOS from this PC.

## Pointing it at a different API

By default the app talks to production (`https://studiotapatv.site`). To point it
at your local `npm run dev` (running from the repo root, port 3000) instead,
create `mobile/.env.local`:

```
EXPO_PUBLIC_API_URL=http://localhost:3000
```

(This file is gitignored — it's per-machine, not committed.) Restart `npm start`
after changing it — Expo only reads env vars at startup.

## What's here so far

- Expo Router (file-based routing, same idea as Next's `pages/`) — screens live in
  `src/app/`.
- A bottom-tab shell: **Home**, **Pitch Room**, **Profile**.
- Pitch Room calls a new endpoint, `GET /api/pitches/list` (added on the Next.js
  side, `pages/api/pitches/list.js`), and renders the real, live approved
  pitches — proof the whole pipeline (app → API → Supabase) works end to end.
- Profile is a placeholder; sign-in isn't wired up yet.

## What's next

Roughly in order of what unlocks the most:

1. **Auth** — add `@clerk/clerk-expo` so people can actually sign in, matching
   accounts with the website.
2. **More JSON API routes** — most of the site currently hands data to pages via
   `getServerSideProps`, which only runs for the Next.js site itself. Each screen
   this app needs (browse, watch, profile, etc.) will need a small public/authed
   JSON endpoint under `pages/api/` the same way `pitches/list.js` was added,
   before its native screen can be built.
3. **Video playback** — the site's player will need a native equivalent
   (`expo-video` or similar) once a watch screen exists.
4. **Rebuild remaining screens** one at a time: browse/home feed, watch page,
   profile, creator dashboard — whichever order matters most.
5. **App Store / Play Store accounts**, once there's something worth shipping:
   an Apple Developer account ($99/year) for iOS, a Google Play Developer account
   ($25 one-time) for Android. Not needed yet — Expo Go covers all testing until
   then. Building and signing the actual store binaries happens through EAS
   (Expo's cloud build service) and doesn't require a Mac even for iOS.
