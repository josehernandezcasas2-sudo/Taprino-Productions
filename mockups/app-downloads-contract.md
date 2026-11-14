# Downloads in the app — build contract

Jose, 2026-11-14: "I want users to be able to download and view their download page from the tab bar … if they have something downloaded, and they are offline, they can still view it as long as they have the subscription, once the month is over and if they haven't connected, make sure they have to connect back" → mockup https://claude.ai/artifact/GbG6FPXECgH61aMsbFvnyT (`mockups/app-downloads-v1.html`) → "let's add this feature for premium and sponsor. Let's also add a section in admin to toggle this feature on and off, with an eventual lock on. That only admin or me can do. Sub admin accounts should not be able to unlock it or change it. Let's build and see what comes up."

This file is the agreement between the server, the website and the app. Where a builder has to depart from it, they say so in their hand-back; they don't quietly change a shape the other side reads.

## 0. Decisions (settled)

1. **Who**: Premium and Sponsor members (the team counts as Premium), plus anyone who bought the title (Buy to own). Standard and Basic see "Downloads come with Premium".
2. **The month rule**: a member's copy plays offline until the end of the paid month + 2 days' grace, and never longer than 31 + 2 days without the phone connecting. After that it is locked until the phone connects once. If the plan no longer carries downloads at that check-in, the copies lock ("ended") and the files stay 30 days, then the app removes them.
3. **Bought titles**: no plan needed; the phone connects at least every 30 days.
4. **Creators**: a switch per title, "Allow downloads in the app", on by default.
5. **Limits**: 25 titles per phone, 2 phones per account, Wi-Fi only unless the member switches that off.
6. **Where**: first row of the Watch tab's menu. Offline, the app opens straight onto Downloads.
7. **The admin switch**: Downloads is **off until a full admin turns it on**. The switch has a **lock**: locked, nobody can flip it; only a full admin can unlock (typing UNLOCK). Sub-admins can neither see the page nor call the route.
8. **App only.** No download in a browser. Podcasts are out of v1.
9. **Where the file lives**: the app's **cache** directory (`Paths.cache`), never `Paths.document` — Documents is copied into iCloud and desktop backups and Expo has no way to exclude a file, and a backup is the easy way to pull a film off a phone. The price: iOS may clear the cache when the phone is nearly full; the app then says so and offers the download again.

The pure rules are written and tested: `lib/downloadRules.js` = `mobile/src/lib/downloadRules.js` word for word (`node scripts/test-downloads.mjs`, 25 checks). **Use them; don't re-derive a rule or retype a constant or a sentence.** If a rule is missing, add it to both files and to the test.

## 1. Data — migration 123 (`supabase/migrations/123_downloads.sql`)

