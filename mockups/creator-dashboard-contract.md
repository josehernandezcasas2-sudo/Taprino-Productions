# Creator Dashboard: build agreement

Jose, 2026-11-14: "i want to add a dashboard to the tab bar, for all, pc, and mobile. The goal of this is that creators land there to view everything from the films and shows they add and also see their income/money they make from them plus more." Mockup: https://claude.ai/artifact/Sbam9nFHvuM18YhjUFgZtp (today's four creator pages beside the proposal). His answers the same day:

1. "I like the proposed sections, lets build that in."
2. Who sees the tab: "all creators and teams see the tab."
3. After signing in: "a creator should be sent there, this is where they can add content and review what they have added."
4. Creator Studio: undecided. He wants to see Creator Studio beside the built Dashboard first ("it might be the case that we can move from that to this new design"). Until he says so, Creator Studio stays exactly as it is and keeps a tab.

## 1. What it is

One page, `/creator/dashboard` on the website and `creator/dashboard` in the app, the same sections in the same order:

1. Head: kicker "Creator dashboard · <name>", "Your work and what it earns.", the month picker, **New show**, **+ Submit a title**.
2. The row of section tabs: Overview · Your work · Numbers · Money · Pitches · Creator Studio.
3. Four numbers: earned this month across lanes, owed to you with the next transfer, views in the last 30 days, supporters.
4. **Your titles** (filters All / Live / In review / Drafts / Needs you; the first 8 rows, then "Show all N"): one row per show, per title in no show, per episode in review or turned down, per draft. A live row has views (30 days, with a small line), how much of it people watch, and what it earned in the month.
5. **Needs you** (at most 5, then "N more in Your work").
6. **Money this month**: the lanes as bars, what moves on the 1st, what is in Stripe now.
7. **Views a day · last 30 days** (a line) and **Earned · last six months** (bars).
8. **Latest**, **Pitch Room**, **Your link**.

On a phone (and in the app) the order is head, tabs, numbers (2 × 2), Needs you, Your titles, Money, Views, Latest, Also yours. The six-month bars are on the website's wide layout and the app's Money tab only if it fits; the phone board leaves them out.

## 2. Where the numbers come from

Nothing new is stored and there is no migration. The page asks six routes that already exist, each with its own gate, and draws each section as its answer arrives:

| Section | Route |
|---|---|
| titles, Needs you, Latest | `GET /api/creator/my-submissions` |
| shows | `GET /api/show?mine=1` |
| drafts | `GET /api/creator/drafts` |
| invites to be paid | `GET /api/payees/mine` |
| money, six months, per-title earnings, Latest | `GET /api/creator/money?period=YYYY-MM` |
| views | `GET /api/creator/analytics?days=30&compare=1` |

Added for the Dashboard (all additive; the old answers are unchanged):

- `/api/creator/money` carries `dashboard: { months: [{ period, cents, current }] (six, oldest first), previous: { period, cents } | null, byTitle: { 'episode:<id>' | 'series:<id>': { salesCents, adsCents } }, latest: [{ id, at, lane, kind, label, detail, cents, amountCents, href }] (8) }` (`lib/creatorMoney.js` `dashboardExtras`; `earnedByTitle`, `monthTotals`, `periodsBack` in `lib/creatorMoneyRules.js`). Sale lines carry `titleType` / `titleId`.
- `/api/creator/analytics` takes `compare=1`: the change is then the window against the same number of days before it (`comparedTo: 'previous'`), and every `perEpisode` row carries `windowViews` and `spark` (at most ten steps) whatever the flag.

**Earned per title is its sales plus its ad share, and nothing else.** Those are the only two lanes the site records against a title. Member support, tips and backing are recorded against the creator and show in the money card only; the page says so under the list. Ad share for a month's plays is credited on the 1st of the next month, so "this month" holds last month's plays (the money page counts it the same way; the two pages always agree).

## 3. The rules

`lib/creatorDashboardRules.js` (pure; imports only `./showRules.js`; `node scripts/test-creator-dashboard.mjs`). **`mobile/src/lib/creatorDashboardRules.js` is the file word for word**: a change goes into both in the same commit. It holds every word and number the page draws:

