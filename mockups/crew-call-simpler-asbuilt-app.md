# Crew Call, simpler — as built, the app (2026-11-18)

The app's half of `mockups/crew-call-simpler-contract.md`. No migration, no new
API route; `mobile/src/lib/crewDirectoryRules.js` is the lead's (revised the same
day after this builder's first report: `withPlace`, `urgentBadgePath`,
`showButton`, `urgentChip`, `productionChip`, `moreLabel`, `hoursLabel`,
`menuChip`, `REMOVE_FILTER_HINT`, and `apiPathFor` taking a partial object);
the app uses all of them and builds no words of its own.

## Files

- `mobile/src/app/crew/index.js` — rewritten: the four-tab screen (TopNav, title
  row, Calls · People · Cast · Gear, search, one chip row, the free strip or the
  nudge on Calls, the list, empty states, pull to refresh, the Filters sheet).
- `mobile/src/components/crew/CrewDirectoryBits.js` (new) — `TitleRow`,
  `TabSwitch`, `Pill`, `ChipRail`, `RailRule`, `FreeStrip`, `Nudge`, `EmptyList`.
- `mobile/src/components/crew/CrewRows.js` (new) — `CallRow`, `PersonRow`
  (People B), `CastRow` (Cast B), `GearRow`.
- `mobile/src/components/crew/CrewFilters.js` (new) — the Filters sheet, on
  `components/messages/MessageSheet.js` (reused as is: grabber, dimmed screen,
  ×, Android back, tap outside, every orientation, keyboard padding).
- `mobile/src/components/crew/CrewIcons.js` (new) — the boards' glyphs (card, +,
  pin, locate, message, close, the empty-list icons, one per gear category).
- `mobile/src/components/CrewBits.js` — additive only: `PlaceBox` takes an
  optional `look` (the sheet's 44pt field with a pin, 16pt text, icon buttons
  "Use my location" / "Clear place"; without it, the old look), and two new
  exports `avatarColor` / `avatarInitials` (the Cast box with no photo). Every
  existing export is kept.
- `mobile/src/app/crew/calls/index.js` — a `<Redirect>` to `/crew` keeping
  `urgent`, `production`, `kind`.
- Links to the board now go to `/crew`: `crew/calls/[id].js` (‹ Calls fallback),
  `crew/calls/new.js` (‹ Calls), `crew/tape.js` (back fallback), the home
  screen's "Open calls" row, Productions' "Calls" button.
- `mobile/src/components/PushListener.js` `hrefToRoute`: `/crew/calls` with no id
  → `/crew` keeping its query; `/crew` keeps `tab`, `free`, `urgent`,
  `production` (uuid), `kind` (SCREEN_KEEP). `/crew/calls/<id>` unchanged.

## As the contract says

