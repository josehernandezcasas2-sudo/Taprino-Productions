# Your work revamp + title dashboards — the build agreement (2026-11-15)

Signed off by Jose on the canvas https://claude.ai/artifact/6LuuNpyuaKTS5PkCij8Nfc
("I like that, let's build it and add it onto what we have", 2026-11-15) after
four comments on 2026-11-14:

1. "lets seperat these, so they each have their own, films and shorts section.
   Snippets will be under the user profile once that is set up … they will go
   under bunny.net instead of this so they can be cheaper to hold."
2. "Lets have the sections a drop down so they can continue scrolling down
   their work."
3. "show the series, then make a drop down to see the rest of the seasons then
   the rest of the episodes. This may change later but lets do this for now."
4. "for series, and single items like a film/short, add a dashboard that will
   encompass the works's back end and analytics, this is so that we can more
   edit the work and add more information."

The canvas boards: "New · laptop", "New · a title open", "New · phone",
"Dashboard · a film (a new page)", "Dashboard · a series (the show page, with an
Overview tab)". The site moved on since the mockup was drawn: Your work is now
a tab of the creator Dashboard (the row of tabs `components/creator/DashboardTabs.js`,
Overview · Your work · Numbers · Money · Pitches). Keep that row; the mockup's
"← Creator Studio" link is replaced by it.

**No migration, no new API route.** Everything reads routes that exist.

## Decisions made while building (to report to Jose)

- Clicking a film, short, extra or vertical title of its own opens its
  **title dashboard** (`/creator/title/<id>`). The side panel of the "a title
  open" board is not built: the dashboard's tabs replace it.
- Clicking a show's episode opens the episode editor as today
  (`/creator/show/<sid>/episode/<eid>`).
- Vertical titles stay reachable in a **Vertical** section, folded, with a line
  saying they are moving to the profile, until the profile page exists.
- The five number tiles, the approval rate, the average review time, the
  "View your numbers" line and the missing-artwork banner leave Your work: the
  counts are on the tabs, the numbers are on the Dashboard and Numbers tabs,
  and what's missing is on each row and under Needs you.
- A show page gets a row of two tabs, **Overview · Episodes**. It still opens on
  Episodes (the room as it is today), so every existing link, the `?ep=` panel,
  `?edit=`, `?created=1` and `#ep-<id>` keep working; `?tab=overview` opens the
  Overview. The admin's show page (`/admin/shows/<id>`) is unchanged.
- The title dashboard's tabs reuse the edit boxes Your work already has
  (RequestEditModal, EditSubmissionModal, AdminEditEpisodeModal, ArtworkModal,
  ReplaceVideoModal, CaptionUploadModal, SellTitleModal, PayeeModal,
  DeleteRequestModal); nothing about what they send changes.
- The Dashboard's rows and Needs you for a title of its own now open its title
  dashboard instead of Your work (`lib/creatorDashboardRules.js` `titleHref`).

## The rules (the lead owns these files; builders do not edit them)

Every number, label, row and sentence comes from these two pure files. The
app's copies are the same files word for word (`mobile/src/lib/…`), checked by
`scripts/test-work-list.mjs` and `scripts/test-title-dash.mjs`. If a builder
needs a change, say so in the report; do not edit them.

