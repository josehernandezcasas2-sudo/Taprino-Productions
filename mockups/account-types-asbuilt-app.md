# Account types, phase 1 — the app, as built

The app half of `mockups/account-types-contract.md` ("The app", items 1–6). Files under `mobile/` only; `mobile/src/lib/accountTypeRules.js` was not touched. No plans, prices, badges or plan names anywhere.

## What was built, file by file

**New**

- `mobile/src/app/start.js` — the question (the Main board). The brand strip ("Studio **Tapa**" + Skip at the right, as the website's `/welcome` bar), `TYPE_WORDS.askTitle` / `askIntro`, the four `askCards(pick)` as checkbox cards (icon tile in the type's tint, label, the `MAIN` chip on the main, blurb, tick box), a "Main" radiogroup of the ticked types when two or more are ticked (`makeMain`), `askSkipNote`, then a fixed foot: the orange `continueLabel(...)` button (disabled while nothing is ticked; it grows to two lines on a narrow phone with four ticked) and `skipLong`. It asks `GET /api/account/types`; `suggested` is the starting pick (its first the main). Continue → `POST { types, main }`; either Skip → `POST { skip: true }`; then on to `next`. 503 (`migration-126`) goes on silently; any other failure shows `TYPE_WORDS.failed` and stays. Already answered, or `available: false` → straight on to `next`. Clerk signed out → `/account`. A failed read shows a couldn't-load line with **Try again** and **Not now** (on without saving) — never the question, because a Skip from a question shown on a guess would wipe types the person already has. `next` must be an app path (`/…`, no `//`, no `\`, not `/start` itself), else `/` — expo-router opens `//host` externally. Phone column full width; from a tablet the same column centred at 520pt.
- `mobile/src/components/account/AccountTypeBits.js` — everything drawn about types, words from the rules: `TYPE_TINT` + `TypeGlyph` (the board's four icons), `TickBox`, `TypesLine` (typesLine with the main's label in gold), `useAccountTypes({ refreshOnFocus })` (the GET as `{ status, state, retry, setState }`; it also follows changes published to the menu's copy of `/api/my-role` after the screen opened, so a switch in the ☰ menu shows on the Profile row under it), `TypesNudge` (the hub card), `TypesCard` (Account → Profile's row via `typesRow`), `TypesSheet` (the Switch board in `messages/MessageSheet.js`), `MenuTypes` (the ☰ you card's block via `menuTypes`).
- `mobile/src/lib/accountTypes.js` — `readAccountTypes(getToken)`, `saveAccountTypes(getToken, body)` (publishes the saved state to the menu's copy), `switchMainType(getToken, state, type)` (optimistic: the menu's copy changes first, a failure puts it back and throws), `isNotReady(err)` (503).

**Changed**

- `mobile/src/lib/adminRole.js` — `setRoleAccountTypes(accountTypes)` (puts a saved state into the `/api/my-role` copy every `useAdminRole` holds) and `currentRole()`.
- `mobile/src/app/_layout.js` — `start` with `headerShown: false`.
- `mobile/src/components/BottomNav.js` — no bar on `/start` (next to the `/messages/<id>` rule).
- `mobile/src/components/dashboard/useSignInLanding.js` — `land()` now asks `GET /api/account/types` after reading the role; when `askDue`, `router.replace('/start?next=<landing or the current screen>')`. A failed read lands as before. This covers the general sign-in card (`AccountFrame` with `?signin=general`) and the beta door (`PrivateBetaGate`). Mid-task sign-ins (no mark) still go back and are never asked.
- `mobile/src/app/account/index.js` — the hub's nudge above the tiles while `askDue` (`useAccountTypes({ refreshOnFocus: true })`): `askTitle`, `askSkipNote`, **Pick** → `push('/start?next=%2Faccount')`, `TYPE_WORDS.skip` → `POST { skip: true }` then the card goes (a failure shows `failed`; a 503 just hides it).
- `mobile/src/app/account/profile.js` — the Your types row first on the screen, the sheet on Change; `?types=1` opens the sheet once the row has loaded and clears the param (closing it doesn't reopen it). The sheet saves on its own (never with Save profile), closes on success, updates the row and the menu; the creator note's link closes the sheet and opens `/apply`.
- `mobile/src/components/SiteMenu.js` — under the name, `menuTypes(state).line` in the plan line's style; then `MenuTypes` (label + chips radiogroup with the main filled gold, the note, the dashed "+ Add a type"). The state is `useAdminRole().accountTypes`; none of it signed out or when it's null (before 126). "+ Add a type" closes the menu and pushes `/account/profile?types=1` (on that screen already, it sets the param there instead of stacking a second copy).
- `mobile/src/components/PushListener.js` — `hrefToRoute('/account/profile#types')` (and `?types=1`) → `/account/profile?types=1`.
- `mobile/src/app/profile/[userId].js` — `TypesLine` under the name row (nothing for a watcher); the page's sections are now a list of `{ key, render }` drawn in `mainFirst(sections, main)` order: About `about` (it used to sit inside the hero; its 4pt bottom margin moved with it), Working card `card`, Track record `record`, Locations `places`, Latest post + Posts `posts`, Saved Snippets `saved`, Tagged in `work`, Pitch Room projects `pitches`, Projects backed `backed` (the last two of the unmapped keys keep their place among the rest). Each section's own condition stays inside its render, unchanged.

## Deliberate departures (small)

- Leaving `/start` uses `router.dismissTo(next)` rather than `router.replace(next)`. In expo-router 58 `dismissTo` is React Navigation's POP_TO: when `next` isn't in the stack it takes `/start`'s place exactly like `replace`; when it is (the hub's Pick pushes `/start` over the hub; a Dashboard already under the sign-in card) it goes back down to it instead of stacking a second copy. Entering is as written: `replace` from the landing, `push` from the hub's Pick so Back returns to the hub.
- On `/start` a failed read shows Try again / Not now instead of the question (see above). A refusal there while Clerk says signed in counts as "couldn't load", not a bounce to `/account`.

## Words missing from the rules file (please add to both copies if you want them there)

- **"Pick"** — the hub nudge's button (the contract names it; `TYPE_WORDS` has no `pick`). It is a local constant `PICK` in `AccountTypeBits.js`.
- Couldn't-load / loading lines written in components, as the contract allows: "Loading…", "Your types didn’t load.", "Try again" (the Profile row); "This didn’t load. Check your connection and try again.", "Try again", "Not now" (`/start`).
- The brand strip's "Studio Tapa" wordmark is the app's existing wordmark, not a types word.

## Board details not followed (on purpose)

- The MenuCard board's note says "Both cards stay."; the rules' `menuSwitchNote` ("Your other types stay.") is used.
- The Switch board puts the creator line in the note box for everyone; the rules give it per row (`sheetRows(...).note`) only when Creator is ticked by someone without the role — followed the rules.
- The Profile board colours the main gold and the second type mint; `typesLine` is one string, so only the main's label is coloured (gold) and the rest stays in the line's colour.
- The boards' plan, Ultra/Pro rows, verified badge and prices are left out, as the contract says.

## What was checked

- `cd mobile && npx expo export --platform ios --clear` and `--platform android --clear` (output in the scratchpad): both exit 0.
- `npm run lint`, `npm run check:refs`: clean. `node scripts/test-account-types.mjs`: 14 checks pass (the app copy is still the website file word for word).
- A react-native-web harness of the real screens (`start.js`, the hub, Account → Profile, the public profile, the real TopNav / ☰ menu / BottomNav / `useSignInLanding` / `AccountFrame`) against fixtures in the routes' shapes (GET/POST `/api/account/types` validated with the rules' own `validateTypesInput`, `/api/my-role` with `accountTypes`, `/api/profile` with `accountTypes`), with a stand-in router that records push / replace / dismissTo / setParams. Kept in the scratchpad, not the repo. **95 checks pass**, among them: the question's cards, ticks, main chips and button label through tick / untick / make-main; Continue and both Skips post the right bodies and go on to `next`; a failed save stays with the line; 503 goes on; answered / before-126 go straight on; signed out → `/account`; `//evil.example` → `/`; a failed read never shows the question; 320 and 390 with nothing off the side and Continue on screen at 640pt tall; the landing asks a fresh viewer (next = the hub) and a fresh creator (next = the Dashboard), doesn't ask someone who answered, lands as before on a failed read, and never asks after a mid-task sign-in; the hub nudge (Pick → question → back to the hub with the nudge gone; Skip; a failed Skip); no nudge for answered / skipped / before 126; the Profile row (Here to watch, greyed with the note before 126, failed read with Try again); the sheet (rows, MAIN pill, Make main, the creator note and its `/apply` link, × discards the draft, a failed save stays open, Save posts and closes, the row and the ☰ menu update at once); `?types=1` opens it once; the menu (line, radios in the rule's order with the main gold, the switch showing before the save answers and posting the new main, a failed switch put back with the line, "+ Add a type" to the sheet from another screen and on the Profile screen itself, one type / four types / watcher / before 126 / signed out); a switch in the menu showing on the Profile row underneath; the public profile's order for Crew, Creator, Studio and watcher mains; `hrefToRoute` for `#types` / `?types=1`. The real answers of `GET /api/account/types`, `/api/my-role` and `/api/profile` were also read from the rig on :3100 to match the fixtures' shapes (nothing was posted to the rig).

## What only a device can show

- `router.dismissTo` / `replace` / `setParams` on real expo-router (the harness's router is a stand-in with the same meanings), including `setParams` from the ☰ menu's Modal reaching the Profile screen under it.
- The sheet over the stack on iOS and Android (MessageSheet's Modal), VoiceOver / TalkBack moving to the sheet's title, the checkbox and radio roles as announced on each platform.
- The landing right after Clerk's hosted sign-in: the session reaching the server before the types read (the role read already retries up to four times first).
- The dashed "+ Add a type" border on iOS.
