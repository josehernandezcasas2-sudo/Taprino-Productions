# Part C as built — productions in the app (2026-11-19)

The app's half of part B of `mockups/productions-yearly-contract.md`, from the
routes and rules part B built (`mockups/productions-yearly-asbuilt-web.md`).
Only files under `mobile/` changed; the two rules copies
(`mobile/src/lib/productionDashRules.js`, `mobile/src/lib/siteMenuRules.js`)
were **not** edited — the review commit `5918bfe` changed the first one while
this part was being built, and the screens use it as it is (`PRODUCER_ROLE`
on whole titles, the dashboard's `onCrew` for its Message buttons,
`MANAGE_WORDS.onHold`). No migration, no new route. Nothing committed.

## What was built, file by file

### New

- `mobile/src/app/productions/[id]/dashboard.js` — the production dashboard
  (the DashPhone board). One read, `GET /api/productions/<id>/dashboard`
  (Bearer), drawn from `productionDashboard(facts)`. TopNav, pull to refresh,
  the phone board's order: ‹ Your productions, the kicker, the title, the
  status pill (`Prep ▾`, a sheet of `head.status.options`, greyed ones off;
  no ▾ and no sheet when `locked`) and the meta line with "grew out of the
  pitch <title>" (a link), the five round actions (Post a call · Add a day ·
  Book a place · Message crew · Edit), the tabs as chips (short words; the
  long ones from 700pt wide), then on Overview the four numbers (2 × 2; one
  row of four from 700pt, with `subLong`), Needs you (the short link words;
  `link.label` from 700pt), Funding, Calls, Crew, Shoot days, Places,
  Release & distribution and "See it as the crew does ›"; Overview cuts rows
  at `OVERVIEW_ROWS` / people at `OVERVIEW_PEOPLE` with "All N ›" to the tab.
  Each tab is its section in full: Crew with Message / Worked it / Remove
  (Remove asks first with `removeQuestion`) and + Add someone; Days with
  "Call sheet ›" on each row and + Add a day (the app's `DayForm`, the
  answer's `bookedPlaces`); Money with the funding in full and **Post an
  update** (`/api/creator/pitch-update` with `alsoBackers: true`, then
  `DASH_WORDS.updatePosted`), crew pay lines, places paid, the requests;
  Release. `?tab=` opens a tab and the chips keep it in the address
  (`router.setParams`); `?started=1&told=` shows `startedFlash(told)` once
  and is cleared from the address. A rules href that is this dashboard
  (`?tab=money#update`, `?tab=crew`, `?tab=days#add-day`) switches the tab
  in place and scrolls to the tabs; every other href goes through
  `hrefToRoute`. The Message buttons start a conversation the app's way
  (`startConversation`, kind `production`, ref = the production) and show
  only where the rules give `actions.message` (so, since `5918bfe`, only for
  someone on the production). Every write (status, members POST / PATCH /
  DELETE, days PUT, the update) reads the dashboard again. A 401 / 403
  (signed out, on the crew but not running it, a stranger, a held
  production for anyone but a full admin) replaces the screen with the
  production screen, as the website's 307 does; a 404 says the server's
  line; anything else says `DASH_WORDS.failed` with Try again.
- `mobile/src/app/productions/mine.js` — Your productions (the YourProds
  board): the title and the round + (→ `/productions/new`), the tabs
  `mineGroups(items).tabs` as chips (`?tab=running|crew|done`, kept by
  `setParams`), the cards from `yoursCard` (status word in its colour, line,
  stats, "N need you", Open the dashboard — filled when something needs them
  — or Open the production), and on Running the dashed "Got a pitch?" cards
  from `readyPitchCard` whose "Start from the pitch ›" opens the start sheet.
  Signed out: `MINE_WORDS.signIn` + Sign in (→ the account card, nothing
  read). A failed read: `MINE_WORDS.failed` + Try again. Pull to refresh;
  read again on focus.
- `mobile/src/components/productions/StartSheet.js` — the start sheet (the
  StartSheet board) in `messages/MessageSheet.js` (`fill`; the keyboard pads
  it, every orientation, a 560pt column in the middle from 600pt wide). All
  words from `startSheet(pitch, backers)`: kicker, title, sub, labels, the
  kinds as chips (`kindFromTag`; none for Animation → "Pick one" and the
  button off), two date fields, Based in (the app's `PlaceBox`), "Keeps
  taking backing" as a ✓ row (as on the website), "Tell my N backers" /
  "Tell the people following it" as a `Switch`, the visibility note, Start the
  production. POST `/api/pitches/<id>/production`; 201 → the sheet closes and
  the new dashboard opens with `?started=1&told=<toldState>`; a 409 `exists`
  shows the server's line and **Open its dashboard ›** (the one the pitch
  has). On a screen under 500pt tall (a phone sideways) the sub line is left
  out and the title is 20pt so the fields keep room to scroll.
- `mobile/src/components/productions/DashBits.js` — the pieces those screens
  share, in the app's tokens (the website's `.pd-*` / `.ypr-*` looks): tone
  colours for the rules' tones, status colours, the five action icons (the
  website's SVG paths), BackPill, Card, SmallLink (44pt tall), Bar, Row, Btn,
  Flash, StatusPill / StatusWord, StatusSheet (MessageSheet), TabChips,
  UpdateForm.