- `lib/workListRules.js` — `buildWorkList({ submissions, shows, prices, tab, query, canEditAll })`
  → `{ tabs: [{ key, label, count }], counts, sections, filtering, empty, nothingMatches }`.
  - `sections[]`: `{ key: 'shows'|'films'|'shorts'|'extras'|'podcasts'|'other'|'vertical', label, count, note, openByDefault, shows | rows }`.
  - a show card: `{ id, name, kindLabel, state, stateLabel, stateTone, poster, countLine, needLine, restLine, makePublic: { name } | null, href, seasons, hasSeasons, openLabel, openByFilter }`.
  - a season: `{ key, number (null = Extras), label, summary, needs, rows }`.
  - a row: `{ key, id, showId, kind: 'episode'|'extra'|'title', code, title, showName, thumb, pill: { label, tone: live|review|declined|quiet }, meta, need, waiting, next: { key, label } | null, menu: [{ key, label, detail?, tone?, on? }], href, publicPath, live, raw }`.
  - `next.key` ∈ `open` (go to `href`), `replace_file`, `artwork`, `captions`, `cancel_removal`.
  - `menu[].key` ∈ `open`, `edit_full`, `edit_submission`, `edit_words`, `view`, `copy`, `sell`, `payee`, `artwork`, `video`, `captions`, `extract_audio`, `channels`, `cancel_removal`, `remove`.
  - `WORK_TABS`, `WORK_WORDS` (the page's words), `titleDashHref`, `showPageHref`, `episodeEditorHref`, `copyLinkFor(row, origin)`.
- `lib/titleDashRules.js` —
  - `titleDashboard({ title, detail, money, price, chartMode, canEditAll })` → `{ head, need, waiting, tiles, chart, money, checklist, history, trackingOff, tabs, details, artwork, video, selling, channels, removal }` (or null when there is no title).
  - `showOverview({ show, numbers, money })` → `{ tiles, chart, money, episodes, episodesTotal, needs, waiting, people, trackingOff }` (or null).
  - `TITLE_TABS`, `SHOW_TABS`, `TITLE_WORDS`, `watchWords`, `moneyOf`, `lastDays`.
  - action keys in `checklist[].action.key`, `details.action.key`, `artwork.action.key`, `video.*.action.key`, `selling.action.key` / `selling.payee.key`, `removal.key`: the same keys as Your work's menu.

## The data (existing routes; read on the client like the Dashboard does)

| What | Route |
| --- | --- |
| every title of the creator's | `GET /api/creator/my-submissions` → `{ submissions }` |
| their shows | `GET /api/show?mine=1` → `{ shows }` |
| prices | `GET /api/creator/pricing` → `{ prices, settings, blocked }` |
| one title's numbers | `GET /api/creator/episode-detail-analytics?episodeId=<id>` |
| every title's numbers (a show's Overview) | `GET /api/creator/analytics?days=30&compare=1` |
| money (this year's lines) | `GET /api/creator/money?period=<YYYY>` → `history` |
| a show | `GET /api/show/<id>` |
| Make it public | `POST /api/show/<id>/public` with `{}` after `window.confirm(DASH_WORDS.makePublicAsk(name))` |
| channels | `POST /api/creator/channel-opt-in { type: 'episode', id, optIn }` |
| cancel a removal | `POST /api/creator/request-episode-deletion { episodeId, action: 'cancel' }` |
| ask for a removal | `DeleteRequestModal` → the same route with `action: 'request', reason` |
| extract a podcast's audio | `POST /api/creator/extract-podcast-audio { episodeId }` (poll every 3 s until `status: 'ready'`) |

A route that refuses (403) leaves its part out; one that fails says so in its
part; nothing is drawn as zeros because a route didn't answer (the rules
already return '—' for a null answer).

## Builder A — the website's Your work (`pages/creator/my-work.js`)

Owns: `pages/creator/my-work.js`, any new `components/creator/work/*.js`, and
the block between `/* === Your work, revamped … === */` and `/* === end Your
work === */` in `styles/globals.css` (class prefix `.wk-`). Delete nothing else
(the old `.yw-*` / `.project-*` / `.work-episode-row` rules stay; other pages
may use some).

- Keep `getServerSideProps` as it is (gate, `allSeries`, `mainGenres`), the
  HeaderNav, the eyebrow "Creator Studio" + `<h1>Your work`, the lede from
  `WORK_WORDS.lede`, the two head buttons (+ Submit a title → `/creator/submit`,
  New show → `/creator/show/new`), `DashboardTabs current="work"`, Footer,
  MobileTabBar, and every modal with exactly the props it gets today
  (`editValuesFor`, `setChannelOptIn`, `extractAudio`, `requestEpisodeDeletion`,
  `cancelEpisodeDeletion`, `loadPricing`, the payee sheet, the Sell modal with
  `blocked`).
