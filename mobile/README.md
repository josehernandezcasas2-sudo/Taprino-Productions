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

  Two rules that have bitten before:
  - **Expo Go runs exactly one Expo SDK, and the app has to be on it.** The
    SDK that matters is the one Expo Go on the phone reports under
    **Settings → App Info → Supported SDK**, not npm's newest `expo` release:
    SDK 58 was on npm from 2026-09-29, but Expo Go on the iOS App Store was
    still 57.0.9 on 2026-10-18, so the app is on **SDK 57** until Expo Go
    moves. When Expo Go updates and the project won't open ("incompatible with
    this version of Expo Go"), move the app to the SDK it now reports:
    `npx expo install expo@<version> --fix` from `mobile/` (the exact SDK, not
    `expo@latest`), `npm install`, and `npx expo export --platform ios` to
    prove it still bundles before testing on the phone.
  - **Same Expo account on both ends.** `npx expo whoami` on the PC and the
    account signed into Expo Go must match (studiotapa237). If not:
    `npx expo logout`, `npx expo login`, and sign Expo Go in again.
  - **After pulling a dependency change, `npm install` before `npx expo start`.**
    Stale `node_modules` on the PC (2026-10-22: left over from a bump to SDK
    58 that was undone) made Expo Go draw every screen over a red
    "Unimplemented component: <RNSScreenStack>" box. `npm install` then
    `npx expo start -c` fixed it; nothing in the repo was wrong. The SDK stays
    on 57 until the phone's Expo Go reports a newer Supported SDK — not when
    npm or Expo's changelog says 58 exists.

  Other quick fixes when the QR won't connect: `npx expo start -c` (clears
  Metro's cache), and `npx expo start --tunnel` when the phone and PC can't
  see each other on the network (works from anywhere, but the PC must be on).
- **In a browser on your PC (fastest, good for quick checks):** run `npm run web`
  instead, or press `w` in the terminal after `npm start`. Note: a few native-only
  features (camera, push notifications, native video, etc.) won't work in the
  browser — treat it as a layout/logic preview, not a full test.
- **Android emulator on your PC (no phone needed):** install
  [Android Studio](https://developer.android.com/studio), create a virtual device,
  then press `a` in the terminal after `npm start`.
- **iOS simulator:** requires a Mac — not available on Windows. Physical iPhone +
  Expo Go is the way to test iOS from this PC.

## The cloud version (EAS Update) — testing away from home

Every push to `main` that touches `mobile/` publishes the app's JavaScript to
EAS Update (branch `preview`) through `.github/workflows/mobile-update.yml`, so
the current app can be opened in Expo Go anywhere, with no dev server running.
It uses the production API and the committed Clerk key in `mobile/.env`.

One-time setup (on the PC, signed in as studiotapa237):

```bash
cd mobile
npx eas-cli@latest login
npx eas-cli@latest init                # creates the project on expo.dev, writes extra.eas.projectId
npx eas-cli@latest update:configure    # writes updates.url (runtimeVersion is already set)
git add app.json && git commit -m "Mobile: link EAS project" && git push
```

Then on expo.dev → account settings → **Access tokens** → create one, and add it
to the GitHub repo as a secret named `EXPO_TOKEN` (Settings → Secrets and
variables → Actions). From the next push on, the workflow publishes.

To open it on the phone: expo.dev → the project → **Updates** → the latest
update → scan its QR code with the iPhone camera (opens in Expo Go). The first
publish can also be done by hand:

```bash
npx eas-cli@latest update --branch preview --message "first"
```

(No `--environment` flag: with it, EAS CLI ignores `.env` and the bundle ships
without the Clerk key. The workflow sources `mobile/.env` for the same reason.)

Expo Go has to be on the same SDK as the app (see above); updates are plain
JavaScript, so anything needing a native module outside Expo Go still needs a
development build later.

## Pointing it at a different API

By default the app talks to production (`https://www.studiotapatv.site`). To point it
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
   ($25 one-time) for Android. Building and signing the store binaries happens
   through EAS (Expo's cloud build service) and doesn't require a Mac even for
   iOS. **Android is wired up**: `.github/workflows/mobile-android-build.yml`
   builds the signed app bundle (and uploads it to Internal testing once the
   app exists in the Play Console); `PLAY_STORE.md` has the steps, the store
   listing copy and the policy-form answers. The package name is
   `site.studiotapatv.app`. iOS waits on the Apple account.
