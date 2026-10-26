# Studio Tapa TV on Google Play

How the Android app gets built, signed and onto Google Play, and what the
store listing needs. The build itself runs in the cloud (EAS Build) from
GitHub Actions, so nothing has to be installed on the PC beyond what's
already there for Expo Go.

The identifier that can never change after the first upload is the
package name: **`site.studiotapatv.app`** (`android.package` in
`app.json`, the same string as the iOS `bundleIdentifier`). Decide on it
before the first upload; after that it's fixed for the life of the app.

## One-time setup (Jose)

1. **Google Play Developer account**: play.google.com/console, $25 once.
   Google verifies identity and, for an organization account, the LLC's
   D-U-N-S number; a personal account is faster for a first release.
2. **Create the app** in the Play Console: name "Studio Tapa TV", app (not
   game), free. Fill in the Store listing, App content and Policy sections
   below. Google won't accept a build until those are done.
3. **The first build** (Actions → "Mobile · Android build" → profile
   `production`, submit off). EAS signs it with a keystore it generates
   and keeps; Google Play App Signing re-signs on top. When it finishes,
   download the `.aab` from expo.dev → project → Builds and upload it by
   hand in the Play Console → Testing → Internal testing → Create release.
   Google requires the very first upload to come through the Console.
4. **Automatic uploads after that**: Play Console → Users and permissions
   → Invite new users isn't it; it's Setup → API access → create a
   service account (Google Cloud), grant it "Release manager" on the app,
   download its JSON key, and paste the whole file into the GitHub secret
   `GOOGLE_SERVICE_ACCOUNT_JSON`. From then on the workflow with
   "submit" ticked uploads each production build to Internal testing.
5. **Testers**: Internal testing takes up to 100 emails, no review needed,
   available within minutes. That's the Android equivalent of Expo Go for
   friends and sponsored creators. Closed testing → Production is the
   path to the public listing, and Google reviews those (days, not hours).

## Day to day

- **A new build** is needed only when native code changes: a new Expo
  SDK, a new library with native code, a change to `app.json` (icon,
  permissions, splash). Run the workflow with profile `production`.
- **Everything else** (screens, copy, fixes) ships as an over-the-air
  update: Actions → "Mobile · publish update" → branch `production`.
  Installed apps pick it up on their next launch. Pushes to `main`
  publish to `preview` (Expo Go) only, never to production.
- A `preview` build is an installable `.apk` for a phone or the Android
  emulator in Android Studio, outside the Play Store.
- Each native build is tied to the `version` in `app.json` (runtime
  version policy `appVersion`): bump it when you ship a new build, and
  publish updates to `production` only from code that matches that
  build's native modules. The move to Expo SDK 58 (2026-10-26) took it
  to `1.1.0`, so an SDK 58 update is never offered to a build made on
  SDK 57; every later SDK move bumps it again.

## Store listing

- **App name**: Studio Tapa TV
- **Short description** (80 max): Indie films, series and podcasts. Watch,
  back a project, own a title.
- **Full description**: Studio Tapa TV is an independent screening room.
  Watch films, series, podcasts and short vertical video from independent
  creators; join as a member or buy a title outright and keep it. Back
  projects in the Pitch Room, find crew and gear on Crew Call, list or
  book a place to shoot on Locations, and learn the craft in Film
  University. Creators are paid by the people who watch them.
- **Category**: Entertainment. **Tags**: Video Players & Editors is wrong;
  pick Entertainment and "Streaming".
- **Graphics**: `mobile/store/play-icon-512.png` (hi-res icon),
  `mobile/store/play-feature-1024x500.png` (feature graphic). Phone
  screenshots: at least 2, up to 8, 16:9 or 9:16, from a real phone or the
  emulator (Home, a film page, Live TV, Pitch Room, Account). Take them
  from a `preview` build or Expo Go.
- **Contact**: info@studiotapa.com, https://www.studiotapatv.site.
  **Privacy policy**: https://www.studiotapatv.site/privacy (required).

## App content (the policy forms)

- **Privacy policy**: the URL above.
- **Ads**: Yes, the app shows ads (house ads and advertiser ads in free
  titles; Live TV ad breaks show a countdown card for now).
- **App access**: parts of the app need an account. Give Google a test
  account (an invited email once the private beta gate is on) and note
  that sign-in is email + code through Clerk.
- **Content rating** (IARC questionnaire): the catalogue carries titles
  up to TV-MA / R, gated by the viewer's age on file. Answer honestly
  about violence, language and mature themes in user-submitted video;
  expect "Mature 17+".
- **Target audience**: 18 and over. Not designed for children.
- **Data safety**, from what the app actually collects:
  - Collected: email address and name (account), profile photo and bio
    (optional, user-provided), approximate location (optional, only when
    the person searches Crew Call or Locations by distance; rounded to
    about a kilometre on the server, never stored precisely), app activity
    (what was watched, saved, bought), messages between users.
  - Not collected: device IDs, contacts, financial details (payments
    happen on Stripe's pages in the browser; the app never sees a card).
  - Shared: none sold; Stripe (payments), Clerk (sign-in), Cloudflare
    (video delivery) and Resend (email) process data as providers.
  - Encrypted in transit: yes. Deletion: in the app, Account → Delete
    account, and by email.
- **User-generated content**: yes (creator uploads, comments, messages,
  crew and location listings). Google requires in-app reporting and
  blocking, which exist (report sheets, blocks in Messages), and a
  moderation policy, which the Terms carry (sections 6, 7, 13 and 14).
- **Payments**: memberships, Pitch Room backing, location bookings and
  Buy to own all open Stripe Checkout in the browser, not Google Play
  Billing. Google's policy on digital goods bought outside Play Billing
  has changed since the Epic ruling; check the current policy page in the
  Play Console before submitting to Production, and be ready to either
  hide those buttons on Android or add Play Billing if required.
- **Permissions** the build declares: approximate location (Crew Call and
  Locations distance search; fine location and microphone are blocked in
  `app.json`), photos (avatar, pitch images), internet. Google asks for a
  one-line justification for location in the Data safety form.

## Not done yet

- **App Links**: opening https://www.studiotapatv.site/… links in the app
  (creator referral links, shared titles). Needs `android.intentFilters`
  in `app.json` plus `/.well-known/assetlinks.json` on the website with
  the app's signing certificate SHA-256 from Play Console → App
  integrity. One short session once the app exists in the Console.
- **Push notifications** (messages, calls, purchases): the app polls today.
- **Google TV**: a separate target with remote-control navigation and a
  TV layout. Decided to follow the phone app.