- Under the tabs: the five work tabs with counts (`aria-pressed`) and the search
  box, wrapping on a phone. Deep links: `?status=pending` → In review,
  `?status=approved` → Live, `?status=rejected` → Not this time,
  `?attention=1` → Needs you, `?tab=<key>` → that tab.
- Sections fold from their heading (a real `<button aria-expanded>` with a
  chevron, the label and the count, a hairline to the right). Open by default
  except Vertical (`openByDefault`); while a tab or search is on, every section
  shows what matches (open). Remember which sections, shows and seasons are
  open in `sessionStorage` (`tapa_work_open`, try/catch, page works without it).
- A show is one card: poster (2:3), name, kind chip, state chip (not for a live
  show), count line, the need line (orange) + rest line, then the buttons:
  Make it public (only `makePublic`), Open show page, and the seasons toggle
  (`openLabel` / `WORK_WORDS.hideSeasons`, chevron; hidden when `!hasSeasons`).
  A show starts folded (except `openByFilter`). Open, it lists its seasons as
  rows (`<button aria-expanded>`: chevron, label, summary, the needs in
  orange); a season starts folded (except while filtering) and opens to its
  episodes, indented under it.
- One row design for every title (show episodes and titles of their own):
  thumbnail 16:9, code + title (a title's whole left part is one link to
  `row.href`), the pill + meta line, `need` in orange with a warning icon,
  `waiting` in gold with a clock icon, then on the right the `next` button
  (outlined gold, 40px+), then the ⋯ button (`aria-label` "More for <title>",
  `aria-haspopup="menu"`, `aria-expanded`). The ⋯ menu has a word on every
  item; it closes on a click outside, Escape (focus back to its button), and
  after an action; only one is open. `danger` items in red after a divider.
  `on` items show their state on the right ("On" / "Off"). The `view` item
  opens the public page in a new tab; `copy` copies `copyLinkFor(row, SITE.productionDomain)`
  and the item reads "Link copied" for 2 s. For a show's episode the `payee`
  item links to `episodeEditorHref(showId, id, 'who-gets-paid')`; for a title
  of its own it opens `PayeeModal`. `sell` opens SellTitleModal with
  `{ type: 'episode', id, title, sub }`.
- An action's error shows on its own row (`role="alert"`), not at the top.
- States: loading (`WORK_WORDS.loading`), failed (`WORK_WORDS.failed` + Try
  again), nothing yet (`WORK_WORDS.nothing` with the link), nothing matches
  (`WORK_WORDS.nothingMatches` + Show everything which clears tab and search).
- 1280 and 390 wide with no sideways scroll; every button ≥ 40px tall (44 on a
  phone); colours only from the `:root` tokens; tints as
  `rgba(var(--brass-rgb|--olive-rgb|--danger-rgb), a)`.

## Builder B — the website's title dashboard and a show's Overview

Owns: `pages/creator/title/[id].js`, `components/creator/title/*.js`,
`components/show/ShowOverview.js`, `pages/creator/show/[id].js` (the tab row
only), and the block between `/* === Title dashboard … === */` and
`/* === end Title dashboard === */` in `styles/globals.css` (prefix `.td-`).

- `/creator/title/[id]`: `getServerSideProps` like `pages/creator/my-work.js`
  (creator or admin, else `/stream`; `isTitleId(id)` else 404; `allSeries`
  only for an admin; `mainGenres`; `Cache-Control: private, no-store`). The
  page reads the four routes (my-submissions, episode-detail-analytics,
  pricing, money for this year). If the title isn't among the creator's
  submissions: `TITLE_WORDS.notFound` and a link back. If it is a show's
  episode (it has a `seriesId` and is not vertical), `router.replace` to its
  episode editor.