- `seesDashboard(role)`, `canAddTitles(role)`, `dashboardTabs(role, { studio })`, `signInLanding(role, next)`, `DASHBOARD_PATH`, `DASH_WORDS`
- `dashboardTiles({ money, numbers, period, now })` → four `{ key, label, value (null while loading), sub, tone }`
- `dashboardTitles({ submissions, shows, drafts, numbers, money, now })` → `{ rows, counts }`; a row is `{ key, kind, id, title, meta, state, stateLabel, href, poster, views, spark, watchedPct, earnedCents, earnedDetail, note, action, needs }`; `filterTitles(rows, filter)`, `TITLE_FILTERS`, `TITLES_LIMIT`
- `dashboardNeeds({ submissions, shows, invites, money, limit })` → `{ rows: [{ key, title, sub, action }], total, more }`; an `action` is `{ kind: 'publish', label, showId, name }` or `{ kind: 'link', label, href }`
- `dashboardMoney(money, { period, now })`, `dashboardMonths(money)`, `dashboardViews(numbers)`, `dashboardLatest({ money, submissions, now, limit })`, `dashboardPitch(money)`, `dashboardLink(money)`, `periodOptions(money, now)`
- `dollars`, `count`, `dayLabel`, `whenLabel`, `runtimeLabel`, `monthName` / `monthShort` / `monthLabel`

Every `href` is a website path. The app turns one into its own route with `hrefToRoute` (and opens the site for what it has no screen for).

**Make it public** (an `action` of kind `publish`): ask with `DASH_WORDS.makePublicAsk(name)`, then `POST /api/show/<showId>/public` with `{}`, then read the shows and the submissions again. A refusal shows the server's own `error`.

## 4. Who sees what

- The tab and the page: `seesDashboard` = a creator, an admin, or a sub-admin. Everyone else never sees the tab; the page sends them to `/account` (signed out) or `/stream`.
- A sub-admin who is not a creator has no titles, so the titles, drafts, invites and money routes refuse them: the page then shows `DASH_WORDS.teamOnly` and whatever does answer (the views route does). No section of a refused route is drawn as zeros.
- The tabs: `dashboardTabs(role)`.

## 5. Website (built by the lead)

`pages/creator/dashboard.js`, `components/creator/dashboard/*`, `components/creator/DashboardTabs.js` on the Dashboard, Your work, Numbers, Money, the Pitch Room dashboard and Creator Studio, the `.dash-*` styles; `components/MobileTabBar.js` gets a **Dashboard** tab between Watch and Account (a link, not a menu; lit on every `/creator/*` page) and loses My Work / Your Numbers / Money from the Account menu for people who have the tab; Creator Studio and Your work get the tab bar; `HeaderNav`'s account menu gets a Dashboard row; `/signed-in` decides where a sign-in from the account card or the door lands.

## 6. The app

Mirror the phone board (the signed-off HTML is `DashboardPhone.dc.html` in the session's scratchpad; the sizes, colours and order are in its inline styles, and the colours are the theme's own tokens):

- `mobile/src/app/creator/dashboard.js` (registered in `_layout.js` like the other creator screens, `headerShown: false`, `TopNav` on top), its pieces under `mobile/src/components/dashboard/` (no non-route code under `app/`).
- Data: the six routes above with the token (`useAuth` from `mobile/src/lib/stableAuth.js` only; the lint rule refuses the Clerk import elsewhere). Each section draws when its own answer arrives; a refused or failed route leaves its section out or says it couldn't load, with Retry. Re-read on return to the screen (`useRefreshOnReturn` or the focus pattern the hub uses).
- `BottomNav`: a **Dashboard** tab between Watch and Account for `seesDashboard(role)`; a tap goes to the screen (no menu); lit on the Dashboard, Creator Studio, Your work, Your numbers, Money, Your pitches and the show screens. An admin then has six tabs (with Admin): all six must fit on a 320pt-wide phone with no clipped label. People with the tab lose My Work, Creator Studio, Your Numbers and Money from the Account menu.
- `DashboardTabs` (a horizontal, scrollable row) on the Dashboard and on Your work, Your numbers, Money, Your pitches and Creator Studio.
- `TopNav`'s account panel: a Dashboard row above the creator rows.
- After signing in from the general entries (the top bar's Log in / Create account, the Account screen's sign-in state, the beta door), `signInLanding(role)` decides: a creator or team member goes to the Dashboard. A sign-in started by an action (tip, buy, back, answer a call) leaves the person where they were.
- `PushListener`'s route list knows `/creator/dashboard`.
- Charts in `react-native-svg` (the views line, the row's small line, the six-month bars if shown): one colour per chart, text in the theme's ink, the line 2pt, bars with a rounded top.

## 7. Done means

`node scripts/test-creator-dashboard.mjs`, `node scripts/test-creator-money.mjs`, every other `scripts/test-*.mjs`, `npm run check:refs`, `npm run lint`, `next build`, both app exports; the rig check `dev/test-rig/checks/creator-dashboard.mjs` (a creator, an admin, a sub-admin, a viewer, signed out; 390 and 1280; the tab, the sections, Make it public, the month picker, the sign-in landing). Not on a device.
