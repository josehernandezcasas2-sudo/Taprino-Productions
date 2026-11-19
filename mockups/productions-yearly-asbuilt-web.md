# Part B as built — productions from pitches and the production dashboard (2026-11-19)

The server, the shared rules and the website for part B of
`mockups/productions-yearly-contract.md`. No migration beyond 127 (written
before this part; not changed). Nothing under `mobile/` changed except the two
rules copies (`mobile/src/lib/productionDashRules.js`, new, and
`mobile/src/lib/siteMenuRules.js`), both word for word with the website's.

## Who runs a production (contract item 1)

`lib/productionDashRules.js`:

- `canManageProduction({ ownerId, members }, viewerId, { isAdmin })` — the owner,
  a crew row not taken off (`hidden`) whose role matches `PRODUCER_ROLE`
  (`/producer/i`: Producer, Executive producer, Line producer, Co-producer…),
  or a full admin. `members` rows may be `{ userId }` or `{ user_id }`.
- `canOwnProduction({ ownerId }, viewerId, { isAdmin })` — the owner or a full admin.
- `managerIds({ ownerId, members })` — the owner first, then the listed producers.
- `MANAGE_WORDS` — the refusals the server answers with.

Used in `lib/productions.js`:

| What | Who |
| --- | --- |
| status prep / shooting / post / released | owner, producer, admin |
| archive, reopen an archived one | owner, admin (`MANAGER_STATUSES` vs `OWNER_STATUSES`) |
| remove | admin (as before) |
| details: title, logline, kind, dates, place, notes | owner, producer, admin |
| visibility, the project it grew out of (the pitch link) | owner, admin — a producer's save may send them unchanged; a change is 403 `ownerVisibility`, and the patch never carries them |
| release link / unlink | owner, admin (403 `ownerRelease`) |
| add crew, take crew off, "worked it", days (add / edit / delete) | owner, producer, admin |
| add or take off a **producer** row | owner, admin (403 `producerOwnerOnly`) — **my call**: making someone a producer hands them the dashboard |
| take the owner's own crew rows off | owner, admin (403 `notTheOwnerRow`) |
| distribution & screeners page | owner, admin (unchanged: `lib/distribution.js` `ownedProduction`) |

Also:

- `gate()`: a listed producer sees a **private** production ("Just you" is now
  "just the people running it" in practice; the label in
  `lib/productionRules.js` `VISIBILITY.private` is unchanged — see "For you to decide").
- `getProduction()` answers, besides what it did: `isProducer`, `canManage`,
  `canOwn`, `dashboardHref` (managers only, else null) and `funding` (below).
  `canEdit` now equals `canManage`; `canConfirm` follows managers.
- The call sheet's street address / access notes open for a booking paid by
  **any manager** (`liveBookingIds(dayRows, managerIds(...))`), a shoot day's
  "Where" picker accepts any manager's paid booking, and
  `lib/productionLinks.js` `attachBookingToProduction` attaches a producer's
  paid booking to the call sheet.
- Posting a call or a place request under the production: `ownProductionInfo(…, { manage: true })`
  (`lib/productionLinks.js`) accepts a listed producer; `lib/crewCalls.js`
  `cleanCallInput` and `lib/locationRequests.js` `createRequest` pass it.
  Partner codes and "Shot here" claims still take the owner only (no `manage`).