Tab from `tabFromQuery(params)`, switched with `router.setParams({ tab })`;
older links through `filtersFromQuery`. Reads: `apiGet(apiPathFor(tab, f),
freshToken)` (no token signed out), 250 ms debounce, newest answer wins per tab;
own card from `/api/crew/card`; vocabularies from `/api/crew/options` (kept for
the app's life); pay types `{ paid, union, deferred, unpaid, other }`. The Calls
badge is the urgent calls near the viewer's place whatever the Calls tab's search and
filters are: a quiet read of `urgentBadgePath(near, within)` on focus and
whenever the place changes, taking its `urgentCount`. Each tab keeps its search and its last answer (switching
back draws at once and reads again quietly). Message → `/messages/new` with
`{ to, kind, label }`; signed out → `/account`; a row → its `profilePath`; a call
→ `/crew/calls/<id>`. Free strip: "I'm free" shows 4 h / 8 h / 12 h / 24 h in its
place (with a × to back out), `POST /api/crew/available-now { hours }`, "Turn
off" posts 0. Avatars go through `CrewBits` `Avatar` / `PositionedImage` with
their focal point and zoom (the Cast box with no headshot shows the photo at its
focal point in the 54×68 frame). `useAuth` from `lib/stableAuth.js`.

## Where it differs, and why

- **Filters per tab, one shared place** — now the rule: each tab keeps its own
  filters (with its own `q`); `withPlace(byTab[tab], near, within)` carries the
  shared place into the tab's filters. An older link's filters go to the tab it
  opens. Clear all clears the tab's own object (`clearedFilters(tab,
  byTab[tab])`); the place stays.
- **Words**: none built in the app any more — the sheet's button is
  `showButton`, the chips `urgentChip`, `productionChip` (the first call's
  `productionTitle`), `menuChip` ("Pay ▾", "Role ▾", "Playing age ▾",
  "Union ▾"), the roles' `moreLabel`, the strip's `hoursLabel`, the production
  chip's hint `REMOVE_FILTER_HINT`, the sheet's Urgent switch `urgentChip(0)`.
- **Gear categories' "on"** is the orange tint, as the contract says (the Gear
  board drew "All" in an ink tint).
- **The name row wraps**: name first, then `TierChip` and "✓ CREATOR", which go
  under the name when the line is short (on a 320pt phone the name was squeezed
  to one letter otherwise).
- **Cast rows**: no green "open" dot on the headshot (the contract and the board
  only ring the free ones); "✓ CREATOR" is shown when verified, like People.
- **The gear row** (tile + lines) opens the owner's profile, as the old Gear card
  did; Ask is its own button.
- **No laptop layout in the app**: on a tablet the phone layout sits in a 760pt
  column (no 2/3-column grid, no side free card); a phone held sideways keeps the
  phone layout and the sheet is MessageSheet's centred 560pt column.
- **Toggles** are `accessibilityRole="togglebutton"` with `checked`; the tabs
  `tab` with `selected`; the switch rows `switch` (the RN `Switch` inside is
  hidden from a screen reader so it isn't read twice).
- Focus back to the chip that opened Filters uses
  `AccessibilityInfo.sendAccessibilityEvent(el, 'focus')` (guarded; a no-op on
  the web harness).

## Checked

- `node scripts/test-crew-directory.mjs` — 13 checks passed (after the lead's
  revision).
- `npm run check:refs` — ok; `npm run lint` — clean.
- `npx expo export --platform ios` and `--platform android` (with `--clear`) —
  both bundled (2360 / 2356 modules).
- `hrefToRoute` against ten addresses (scratchpad `href-crew.mjs`).
- A react-native-web harness of the real screen files against fixtures in the
  API's shapes (scratchpad `crew-harness/`, the Messages harness's stand-in
  router and Clerk): 89 checks — order and words on Calls, the badge (still
  "2 urgent" after a search that leaves none, read from the bare
  `urgentBadgePath` near the place, read again when the place changes), the read
  near the card's place, no count line/eyebrow/intro, a row → its call, the free
  strip's four choices / 8 h / Turn off, the Urgent chip, search per tab and the
  quiet re-read on switching back, the People sheet (sections, "+ 20 more", a
  role, a switch, Clear all keeping the place, ×, Escape, Role ▾), the place
  cleared / searched / picked / widened, Message and a row's profile, Cast's
  playing age and union (16pt fields), Gear's categories and Ask and its
  Near-only sheet, the Calls sheet (Kind, Role, Pay, switches, Clear all), no
  card (dot, nudge, Set it up), signed out (nudge, + / card / Message →
  /account, unsigned reads), `/crew/calls?urgent=1&kind=cast` redirected with
  both kept, `?free=1`, `?production=` with its "For Night Bus" chip and ×, the
  four empty lists, a failed read, the sheet sideways and at 320; no page
  errors and nothing off the side at 390, 320 and 844×390. Screenshots in
  scratchpad `crewshots-app/`.

## Only a phone can show

The sheet over the keyboard (the playing-age fields scroll up when tapped),
Android's back button and a tap outside closing it, the sheet sideways with real
insets, VoiceOver/TalkBack focus going into the sheet and back to the chip,
"Use my location" (expo-location's permission prompt) from inside the Modal,
pull to refresh, the RN `Switch` look on each platform, and the real
expo-router's `setParams` / `<Redirect>` with params.
