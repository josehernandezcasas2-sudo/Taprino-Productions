# Crew Call, simpler — build agreement (2026-11-18)

Signed off by Jose on the canvas https://claude.ai/artifact/NAcrMSstXHTCP2HuysLCjp:
"calls should be its own tab for now, make it the first page", then "I like both Bs":
**People B** (each person carries one gear line) and **Cast B** (rows with a small headshot).
Website and app the same. **No migration, no new API route.**

The boards to match: "Calls · where Crew Call opens", "Calls · not on the board yet",
"Filters, open (People)", "Gear", "People · B: one gear line", "Cast · B: rows",
"On a laptop · Calls (first page)", "On a laptop · People". Colours are the site's
tokens (`styles/globals.css` `:root`; the app's `mobile/src/lib/theme.js`).

## The shared rules (done, do not edit)

`lib/crewDirectoryRules.js` — the app's `mobile/src/lib/crewDirectoryRules.js` is the
file word for word; `node scripts/test-crew-directory.mjs` (12 checks). Every label,
count line, row line and API query on the page comes from it: `CREW_TABS`,
`TAB_LABELS`, `tabFromQuery`, `tabHref`, `filtersFromQuery`, `emptyFilters`,
`searchPlaceholder`, `placeChip`, `withinLabel`, `WITHIN_STEPS`, `filterCount`,
`filtersLabel`, `clearedFilters`, `apiPathFor`, `personRow` (+ `gearLine`,
`personStatus`, `rateText`), `castRow` (+ `playingAgeText`), `callRow` (+ `payText`,
`callDates`), `gearRow`, `emptyLine`, `freeStrip`, `FREE_HOURS`, `CREW_WORDS`.
If a builder needs a change in it, they report it instead of editing it (both copies
change together, by the lead).

## The page (website `/crew`, app `crew/index.js`)

Top to bottom:

1. **Title row**: "Crew Call" (Fraunces 28 on a phone, 32 on a laptop), then the
   **card button** (round 44px outline, the id-card icon; `aria-label` "Your card",
   or "Set up your card" with a small orange dot when the viewer has no card) and the
   **+ Post a call** button (round 44px orange). From 900px both are labelled pills
   ("Your card", "+ Post a call"). Signed out, both open sign-in in place
   (website `SignInHere`; app `router.push('/account')`).
2. **The switch**: Calls · People · Cast · Gear (`role="tablist"`, each a `role="tab"`
   button with `aria-selected`; equal widths, 40px). Calls carries a small red count
   when `urgentCount` > 0 (`aria-label` "Calls, N urgent"). On a laptop the switch sits
   on the title row (420px). Switching tabs: website `router.replace(tabHref(tab),
   undefined, { shallow: true, scroll: false })`; app `router.setParams({ tab })`.
   Each tab keeps its own search text and its last answer (switching back draws at once
   and re-reads quietly).
3. **Search**: 44px (40 on a laptop), 16px text on a phone, placeholder
   `searchPlaceholder(tab, total)`.
4. **One row of chips** (one line that scrolls sideways on a phone, wraps on a laptop;
   34px pills; on = orange tint, the urgent chip red):
   - Calls: place chip (`placeChip`; opens Filters at Near) · `⚡ Urgent · N` toggle ·
     "Matches my card" toggle (only with a card) · "Pay ▾" (opens Filters at Pay) ·
     Filters (`filtersLabel`). With `?production=` a chip "For <productionTitle of the
     first call, else 'one production'>" with × that clears it.
   - People: place · "Role ▾" (Filters at Role) · `⚡ Free now` toggle · "Open to work"
     toggle · Filters.
   - Cast: place · "Playing age ▾" · "Union ▾" · `⚡ Free now` · Filters.
   - Gear: place · a thin rule · the categories inline as single-select chips
     (All + `GEAR_CATEGORIES`). No Filters chip.
5. **Calls tab only**, under the chips:
   - signed in **with** a card: the **free strip** (`freeStrip(availableNowUntil)`): a
     52px orange-tinted card, title + line, and the button: off → "I'm free" which shows
     the four `FREE_HOURS` choices ("4 h" …) in place of itself; on → "Turn off".
     `POST /api/crew/available-now { hours }` (0 turns off). On a laptop it is a 300px
     side card to the right of the calls with the four choices always showing and
     `CREW_WORDS.free.laptopLine`.
   - signed in **without** a card: the **nudge** (`CREW_WORDS.nudge`: title, line,
     "Set it up" → `/crew/card`).
   - signed out: the nudge with `signedOutLine` and "Sign in".
6. **The list** of the tab (below). No count line, no "sorted by" line, no eyebrow,
   no intro paragraph, no footnotes.

### Rows

- **A call** (`callRow`): the whole row links to `/crew/calls/<id>`. Tags line (mono
  10px, uppercase by CSS, joined " · "; tones: urgent red, cast gold, ok mint, mine
  orange, muted faint), title (16px bold), meta (13px), then "pay · poster · answered"
  (12px; pay coloured by tone: paid mint, union sky, deferred gold, muted faint).
  Laptop: a 2-column grid of cards (16px radius; urgent cards get a red-tinted border),
  the poster with an 18px avatar.
- **A person — People B** (`personRow`): avatar 52px (focal point + zoom, the site's
  rule), mark: `free` → orange ring, `open` → small green dot; name (16 bold) +
  `TierChip` + "✓ creator" when verified; roles (14); `status` (coloured: free orange,
  open mint, booked gold) · `meta` (12); **the gear line** (12): the verb coloured
  (brings gold, lends mint, others dim) then the text, one line with an ellipsis. The
  row (photo + lines) links to the profile; a round 40px **Message** button on the right
  (`/messages?to=<id>&kind=card&label=<messageLabel>`; signed out → sign in).
  Laptop: 3-column cards with a 56px avatar, the same lines, the bio on one line, and
  "Message" (orange) + "Profile" pills.
- **A performer — Cast B** (`castRow`): a 54×68 headshot (radius 10, cover; no
  headshot → the avatar in that box), the orange ring when free; name + `TierChip`;
  `playing` (14); `status` · `meta` (12); the round Message button. Laptop: 2-column
  cards of the same row.
- **A piece of gear** (`gearRow`): a 48px rounded tile with a category icon in gold;
  name (16 bold); "category · flag" (flag coloured: brings gold, lends mint, ask dim);
  the owner with an 18px avatar + `owner`; an "Ask" pill
  (`/messages?to=<owner>&kind=gear&label=<name>`). Laptop: 3-column cards.
- **Empty** (`emptyLine`): centred icon, title (Fraunces 20), line.

### Filters (one component)

Phone (< 900px): a bottom sheet (`role="dialog"`, `aria-modal`, grabber, "Filters",
"Clear all" (`clearedFilters`), a × close, a sticky "Show N …" button that closes it;
filters apply live as today, the button just shows the current total). Laptop: the same
content as a panel dropping under the chip row (max height, scrolls inside, closes on a
click outside or Escape). Focus goes into it and back to the chip that opened it; the
page behind never scrolls (`keepScrollInside` from `lib/menuScroll.js` on the website).
A chip that opens it at a section scrolls that section into view.

Sections per tab:
- Calls: Near (place search + "Use my location" + `WITHIN_STEPS` chips) · Kind
  (`CREW_WORDS.kinds`) · Role (single choice, "Any role", `CAST_ROLES` when Casting,
  else `CREW_ROLES`) · Pay (multi, `PAY_TYPES`) · switches: Urgent, Matches my card
  (with a card), Remote (each with its `…Line`).
- People: Near · Role · pick any (multi; the first 10 then "+ N more" opens the rest) ·
  Has gear (Any + `GEAR_CATEGORIES`) · switches: Free right now, Open to work,
  Verified creators only.
- Cast: Near · Playing age (from / to, numbers) · Union (Any + `UNION_STATUS`) ·
  switches: Free right now, Open to work, Verified creators only.
- Gear: Near only.

## Addresses

- `/crew` opens Calls; `/crew?tab=people|cast|gear`; older links: `/crew?free=1` →
  People with Free now on; `?urgent=1`, `?production=<uuid>`, `?kind=` → Calls with
  that filter (`tabFromQuery`, `filtersFromQuery`).
- `/crew/calls` (no id): website — a 307 to `/crew` keeping `urgent`, `production`,
  `kind`; app — `crew/calls/index.js` becomes a `<Redirect>` to `/crew` with the same
  params. `/crew/calls/<id>`: website — the call on its own at every width (the
  existing `CallDetail`, unchanged) under a "‹ Calls" link to `/crew`; no board or
  filters beside it, no `listCalls` read. `/crew/calls/new` unchanged apart from its
  links to the board, which point at `/crew`.
- Links that pointed at the board now point at `/crew` (`pages/index.js`,
  `pages/productions/index.js`, the app's home, productions, `calls/[id].js`,
  `calls/new.js`, `crew/tape.js`). `hrefToRoute` (`PushListener.js`): `/crew/calls`
  with no id → `/crew` keeping the query.

## Data

- Website SSR (`pages/crew/index.js`): account, the viewer's own card (`near`,
  `hasCard`, `availableNowUntil`), `tab = tabFromQuery(query)`, `filters =
  filtersFromQuery(query, near)`, and the first answer **for that tab only**
  (`listCalls` / `searchCards` (+ track records) / `searchCards` cast / `searchGear`,
  with the same filters the API would apply). The Calls badge: from the calls answer;
  on another tab one quiet client read of `apiPathFor('calls', { near, within })`.