One transaction, safe to run again, ends with row level security on both new tables (112's rule).

- `site_settings.downloads_enabled boolean not null default false`
- `site_settings.downloads_locked boolean not null default false`
- `episodes.downloads_allowed boolean not null default true`
- `download_devices`: `id uuid pk default gen_random_uuid()`, `user_id text not null`, `device_id text not null` (the app's own random id, 16–80 chars `[A-Za-z0-9_-]`), `name text`, `platform text` (`ios` | `android`), `created_at`, `last_seen_at`, `removed_at`. Unique `(user_id, device_id)`.
- `downloads`: `id uuid pk`, `user_id text not null`, `device_id text not null`, `episode_id text not null` (a title slug — text, checked with `isTitleId`), `basis text not null` (`member` | `owned`), `status text not null default 'active'` (`active` | `removed` | `revoked`), `licensed_until timestamptz`, `ended_at timestamptz` (the first check-in at which the plan no longer carried downloads; null again once it does), `bytes bigint`, `created_at`, `renewed_at`, `removed_at`, `revoke_reason text`. Partial unique index on `(user_id, device_id, episode_id) where status = 'active'`; an index on `episode_id`.

Before 123: `/api/site-settings` says `downloadsEnabled: false`, the episode payloads say `download: { state: 'hidden', reason: 'off' }`, every `/api/downloads/*` route and the admin route answer 503 `{ code: 'migration-123' }`, the creator switch answers 503 `migration-123`, the admin page shows the "needs a database update (migration 123)" banner. Check it on a real Postgres (`scripts/check-migration-123.mjs`, on `scripts/pg-chain.mjs`) and regenerate `supabase/check_migrations.sql` (`node scripts/migration-status.mjs`).

## 2. Server

`lib/downloads.js` (server-only; pages import only `lib/downloadRules.js`). Errors carry a status and a `code`; routes answer through `sendError` and never echo database or Stripe text.

**The file**: `lib/cloudflareUpload.js` already has `ensureCloudflareDownloadUrl(uid)` (starts Cloudflare's MP4 and reports `inprogress` / `ready`). New: `createCloudflareDownloadToken(uid, { expiresInSeconds })` — a token with `downloadable: true` (signed locally when the Stream key is set, else `POST …/token { exp, downloadable: true }`), **never cached or shared with playback tokens** (those stay `downloadable: false`), life `LINK_SECONDS` — and `cloudflareSignedDownloadUrl(token)` = `https://customer-<code>.cloudflarestream.com/<token>/downloads/default.mp4`. A title is *downloadable* when its `src` is a Cloudflare Stream video (`cloudflareUidFromUrl`) and `downloadableKind(contentType)`.

**Paid through**: the latest `current_period_end` among the account's active subscriptions whose tier is Premium or Sponsor; null for the team, comped and promo accounts (for a promo, the earlier of the promo's end and the 30-day check-in).

**Title still fine** (`titleOk` for `syncVerdict`): the episode exists, is approved, not held, its show (and for an extra, its parent) public and not held, `downloads_allowed` not false, and not withdrawn — except that a withdrawn title stays fine for someone who owns it.

### Routes

All: `applyCors`, `Cache-Control: private, no-store`, signed in (401 otherwise), a suspended account 403 `{ suspended: true }`, per-account rate limits beside the per-IP ones.

- `GET /api/downloads?deviceId=` → `{ enabled, plan: { carries, tier }, limits: { titles, devices }, devices: [{ deviceId, name, platform, lastSeenAt, count, current }], items: [{ episodeId, basis, licensedUntil, endedAt }] }` (this device's active rows).
- `POST /api/downloads/start { episodeId, deviceId, deviceName, platform }` (the app also sends its viewing-terms flag the way playback does):
  - runs `playbackGate(req, episodeId)` first — the same answers playback gives (age, terms, early screening, tier or ownership, holds) — then `downloadOffer`;
  - 200 `{ ready: true, url, expiresAt, basis, licensedUntil, paidThrough, item: { episodeId, title, kicker, seriesId, seriesName, season, number, contentType, runtimeSeconds, rating, art, hasCaptions } }` — `art` is an image address the app can fetch and keep (the still, else the poster), `kicker` the words the episode page prints ("Night Bus · Season 1 · Episode 2");
  - 202 `{ ready: false, percent }` while Cloudflare makes the file (the app asks again every 5 s, for up to 5 minutes);
  - 403 `{ code: 'off' | 'title' | 'plan' }` (and the gate's own 403s), 404, 409 `{ code: 'titles' }` / `{ code: 'devices', devices: [...] }`, 422 `{ code: 'kind' }`, 429, 503 `{ code: 'migration-123' | 'cloudflare' }`;
  - writes the device row and the `downloads` row (one active row per phone and title; `licensed_until` from `licensedUntil()`); 60 an hour per account.
- `POST /api/downloads/sync { deviceId, deviceName, platform, have: [episodeId] }` (at most 60 ids; 120 an hour) → `{ enabled, serverTime, paidThrough, plan: { carries, tier }, limits, items: [{ episodeId, state: 'ok' | 'paused' | 'ended' | 'revoked', basis, licensedUntil, endedAt, keepUntil, reason }], deviceRemoved }`:
  - an active row of this phone that isn't in `have` → `removed` (the phone no longer holds it; its slot is free);
  - an id in `have` with no active row → `{ state: 'revoked', reason: 'removed' }`;
  - otherwise `syncVerdict`: `ok` → new `licensed_until`, `basis`, `renewed_at`, `ended_at` cleared; `paused` → nothing changes; `ended` → `ended_at` set once, `keepUntil` returned; `revoked` → the row is `revoked` with its reason;
  - a phone removed from another device → `deviceRemoved: true` and every item `revoked` (reason `device`).
- `POST /api/downloads/remove { deviceId, episodeId }` → `{ ok: true }`.
- `GET /api/downloads/devices` → `{ devices }`; `POST /api/downloads/devices { remove: deviceId }` → that phone and its rows are removed.
- `GET /api/admin/downloads` (**`rc.isAdmin` only — a sub-admin gets 403 whatever capabilities they hold**) → `{ switch: { available, enabled, locked, changedAt, changedBy, lockedAt, lockedBy }, numbers: { phones, copies, titlesOff }, titlesOff: [{ id, title }] }`; `POST { enabled }` → 409 `{ code: 'locked' }` while locked; `POST { locked: true }`; `POST { locked: false, confirm: 'UNLOCK' }` (400 `{ code: 'confirm' }` without the word). Every change is one `audit_log` line (`downloads_switch`, details `{ field, from, to }`) and a security alert mail (awaited), like the Security switches; 30 changes an hour.
- `/api/site-settings` gains `downloadsEnabled`. `/api/episode-page` (and the website's episode page props) gain `download: { state, reason?, basis? }` from `downloadOffer` — `hidden` in a preview.
- The creator switch: `rowToEpisode` → `downloadsAllowed` (a missing column reads true); `FIELD_POLICY.episode.downloadsAllowed` applies at once for the uploader, the show's owner and the team in every state; `PATCH /api/show/episode/<id> { downloadsAllowed }` and `/api/admin/edit-episode { downloadsAllowed }`.

### The rig

`dev/test-rig/bin/cloudflare.mjs` already serves `/stream/<uid>/downloads`, a `downloadable` token and `/<token>/downloads/default.mp4`. A new check `dev/test-rig/checks/downloads.mjs` (seeds and removes its own rows) covers: the switch (full admin on/off, lock, a locked flip refused, unlock needs the word, a sub-admin and a creator 403, audit lines), who may download (Basic and Standard `plan`, Premium, Sponsor, the team, a buyer on Basic; a creator-switched-off title `title`; the switch off `off`; a podcast `kind`; signed out 401; suspended 403), the link really downloads from the fake with the `downloadable` claim and a playback token doesn't, the two limits, check-in dates for a member (paid-through + 2 days, capped), a buyer and the team, a plan that ended (`ended`, `keepUntil`), a title taken down or switched off (`revoked`), a phone removed from the website, and before 123 (`RIG_MIGRATE_TO=122`) every 503.

## 3. Website

- **Admin → Downloads** (`/admin/downloads`, in the Site group after Settings, full admins only — `adminPageProps` with no caps): the switch with the words below, the lock, three numbers (phones, copies on phones, titles whose creators switched it off) and that list.
  - On: "Premium and Sponsor members, and people who bought a title, can keep it in the app and watch offline."
  - Off: "Nobody can start a download. Copies already on phones play until their date and aren't renewed."
  - Lock: a button "Lock this switch"; locked: "Locked on {date} by {name}. Nobody can change it until a full admin unlocks it." and "Unlock…" which asks for the word UNLOCK.
- **`/downloads`** (the tab bar's Watch menu gets a first row "Downloads" while the switch is on): `DOWNLOAD_WORDS.webOnly`, then for a signed-in person their phones (name, how many titles, last seen) with "Remove this phone".
- **The creator's switch**: the web episode editor (More info) and the Library's edit modal — a checkbox "Allow downloads in the app" with "Premium and Sponsor members can keep this title in the app to watch offline. Turn it off and copies already on phones are removed the next time they connect."
- **Words that must stay true**: the AI policy page gets a sentence about downloads (shown only while the switch is on), the Terms and the Privacy page one each (`TEXT_UPDATED`), and `legal/downloads-draft.md` holds them with the questions for the lawyer.

## 4. The app

Dependencies are in `mobile/package.json` already: `expo-file-system` and `expo-network` (both inside Expo Go).

- `mobile/src/lib/downloads.js` — the store and the manager, outside any screen (like `showUploadQueue.js`):
  - a device id made once (`expo-crypto` random, SecureStore `download_device_id`), the device's name from `expo-device`;
  - an index file (JSON, in `Paths.document/downloads/index.json` — small, no video in it): `{ userId, lastSeenAt, lastSyncAt, paidThrough, wifiOnly, items: { [episodeId]: { …the `item` from start, basis, licensedUntil, endedAt, keepUntil, state: 'queued' | 'preparing' | 'downloading' | 'paused' | 'ready' | 'failed', progress, bytes, file, art, captions, resumeSeconds, addedAt } } }`;
  - files under `Paths.cache/downloads/` (decision 9): `<episodeId>.mp4`, the art, the captions `.vtt` (fetched from the gated `/api/captions/<id>` right after start when `hasCaptions`);
  - `File.createDownloadTask` with progress, pause and resume, one download at a time; a paused task's saved state is kept so it resumes; a link that has expired (or a resume the server refuses) starts again with a fresh link from `start`;
  - Wi-Fi only (on by default, SecureStore): on mobile data a download waits with `DOWNLOAD_WORDS.waitingWifi`;
  - `lastSeenAt` moves forward with `highWater` whenever the app is in front; `playState` is asked before a copy plays and once a minute while it does;
  - check-in (`/api/downloads/sync`) on sign-in, when the app comes to the front and the phone is online (at most once every 10 minutes), and when the Downloads page opens; `revoked` deletes the file, `ended` keeps it until `keepUntil` then `removeDue` deletes it, `deviceRemoved` deletes everything;
  - a file the phone cleared is noticed (the index says ready, the file is gone) → `missing`;
  - signing out removes this phone's downloads (`signOutEverywhere` calls `POST /api/downloads/devices { remove }` and deletes the files); a different account signing in never sees the last one's copies.
- `mobile/src/app/downloads/index.js` — the page from the mockup: the summary line and `untilChip`, the rows (art, title, kicker, size, tick / ring / pause, `DOWNLOAD_WORDS.owned` for a bought title, "Resume at 41:10"), the Wi-Fi switch, swipe or a menu to remove, the offline banner, the lock cards from `lockCard` (`retry` re-checks the connection and checks in; `plans` opens `/account/membership`), the empty state, and for an account without the plan `planTitle` / `planBody`.
- `mobile/src/app/downloads/[id].js` — plays the file with `EpisodePlayer` (the site's controls, full screen, captions from the stored `.vtt`, the capture block), resumes from `resumeSeconds`, saves the place locally, and posts watch progress the usual way when online. No ads, no end card, no Tip. `playState` not ok → the lock card instead of the player.
- The episode screen gets the fourth round action from the mockup (`download` from `/api/episode-page`): Download → a ring with the percent (tap pauses) → a tick (tap: Play from this phone / Remove). `plan` shows the button with a small lock and opens a sheet with `planTitle`, `planBody`, `planAction`; `signin` asks them to sign in; `hidden` draws nothing. Errors use the server's `code`: `titles` → `DOWNLOAD_WORDS.titleLimit`, `devices` → `deviceLimit` with the phones listed and "Remove" on each.
- `BottomNav`: "Downloads" first in the Watch menu, with the count, while `downloadsEnabled` is true **or** this phone holds copies.
- **Offline start**: with no connection the app must still open and reach Downloads without waiting on Clerk, the beta door, the suspension check or any fetch. If the phone is offline at launch and the index has copies, land on `/downloads`. The Downloads page and the offline player read only the index and the files.
- Register the screens in `_layout.js` (`headerShown: false`), `PushListener`'s route list, and the Account → Preferences screen gets the Wi-Fi switch too.

## 5. What can't be proved here

No device: local `file://` playback in expo-video (it works in the source, the docs don't promise it), whether a paused download resumes or restarts against Cloudflare, background behaviour, how big Cloudflare's MP4 really is, and whether iOS clears the cache in practice. Say so in the hand-back; don't claim them.

## 6. As built (2026-11-14) — where the code departs from or adds to the above

Both halves were built to this file, reviewed independently, and fixed; these are the shapes as they are now. Where this section and an earlier one disagree, this one is right.

**Dates.** Every date on every route is an ISO 8601 string (`expiresAt`, `licensedUntil`, `serverTime`, `paidThrough`, `endedAt`, `keepUntil`, `lastSeenAt`, `changedAt`, `lockedAt`).

**`POST /api/downloads/start`**
- 200 also carries `serverTime` (the clock the date was worked out on) and `item.hasFlashingLights`.
- Asking again for a title the phone already holds is free: no limit, a fresh link, a renewed date. The app re-asks while it gets 202s, after a restart, when a link is about to run out and after a failed transfer.
- **A new title is counted at its first ask**: a row is written before Cloudflare is asked, with no date (`licensed_until` null), and gets its date with the link. It holds one of the phone's 25 places while it waits. New copies are **30 an hour and 60 a day per account**; the route's own ceiling is 600 asks an hour. A refusal comes at the first ask, never at a later poll.
- Both limits are asked again after the row is written (so racing requests can't pass them); a row taken back at a limit is `revoked` / `revoke_reason: 'limit'`.
- 429 `{ code: 'rate', limit: 'hour' | 'day' | 'requests', retryAfter }` with a `Retry-After` header.
- 403 `{ code: 'app-only' }` on `start`, `sync` and `remove` for anything carrying an `Origin` or `Sec-Fetch-Site` header or signed in by cookie rather than `Authorization: Bearer`. A speed bump, not a lock: a member can still fetch a copy with their own token outside the app, and the public words say so.
- The playback gate's own 403s pass through with their line and no `code`.
- 503 `{ code: 'unavailable' }` whenever something couldn't be read: the switch, the plan (Stripe, Clerk, the comped list, a promo's date), purchases, a suspension. Never "no plan" on a guess.
- The video is made to demand signed links before its MP4 is made.

**`POST /api/downloads/sync`**
- `have` must be an array (400 `{ code: 'have' }` otherwise). `[]` frees every row of the phone. With a list, an unlisted row is freed unless it was licensed in the last 120 seconds; a title still waiting for its file is freed after 120 seconds without a poll.
- `reason` on a revoked item: `title` | `refund` | `device` | `removed`.
- A phone removed elsewhere: its rows are `revoked` / `device`, and `deviceRemoved: true` comes back until that phone's next successful `start`.
- The app does not check in while the phone holds nothing, so a phone becomes one of the two only at its first `start`.

**Phones.** `devices` lists phones holding at least one copy, plus the asking phone once it is on record; only those count toward the two. `GET /api/downloads` leaves titles still waiting for their file out of `items` and `count`, and answers 503 when the plan can't be read. `POST /api/downloads/devices { remove }` answers `{ ok: true, devices }`.

**The episode payload.** `download` in a preview is `{ state: 'hidden', reason: 'preview' }`.

**The creator switch.** Not in `FIELD_POLICY` (`lib/showRules.js` is shared word for word with the app): the server computes `policy.downloadsAllowed = { mode, line }` in `lib/downloadSiteRules.js`, and leaves it out for a podcast (a PATCH sending the field for a podcast is 400 `{ code: 'kind' }`). `GET /api/show/episode/<id>` answers `episode` and `policy` at the top level; they sit under `view` only in the PATCH answer. Films and shorts get the box in Your work's two edit modals on the website and in the app's Your work sheet; `/api/creator/my-submissions` rows carry `downloadsAllowed` and `downloadsAllowedReady`.

**Admin → Downloads.** GET adds `switch.readFailed`; `changedBy` / `lockedBy` are emails; the audit `details` is a JSON string `{ actor, words, field, from, to }`; extra codes 400 `one` / `value`, 409 `changed`. The page and the route read the settings row fresh, never a cached copy. The audit line and the alert mail are best effort, like the Security switches.

**Migration 123** also has check constraints (the device id's shape, the platform, `basis`, `status`) and a third index, `downloads_user_created_idx (user_id, created_at desc)`.

**Account context.** `getAccountContext` gained `paidThrough` (ms) and `billingKnown` (false when Stripe, Clerk, the comped list or the promo read failed).

**Account deletion** is done by hand; `supabase/delete_account_downloads.sql` is its downloads step.

**The app.**
- The wait on Cloudflare: every 5 s for the first minute, 15 s to five minutes, 30 s to twenty.
- Dates are kept in the phone's own clock: `now + (date − serverTime)` (`onPhoneClock`), so a phone whose clock is wrong plays exactly as long as it should. `paidThrough` and `endedAt` are only shown and stay as sent.
- The index is `index.json` plus `index.json.tmp` with a save counter; it is only ever replaced by a move, and nothing is swept unless an index was really read or neither file exists.
- The phone id lives only in the keychain (`WHEN_UNLOCKED_THIS_DEVICE_ONLY`); an index naming an id the keychain doesn't hold is a restored phone and starts fresh.
- Links live in memory only; a paused transfer's state is a file in the cache.
- Sign-out: take the token, sign out, and only then delete the files and tell the server; a sign-out that fails deletes nothing.
- A title whose `start` answers 5xx or 429 steps aside, is retried after 20 s and 60 s, then shows as failed.
- "Try again" always sends the check-in.
- The page-open check-in is spaced 30 s; the chip shows the end of the paid month, not the two grace days after it.
- Films open on their landing, so the Download action is also a pill there.
- Clerk fails for the whole run when the app starts offline; `DownloadsBoot` runs its loader again (`useClerk().loadHeadlessClerk()`, not in Clerk's typings) once the phone is back.