- `mobile/src/components/productions/AddMember.js` — "+ Add someone" moved
  out of the production screen (as the website moved its own) so the screen
  and the dashboard share it; unchanged words and behaviour.

### Changed

- `mobile/src/app/pitches/[id].js` — the PitchNow board: "● IN PRODUCTION" on
  the art, the card from `pitchProductionCard` (→ the production) above the
  backing, `pitchOwnerAction` (Start the production → the start sheet with
  the pitch and `backerCount`; or Open its dashboard ›), and a **Crew needed**
  card (the app had none) — `crewNeededHead` (title with the count, "All
  calls ›" → `/crew?production=`, the note), the merged `crewCalls` with the
  app's `CallCard`, `PITCH_WORDS.noCalls` when none, and for the pitch's
  owner `DASH_WORDS.postCall` → the call form under the production (or for
  the pitch when it has none). The screen reads the pitch again when it comes
  back into view, so after starting, Start has become Open its dashboard.
- `mobile/src/app/creator/pitches.js` — Your pitches: `pitchBox` on each
  approved pitch ("Ready to shoot it?" + Start the production → the sheet
  with `backers[pitchId]`; or "IN PRODUCTION · Shooting from … · Open its
  dashboard ›"). No box when the route's `productions` is null.
- `mobile/src/app/productions/[id]/index.js` — "Dashboard ›" at the top when
  the answer has `dashboardHref`; the Funding card from
  `productionFundingCard(funding)` (kicker, %, line, bar, Back it › → the
  pitch, or On the pitch page ›); and the producer rules the website page
  got: the status chips are `MANAGER_STATUSES` for someone who isn't the
  owner (locked on an archived / removed one), Distribution & screeners,
  Archive and the release link are `canOwn`'s, Remove follows the owner /
  producer rule (`isProducerRole`), the booked places for the day form are
  read for anyone running it. **Message on the crew rows** (the
  coordinator's fix of 2026-11-19): `(isOwner || isMember) && canEdit` — see
  "Not followed exactly" below.
- `mobile/src/app/productions/[id]/edit.js` + `mobile/src/components/ProductionBits.js`
  — `ProductionForm` takes `ownerFields`; a listed producer's edit form
  leaves out "Who sees it" and "Grew out of" and never sends them (as the
  website's).
- `mobile/src/app/productions/index.js` — a "Your productions ›" button for
  someone signed in.
- `mobile/src/components/SiteMenu.js` — the ☰ menu's **Running now**
  (`menuRunning`, passed to `siteMenu({ running })`): read from
  `GET /api/productions/running` (Bearer) as the menu opens signed in, kept
  two minutes per account (`countsFresh`), dropped signed out, a failed read
  leaves the card out. Drawn above the Connect / Stream switch: "RUNNING NOW",
  the count, up to two rows (title, line · "N need you" in the accent, Open —
  the first filled), "All your productions ›".
- `mobile/src/components/PushListener.js` — `hrefToRoute`:
  `/productions/<id>/dashboard` keeps `?tab=` (one of the six), 
  `/productions/mine` keeps `?tab=`, and **`/crew/calls/new` now keeps
  `?production=` / `?project=pitch:<id>`** (it dropped them before, so the
  dashboard's Post a call would have opened an empty form).
- `mobile/src/app/_layout.js` — `productions/mine` and
  `productions/[id]/dashboard` registered `headerShown: false` with the other
  production screens.
- `mobile/src/lib/api.js` — a failed request's Error now carries the answer
  as `err.data` (the start sheet reads the 409's `code` / `dashboardHref`).

## Checks

- `cd mobile && npx expo export --platform ios --clear` and `--platform android --clear`
  (output in the scratchpad): both bundle (2371 / 2367 modules), on the final code.
- `npm run check:refs` — ok (1161 files); `npm run lint` — clean.
- Every `scripts/test-*.mjs` — 70 files, 0 failing (`test-production-dash`
  16 checks, `test-site-menu` 16, both comparing the app copies word for word).
- A react-native-web harness of the real screen files
  (`/tmp/claude-0/-home-user-Taprino-Productions/7fff803f-6183-5d77-9149-e0c8a3c64074/scratchpad/prod-app/`,
  not committed): `seed.mjs` seeds a run on the rig (owner, producer, crew,
  backer, stranger; three approved pitches and a pending one; the production
  started through the real route; crew, calls with answers, secured pay held
  and not funded, days, two place requests, backers quiet 17 days),
  `harness/` is the app bundled for the web with stand-ins for expo-router
  and Clerk only, and every `/api/` request goes **to the rig** through the
  harness server with the persona's real session (no Origin, as the app
  sends). `check.mjs` — **141 ok, 0 FAIL** on the final code, the expected
  words computed by the rules from the rig's own answers: hrefToRoute (8);
  the dashboard as the owner at 390 (head, actions, tabs, numbers, Needs you,
  the cards in the board's order, every row; status sheet → Shooting → back
  to Prep against the database; a Needs-you link switching the tab vs one
  pushing; the actions; Crew tab Message / Remove / no Worked it before the
  last day; Message → `/messages/new` about the production; + Add someone by
  @handle; + Add a day; a day row → its call sheet; Money with Post an update
  `alsoBackers`; Release; Remove with its question), `?tab=days`,
  `?started=1&told=later`, 320×640 and 844×390 (no sideways scroll, long
  words and four numbers in a row when wide); the producer (no Archived, the
  owner's distribution note, no Remove on the owner); a stranger, a crew
  member and signed out sent to the production screen; a failing route;
  Your productions as the owner (cards, Got a pitch?, tabs, +), as crew
  (`?tab=crew`), signed out, failing (at 320); the pitch page as the owner,
  a stranger at 320 and on a pitch with no production (Start → the sheet
  filled in, × closes); Your pitches → Start for Paper Moons (Animation → Pick
  one, Short, a date, tell off) → POST → the new dashboard with its line →
  back, In production; Your productions sideways → the sheet (compact head, a
  centred column) → started elsewhere meanwhile → 409 → Open its dashboard;
  the production screen as a stranger (Funding card → the pitch), the
  producer at 320 (Dashboard ›, no Distribution / Archived / Archive) and the
  owner; Message on the crew rows hidden for a full admin not on it (dashboard
  and production screen) and shown for the owner and the producer; the edit
  screen (the producer's form without the owner's fields, its PATCH without
  them, accepted); the ☰ menu's Running now (above the switch, two of three,
  All your productions ›, read once in two minutes, Open → that dashboard),
  none for someone running nothing (320), on a failed read (844×390) or
  signed out. No page errors anywhere. `teardown.mjs` removed the seed.
  (Two earlier runs failed only on the rig: the dev server recompiling after
  the review commit, and an 11-second wait on the menu's reads.)

## Only a device can show

- The start sheet with the keyboard up on both platforms (MessageSheet's
  KeyboardAvoidingView around a sheet whose own list scrolls), the RN
  `Switch`, and the sheet closing (its Modal animating out) while the new
  dashboard is pushed on iOS.
- Real expo-router: `router.setParams({ tab })` and `setParams({ started: undefined })`
  keeping and clearing the address, the static `productions/mine` beating
  `productions/[id]`, `useFocusEffect` reloading the pitch screen on return.
- The Status sheet and the iOS `Alert` for Remove; pull to refresh; the ☰
  menu's Running card inside its Modal with VoiceOver / TalkBack; touch
  targets with real fingers; Android back on the sheets.
- Nothing ran against real Clerk, Stripe or Cloudflare.

## Not followed exactly, or for you to decide

1. **Message on the production screen's crew rows**: the coordinator asked
   for `(data.isOwner || data.isMember)` *instead of* `data.canEdit`. The
   website's link sits inside its `canEdit` block, so its condition is
   `canEdit && (isOwner || isMember)`; replacing `canEdit` outright would have
   given every plain crew member a Message button on every row (they have
   "Message the producer" instead). The app checks both, to match the
   website.
2. Words that aren't in the rules: "Try again" (the dashboard's and Your
   productions' failure state, as elsewhere in the app), "Cancel" on the
   Remove question, the date fields' "YYYY-MM-DD" placeholder (the website
   uses a native date input; the app types dates on all its production
   forms), and the existing words of `AddMember`, `DayForm` and `PlaceBox`
   (the website's AddMember / DayForm aren't in the rules either).
   `PlaceBox` always offers "◎ Near me"; the website's sheet turns locating
   off (`allowLocate={false}`), the app's PlaceBox has no such switch.
3. The pitch page's owner button under Crew needed says
   `DASH_WORDS.postCall` ("+ Post a call"); the website says "+ Post a call
   for this project" (a page word, not in the rules). Crew needed's rows are
   the app's existing `CallCard` (the website uses its existing call rows).
4. The dashboard's Message buttons use the rules' `actions.message` as the
   condition but open the conversation with `startConversation` (the app's
   `/messages/new`), not the rules' website `/messages?to=` href.
5. A held production's dashboard (403 `not-manager` with `MANAGE_WORDS.onHold`)
   goes to the production screen without the line, as the website's page
   does.
6. `mobile/src/lib/api.js` changed (one field on the Error), which every
   screen shares.