- `ownerProductions(userId)` (the call form's, a place page's and
  `/api/crew/my-projects`' picker) lists the productions they're a producer of too.
- `updateProduction` has a per-account limit (120 an hour, admins exempt).

## Start the production from a pitch (item 2)

`POST /api/pitches/[id]/production` → `startProductionFromPitch(userId, pitchId, input)` in `lib/productions.js`.

Body: `{ title, logline, kind, startsOn, endsOn, place: { label, city?, region?, country?, lat?, lng? } | null, tellBackers }`.

| Answer | When |
| --- | --- |
| 201 `{ production, members, days, calls, isOwner, … (GET /api/productions/<id>'s shape), told, toldState, dashboardHref }` | started; `toldState` is `yes` · `later` (the pitch had its three updates today) · `failed` · `off` |
| 401 | signed out |
| 403 | not the pitch's creator |
| 404 | no such pitch (or not a uuid) |
| 409 `{ error }` | the pitch isn't approved |
| 409 `{ error, code: 'exists', productionId, dashboardHref }` | it already has a production (any status but removed) |
| 429 | ten a day per account (plus 30 an hour per address at the route), or `createProduction`'s own limits |

- The owner is the pitch's creator — read from **`pitches.created_by`**, not
  `submitted_by` as the contract says: `created_by` is what every other pitch
  owner check reads (`lib/pitches.js`, `lib/pitchDetailHub.js`,
  `/api/creator/pitch-update`); both are set to the same id on creation.
- The production: `project_type 'pitch'`, `project_id`, `project_title`,
  visibility public; through `createProduction` (so its 20-live and
  ten-a-day limits apply too). Backing is untouched.
- One per pitch: `productionIdForPitch(pitchId, { exceptId })` reads first
  (so a database without 127 says the same thing — checked on the rig with the
  index dropped: 201 then 409), then the unique index's 23505
  (`productions_one_per_pitch_uq`) is answered with the same 409 naming the
  production that won (three racing starts on the rig: one 201, two 409 with
  its id, one row). The same check covers `POST /api/productions` and the edit
  form when they link a pitch (`cleanProductionInput`'s `selfId`).
- `tellBackers`: `productionUpdate()` builds the title and body; posted with
  `postPitchUpdate(…, { alsoBackers: true })` under the update route's own
  limit (`pitch-update:<pitchId>`, three a day). **`alsoBackers` is new** in
  `lib/pitches.js`: the update reaches everyone with a paid backing as well as
  the people following it (the regular "Post an update" still reaches
  followers only — see "For you to decide").

## The pitch page (item 3)

`lib/pitchDetailHub.js` (`pages/pitches/[id].js` and `GET /api/pitch-detail`) adds:

- `production`: `{ id, title, status, statusLabel, startsOn, endsOn, placeLabel, crewCount, openRoles }`
  or null — the linked production when this viewer may see it (public and not
  held; crew-only for its crew; private for those running it) and its status is
  prep / shooting / post / released (an archived one isn't shown).
- `productionLink`: `{ id, canManage }` or null — the production it has even
  when not shown (archived), for `pitchOwnerAction`.
- `crewCalls`: the production's open calls (`listCalls({ production }, { viewerId, isAdmin })`,
  which applies the production's visibility) merged with the pitch's own, deduped.
- `today` (Pacific).

`/api/pitch-detail` now also returns `production`, `productionLink`,
`crewCalls` (it didn't pass `crewCalls` before) and `today`.

The page draws `pitchProductionCard(production, today)` (the "● In production"
pill over the hero's text, the card "Shooting Dec 6 – 9 in Echo Park · Prep ·
4 crew on it · 2 roles open · The production ›" above the Back / backing
block), `pitchOwnerAction({ isPitchOwner, production: productionLink, canManage })`
(Start the production → the start sheet; Open its dashboard ›), and
`crewNeededHead(count, production)` ("Crew needed · N", "All calls ›" →
`/crew?production=<id>`, the note under the list). The owner's "+ Post a call"
posts under the production when there is one.

## Your pitches (item 4)

`pages/creator/pitch/dashboard.js` reads `productionsForPitches(approvedIds, { viewerId, isAdmin })`
and `today`, and draws `pitchBox({ pitch, production, today })` on each approved
pitch: "Ready to shoot it?" + Start the production (the start sheet), or "In
production · Shooting from Jan 10 · 5 crew booked · 3 roles open · Open its
dashboard ›". A read that fails draws no box (never a second Start).

`GET /api/creator/pitches` (the app's Your pitches) adds:
`productions` — `{ [pitchId]: { id, title, status, statusLabel, startsOn, endsOn, placeLabel, crewCount, openRoles, visibility, canManage, visible } }`
or null when it couldn't be read; `backers` — `{ [pitchId]: count }`; `today`.

`productionsForPitches(pitchIds, { viewerId, isAdmin })` (lib/productions.js)
is that map, also used by the pitch hub.

### The start sheet

`components/productions/StartSheet.js` (portalled into `<body>`; a bottom sheet
under 900px, a 520px dialog from 900px; focus to the title, Escape closes, focus
back; `keepScrollInside` on the list and the backdrop). Words and defaults:
`startSheet(pitch, backers)` → `{ kicker, title, sub, labels, kinds, defaults:
{ title, logline, kind (kindFromTag, null for Animation: "Pick one"), startsOn:'', endsOn:'',
place:null, tellBackers:true }, keep, tell, visibility, submit, busy }`.
"Keeps taking backing" is a ✓ row, not a switch (backing can't be turned off
here; the board drew a switch). Submit → `router.push(dashboardHref + '?started=1&told=<toldState>')`;
a 409 `exists` shows the line with "Open its dashboard ›".

## The production dashboard (item 5)

Page `pages/productions/[id]/dashboard.js` (`?tab=` opens a tab); anyone who
isn't the owner, a listed producer or a full admin — signed out too — gets a
307 to `/productions/<id>`; a removed production 404s (admins excepted).

`GET /api/productions/[id]/dashboard` (cookie or Bearer):

| Answer | When |
| --- | --- |
| 200 `{ facts, bookedPlaces, dashboardHref }` | owner, listed producer, full admin |
| 401 `{ error, code: 'not-manager', productionHref }` | signed out |
| 403 `{ error, code: 'not-manager', productionHref }` | anyone else (show them the production page) |
| 404 | not a uuid, not there, removed |
| 429 | 120 a minute per account |

`bookedPlaces`: the viewer's own paid places (`[{ value, label }]`) for the
add-a-day form. The **facts** shape is documented in a comment above
`productionDashboard` in the rules file; in short:

```
{ today, now,
  production: { id, title, logline, kind, status, startsOn, endsOn, placeLabel, visibility,
                pitch: { id, title } | null, release: { title, href } | null, moderationHold },
  viewer: { userId, isOwner, isProducer, isAdmin, canManage, canOwn, canConfirm },
  owner: { userId, name },
  members: [{ id, userId, name, role, department, worked, viaCall, isOwner, isViewer,
              pay: null|'pending'|'held'|'unfunded'|'released'|'disputed'|'refunded',
              callId, producer, profilePath, offList? }],
  calls: [{ id, title, role, spots, status, payType, payLabel, payNote, paySecured, payRateCents,
            startsOn, endsOn, closesOn, waiting, answers, booked, forPitch }],
  days: [{ id, dayNo, shootOn, callTime, wrapTime, placeLabel, paid }],
  places: [{ id, title, status, startsOn, endsOn, totalCents, respondsBy, mine }],
  pay: { heldCents, heldPeople, releasedCents, releasedPeople, pendingCents },
  pitch: null | { id, title, status, goalCents, raisedCents, toCreatorCents, cutPercent, backers,
                  deadline, fundingEnabled, lastUpdateAt, firstBackedAt, latestBackers: [names], isOwner },
  release: { released, title, href, checklist: {8 keys} | null, screenersLive } }
```

Notes on what the server reads (`lib/productionDashboard.js` `loadFacts(rows, { viewerId, isAdmin, withRelease })`, one batch for any number of productions):

- calls: the production's (any status but removed) plus calls posted **for the
  pitch** (no production) by someone running it (`forPitch: true`); their
  answers (`waiting` = status sent, `answers` = not withdrawn, `booked`).
  `closesOn` = last day + 7 (the board's auto-close), an urgent call's needed-by day.
- pay: secured crew pay on those calls (`crew_payments`, live row per answer);
  a person booked on a secured call with no live payment is `unfunded`. Someone
  booked on a pitch call (so not on the crew list) is added as `offList: true`
  only so their unfunded pay counts; the rules leave them out of the crew list.
- days: `paid` = the day's booking is paid or done, by someone running it, for
  that place.
- places: the production's location requests, status through
  `shownStatus` (a request past its 48 h reads as expired), `mine` = the viewer made it.
- pitch: completed backings only (raised, what reaches the creator, distinct
  backers, the latest two backers' display names — names are shown on the
  pitch page today), the latest update's date.
- release: `distributionChecklist(row)` — **new in `lib/distribution.js`**,
  the eight checks of the distribution page without its owner gate.

`productionDashboard(facts)` (the page and the app) → `{ head, actions, tabs,
tiles, needs, funding, calls, crew, days, places, money, release, crewView }`:

- `head`: kicker "Production dashboard · Short", title, back (‹ Your
  productions → `/productions/mine`), `status` `{ value, label, tone, options:
  [{ value, label, disabled }], locked }` (a producer gets prep–released; the
  owner archived too; an archived one is locked for a producer), `meta`
  ["Dec 6 – 9", "Echo Park, Los Angeles", "Public"], `grewOut`.
- `actions`: Post a call (`/crew/calls/new?production=`), Add a day (tab
  days + the form), Book a place (`/locations`), Message crew (tab crew — the
  site has 1:1 messages only, so each crew row has its own Message button), Edit.
- `tiles`: Raised (pitch backings / goal / backers, or "—" "Not tied to a
  pitch"), Crew ("N booked" = crew list, "N roles still open" = open calls'
  unfilled spots, pitch calls included), Next shoot day (call sheet's next day
  from today, else the production's first day; "call 6:30 · in 17 days"),
  Crew pay held ("for N people", `subLong` adds "· released when they work it").
- `needs`: `needsYou(facts)` items `{ id, text, strong?, link: { href, label, short }, short }`:
  answers waiting on a call (Review → the call), days still ahead with no place
  ("Days 2 and 3 have no place" → `/locations`), unfunded secured pay (Fund →
  the call), backers quiet ≥ `QUIET_BACKERS_DAYS` 14 days since the last update
  (else since the first backing; only for the pitch's owner; Post an update →
  `?tab=money#update`), after the last day "Confirm who worked it · N people"
  (→ `?tab=crew`), a place request of the viewer's countered (Answer) or
  accepted (Pay). `needsLabel(count, firstShort)` → "4 need you" / the one thing.
- `funding`, `calls`, `crew` (groups by department, each person
  `{ label, state: { text, tone }, actions: { worked, remove, message } }` —
  `memberState`), `days`, `places`, `money` (funding + crew pay lines + places
  paid), `release` (`checklistCount`: "checklist 2 of 8"; the distribution
  button for `viewer.canOwn`, else "The owner runs distribution and screeners.").

The website: `components/productions/ProductionDashboard.js` (styles `.pd-*`):
on a phone the board's order (tiles, Needs you, Funding, Calls, Crew, Shoot
days, Places, Release, "See it as the crew does ›") — one column whose cards
are ordered with CSS `order`; from 1024px two columns (Needs you, Calls, Crew |
Funding, Days, Places, Release), from 1200px the actions sit beside the title.
Overview shows four rows of a section (six people of the crew) with "All N ›"
to its tab; each tab is its section in full: Crew with Message / Worked it /
Remove and "+ Add someone" (`components/productions/AddMember.js`, **moved out
of** `pages/productions/[id]/index.js` so both pages use it), Days with the
add-a-day form (`DayForm`), Money with the pitch-update form (`#update`, the
existing `/api/creator/pitch-update`; owner of the pitch only), Release. Tabs
are a tablist (arrow keys, Home / End), `?tab=` by shallow replace. The status
pill is a `<select>` that PATCHes and reads the dashboard again; every write
re-reads `GET /api/productions/<id>/dashboard`. `?started=1&told=` shows
`startedFlash(told)` once and is cleared from the address.

## Your productions (item 6)

Page `pages/productions/mine.js` (`?tab=running|crew|done`), styles `.ypr-*`.
`GET /api/productions/mine` keeps `{ owned, crewOn, bookedPlaces, releases }`
(the app's production screens read those) and adds:

- `items`: `[{ id, title, kind, status, statusLabel, startsOn, endsOn,
  placeLabel, visibility, fromPitch, crewCount, openRoles, raisedCents,
  needsYou, needsShort, manage, nextShootOn, line, myRoles }]` — every
  production they own or are on the crew list of (a crew-only one shown; a
  private or held one only if they're a producer of it), the ones that need
  them first.
- `readyPitches`: `[{ id, title, logline, tag, raisedCents, backers }]` — their
  approved pitches with no production.
- `today`.
- 60 reads a minute per account.

Rules: `mineGroups(items)` → `{ tabs: [{ id, label: 'Running · 2', count }], groups: { running, crew, done } }`
(Running = they run it, prep/shooting/post; On the crew = not running it;
Done = they run it, released/archived), `mineTab`, `yoursCard(item, today)` →
`{ id, title, status: { text, tone }, line, stats, needs, button }`,
`readyPitchCard(pitch)` (the heading is "Got a pitch?", per Jose's "any
approved pitch", not the board's "Got a funded pitch?"). "Start from the pitch ›"
opens the start sheet. The round + goes to `/productions/new`.

`/productions#mine` still lands on the section of `/productions` (kept), which
now starts with a "Your productions ›" link.

## The ☰ menu (item 7)

`lib/siteMenuRules.js` (still import-free, both copies):

- `menuRunning(running)` → null, or `{ title: 'Running now', count: '2 productions',
  items: [{ id, href: '/productions/<id>/dashboard', title, line, needs: '4 need you' | '1 needs you' | null, open: 'Open', primary }],
  all: { href: '/productions/mine', label: 'All your productions' } }` — at most
  `MENU_RUNNING_SHOWN` 2; items with an id that isn't a uuid are dropped.
- `siteMenu({ …, running })` returns `running` (signed in only), on both sides.
- Your things: "My productions" (`/productions#mine`) is now **"Your productions" → `/productions/mine`**.
- New words: `MENU_WORDS.runningNow`, `runningOpen`, `allProductions`.

`GET /api/productions/running` (signed in, cookie or Bearer; 60 a minute):
`{ items: [{ id, title, status, statusLabel, line, needsYou }], total }` —
productions they own or are a listed producer of, status prep / shooting /
post, needs first (up to five items; `total` counts all). `line` is
`runningLine()`: "Prep · shooting Dec 6", "Shooting · until Dec 9", "Post".

`components/SiteMenu.js` reads it when the menu opens signed in, kept two
minutes per account (`countsFresh`), dropped signed out, and draws the card
above the Connect / Stream switch (`.sm-running*`).

## The production page (item 8)

`pages/productions/[id]/index.js`: "Dashboard ›" at the top for those running
it; the Funding card (`productionFundingCard(funding)` → `{ kicker, line,
percent, button }` — Back it → the pitch's `#fund` when backing is open, else
"On the pitch page") for everyone who can see the production, when it grew out
of an approved pitch and the Pitch Room is on (admins see it either way).
`getProduction()` answers `funding: { pitchId, title, raisedCents, goalCents,
percent, backers, open, href } | null`. Managers get the crew / days / status
controls; the status select offers a producer prep–released; the distribution
button and Archive are the owner's; Remove on a crew row follows the rules
above. `pages/productions/[id]/edit.js` opens for managers; `ProductionForm`
takes `ownerFields` and leaves out "Who sees it" and "Grew out of" for a producer.

## Also

- `lib/adsenseRules.js`: `/productions/mine` and `/productions/[id]/dashboard` are private (no display ads).
- `styles/globals.css`: one block before the no-zoom block (`.pd-*`, `.ypr-*`,
  `.pst-*`, `.pitch-prod-*`, `.pitch-ready*`, `.prod-funding*`,
  `.prod-crumbs-row`, `.prod-dash-link`, `.sm-running*`); tokens only (two
  `rgba(0, 0, 0, …)` shadows, as the other sheets have). The sheet's fields
  are 16px (no zoom on a phone).
- `dev/test-rig/checks/site-menu.mjs`: the Your things row's label.

## Checks

- `node scripts/test-production-dash.mjs` — 16 checks (new): the app copy word for
  word, who runs it, statuses, kinds (keys equal `PRODUCTION_KINDS`, every pitch
  tag maps or is null), money and dates, Needs you (both fixtures), the four
  numbers, the whole dashboard (owner and producer), tabs, Your productions,
  the menu line, the pitch page, the Funding card, Your pitches, the start sheet.
- `node scripts/test-site-menu.mjs` — 16 (2 new: Your productions, Running now).
- Every `scripts/test-*.mjs` (70 files) passes; `npm run check:refs`, `npm run lint` clean.
- `dev/test-rig/checks/productions-dashboard.mjs` (new) — **167 ok, 0 FAIL**
  (three clean runs, the last after the final edit; two earlier runs failed only
  on the dev server being slow — a 240 s API timeout and a 180 s page load while
  it recompiled — and on the 390 tab's address arriving after the tab, which the
  check now waits for): starting (401, 403, a
  pending 409, a bad id 404, 201 with the update and the backer told, a second
  409 with the id, the production form 409, one row), the seeded crew / calls /
  pay / days / places, the facts and the rules' numbers and Needs you (incl.
  17 quiet days), owner / producer / admin / stranger / crew / signed out / the
  app's bearer token, the page's redirects, everything a producer may and may
  not change (16 cases incl. posting a call under the production), the pitch
  page signed out and as the owner, `/api/pitch-detail` (and a crew-only
  production hidden from a stranger, shown to its crew), Your productions and
  running for the four people, `/api/creator/pitches`, the production page's
  link and card, `/productions#mine`; in the browser the dashboard at 390 and
  1280 (numbers, five Needs-you rows, Needs you first, two columns at 1280,
  tabs and their address, arrow keys, Money, Release), Add a day and the
  status pill against the database, the producer's pill and Remove buttons,
  Your productions at both widths, the menu's card at both widths (above the
  switch, Open → the dashboard), no card for someone running nothing, Your
  pitches' boxes, the start sheet (bottom sheet at 390, dialog at 1280, filled
  in, focus, Escape, submit → the new dashboard with its line, kind from the
  tag), no sideways scroll at 320 / 390 / 1280 on seven pages, no page errors.
- Re-run after the changes: `site-menu` 67 ok, `menu-rows` 24 ok,
  `messages-simpler` 128 ok, `crew-call-simpler` 144 ok, `pitch-room` 45 ok,
  `node dev/test-rig/smoke.mjs` (no 5xx, no page errors at 390 / 1280).
- By hand on the rig: without 127's index (dropped for a moment) a second
  start is 409 from the read; three starts at once on one pitch with the index
  give one 201 and two 409s naming it.
- Not run: `next build` (as asked); nothing on a device (the app half is part C).

## For you to decide (or that I couldn't follow exactly)

1. **`created_by`, not `submitted_by`**, decides who owns a pitch (above).
2. **Only the owner adds or removes a producer.** A producer runs the crew list
   but can't make someone else a producer or take one off. Say if producers
   should be able to.
3. **A private production opens to its listed producers.** "Just you" in the
   visibility picker now really means "just the people running it"; the label
   wasn't changed (`lib/productionRules.js` is the app's vocabulary too).
4. **"Tell my backers" tells backers and followers; a regular "Post an update"
   still tells followers only.** The Needs-you line "Your backers haven't heard
   from you in N days" links to that regular update. Should every update reach
   backers too (`postPitchUpdate`'s `alsoBackers`)?
5. **Open roles count calls posted for the pitch** (not only the production's),
   and so does Needs you's "answers waiting". Calls for the pitch posted by
   someone else than the people running it aren't counted (only the pitch's
   owner can post one today anyway).
6. **Message crew** goes to the Crew tab (one Message per person); the site
   has no group messages.
7. **Distribution & screeners stay the owner's** (the contract lists them for
   the dashboard but not among a producer's writes); a producer sees the
   checklist count and "The owner runs distribution and screeners."
8. The start sheet's "Keeps taking backing" is a fixed ✓ row, not a switch.
9. "Got a pitch?" rather than the board's "Got a funded pitch?" (any approved pitch).
10. The dashboard and Your productions read live; a production with many calls
    and payments is one batch of reads, but nothing is cached. The menu's
    "Running now" runs the same batch on open (at most every two minutes).
11. The 23505 branch of the one-per-pitch check (`pitchTaken`) was reached only
    through racing requests; the read before insert answers almost all of them.

## For the app builder (part C)

Everything the screens say is in `mobile/src/lib/productionDashRules.js` and
`mobile/src/lib/siteMenuRules.js` (`menuRunning`, `siteMenu({ running })`).
Routes, all cookie or Bearer, CORS as the rest:

- `GET /api/productions/<id>/dashboard` → `{ facts, bookedPlaces, dashboardHref }`; `productionDashboard(facts)`.
- `GET /api/productions/mine` → `items`, `readyPitches`, `today` (with the old keys); `mineGroups`, `yoursCard`, `readyPitchCard`.
- `GET /api/productions/running` → `{ items, total }`; `menuRunning`.
- `POST /api/pitches/<id>/production` → as above; `startSheet`, `startedFlash(toldState)`.
- `GET /api/pitch-detail?id=` → `production`, `productionLink`, `crewCalls` (merged), `today`; `pitchProductionCard`, `pitchOwnerAction`, `crewNeededHead`.
- `GET /api/creator/pitches` → `productions`, `backers`, `today`; `pitchBox`.
- `GET /api/productions/<id>` → `funding`, `dashboardHref`, `canManage`, `canOwn`, `isProducer`; `productionFundingCard`.
- Writes the dashboard makes: `PATCH /api/productions/<id> { status }`,
  `POST|PATCH|DELETE /api/productions/<id>/members`, `PUT|DELETE /api/productions/<id>/days`,
  `POST /api/creator/pitch-update`. Each answers the production (or `{ ok }`);
  read the dashboard again after.
- `hrefToRoute` needs `/productions/<id>/dashboard` (keep `?tab=`) and
  `/productions/mine` (the menu's Your things row points there now).