- Layout (the canvas's "Dashboard · a film"): HeaderNav, `← Your work`
  (`.acct-back`, to `/creator/my-work`), `DashboardTabs current="work"`, the
  head (poster 2:3, type chip, the pill, `<h1>` title, meta, View its page /
  Copy link when live), the title tabs (`TITLE_TABS` from the rules, `?tab=` via
  a shallow route change, keyboard: a real `<nav>` of links or buttons with
  `aria-current`), then the tab:
  - Overview: `need` card (orange) when there is one, the four tiles, the chart
    (30 bars, Views / Watch time switch, `role="img"` with an `aria-label` that
    says the range and the peak; the empty line when `chart.empty`), the money
    card (rows, total, the month line, the note, a link to `/creator/money`),
    and on the right the checklist (each undone item's button runs its action)
    and the history. Two columns from 1024px, one below.
  - Details / Artwork / Video and captions / Selling / Channels: one card each
    from `details`, `artwork`, `video`, `selling` (+ Who gets paid), `channels`
    (a real switch: `role="switch"` `aria-checked`), each button opening the
    existing box. The removal card (`removal`) at the end of Details.
  - Run `trackingOff` → `TITLE_WORDS.noTracking` under the tiles.
- A show's Overview: `pages/creator/show/[id].js` gets the row of tabs
  (`SHOW_TABS`: Overview · Episodes) above the room in creator mode (not the
  sub-pages `episode/[episodeId]` and `edit`). `?tab=overview` renders
  `components/show/ShowOverview.js` in place of `ShowControlRoom`; anything
  else renders the room exactly as today. The Overview reads `GET /api/show/<id>`,
  `/api/creator/analytics?days=30&compare=1` and `/api/creator/money?period=<YYYY>`
  and draws `showOverview(...)`: the four tiles, the chart (10 bars of three
  days), "Episode by episode" (a table in an `overflow-x: auto` box: code +
  title linking the editor, views, average watch, watched through as a bar, or
  the pill), and on the right Needs you, Waiting on us, Who's on it, and the
  money card. Keep the room's back pill ("Dashboard") above the tabs.
- 1280 and 390 with no sideways scroll, tokens only, buttons ≥ 40px.

## Builder C — the app (Expo, `mobile/`)

Owns everything under `mobile/` except `mobile/src/lib/workListRules.js`,
`mobile/src/lib/titleDashRules.js` and `mobile/src/lib/creatorDashboardRules.js`.

- `mobile/src/app/account/my-work.js` (Your work): the same model from
  `buildWorkList` — the tabs with counts (sideways scroll), search, the folding
  sections, show cards that open to seasons that open to episodes, one row
  design, the ⋯ as the screen's existing action sheet with the menu's words
  (keep every action the screen has today, including the downloads switch for
  films and whatever else it offers; map the menu keys onto them). A title of
  its own opens the new title dashboard screen; a show's episode opens the
  existing episode editor screen. Make it public through an `Alert` in
  `DASH_WORDS.makePublicAsk`.
- `mobile/src/app/creator/title/[id].js` (new): the title dashboard in the
  phone's order (head, the tabs as a sideways row, the tab's content; Overview:
  need, tiles two across, chart with react-native-svg like `DashCharts.js`,
  money, checklist, history). Actions: the screen opens the same sheets/screens
  Your work uses for that action today; anything the app can't do (captions,
  for example, are website-only in the app) says so and opens the website
  through the existing helper.
- The show screen (`mobile/src/app/creator/show/[id]/index.js`): the Overview ·
  Episodes tabs, `?tab=overview`, Overview from `showOverview(...)`.
- Register the new screen (`_layout.js`, `headerShown: false`), `hrefToRoute`
  / `PushListener` for `/creator/title/<id>`, and make the Dashboard screen's
  links to `/creator/title/<id>` open the new screen.
- Theme tokens from `mobile/src/lib/theme.js` only; touch targets ≥ 44.

## Done (each builder)

- `npm run lint` and `npm run check:refs` pass; `node scripts/test-work-list.mjs`,
  `node scripts/test-title-dash.mjs`, `node scripts/test-creator-dashboard.mjs`
  pass.
- Web builders: no rig in the worktree (the lead runs the rig after the merge);
  `npx next build` if time allows.
- App: `cd mobile && npx expo export --platform ios --clear --output-dir /tmp/<name>-ios`
  and the same for android bundle.
- Commit on the worktree's branch with a plain message; report the files, what
  was built, what was not, and anything in the rules that looked wrong.
