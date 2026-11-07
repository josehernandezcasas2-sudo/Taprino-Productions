# Series revamp — the rest of slice 5 (the app's admin deck) and slice 6 (ship)

Written 2026-11-06 after slice 4 shipped (3b0f934). The spec is `mockups/series-revamp-spec.md`
("App — admin deck", "5 · The app", "6 · Ship", "Retired", "Going this way"); Jose's decisions there
stand. Where the spec predates a decision, the decision wins: **decision 2** — approving an episode never
brings a show live (the owner presses Make it public; slice 3a retired the queue's "ready to go public"
items), so nothing here says "Approving this brings the show live" and no Approve is disabled "for a
sub-admin on a first episode".

No migration. No money path changes (payees, prices, Checkout, lanes, tips, Terms untouched) except where
this contract names one.

---

## A. The app's admin deck (rest of slice 5) — app builder

`mobile/src/app/admin/review.js`, `mobile/src/app/admin/index.js`.

1. **A submission card of a show's episode** reads what `/api/admin/review-queue` already sends since 3a
   (`lib/reviewQueue.js`): its `subtitle` ("Night Bus · S1 E4 · 23 min · Mara"), `position`, `blocked`
   (the approval blocker's line, or null) and `meta.slot` (`{ free, words }`). Under the title: the slot
   line (`meta.slot.words`; gold when `free: false`). When `blocked` is set, **Approve is disabled** and the
   line shows under the buttons in the danger colour; Reject stays. The Free / Tapa + chips are unchanged.
   A card whose item carries a show (`meta.show` or the subtitle's group — read what the server sends; add
   nothing server-side) shows a small kicker above the title: "<Show name> · N in review" when the queue
   sends that count, else just the show name.
2. **The `series` kind is gone from the app**: `KIND_LABEL.series`, the "Make it public on the web ↗" /
   "Check artwork on the web ↗" branch for series, and `series` in the `?kind=` filter. Ads keep their web
   link.
3. **`admin/index.js`**: a **Shows** row under "On the web" → the website's `/admin/shows` (through the
   same opener the other web rows use), shown to full admins and to sub-admins holding any of the show
   capabilities (the list `lib/adminNav.js` gives `/admin/shows`; mirror it, don't import it).
4. Words follow the website's queue (`components/admin/ReviewQueue.js`) exactly.

## B. Slice 6 — web builder unless marked (app)

### B1. Linked credits on profiles (decision 20)

A Studio or Producer credit linked to an account (`series.credits` / `episodes.credits`, `{ studio: { name,
userId }, producer: { name, userId } }`, migration 118) puts that title on the linked account's profile, in
the existing **"Tagged in"** grid (`pages/profile/[userId].js`), with `role: 'Studio'` or `'Producer'`
(the grid already prints "· role"). Rules:

- Only what the public catalogue shows: a public show (`isPublicShow`, not held, not being removed) or a
  public standalone title / episode (`getPublicEpisodes`). A show's own credit lists the show; an episode's
  own credit (overriding its show) lists the episode.
- A title the account also made (uploader / show owner) appears once, as today, with no role added.
- Read with a JSON filter where PostgREST allows it (`credits->studio->>userId`), else read the candidate
  rows and filter in code; either way bounded. Before 118 (no `credits` column) nothing changes and nothing
  errors.
- `getCreditedWork` stays the one source (`lib/userProfiles.js`); `/api/profile` and the profile page carry
  it as today. The count in the profile's stats line includes them.
- **App**: `mobile/src/app/profile/[userId].js` already draws `creditedWork`; make sure it prints the role
  like the website ("Series · Producer").

### B2. Artist Support picks a linked producer (decision 20)

`listSupportableCreators` (and its search) also lists an account linked as Studio or Producer on a title
the public catalogue shows, **only when that account has Creator Studio (creator role) or is an admin** —
the same requirement 3b set for a paid account (they need the Money page and payouts to collect) — and is
not a creator who left (`creator_standing`). Everything else about the list is unchanged; in particular
**the studio's own account stays exactly as it is today** (Jose has not answered whether to remove it).
Members' picks pay through the existing lanes; nothing in the money code changes.

### B3. Nothing from a show that isn't public appears anywhere else ("Going this way")

Audit and fix: profiles (`getCreditedWork`'s series query), the home page's faces and Notice Board
(`lib/homeFeed.js`, `getFeaturedCreators`), Artist Support's list, channels and the scheduler's title
pickers (what can air; `lib/channelEngine.js`, `lib/scheduleAdmin.js`), the feeds (stream / genre / type /
podcasts / vertical / snippets / recs / wishlist / collection), search, the sitemap, RSS. A private show
(or a held one, or one being removed) and its episodes must not appear in any of them for anyone but
through the preview. Report each surface as already-safe or fixed.

### B4. Retire what the spec retires

- Delete the four caller-less review routes: `pages/api/admin/{pending-series,review-submission,bulk-review,
  pending-submissions}.js` — first prove no caller in `pages/`, `components/`, `lib/`, `contexts/`,
  `mobile/src/`, `scripts/` (and note any scratchpad suite that calls them).
- Remove the queue's `series` decision branch (`DECIDABLE_KINDS`' `'series'`, `decideReviewItem`'s series
  branch that answers 409 `retired`) and whatever only it used.
- The old creator routes the spec's "Retired" list names (edit-submission, request-episode-edit,
  request-series-edit, add-artwork's episode half, replace-video, series-media, request-series-deletion,
  request-episode-deletion, create-series): list each with its callers in web **and** app; delete only a
  route with **no caller anywhere**; leave every route still called (standalone titles still use several)
  and keep `create-series` as `/api/show`'s alias. Say which went and which stayed and why.
