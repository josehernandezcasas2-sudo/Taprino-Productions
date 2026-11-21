# Private screening links — the app, as built (builder C, 2026-11-21)

The creator side of private screenings in the Expo app (`mobile/src`), to
`mockups/private-screenings-contract.md` ("App") and the canvas boards AppList,
AppLink, NewLink and Ended. A screening itself still opens on the website only.

## What was built

- **`components/screenings/ScreeningsList.js`** — the Private screenings tab body,
  one component for a title (`target: { type: 'episode', id }`) and a show
  (`{ type: 'series', id }`). `GET /api/screenings?target=<type>:<id>`, read on focus,
  every 30 s while in front, after every change and on the screen's pull to refresh
  (`refreshKey`). `screeningsList` → the filter chips (All · Live · Opens later · Ended,
  with counts), the open cards (state pill, "N watching" pill or the access line,
  the window bar, the window line in the warning colour when it ends soon, the parts
  "7 of 25 opens · 4 people · 5 stopped", then Copy link / Copy password / Open ›),
  the Ended part (heading, `endedLine`, each card with its state and `endedLine`,
  Run it again / Discard…), the empty state (with `showNote` on a show), the round +.
  A card's top part opens `creator/screenings/<id>`. Discard… is an `Alert` in the
  rules' words, then `DELETE /api/screenings/<id>`.
- **`components/screenings/NewLinkSheet.js`** — new / edit / run again, in
  `messages/MessageSheet.js` (`fill`; every orientation; the keyboard pads the window).
  Sections in the website's order: who it's for, what it plays (a film: "This title ·
  <title>"; a show: Whole show / One season (the season chips) / Pick episodes… (a
  checkbox row per episode of `target.episodes`); an edit shows what it plays, read
  only), when it works (`QUICK_WINDOWS` chips with a Starts/Ends preview, or Custom:
  date `YYYY-MM-DD` + time `HH:MM` for the start and the end, read on the Pacific
  clock by `fromPacificInput`; "7:00" and "2026-12-5" are padded first; an empty start
  = now; an edit of a link that has started keeps its start and says so), the password
  (the suggestion, New one = `GET /api/screenings/password`), who can open it (the three
  `ACCESS` options; named: people searched with `GET /api/messages/people?q=` (two letters,
  250 ms after typing stops, newest answer wins) and typed emails, both as removable
  tags, at most `maxNamed`), limits (opens in total, each person with a "No limit" chip,
  One screen at a time, Where it can be opened: Anywhere / Only in… with a country search
  over `COUNTRIES` — a country only), tell me (`NOTIFY` chips). `validateLink` checks it
  first; the server's `{ error, field }` is shown under its section and beside the button,
  and the form scrolls to that section. A field the keyboard would cover is scrolled up
  (320 ms after focus, once the sheet has shrunk). On a short window (height < 500, a
  phone held sideways) the heading is smaller and the buttons scroll with the form.
  Requests: new `POST /api/screenings { target, …settings }`; edit
  `PATCH /api/screenings/<id> { action: 'update', …settings }` (no scope/season/episodeIds;
  the password only when it was changed), then the sheet closes; run again first shows the
  summary ("A new link with the same settings": `linkDashboard(...).settings` for the old
  link with `againWindow` and the new password) — Make the new link =
  `POST /api/screenings/<id>/again { password }`; Change something first = the whole form,
  prefilled (window = `againWindow`, a new password), sent as the overrides. After new /
  again: the **ready card** (the link, the password, Copy link / Copy password, the
  "Put the password in the invite" switch, Share the invite = `Share.share({ message:
  inviteText(...) })`, Copy the invite, `readyLine`, Open › and Done).
- **`app/creator/screenings/[id].js`** — the link's own screen (registered in
  `_layout.js`, `headerShown: false`), from `linkDashboard`, in the AppLink board's order:
  Back pill "Private screenings" (`router.dismissTo` the tab from
  `hrefToRoute(targetTabHref(link.target))`; "Your work" until the link has loaded), the
  state and "N watching now" pills, the label and `sub`, Share the invite / Copy password /
  Copy link with the include-password switch, the window card (`leftLabel`, the bar with
  the opens as white dots and the turned-away tries as red ones, the start and end,
  `timelineKey`), the four tiles two across (`dashboard/DashSections` `Tiles`; Opens reads
  "7 of 25"), Who watched (photo with its focal point and zoom through `CrewBits`
  `Avatar`, or a "G" for a guest; name · @handle; the two-cities heads-up in the warning
  colour; place · device · `agoLabel` · "2 of 3"; "Their opens used up"; a watched bar —
  accent while watching, mint when all of it, gold otherwise; "● Watching now · 1:12:40"
  or the watched line), Turned away · N (`refusalRows`), Where it was opened
  (`placesFrom` + `placeNote`), Settings (the rows, Edit settings → the sheet, New
  password → `PATCH { action: 'password' }` with the new one shown, `newPasswordLine`),
  End it now… (`Alert` → `PATCH { action: 'end' }`). Ended: `endedLine`, Run it again
  (the sheet; when it's done the new link's screen replaces this one) and Discard…
  (`DELETE`, then back to the tab). Pull to refresh; read every 30 s while in front.
- **`components/screenings/ScreeningBits.js`** — `screeningCall` (never throws: a 503
  `migration-128` reads `needsUpdate`, a 403 `not-yours` reads `notYours`, no connection
  reads `offline`), `useNow`, `useCopy` (expo-clipboard, "Copied" for 2 s), the tone
  pills, 44pt `Btn` / `ChoiceChip` / `PlusButton`, `WindowBar`, `PartsLine`, `LoadState`.
