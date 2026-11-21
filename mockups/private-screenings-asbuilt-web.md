# Private screenings — As built: the website's creator side (builder B, 2026-11-21)

The agreement is `mockups/private-screenings-contract.md`; the boards are the
canvas's Main, NewLink, LinkDashboard and Ended. Everything here is coded to
the contract's JSON; builder A's routes were not running while this was
built, so it was checked against a stand-in that answers in those shapes
(below).

## Files

- `components/creator/screenings/ScreeningBits.js` — the shared pieces:
  `useScreeningRoute(url)` (states `loading | ok | update` (503
  `migration-128`) `| notYours` (403) `| missing` (404) `| signedOut | failed`;
  a re-read keeps the last good answer), `callScreenings` (never throws),
  `errorLine`, `freshPassword` (GET `/api/screenings/password`),
  `passwordProblem` / `emailProblem` (validateLink's own sentences),
  `copyText` (clipboard → `execCommand` → the browser's prompt), `CopyButton`
  ("Copied" for 1.6 s, announced), `StatePill`, `PartText`, `Sheet` (drawn into
  `<body>`; a full-width sheet from the bottom under 900px, a centred box
  from 900px; focus on the heading, Tab kept inside, focus returned on close,
  Escape closes, `keepScrollInside` on the backdrop; the dim page closes only
  the yes/no boxes, never a half-filled form), `CloseButton`, `ConfirmSheet`,
  `RouteNote`.
- `components/creator/screenings/ScreeningsTab.js` — the tab for
  `target={{ type: 'episode'|'series', id }}`: `screeningsList` → filter chips,
  open cards (2 columns from 900px; Copy link / Copy password / Open ›), the
  Ended section (Run it again / Discard… with its confirm → DELETE), the empty
  state, + New link. Exports `useScreeningsList(target, { enabled })` and
  `screeningsBadge(route)` so a page can put "3 live" on its tab and hand the
  same answer in as `route`, and `OpenCard` / `EndedCard` (with `readOnly`,
  `canOpen`) for the Distribution card. `withHead` adds a small poster + name
  (the show page has no head of its own on this tab).
- `components/creator/screenings/NewLinkDialog.js` — one box, four modes:
  `new` (POST `/api/screenings` → the ready card), `edit` (PATCH `update`),
  `window` (Move the end: only When it works → PATCH `update` with `endsAt`,
  and `startsAt` only while the link hasn't started), `again` (the "A new link
  with the same settings" summary → Make the new link = POST `…/again` with the
  password shown, or Change something first → the whole form prefilled → POST
  `…/again` with the changes). A show: Whole show / each season (its label from
  `target.seasons`) / Pick episodes… (a ticked list of `target.episodes`, "in
  review" marked). Quick windows + Custom, Starts / Ends as `datetime-local` on
  the Pacific clock. Who can open it: the three options as real radios; named
  people = accounts searched through `/api/messages/people?q=` (debounced, the
  newest answer wins) plus typed emails, as removable chips with "N of 50
  people". Limits: opens in total, each person (No limit / 1–20 times), one
  screen (a switch), where (Anywhere / Only in… with a searchable list of
  country chips — accents ignored, the first eight of `COUNTRIES` shown before
  anything is typed). Tell me as chips. The form is checked with
  `validateLink` before it is sent; a server `{ error, field }` lands on that
  field (focused and scrolled to), anything else under the form. Enter in a
  text field never sends the form. The ready card: link + password with Copy,
  "Put the password in the invite", Copy the invite (`inviteText`), Email the
  link (a `mailto:` to `recipientEmail` with the invite), Done.
- `pages/creator/screenings/[id].js` — a link's own page. Gate as the title
  dashboard (creators and admins; else `/stream`; an id that isn't
  `[A-Za-z0-9_-]{1,80}` is a 404). GET `/api/screenings/<id>` →
  `linkDashboard`: back pill to `targetTabHref`, the state + watching pills,
  title, sub, Copy link / Copy password / Copy the invite (+ the password tick
  box), the timeline as an inline SVG drawn at its measured width (track,
  orange part gone by, white-ringed dot per open, red dot per refusal, a NOW
  line and mark while not ended), the four tiles, Who watched (avatar or
  initials, name, "@handle · signed in" / "not signed in", place line with the
  two-cities warning in place of the device, when, "2 of 3 opens" / "· no opens
  left", "● Watching · 1:12:40" or the watched line, the bar brass / gold /
  mint), Turned away (when there is any), Settings (Edit settings, New
  password, Move the end, the line), Where it was opened, End it now… (confirm
  → PATCH `end`). Ended: Run it again (Done goes to the new link's page) and
  Discard… (→ back to the tab). New password is its own box: a fresh
  suggestion you can take or type over, checked with validateLink's sentence,
  → PATCH `{ action: 'password', password }`. The page reads the link again
  every 30 s while visible and at once when it comes back into view.
- `components/creator/title/TitleDashboard.js` — the Private screenings tab
  (from `dash.tabs`, so never on a vertical title) renders the tab full width
  (outside `.td-panel`); the page reads the list once the tab is there and the
  tab says "N live".
- `pages/creator/show/[id].js` — `?tab=screenings` (third tab, same badge);
  the tab sits in `.td-page.td-show` with `withHead`.
- `pages/productions/[id]/distribution.js` — the Screeners card and its form are
  gone; **Private screenings** lists `data.screenings.links` read-only with the
  same cards (no copy buttons), Open › where the viewer runs the link
  (`screenings.canManage`, or an older screener of this production —
  `legacy && productionId` — since the page is its owner's) and can reach a
  link's page (creator or admin), and "Private screenings for <title> ›" to
  `screenings.href` when they run it. The checklist row is "Private
  screenings": "N live." worked out in the browser from the links (not
  `checklist.screenersLive`), else `distributionLine` (a link to the tab when
  they run it). `SCREENER_DAYS` is no longer imported.
- `styles/globals.css` — the `.scn-*` block at the end. Tokens only (tints as
  `rgba(var(--…-rgb), a)` or `color-mix` with a token). Buttons and chips 36px
  with a mouse and 44px on a touch screen; fields 16px.

## Words added to the rules

`SCREENING_WORDS_WEB` at the very end of `lib/screeningRules.js` and
`mobile/src/lib/screeningRules.js` (byte-identical; `test-screening-rules`
passes): newLinkTitle, moveEnd, forHead, labelLabel, labelNote,
labelPlaceholder, emailLabel, emailNote, emailPlaceholder, playsHead,
playsTitle, nothingToPlay, inReview, picked, custom, starts, ends, startLocked,
passwordHead, newOne, whoHead, namedFind, namedEmail, add, namedNobody,
namedAccount, namedSearching, namedNoMatch, namedTypeMore, namedCount, remove,
limitsHead, opensTotal, perPersonLabel, noLimitEach, oneTime, nTimes,
whereLabel, anywhere, onlyIn, countryFind, countryNone, countryMax, notifyHead,
readyLink, readyPassword, copy, done, close, emailSubject, againFor,
againWindow, againPassword, againAddress, againRest, againNow, againNew,
againAddressLine, againRestLine, colPerson, colWhere, colOpened, colWatched,
signedIn, notSignedIn, opensOf, openOne, openMany, noneLeft, watching,
turnedAwayHere, nowMark, setPassword, linkMissing, failed, tryAgain, loading,
offline, couldNot, copyFailed, refreshNote, distributionNoRelease,
distributionNone. No existing export changed.

The canvas's "Their email (optional) · we can send the link for you" became
"optional · “Email the link” writes to it": nothing in the contract sends mail
for the creator, so the box doesn't promise it.

## Calls for builder A / the merge

- **Named accounts' names in Edit settings**: a Link carries only
  `named.userIds`. The box shows names it learned from the search or from the
  link's viewers; any other named account reads "A named account". If the
  server adds `named.people: [{ userId, name, handle }]` to the Link, the box
  uses it (already coded, optional).
- `/api/messages/people` answers `displayName` / `avatarUrl` / `avatarPosition`
  / `avatarZoom` (not the brief's `name` / `avatar`); both shapes are read.
- `{ field }` in a 400 is taken to be one of validateLink's field names
  (`label`, `recipientEmail`, `season`, `episodeIds`, `startsAt`, `endsAt`,
  `password`, `access`, `named`, `maxViews`, `perPerson`, `countries`,
  `notify`); any other lands under the form.
- Run it again sends `{ password }` (the one the summary shows) or, with
  changes, every setting but the scope; the window is left to `againWindow`
  unless the form changed it.
- Edit settings sends no `password` and, once the link has started, no
  `startsAt`.
- The title dashboard and the show page each make one GET
  `/api/screenings?target=…` per visit (for the badge), the show page also on
  its Episodes tab and for a contributor or team member (who get 403 and see
  `notYours` on the tab).

## Verified

- `npm run check:refs`, `npm run lint`, `node scripts/test-screening-rules.mjs`
  (14), `test-title-dash.mjs` (11), `test-sign-in-here.mjs` (5),
  `test-menu-scroll.mjs` (24), `npx next build`.
- A browser harness outside the repo (the scratchpad's `harness/`: the real
  components and pages bundled with esbuild, `next/link` / `next/router` /
  `next/head` / `next/image` and the server-only page helpers stubbed, a
  stand-in for A's routes in the contract's shapes, a 2,400px page behind so a
  scroll leak shows), in headless Chrome: `run-tab.mjs` 62 checks (the list,
  filters, Copy, Open ›, New link end to end with named people, countries,
  limits and the POST body, the ready card, invite with and without the
  password, the mailto, Escape, Tab kept inside, a server field error, a 409,
  Run it again both ways, Discard), `run-small.mjs` 44 (390 / 320 touch and
  844×390: no sideways scroll, 44px targets, the sheet full width and on
  screen, 16px fields, a wheel and a CDP touch drag past the end leaving the
  page still; the show's scope chips and POST bodies; the empty tab; the
  migration and not-yours lines), `run-link.mjs` 66 (the link page's head,
  tiles, timeline dots, who watched, turned away, settings, places, Copy the
  invite, the visibility refresh, Edit settings with the opens-so-far floor,
  Move the end, New password, End it now, the ended page, Run it again →
  the new page, Discard → the tab, 390 / 320, an unknown link, the
  Distribution card with and without `canManage`).
- Found and fixed through it: the round close button was labelled "Cancel"
  (two "Cancel" buttons for a screen reader; now "Close"); the End it now card
  and its confirm box shared the id `scn-end-h`.

## Not verified

- Against builder A's real routes, the rig's database, Clerk or a real
  sign-in: the title dashboard's and the show page's tab wiring were checked
  by the build only, not in a browser.
- Safari / iOS (the `datetime-local` picker, the sheet over the keyboard,
  `keepScrollInside` with a real finger).
- The Distribution page against `getDistribution`'s real `screenings` answer.