- Caller-less components stay in the tree (the spec says so). Remove dead words pointing at "Series
  management" in anything still rendered, web and app (app help text: "…from the website's Series
  management").

### B5. Two leftovers from 3b

- **Test content** (`lib/testContent.js`, `/admin/test-content`): deleting one episode that has extras
  filed after it re-files them under the show first, through `refileExtrasUnderShow` in `lib/payees.js`
  (the same step `resolve-deletion` runs); when that fails nothing is deleted and the page says why.
- **The Move sheet's earnings line** ("Future earnings go to …", web `components/show/MoveSheet.js` + app
  `mobile/src/components/show/MoveSheet.js`): when the moved episode carries extras whose payee would also
  change, the line says so ("…, and its 2 extras"). Use what the move answer or the show payload already
  carries; add a field only if nothing carries it, in `lib/showPage.js`, never in `lib/payees.js`'s rules.
  If this needs more than a small field, leave it and say so.

## C. Verification

- Web builder: `pw/slice6-http.js` (registered in `final/run.sh` as `slice6-http`, and `slice5-app-http`
  for the app builder's file — the web builder adds both case lines first thing): B1 (a linked producer's
  profile lists a public show with "Producer", not a private one, not twice for the maker; before 118 the
  same profile still answers), B2 (a linked producer with Creator Studio is in Artist Support's list and
  search, one without is not, a leaver is not), B3's fixes, B4 (the deleted routes answer 404, a `series`
  decision answers 400), B5 (test-content's refile and its failure path through the stand-in's
  `/__fail?table=episodes`); a browser screenshot of the profile grid at 390 and 1280.
- App builder: `pw/slice5-app-http.js` (Bearer token, no Origin): the queue items the deck reads carry
  `subtitle`, `position`, `blocked`, `meta.slot` for a show's episode (taken slot → `blocked`), no `series`
  item; `/api/profile` carries the role; both expo exports.
- Then the must-stay-green list through the runner, `check:refs`, `lint`, every unit test, `next build` in
  a copy, both exports.

## D. Questions for Jose (none needed to build)

- Remove the studio's own account from Artist Support's pick list? (asked 2026-11-06; unchanged here)