- **The title screen** (`app/creator/title/[id].js`): the Private screenings tab (from
  `dash.tabs`, so not on a vertical title) draws `ScreeningsList`; pulling to refresh
  reads it again.
- **The show screen** (`app/creator/show/[id]/index.js`): the third tab, for whoever
  runs the show (`viewer.isOwner`) and a full admin, never on a vertical series;
  `?tab=screenings` opens it.
- **The Distribution screen** (`app/productions/[id]/distribution.js`): the Screeners
  card and its form are gone; **Private screenings** lists `screenings.links` (live,
  later, then ended) read only — state pill, label, window line or how it went, the
  numbers — with Open › when `screenings.canManage`, and "Private screenings for
  <release title> ›" (`distributionGo`) to `screenings.href`. The checklist row reads
  "Private screenings · N live." or `distributionLine`. An older server without
  `screenings` shows an empty list (the checklist falls back to `screenersLive`).
- **`hrefToRoute`** (`components/PushListener.js`): `/creator/screenings/<uuid>` is the
  app's screen; `/creator/title/<id>?tab=screenings` and `/creator/show/<id>?tab=screenings`
  keep the tab.
- **`components/work/WorkBits.js` `TabRow`** brings the current tab into view when it
  isn't (Private screenings, the last of seven tabs on a film, sat off the right of a
  390pt phone when opened from a notification). Shared by the title and show screens.

## Words added

At the very end of both copies of `lib/screeningRules.js` (byte-identical), one new
export, `SCREENING_WORDS_APP`: `newLinkTitle`, `forHead`, `labelField`, `emailField`,
`playsHead`, `seasonChip`, `custom`, `starts`, `ends`, `now`, `datePlaceholder`,
`timePlaceholder`, `customHint`, `badStart`, `badEnd`, `startFixed`, `newOne`, `whoHead`,
`emailPlaceholder`, `add`, `removeName`, `someAccount`, `limitsHead`, `opensTotal`,
`eachPerson`, `noLimit`, `whereHead`, `onlyIn`, `searchCountries`, `tellHead`,
`linkLabel`, `done`, `watchingNow`, `nothingHere`, `notFound`, `tryAgain`, `offline`.
The section headings and field labels are the NewLink board's; if builder B put the same
ones into `SCREENING_WORDS`, the merge should keep one set and point both sides at it.
Reused from other rules files: `VIEWER_WORDS.password_label` ("Password"),
`MESSAGE_WORDS.toPlaceholder` / `typeMore` / `nobody` (the people search),
`TITLE_WORDS.back` (the Back pill before a link loads), `REFUSALS.person_opens`
("Their opens used up").

## For the server (builder A)

- **Older app builds read `d.screeners.filter(...)` and `d.episodes.length` on
  `GET /api/productions/<id>/distribution`.** If the answer drops `screeners` / `episodes`,
  the Distribution screen of an app that hasn't picked up this update throws. Keeping
  `screeners: []` and `episodes: []` in the answer for a while avoids it.
- The app reads `displayName` from `/api/messages/people` (what the route answers today),
  falling back to `name`.
- `DELETE` is sent with a JSON body `{}` (the app's `apiDelete` always sends one).
- The app's route for a link expects a uuid id (`/creator/screenings/[0-9a-f-]{36}`).
- A 409 `ended` / `not-ended` on a link's screen makes it read the link again.

## Checked

- `npm run check:refs`, `npm run lint`, `node scripts/test-screening-rules.mjs` (14, the
  copies identical), `node scripts/test-title-dash.mjs` (11), `npx expo export --platform
  ios --clear` and `--platform android --clear`.
- A react-native-web harness of the real files against a fake server in the contract's
  JSON (validation and stats by the real rules) — 102 checks at 390, 320×640 and 844×390:
  the tab on a film's screen (order, counts, pills, copy, filters, a card opening the
  link), New link (the order, the defaults, the client check, the server's field error,
  a bad custom end, named people and an email, a country, notify, no limit each, the
  POST body including the Pacific end time, the ready card, Share with and without the
  password, Copy the invite, Done reloading the list), Run it again (the summary and its
  POST, Change something first with overrides), Discard (the Alert's words, DELETE), the
  link screen (board order, watching now, two cities, opens used up, a guest, folded
  refusals, New password, Edit settings → PATCH update without scope or an unchanged
  password, End it now, Run it again replacing the screen, the Back pill, Discard going
  back to the tab), a show (season and picked episodes), before migration 128 and not
  yours, the Distribution screen (Open › for a runner only, the way to the tab),
  `hrefToRoute`, nothing off the side, 44pt controls, the opened tab in view. The show
  screen itself wasn't driven (it needs its whole page read): the tab is the same
  component, drawn in a stand-in frame.

## What only a device can show

- **Hermes's `Intl` with `timeZone: 'America/Los_Angeles'`**: `pacificParts` reads
  `toLocaleString`'s output with a pattern; if Hermes (iOS or Android) formats it
  differently, the quick windows, the custom date and every Pacific label are wrong. Make
  one "Tonight only" link on each platform and check its end reads 11:59 PM.
- The keyboard over the sheet (MessageSheet pads the window; fields scroll up after
  320 ms), the number pads and the date/time keyboards (iOS's number pad has no Done key:
  tap outside or drag), and the sideways layout with a keyboard up.
- `Share.share` with a message on both platforms, native `Alert`s, the clipboard.
- VoiceOver / TalkBack on a card (its top part is one link, its buttons separate), the
  radio rows and the tags.
- The new link's screen replacing the ended one after Run it again, and `dismissTo` with
  `?tab=screenings` landing on the tab the creator came from.