- Client reads: `fetch(apiPathFor(tab, filters))`, 250 ms debounce, newest answer wins.
- App: `apiGet(apiPathFor(tab, f), token)` with `freshToken`; the own card from
  `/api/crew/card`; vocabularies from `/api/crew/options` (`roles`, `gearCategories`,
  `castRoles`, `unionStatus`); pay types are `{ paid, union, deferred, unpaid, other }`.

## Rules that bite

- Never name a site class `cl-…` (Clerk's prefix). New classes are `.ccx-*`.
- Every avatar honours its focal point and zoom (website `Avatar` from
  `components/crew/CrewBits` with `position`/`zoom`; app `Avatar` in `CrewBits.js`).
- Every text field is 16px on a touch screen (the no-zoom rule).
- A button that signs someone in from the page is `<SignInHere>`
  (`scripts/test-sign-in-here.mjs` fails otherwise).
- App: `useAuth` only from `mobile/src/lib/stableAuth.js`; `pathId` for ids in API paths.
- Keep the old `.crew-*`, `.cc-*` and `CrewBits` pieces other pages use (the card
  editor, a call's page, productions, profiles).

## Not changing

The working card editor, a call's own page, posting a call, rates only for signed-in
viewers, places kept to about a kilometre, the APIs.

## As built

(Each builder adds a short section here: files, anything that differs, what they
checked.)
