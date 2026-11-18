# Crew Call, simpler — As built: the website (2026-11-18)

The website half of `mockups/crew-call-simpler-contract.md`. No migration, no
new API route, `lib/crewDirectoryRules.js` untouched.

## Files

- `pages/crew/index.js` — rewritten: the four-tab page (Calls · People · Cast
  · Gear, Calls first and the bare `/crew`). SSR reads the account, the
  viewer's own card (`near`, `hasCard`, `availableNowUntil`),
  `tab = tabFromQuery`, `filters = filtersFromQuery(query, near)` and the first
  answer for that tab only (`listCalls` with the API's own production/team
  rule, `searchCards` + track records, `searchCards` cast, `searchGear`) with
  the filters the API would apply. Client: one filter object per tab (its
  search text included; the opening tab's from `filtersFromQuery`, the others
  `withPlace(emptyFilters(), near, within)`), only the place shared — a new
  place goes to every tab through `withPlace` —, a last answer per tab,
  `fetch(apiPathFor(tab, …))` 250 ms after a change (at once on a tab
  switch), newest answer per tab wins, the list dims while a read is
  pending. A tab switch is `router.replace(tabHref(tab), …,
  { shallow: true, scroll: false })`; a filter change also drops the older
  links' query from the address (so a reload shows what is on screen). The
  red Calls badge (and the Urgent chip's count) is one quiet read of
  `urgentBadgePath(near, within)` on load and whenever the place changes,
  whatever the Calls search and filters are; the page skips that read when
  its own first Calls answer was that very query, and keeps the quiet read as
  Calls' answer when Calls hasn't read yet and would ask the same. A real navigation to
  `/crew?…` remounts the page (`serverKey` prop) so new server props are
  never ignored.
- `components/crew/CrewDirectory.js` — new: the rows (`CallRowItem`,
  `PersonRowItem` (People B), `CastRowItem` (Cast B), `GearRowItem`), the
  empty line, the "Free right now?" strip, the nudge, and the inline icons
  (id card, plus, search, pin, message, close, locate, the eight gear
  categories). Every line comes from the rules.
- `components/crew/CrewFilters.js` — new: the one Filters component. Under
  900px a bottom sheet portalled to `<body>` (`role="dialog"`,
  `aria-modal="true"`, grabber, Filters, Clear all, ×, a sticky "Show N …",
  Tab kept inside); from 900px the same content as a panel under the chip row
  (`aria-modal="false"`, closes on Escape, a click or focus outside). Focus
  goes to the opened section's label (so a phone's keyboard doesn't open by
  itself) and back to the chip that opened it; the opened section is
  scrolled into view; `keepScrollInside` on the sheet's backdrop / the panel.
  Sections per tab as in the contract; Near is `PlaceSearch` (no built-in
  locate button) + our own round "Use my location" + the `WITHIN_STEPS`
  chips (greyed until there is a place).
- `pages/crew/calls/[[...id]].js` — no id: a 307 to `/crew` keeping `urgent`,
  `production`, `kind` (before any account read). An id: `getCall` only (no
  own-card read, no `listCalls`), the existing `CallDetail` under a
  "‹ Calls" pill to `/crew`, at every width (`.ccx-call-page`, max 760px; the
  old phone-only `‹` is hidden there). `new`: unchanged but its crumbs and
  Cancel point at `/crew`. `CallDetail`'s two links to the board (its hidden
  `‹` and the admin Remove's `router.push`) point at `/crew`. The `Board`
  component and its helpers are gone. A read failure other than 404/503 now
  says "Crew Call couldn’t load just now" (it used to show an empty "Pick a
  call."). The Shell's `<title>` is one string (it was an array; React
  warned).
- `pages/index.js` — the two `/crew/calls` links → `/crew`;
  `/crew/calls?production=` → `/crew?production=`.
- `pages/productions/index.js` — "Find people" → `/crew?tab=people`,
  "Calls" → `/crew`.
- `styles/globals.css` — the `.ccx-*` block, before the no-zoom block. Tokens
  only (`color-mix(in srgb, var(--ink) N%, transparent)` for lines, the
  `--brass-rgb`/`--olive-rgb`/`--danger-rgb` tints); every `.crew-*` / `.cc-*`
  rule kept.
- `dev/test-rig/checks/crew-call-simpler.mjs` — new, re-runnable (134 checks).

## Where it differs from the contract, and why

- **The lead's three rule updates of the same day are in**: filters per tab
  with only the place shared (`withPlace`), the badge from
  `urgentBadgePath`, and the words `showButton`, `urgentChip` (the chip and
  the Urgent switch's label, `urgentChip(0)`), `productionChip`,
  `moreLabel`, `hoursLabel`, `menuChip`, `REMOVE_FILTER_HINT` (the × on the
  production chip, as its label and title). Words still written in the
  components: the locate notes (PlaceSearch's own sentences) and a few aria
  labels ("Search calls", "Clear the search", "Distance", "Message <name>",
  "Ask <name> about <piece>").
- **The name row wraps**: the tier and ✓ creator chips go under the name
  when the row is short (a 320px phone) instead of squeezing the name (the
  app builder's finding); checked at 320.
- **Empty "filtered"**: a place with a distance counts as a filter, so an
  empty list near your own place says "Widen the distance…".
- **On a laptop the search and the chips share one line** (as the board
  "On a laptop · Calls" draws it), the search 320 × 40; Gear's categories wrap
  under the place chip there.
- **The nudge on a laptop** takes the same 300px side slot as the free card
  (the contract only placed the free card).
- **"I'm free" on a phone**: the four choices replace the button; when they
  don't fit beside the text (390 and under) they wrap to a line of their own
  inside the strip.
- **Gear's category chips use the orange "on"** (the contract's rule for all
  chips); the Gear board drew the selected "All" in a neutral tint.
- **The gear owner line links to the owner's profile** (the board drew plain
  text).
- **Cast rows show no "✓ creator"** (the contract says name + TierChip; People
  rows show it).
- **Before hydration a free person reads "⚡ Free right now"** and the strip's
  title "⚡ Free right now": the clock time in "Free until 6 PM" is the
  viewer's own zone, which the server can't know; the time appears once the
  page has hydrated, so the two renders never mismatch.
- **The Message pill on a laptop People card is text only** (no icon), as
  the board.
- **The tablist** has arrow-key / Home / End movement and roving tabindex.

## Checked

- `node dev/test-rig/checks/crew-call-simpler.mjs`: 134 ok, 0 FAIL (with
  `SHOTS=` it keeps a screenshot of every tab at 390 and 1280).
- `node scripts/test-crew-directory.mjs` 12, `node scripts/test-sign-in-here.mjs`
  5, `npm run check:refs`, `npm run lint`.
- The earlier checks that touch these pages and the smoke pass (see the
  report for their counts).
- Screenshots looked at against the boards: Calls, People, Cast, Gear at 390
  and 1280 (signed out and as a card holder), the strip choosing, the sheet
  on People and Calls, the panel on People, the call on its own, 900px.
- Not run: `next build` (the lead runs it). Not seen with Clerk's real
  browser script (the rig doesn't load it): a signed-out Message / Sign in
  is checked against a stand-in that records what the site asks it to open.
