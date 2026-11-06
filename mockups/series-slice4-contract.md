# Series revamp, slice 4 — the public pages (and the app's public screens)

The build contract for two builders working at once: **web** (the pure rules and both their copies, every server
change, the website's pages and components, the stand-ins and both suites) and **app** (the app's series and episode
screens, its heroes and cards, the creator screens' preview links, its HTTP suite and the exports). Written 2026-11-06
from `mockups/series-revamp-spec.md` (Jose's decisions 2, 10, 11, 20, 23 and the "Going this way" list win over the
spec's screens; the spec's "Public series page", "Public episode page", "An episode's own page", "The public series
page", amendments 5, 16 and 23, and Build slice 4), the signed-off canvas https://claude.ai/artifact/F9iNDTTZFJ4Y8ocaWaNv2Z
(boards **V1** public series page, **V2** episode with its own page, **V3** owner's preview, **D10** the free-episode
labels), `mockups/series-slice3a-contract.md` / `series-slice3b-contract.md` (format), and the code on branch
`series-app` after the 3b follow-ups (slices 1, 2, 3a, 3b built).

**The 3b follow-ups are committed** (on `series-app` and `main`, 2026-11-06): the episode page's Tip button tips the
title's **maker** (`submitted_by`, the tipping block of `lib/episodePage.js`), extras filed under a show through
`bonus_parent_*` follow the show's paid account (`extraParentOf` / `payeeShowIdOf` in `lib/showRules.js`, `lib/payees.js`),
and the Own card's fine print reads "Most of it goes to the people who made it." Slice 4 never edits `lib/payees.js`,
the PayeeCards, `pages/terms.js` or the tipping block, and reads only `tipping.enabled` / `tipping.creatorName` from it.

House rules that apply to every line below (CLAUDE.md "Connect-side patterns" and the Series revamp bullet): ids from a
browser are checked with `isTitleId` before any query; episodes are put in order only by `sortEpisodes` /
`compareEpisodes`; a stored episode title is never empty; reads that name a 118 column retry without it on 42703 /
PGRST204 (a database behind on migrations renders, it doesn't 500); public queries keep `moderation_hold = false`; a
route answers errors through `sendError` (never `err.message`); colours are CSS tokens (web) / theme tokens (app), tints
`rgba(var(--x-rgb), a)`; pages and components import only client-safe modules (`lib/showRules.js`,
`lib/seriesResume.js`, `lib/siteConfig.js`, `lib/tierBadge.js`), never `lib/seriesHub.js`, `lib/episodePage.js`,
`lib/showRollups.js`, `lib/publicCredits.js`, `lib/episodes.js`, `lib/publicEpisodes.js`; `mobile/src/lib/showRules.js`
is `lib/showRules.js` word for word below its header and `mobile/src/lib/seriesResume.js` mirrors its play-order block
word for word and its labels' words; no site class starts with `cl-`. **Money rules are untouched**: no lane, price,
payee, payout or Checkout path changes in this slice.

Nobody in this slice edits CLAUDE.md, commits or pushes; the orchestrator does that at the end.

---

## 1. What slice 4 builds, and what it does not

**Builds**

1. **What viewers see of a show (decision 10, option A)** everywhere a show is drawn as one thing: the series page's
   hero, the browse heroes (`HeroSpotlight`, web + app), the series cards in rows (`GenreRow` web, `LibraryRows` app):
   a **"Tapa +"** pill plus a separate green chip — **"E1 free"**, **"E1–E3 free"**, **"2 free"** — or one pill
   **"Free with ads"** / **"Free"** when everything is free; the rating box shows the show's highest rating; a
   non-member's Play reads **"Play S1 E1 · free"**. One rule (`showRollup`, built in slice 1) computed once per show from
   **all** its public episodes (never from a row's filtered subset).
2. **The series page** (`/series/<id>`, web + app) as V1: hero meta (chips, rating box, "N seasons · M episodes", the
   credit lines of decision 20, year, seal), compact episode rows with their code, a per-row **Free / Tapa +** word in a
   mixed show, a lock for a non-member on a Tapa + row, Buy / Owned and a **Details ›** link on an episode that has its
   own page; season tabs that carry their label (**"Season 2 · The Return"**) and read and write `?season=`; the tab
   **Extras** (renamed from Bonus Content) grouped **"With the show"** / **"After S1 E3 · Transfer"**; the compact
   "Own the whole series" card; About with genre, rating, the credit lines, year, Crew needed, Crew and Shot at (web and
   app); og tags.
3. **The owner's private preview (decision 2, amendment 5)**: `/series/<id>?preview=1` and `/episode/<id>?preview=1`
   (web + app) and `/podcasts/<id>?preview=1` (web) for a show that isn't public or an episode that isn't live — the
   owner, anyone with an episode in the show and the team see the page under a preview bar (V3); strangers get the same
   404 as a missing id; `noindex`; `private, no-store`; plays are never counted, saved, shown ads, offered for sale or
   tipped. `PREVIEW_BUILT` turns on (web and app) so the creator side's preview links appear.
4. **An episode's own page (decision 11)**: with `has_page` on and no `?autoplay`, `/episode/<id>` opens the V2
   landing — the trailer/still strip, the title block, **Play / Save / Tip**, **"Notes from Mara"**, the credit lines,
   the full Own card, the season strip — and Play turns it into the player in place (URL gets `?autoplay=1`). With it
   off (the default for a show's episodes) nothing changes.
5. **The episode page's other public changes**: the kicker and "See all" carry `?season=`; `<title>` names the show
   (**"S1 E3 · Transfer — Night Bus · Studio Tapa TV"**); og:image is the episode's still (else the show's art); the
   credit lines of decision 20 in the credits line; the Extras row (renamed) shows the extras hung on this episode first,
   then the show's own.
6. **The 302 for a podcast show** (built in slice 1) gets followed by the app's series screen.
7. **"New episode" banners read `released_at`** (so Make it public, which restarts it, starts the banner), web cards and
   app cards.
8. **The app's public screens** (the public half of slice 5): `series/[id].js` and `episode/[id].js` mirror 2–6, the
   app's `HeroSpotlight` and `LibraryRows` mirror 1, the creator screens' preview links work.

**Does not build (deferred; named so nobody builds them by accident)**

- **A "Paid to" line anywhere public** (decision 23: viewers see the credits, never who is paid; question 23's "public
  too?" stays as 3b left it). No public payload carries `paid_to`, a payee, an invite or `title_payees`.
- **Films and shorts keep today's landing hero** (the 56% hero with Play / Save / Back this project). The V2 layout is
  for a show episode or an extra with its own page. See question 1.
- **A kind of extra** ("Making-of", "Deleted scene" on V1's cards): nothing stores it; the card reads **"Extra · 6
  min"**. See question 2.
- **Linked Studio / Producer credits on profiles** and a linked producer in Artist Support ("Going this way" list):
  slice 6. The public pages only link a credit line's name to that account's profile.
- **Sitemap and search** stay exactly as today (decision 11 as answered): every episode URL listed, `has_page` changes
  nothing there.
- **The app's podcast preview** (the app's podcast screen keeps its pre-redesign shape, spec "Not built"); the app shows
  no preview button for a podcast show. Podcast preview is website-only.
- **Season art, per-season release dates**, a podcast page redesign, a trailer video in the app's series hero (the app
  keeps its image hero), captions in the app, the app's admin deck (slice 5 rest).
- **Wishlist, Recs, Collection and the poster grids** keep their single tier pill (they draw no rolled-up show today).
- No migration (§3), no notification type, no audit action (everything here is a read).

---

## 2. Where the spec, the decisions, the canvas and the code disagree, and what wins

| # | The spec / the code said | What slice 4 does | Why |
|---|---|---|---|
| 1 | Spec: the roll-up pill reads **"Tapa + · pilot free"** | **Two chips**: "Tapa +" and a green "E1 free" / "E1–E3 free" / "2 free"; one pill "Free with ads" ("Free" when no free episode has ads) when all are free; `showRollup` already returns `tierLabel` / `freeLabel`. | Decision 10, option A (2026-11-01), board D10. |
| 2 | Spec: the preview bar says "Only you can see this — it goes public with the first approved episode" | V3's words: **"Only you can see this. Once an episode is approved, press Make it public when you’re ready."** and per-state lines (§6.3). | Decision 2: nothing goes public by itself; the owner presses Make it public. |
| 3 | Spec: has_page landing = "the landing view a film already gets (HeroSpotlight art or signed trailer…)" | A show episode (or an extra) with its own page gets **V2's layout**: a 16:9 strip with the still or the trailer behind a round button, then the after-Play title block, a Play / Save / Tip row, the notes, credits, the full Own card, the strip. Films keep their hero (question 1). | The canvas is the signed-off visual reference; V2 is the only drawing of this page, and it follows the after-Play page of 2026-10-29, not the old hero. |
| 4 | V2's credit line "Crew: 6" (a count linking to #crew) | Kept as today: **"With <names> (role)…"**, "Shot at …", Report. | The episode page has no crew list to link a count to; the after-Play line was signed off on 2026-10-29. |
| 5 | V1's extra card meta "MAKING-OF · 6 MIN" | **"Extra · 6 min"** (CSS uppercases it). | No column holds an extra's kind (question 2). |
| 6 | Spec: the episode page's Bonus row = "Extras anchored to this episode" | One row headed **"Extras"**: those hung on this episode first (shelf order), then the show's own ("With the show"), as one track. | Today a series episode shows the show's extras; dropping them would hide them from every episode page. Amendment 23 already keeps an extra of a non-public episode out (lib/publicEpisodes.js). |
| 7 | Spec: Made by = `defaults.artist`, else the owner's name, else the first episode's artist (`rollup.madeBy`) | **`creditLines`** (decision 20, slice 1's rule): Made by / Hosted by, then the optional Studio and Producer, in the owner's order; the series page falls back to the first episode's artist only when `creditLines` gives no Made by line (an ownerless show from before 038). The words match the editors' preview: **"Made by Mara Reyes · Studio Harbor Films · Producer Lux Tan"** (`components/show/CreditsFields.js` already promises "On the page: …"). | Decision 20 (2026-11-02) replaced the roll-up's Made by. |
| 8 | Spec: og:image = the show's **poster** | **The still** (16:9 `thumbnail`), else the poster, else the hero image, else `/og-image.png`, made absolute on `https://www.studiotapatv.site`. Episodes: their own still, else the show's (rowToEpisode already falls back), else the poster. | Link previews are landscape (`summary_large_image` crops a 2:3 poster badly). A small call, not a decision. |
| 9 | Spec: thin-episode fallbacks "come from the show's defaults in rowToEpisode / rowToPublicEpisode" | **Built in slice 1** (`inheritedField`): title "Episode N", description, genre label, Made by, year. Slice 4 only **stops the series page's rows repeating the show's description** (spec: a row's description falls back to nothing): a row whose `desc` equals the show's description sends `desc: null`. | Spec "The public series page". |
| 10 | Spec: `has_page` null = by type; the page's `showPlayer` today = `contentType === 'series' \|\| trailer \|\| autoplay` | `showPlayer` starts as **`!episodeHasPage(episode) \|\| ?trailer \|\| ?autoplay`**. Films and shorts: unchanged (page). Series episodes: unchanged (player). **Changed:** an extra (`bonus`), a podcast or a vertical title opened bare at `/episode/<id>` now plays straight away instead of showing the landing, unless its `has_page` is on. | Decision 11; spec "a bonus clip opens the same way from both pages (the landing when it has a page, else the player)". Podcasts are linked to `/podcasts/<id>` anyway (`episodeHref`). |
| 11 | Spec "Public series page": preview for "owner/admin", "sees nothing otherwise different" | Preview is for **the show's owner, anyone with an episode in it, and the team** (`findSeries`' rule since slice 1). It **does** differ: the episode list is every approved or in-review episode of the show with its state (V3: "IN REVIEW · sent 3 h ago"), Play reads "Preview S1 E1", no Save, no Buy, the footnote. On a show that **is** public, `?preview=1` is ignored (the ordinary page, no bar). | V3 board; amendment 5 ("every non-deleted episode of the show"). Slice 1 left the list public-only ("the preview reader is the public pages' slice"). |
| 12 | Amendment 5: playbackGate's preview branch for "the owner (series.creator_id), the uploader or an admin" | Exactly those three play an episode in preview (the team = `canAccessAdmin`). A **contributor** sees the series preview but their rows for other people's episodes are not links. Preview **skips the age gate, the tier and the early screening** for those three; a **held** episode (or one in a held show) plays for the team only — others get the "Pulled" panel. Declined (`rejected`) and withdrawn rows never preview. | They are the people answerable for the title; a moderation hold is the legal switch. |
| 13 | Spec: the series page's season tabs "read and write ?season=" — built half in slice 1 (`season` is read) | Read (slice 1) **and written**: a tab tap `router.replace(…?season=N, { shallow: true, scroll: false })`; the app `router.setParams({ season })`. | — |
| 14 | Spec: the BundleCard "names owned episodes 'S1 E3'" | The series page's card becomes **V1's compact card** ("Own the whole series" · "All 5 episodes and any Mara adds later" · **Buy $9.99**) with the owned codes in its credit line. It has one caller (the series page) on each platform; the episode page's OwnTitleCard keeps its bullets. Prices and Checkout untouched. | V1; "fits two episodes per screen" was board T5's complaint. |
| 15 | V2 "NOW OPEN" on the strip's current card | **"Now open"** on the landing (nothing plays yet), **"Now playing"** while playing (as today). | V2. |
| 16 | Spec: `/api/series-hub` "adds isAdmin, isOwner" | Not sent. The preview's `role` ('owner' \| 'contributor' \| 'team') is all a page needs; `isSubscriber` is sent (the locks and the free note). | Nothing reads isAdmin / isOwner; less to leak. |
| 17 | Spec: "The app's hub … draws locks only for a non-member" | Kept, plus: the app's rows play on tap (`?autoplay=1`) — today a row opens `/episode/<id>` bare, which would now land on a has_page episode's page instead of playing. | Spec: "a row tap = play". |
| 18 | `hrefToRoute` (app) drops the query of `/episode/<id>` and `/series/<id>` | Keeps `season`, `preview` and `autoplay` on those two routes. | A notification or a site link to `?season=2` must open season 2. |

**Found while reading, fixed with the 3b follow-ups:** the Own card's fine print said "Most of it goes to <Made by>";
since 3b a sale pays the title's paid account, so it now reads "Most of it goes to the people who made it." (web + app).
Slice 4 does not touch money words.

---

## 3. Data: no migration

Everything slice 4 reads is in **118** (in by 2026-11-04): `series.kind`, `defaults`, `seasons`, `credits`,
`decision_note`, `public_at`; `episodes.has_page`, `page_notes`, `credits`. Nothing is written. **Before 118** (the
stand-ins' `/__shows118?mode=pre`) every page renders: `kind` from the episodes, no season labels ("Season N"),
`has_page` absent = by type (no Details links, a show episode plays), credits absent = Made by from the artist / the
owner's name, no notes.

**What never leaves the server on a public page or answer:** `paid_to`, anything from `payee_invites` / `title_payees`,
`submitted_by` (rows say `canOpen` instead in a preview), a stored trailer or video address, `pending_*` staged values
(a preview shows the live values), `page_notes` of an episode whose `has_page` is off, a credit's `userId` (only its
profile `href`).

---

## 4. Pure rules

### 4.1 `lib/showRules.js` + `mobile/src/lib/showRules.js` (word for word; `scripts/test-show-rules.mjs` diffs and runs both)

Change:

```
showRollup(episodes, show, opts)
  opts.includeInReview === true → an episode with status 'pending' counts as public too (the preview's hero:
  V3 reads "Free with ads · TV-14 · 1 season · 1 episode" for a show whose one episode is in review).
  Everything else as today. Its answer's freeIds stays (servers strip it before a payload).
```

Add (names and contracts exact; use the file's own helpers `pick`, `text`, `posInt`, `numberOf`, `seasonOf`,
`titleOf`, `tierOf`, `compareEpisodes`, `timeOf`):

```
rowTierWord(ep, rollup) → 'Free' | 'Tapa +' | null
  null unless rollup && rollup.tier === 'mixed'; else tierOf(ep) === 'free' ? 'Free' : 'Tapa +'
  (D10: the list carries FREE / TAPA + only in a mixed show; CSS uppercases.)

episodeCodeOf(ep) → 'S1 E3' | null          // null without a number; the same spelling as seriesResume.episodeCode

extraGroups(extras, episodes) → [{ key, parentId, heading, items }]
  extras: content_type 'bonus' rows (camel or snake); episodes: the show's episodes shown on the page.
  key 'show' (bonusParentType 'series'), heading 'With the show', parentId null — first;
  then one group per parent episode found in `episodes`, in compareEpisodes order of the parent:
  key `episode:<id>`, parentId <id>, heading `After ${code} · ${title}` (code = episodeCodeOf(parent),
  title = titleOf(parent)); without a number `After ${title}`.
  An extra whose parent episode isn't in `episodes` is dropped (amendment 23: never "With the show").
  Items within a group: series_order (shelf order) ascending, none last, then createdAt, then id.
  Empty groups are left out; [] when nothing.

previewBarWords({ scope, role, state, headline, ownerName, showName, episodeStatus, held, standalone }) → { strong, text }
  scope 'show' | 'episode'; role 'owner' | 'contributor' | 'team' (an owner who is also on the team is 'owner';
  on an episode, its uploader counts as 'owner'); state = showState(...).key; headline = showState(...).headline;
  ownerName = the show owner's display name or null; first = its first word, else 'its owner'.
  Exact words in §6.3 (the table is this function's test).

previewRowNote(row, now = Date.now()) → { pill, note } | null
  status 'pending'                       → { pill: 'In review', note: `sent ${ago}` }    ago: 'just now' (<1 h),
                                           'N h ago' (<24 h), 'yesterday', 'N days ago'  (createdAt; no date → note null)
  held                                   → { pill: 'Pulled', note: null }
  deletionRequested                      → { pill: 'Removal requested', note: null }
  status 'approved' and row.showPublic === false → { pill: 'Approved', note: 'goes public with the show' }
  otherwise null
  (held is checked before status; the server calls this and sends the words, so render and hydration agree.)
```

Tests (`scripts/test-show-rules.mjs`, both copies): `showRollup` with `includeInReview` (a pending-only show →
`tier 'free'`, `freeLabel 'Free with ads'`, `episodeCount 1`); `rowTierWord` for mixed / all-free / all-premium;
`extraGroups` — a show extra, two extras on S1 E3 in shelf order, one on S2 E1, one on an episode not in the list
(dropped), an unnumbered parent ("After Pilot"); every row of §6.3's table through `previewBarWords`; `previewRowNote`
at 0.5 h / 3 h / 30 h / 4 days, held before pending, a public approved row → null.

### 4.2 `lib/seriesResume.js` + `mobile/src/lib/seriesResume.js` (the app mirrors the words; `scripts/test-series-resume.mjs` runs both)

```
point(ep, state, resumeSeconds)  adds  tier: ep.tier === 'premium' ? 'premium' : 'free'
  (every resume point now says whether the episode it opens is free)

seriesPlayLabel(resume, firstLabel = 'Play first episode', opts = {}) → string
  as today, then: opts.free === true and the state is 'first' or 'next' (or resume is null) → label + ' · free'
  ('Continue S1 E2' never gets it: they are already watching).

freePlayNote({ resume, rollup, isMember, ownsSeries }) → boolean
  rollup && rollup.tier === 'mixed' && !isMember && !ownsSeries
  && (resume ? resume.state !== 'resume' && resume.tier === 'free' : rollup.firstFree === true)
```

Words: **"Play S1 E1 · free"** (series page, app series hero), **"Play S1 E2 · free"** (next state on a free S1 E2),
**"Play first episode · free"** (the browse heroes, which say "Play first episode" today). Tests: first / next / resume
states; all-free and all-premium shows (no note); a member; a bundle owner; a signed-out hero with no resume
(`rollup.firstFree`).

---

## 5. Server

### 5.1 Readers

- **`lib/series.js` `rowToSeries`** adds `credits: normalizeCredits(row.credits)` (public by decision 20; `{}` before
  118). **`findSeries`' preview path** adds, on the preview object only: `decisionNote` (`row.decision_note ?? null`),
  `deletionRequestedAt` (`?? null`), `kind` already there. Nothing else in `lib/series.js` changes.
- **`lib/episodes.js` `rowToEpisode`** adds `hasPage: episodeHasPage(row)` (by type when the column is absent),
  `pageNotes: hasPage ? (row.page_notes trimmed, ≤ 4,000) || null : null`, `credits: normalizeCredits(row.credits)`.
  New export **`findEpisodeForPreview(id, viewer)`** → `{ episode, preview }` | null:
  - reads the row by id (`select('*')`); null when missing, `status` not in (`approved`, `pending`), or `withdrawn_at` set;
  - reads the parent show (`readParentShow`); null when it can't be read;
  - `viewer` = `{ userId, isAdmin, canAccessAdmin }`; allowed when `canAccessAdmin || isAdmin`, or `row.submitted_by ===
    userId`, or `parent && parent.creator_id === userId`; else null (the caller answers 404);
  - `episode` = `rowToEpisode(row, parent)` with `status`; `preview` = `{ role: 'owner' | 'team', status, held:
    Boolean(row.moderation_hold || parent?.moderation_hold), deletionRequested, showPublic: parent ? isPublicShow(parent)
    : null, showName: parent?.name ?? null, showId, ownerId: parent?.creator_id ?? null, canPlay }` where `canPlay` =
    `!held || canAccessAdmin || isAdmin` (role 'owner' covers the uploader and the show's owner).
- **`lib/publicEpisodes.js`** exports **`getShowEpisodesForPreview(seriesId)`** → rows of the show (`series_id = id`)
  and its extras (`content_type 'bonus'` with `bonus_parent_type 'series'` and `bonus_parent_id = id`, or hung on one
  of the show's episodes) with `status in (approved, pending)` and `withdrawn_at is null`, selected with
  `EPISODE_COLUMNS` + `status, submitted_by, moderation_hold, deletion_requested` (no `src`; the 118 retry as
  `readSeriesForEpisodes` does), the show row read with `select('*')` for the fallbacks, mapped by
  `rowToPublicEpisode(row, { [show.id]: showRow })` plus `status`, `held`, `deletionRequested`, `submittedBy` (server
  side only). Not cached.

### 5.2 New server libs

- **`lib/showRollups.js`** — `attachShowRollups(allSeries, publicEpisodes, ratings = null)` → a copy of each show with
  `rollup` = `showRollup(itsEpisodes, show, { ratings })` minus `freeIds` and `mainGenre`: `{ tier, tierLabel,
  freeLabel, firstFree, rating, episodeCount, seasonCount }` (null when the show has no public episode). Groups by
  `seriesId` once (O(episodes)); `publicEpisodes` must be the **unfiltered** public list. Pure apart from what it's
  given; imports `lib/showRules.js` only.
- **`lib/publicCredits.js`** — `publicCreditLines({ episode = null, series, fallbackArtist = null })` → `[{ key, label,
  name, href }]`: `creditLines(episode, series, names)` where `names` come from one `getPublicProfilesByIds` of the
  maker id (runner, else uploader) and the Studio / Producer `userId`s; `href` = `profilePath(profile)` when that
  account has a profile row, else null. When no line has `key 'maker'` and `fallbackArtist` is set, a `{ key: 'maker',
  label: 'Made by', name: fallbackArtist, href: null }` line is put first. A profile read that fails gives the lines
  without names from accounts (a typed name still shows; a line with no name is dropped). `notesFrom(lines,
  profiles)`: the Made by line's first word when it links to an account whose display name is that line's text,
  else the whole Made by text, else null.

### 5.3 `getSeriesHubData(seriesId, req, { season, preview, followKind })` (`lib/seriesHub.js`)

`preview` becomes a **boolean** (the caller's `?preview=1`); the viewer is read inside from `getAccountContext(req)`
(read first when `preview` is true). Order:

1. `isTitleId`, then `findSeries(id, preview && signed in ? { preview: { userId, isAdmin, canAccessAdmin } } : {})`
   (it reads the public row first). Null → null (404). **`previewing = Boolean(seriesInfo.preview)`** only — today's
   second clause (`previewsOwnShow` on a public show) goes, so a public show with `?preview=1` is the ordinary page.
2. Podcast → `{ redirect, kind }` as today (the page keeps the query, so `?preview=1` reaches `/podcasts/<id>`).
3. Episodes: public → today's list; previewing → `getShowEpisodesForPreview` (sorted). Extras: public → every public
   `bonus` with parent `series = id` **or** parent episode in the list; previewing → the same from the preview rows.
4. `has_page` per row: one `episodes.select('id, has_page').eq('series_id', id)` (42703 → none); `hasPage =
   episodeHasPage({ ...row, has_page })`.
5. `rollup` = `showRollup(rows, seriesInfo, { ratings: await getRatings(), includeInReview: previewing })` stripped as
   in 5.2; `credits` = `publicCreditLines({ series: seriesInfo, fallbackArtist: firstRow?.artist })`; `year` =
   `seriesInfo.releaseYear || firstRow?.releaseYear || null`; `seasons` = every season present, `[{ number, label:
   seasonLabel(seriesInfo, n) }]`.
6. Offers, resume, seal, crew, shotAt, crewCalls as today; **previewing**: offers `{}` and bundle null, no resume
   (`resume` = the first row's point with state 'first'), trailer signed as today but `heroTrailer.ref = null` (the
   trailer route refuses a private show, so the hero falls back to its artwork when the hour runs out).
7. `preview` object (previewing only): role ('owner' when `userId === creatorId`, else 'team' when `canAccessAdmin`,
   else 'contributor'), `state = showState(seriesInfo, rows)`, the words from `previewBarWords`, `ownerName`
   (`getPublicDisplayNames([creatorId])`), `linkHref` (owner / contributor `/creator/show/<id>`, team
   `/admin/shows/<id>`), `linkLabel` 'Open show page'. Rows gain `previewNote` (`previewRowNote(row)` with `showPublic:
   false`) and `canOpen` (owner / team: true; contributor: `row.submittedBy === userId`); `submittedBy` is removed.

**The answer adds** (web props and `/api/series-hub` alike):

```
rollup        { tier, tierLabel, freeLabel, firstFree, rating, episodeCount, seasonCount } | null
credits       [{ key, label, name, href }]
year          number | null
seasons       [{ number, label }]
extraGroups   [{ key, parentId, heading, items: [{ id, title, runtime, thumbnail, tier, adsEnabled }] }]
bonusContent  every extra on the page, flat (kept for older app builds; now includes the ones hung on episodes)
seriesEpisodes[i]  + hasPage, desc (own description, null when it is the show's), previewNote, canOpen (preview only)
isSubscriber  (now on the API too)
crew, shotAt, crewCalls   (now on the API too)
preview       null | { role, state, strong, text, linkHref, linkLabel }
```

`seriesInfo` keeps its fields (+ `credits`); `heroTrailer`, `resume`, `kind`, `redirect`, `season`, `aiSeal`,
`bundle`, `episodeOffers` unchanged. Caching: `/api/series-hub` with `preview=1` answers `private, no-store` whatever
the headers; the page with `?preview=1` sets `Cache-Control: private, no-store` before anything else.

### 5.4 `getEpisodePageData(id, req, { preview })` (`lib/episodePage.js`; never the tipping block)

- `findEpisode(id)` first; the buyer path as today; when still nothing and `preview` and signed in →
  `findEpisodeForPreview(id, viewer)`; null → `{ notFound: true }`. A public episode with `preview` set is the ordinary
  page (no bar).
- **Previewing**: skip the age gate, the early screening and **every view count** (`recordView` / `recordDailyView`);
  the strip, Up next and previous come from `getShowEpisodesForPreview(showId)` (rows with `status`), `afterShow` null,
  `watchNext` [], `purchase` / `bundle` null, and **after** the tipping block `tipping = { enabled: false, reason:
  'preview' }`; `previewInfo` = `{ role, status, held, canPlay, strong, text, linkHref, linkLabel }` with the words from
  `previewBarWords({ scope: 'episode', … })` and `linkHref` = the show's page as in 5.3 (a standalone title: owner →
  `/creator/my-work`, team → none).
- The parent show: `findSeries(showId)` as today; **previewing**, `findSeries(showId, { preview: viewer })` (a private
  show's public read is null, and `parentSeriesName`, the kicker and the credits need it).
- Always: `credits` = `publicCreditLines({ episode, series: parentShow })`, `notesFrom`. `bonusContent` = extras hung on this episode (shelf order),
  then, for a show episode, the show's own; for a standalone title its own as today.
- `episode.hasPage` / `pageNotes` / `credits` come from `rowToEpisode` (5.1).

**`/api/episode-page`** takes `preview=1`; adds `credits`, `notesFrom`, `preview` (= `previewInfo` or null);
`episode.hasPage`, `episode.pageNotes`. In preview the entitlement for captions / transcript / audio is true (the
previewer may watch) unless `canPlay` is false. **`pages/episode/[id].js`** passes `{ preview: query.preview === '1' }`;
in preview `entitled = canPlay`, the src is signed as today, `captionsUrl` carries `?preview=1`, and the props add
`preview`, `credits`, `notesFrom`.

### 5.5 Playback in preview

- **`lib/playbackGate.js` `playbackGate(req, episodeId, { preview = false } = {})`**: when `preview` and the ordinary
  lookup (and the buyer path) found nothing, and the account is signed in and not suspended,
  `findEpisodeForPreview(id, viewer)`; null → the same 404; `canPlay` false → 403 `{ error: 'Pulled while our team looks
  at it.', held: true }`; else allowed with **no age, tier or early-screening check**, answer `{ episode, owned: false,
  account, preview: true }`.
- **`/api/stream-token`**: body `preview: true` → `playbackGate(req, id, { preview: true })`; the answer adds `preview:
  true`; same budget. `part: 'trailer'` unchanged (refuses a private show).
- **`/api/captions/[id]`**: `?preview=1` → the same gate with preview.
- The page's player in preview gets `refreshSrc` = a function posting `{ episodeId, preview: true }`.

### 5.6 Rollups on the browse surfaces

`attachShowRollups(allSeries, <the unfiltered public list>, await getRatings())` right after the data is read, in
`pages/stream.js`, `pages/genre/[genre].js`, `pages/type/[type].js`, `lib/streamFeed.js`, `lib/genreFeed.js`,
`lib/typeFeed.js` (before any genre / type filter). Then:

- **`lib/heroCandidates.js` `buildHeroCandidates`** series candidate: `tier` = `rollup.tier === 'free' ? 'free' :
  'premium'` (as before when no rollup), plus `tierLabel`, `freeLabel`, `rollupTier` (`rollup.tier`), `firstFree`,
  `rating` (`rollup.rating`, null when 'Not Rated'), `firstCode` (`episodeCode(repEpisode)`). Standalone candidates
  unchanged.
- **`lib/libraryCards.js` `consolidateCards`** series card: `tierLabel`, `freeLabel`, `episodeCount` =
  `rollup.episodeCount` (the whole show, not the row's subset), `hasNew` from `releasedAt`. Standalone cards: `hasNew`
  from `releasedAt`.
- **`/api/genre-feed`, `/api/type-feed`** answers add `isSubscriber` (false signed out; the routes already answer
  `private` when a token or session is present).

---

## 6. Website

### 6.1 Files

New: `components/PreviewBar.js`. Changed: `pages/series/[id].js`, `pages/episode/[id].js`, `pages/podcasts/[id].js`,
`components/SeriesHero.js`, `components/HeroSpotlight.js`, `components/GenreRow.js`, `components/BuyBits.js`
(`BundleCard` only), `components/show/ShowCards.js` (`PREVIEW_BUILT = true`), `components/show/EpisodeEditor.js` (the
preview link's condition), `pages/stream.js`, `pages/genre/[genre].js`, `pages/type/[type].js`, `styles/globals.css`
(`--ok-rgb: 132, 205, 152;` in `:root` beside `--brass-rgb`, then `.spg-*`, `.epl-*`, `.pvbar-*`, `.ep-badges`,
`.free-chip`). New classes only under those prefixes (none exist today).

### 6.2 The series page (V1, V3; laptop "unchanged skeleton")

**Hero (`SeriesHero`)** new props `rollup`, `credits`, `year`, `preview`, `isMember`, `ownsSeries`. Meta row, in order,
wrapping, gap 9px 12px:

- tier: `rollup.tier === 'free'` → one pill `rollup.freeLabel` (`free-ads` / `free-noads` classes as today);
  'premium' → pill **Tapa +**; 'mixed' → pill **Tapa +** + chip `rollup.freeLabel` (`.free-chip`: 13px, `color:
  var(--ok)`, `border: 1px solid var(--ok)`, `background: rgba(var(--ok-rgb), 0.14)`, radius 999, padding 4px 11px);
  no rollup → today's `tierBadge` of the first episode;
- the rating box (`.hero-rating-tag`, mono 11px, 1px ink border) with `rollup.rating`, left out when it is 'Not Rated';
- **"2 seasons · 5 episodes"** — always both: `${s} season${s === 1 ? '' : 's'} · ${n} episode${n === 1 ? '' : 's'}`
  (V3: "1 season · 1 episode");
- one span per credit line, **"Made by Mara Reyes"**, **"Studio Harbor Films"**, **"Producer Lux Tan"** (`${label}
  ${name}`), in the order given, plain text in the hero;
- the year (**"2026"**); the seal chip.

Buttons: **Play** = `seriesPlayLabel(resume, firstLabel, { free: freePlayNote({ resume, rollup, isMember, ownsSeries
}) })` with `firstLabel` = "Play " + the first row's code (else "Play first episode") → **"Play S1 E1 · free"** / **"Continue S1 E2"**; **Save
this series** / **Saved**. Preview: **"Preview S1 E1"** (the first row, `/episode/<id>?preview=1&autoplay=1`), no Save;
no rows → no Play. Trailer controls unchanged (aria "Unmute preview" / "Pause preview").

**Under the hero**, in the stage (`.library-stage`): BACK pill, BoughtBanner, the owned line, then **the compact bundle
card** (`BundleCard`, V1): `.own-card.bundle.compact` — surface-2, `1px solid rgba(var(--olive-rgb), 0.55)`, radius
12px, padding 14px 16px, a row with the text left and the button right:

- **"Own the whole series"** (16.5px, 600);
- **"All 5 episodes and any Mara adds later"** (13.5px, ink-dim; `bundle.episodeCount`; the name = the first word of
  the Made by line when it links to an account, else the whole Made by text, else "the creator");
- when on sale: **"20% off until Nov 9"**; when episodes are owned: **"You own S1 E3, so it’s $1.99 less."** (codes via
  `episodeCodeOf`, joined "S1 E3 and S1 E4");
- button **"Buy $9.99"** (`payCents`; busy **"Opening Stripe…"**), olive fill, surface-0 text, 44px; error line under.
  Hidden when not for sale, owned, or previewing.

**Tabs**: **Episodes**, **Extras** (only when `extraGroups` isn't empty), **About** — 40px pills, the active one
surface-2.

**Seasons**: more than one → chips (`.season-tab`, 38px, radius 999; active: olive fill, `var(--olive-shadow)` text;
others surface-1 with a `color-mix(in srgb, var(--ink) 14%, transparent)` border and ink-dim text) labelled `label`
(**"Season 2 · The Return"**); a tap sets the season and writes `?season=` (§2 row 13). One season → the heading
(`.series-season-heading`, mono 11px, letter-spacing 1.4px, uppercase) **"SEASON 1"** / **"SEASON 1 · THE RETURN"**.

**Rows** (`.spg-row`, replaces `.episode-row` markup on this page; border-top/bottom 1px ink at 10%, padding 14px 0):

- a link (the row's top) to `/episode/<id>?autoplay=1` (preview: `&preview=1`; `canOpen` false → no link): thumb 120×68
  radius 6 (`thumbnail`, else the dark gradient) with a 28px disc in the middle holding **PlayIcon**, or **LockIcon**
  when `tier === 'premium' && !isSubscriber && !owned && !preview`; beside it the code line — `S2 E1` (mono 10.5px,
  letter-spacing 1.2px, ink-dim) with, right-aligned, `rowTierWord(row, rollup)` (mono 10px, uppercase; Free in `--ok`,
  Tapa + in `--brass`) — the title (16px, 600, 2 lines) and the runtime **"23 min"** (mono 10.5px; `minutesLabel`).
  Accessible name: `S2 E1, Cold Open` + `, locked` when locked;
- the description (`desc`, 14px body font, 1.5, ink-dim, 2-line clamp) when there is one;
- the footer (`justify-content: space-between`): left **BuyChip** (**"Buy $1.99"**, 34px, olive outline) / **OwnedChip**
  ("Owned"); right, when `hasPage`, a link **"Details"** + chevron (44px tall, 13.5px 600) to `/episode/<id>` (preview:
  `?preview=1`), `aria-label` **"Details: Cold Open has its own page"**. Preview: the footer holds the `previewNote` pill
  (`.pvbar-pill`: `rgba(var(--olive-rgb), 0.2)`, mono 9.5px, letter-spacing 1px, uppercase) and note (mono 10.5px)
  instead — **"IN REVIEW · sent 3 h ago"**, **"APPROVED · goes public with the show"**, **"PULLED"**, **"REMOVAL
  REQUESTED"**.
- Laptop (≥ 900px): thumb 176×99, the description beside the title column (grid `176px 1fr`), rows ≤ 860px wide.
- Empty list (preview only): **"No episodes here yet. Episodes you send for review show up here."**

**Extras tab** (V1): per group a heading (mono 11px, letter-spacing 1.4px, ink-dim, uppercase) — **"WITH THE SHOW"**,
**"AFTER S1 E3 · TRANSFER"** — then a grid, 2 columns (gap 12px) under 640px, 3 to 899, 4 from 900: a link to
`/episode/<id>` (an extra plays straight unless it has its own page) with 16:9 art (radius 8), the title (13.5px, 600)
and **"Extra · 6 min"** (mono 10px, uppercase).

**About**: boxes, in this order — **Genre** (the distinct genre labels, as today); one box per credit line, labelled
**Made by** / **Studio** / **Producer** with the name linked to `href` when there is one; **Year** (when set);
**Rating** (`rollup.rating`, "Not rated" for 'Not Rated' or none); **Episodes** ("5 across 2 seasons"); **Shot at**,
**Crew**, and the **Crew needed** list above them, as today.

**Head**: `<title>` `Night Bus — Studio Tapa TV` (as today); `og:title` the name; `og:description` the description's
first 200 characters; `og:image` per §2 row 8 through `absoluteSiteUrl` (new in `lib/siteConfig.js`: an `http(s)` URL
as is, a `/path` prefixed with `https://www.studiotapatv.site`); `og:type` `video.tv_show`; `twitter:card`
`summary_large_image`, `twitter:title`, `twitter:image`. Preview: `<meta name="robots" content="noindex, nofollow">`
and no og tags.

### 6.3 The preview bar (`components/PreviewBar.js`, V3) and its words

Under the header, full bleed: `rgba(var(--olive-rgb), 0.12)` with a `1px solid rgba(var(--olive-rgb), 0.4)` bottom
border, padding 12px 19px 14px (the stage's gutter from 1024px), `role="note"` `aria-label="Preview"`; an eye icon
(18px, olive); the line (14px, 1.45) **`<strong>{strong}</strong> {text}`**; under it the pill link **"Open show page"**
+ arrow (38px, `1px solid rgba(var(--olive-rgb), 0.7)`, olive text) to `linkHref` (left out when null). At the foot of
the page's main column (series page: after the list; episode page: after the credits): an eye-off icon and
**"Hidden from search (noindex). Anyone else gets “not found”. Your plays here don’t count as views."** (mono 10.5px,
ink-dim).

`previewBarWords` (both scopes; `first` = the owner's first name, 'its owner' without one; `show` = the show's name):

| scope | role | state / status | strong | text |
|---|---|---|---|---|
| show | owner | empty, drafts, review | Only you can see this. | Once an episode is approved, press Make it public when you’re ready. |
| show | owner | ready | Only you can see this. | It goes public when you press Make it public. |
| show | owner | pulled, removal, declined | Only you and our team can see this. | `{headline}.` (e.g. "Pulled by an admin: the licence is missing.", "Removal requested on Nov 3.") — declined adds " Fix what it needs and resubmit it from your show page." |
| show | contributor | empty … ready | Only the people working on this show can see this. | `{first} makes it public when they’re ready.` |
| show | contributor | pulled, removal, declined | Only the people working on this show can see this. | `{headline}.` |
| show | team | empty … ready | `Only {ownerName} and our team can see this.` ("Only its owner and our team…" without one) | `{first} makes it public when they’re ready.` |
| show | team | pulled, removal, declined | as above | `{headline}.` |
| episode | owner (uploader or show owner) | pending | Only you can see this page. | It’s in review. It goes live once it’s approved. — on a show that isn’t public: `It’s in review. Once it’s approved, it goes live when {show} is made public.` |
| episode | owner | approved, show not public | Only you can see this page. | `It’s approved. It goes live when {show} is made public.` |
| episode | owner / team | held | Only you and our team can see this page. | Pulled while our team looks at it. |
| episode | owner / team | removal requested | Only you and our team can see this page. | Its removal is requested. |
| episode | team | pending / approved | Only the people on this title and our team can see this page. | the owner row's text |

Each sentence keeps the site's curly apostrophe. V3's own row (owner, review) is the first line, verbatim.

### 6.4 The episode page

**Start**: `showPlayer` initial = `!episode.hasPage || startOnTrailer || startPlaying` (§2 row 10).

**The V2 landing** (a show episode or an extra with `hasPage` true, no `?autoplay` / `?trailer`; films keep their hero,
question 1). Top to bottom on a phone, then the laptop:

1. **The strip** `.epl-strip` in place of the player, the player's box exactly (`aspect-ratio: 16/9; max-height:
   min(600px, 72svh)`): the still (`thumbnail`, else `poster`, else `heroImage`) as cover; with a trailer, a tag
   **"Trailer"** top-left (mono 9.5px, uppercase) and a round 56px button in the middle (1.5px ink border, PlayIcon),
   `aria-label` **"Play the trailer"**, which runs today's trailer path
   (`setShowingTrailer(true); setShowPlayer(true)`); without a trailer the same button reads `aria-label` **"Play"** and
   starts the episode. (The tag's fill is `color-mix(in srgb, var(--surface-0) 78%, transparent)`, the button's at
   55% — the show pages' tint habit.)
2. BACK pill.
3. **The title block** (`.ep-head`, as built): the kicker **"NIGHT BUS · SEASON 1 · EPISODE 3"** + chevron linking to
   `/series/<id>?season=1`; the title (30px on a phone); the meta line **"24 min · Drama · 2026"**, the rating box, the
   tier pill (**TAPA +**), Tapa Original.
4. **The actions** `.epl-actions` (pills, not the round after-Play actions): **Play** (48px, cream fill, flex 1;
   **"Continue"** when the server-side `watchProgress` prop has this episode — signed out it always reads "Play", so
   the render and the browser agree) → `setShowPlayer(true)` and `router.replace({ query: {
   ...query, autoplay: '1' } }, undefined, { shallow: true, scroll: false })`; **Save** / **Saved** (48px, ink
   outline); **Tip Mara** (48px, olive outline; `TipButton` — renders nothing when tipping isn't enabled); **Back it**
   (ink outline) when there is a funding link. They wrap to a second line rather than shrink.
5. **The notes** `.epl-notes` when `pageNotes`: the heading **"NOTES FROM MARA"** (`Notes from ${notesFrom}`; mono 10px,
   uppercase, ink-dim; "Notes" alone without `notesFrom`) and one `<p>` per blank-line paragraph (body font 15.5px,
   1.6). Without notes: the description (`.ep-desc`) in that place, no heading.
6. **The credits** (`.ep-credits`): the avatar initial + **"Made by Mara Reyes"** linked to its `href`; **"Studio Harbor
   Films"**, **"Producer Lux Tan"** (linked when they have one) in the owner's order; the seal; then today's crew line,
   "Shot at …", Report.
7. **The Own card** (`OwnTitleCard`, full, as today) after the credits — V2's order (it sits in `.ep-head` today; on
   the landing it moves to the end of `.ep-body`). Its heading reads **"Own this episode"** for a show episode, "Own this
   title" otherwise (one word change in `OwnTitleCard`).
8. **The season strip** (`EpisodeStrip`) **"Episodes · Season 1"** + **"See all"** → `/series/<id>?season=1`; the
   current card's pill **"Now open"**.

No Up next card and no Accessibility panel on the landing (nothing plays yet): `.ep-layout.no-upnext`. Laptop: the
after-Play grid as built (`head` + `body` left, `episodes` right, 400px), the strip on top at the player's size.

**Always (player or landing)**: the kicker links `/series/<id>?season=<n>`; "See all" carries `?season=<n>`; the credit
lines replace the single "Made by {artist}"; `<title>` = `${code} · ${title} — ${show} · Studio Tapa TV` for a numbered
show episode (`${title} — ${show} · Studio Tapa TV` unnumbered; standalone as today); `og:title` the same without the
site name; `og:image` per §2 row 8; the Extras row is headed **"Extras"** (§2 row 6) with its cards linking
`/episode/<id>`.

**Preview** (`preview` prop): the bar (§6.3) under the header, the footnote after the credits, `noindex`; the player gets
`adsEnabled={false}`, no `onProgress`, `initialPosition={0}`, `endCard={null}`, the preview `refreshSrc`; no Tip, Own
or Buy anywhere; strip / Up next / Play links add `&preview=1`; `canPlay` false → the lock panel with **"Pulled while
our team looks at it"** and **"It plays again once it’s restored."** + "Email us" (`mailto:` `SITE.contactEmail`).

### 6.5 Cards and heroes

- **`GenreRow`** series card: the tier badge becomes `.ep-badges` at the art's bottom-left (0.4rem in, `display: flex;
  flex-wrap: wrap-reverse; gap: 4px`): **Tapa +** (`.ep-badge`, brass) and, in a mixed show, the free chip
  (`.ep-badge.free-chip`: surface-0 fill, `1px solid var(--ok)`, `--ok` text, the same size as `.ep-badge`); all-free →
  one `.ep-badge` with `freeLabel`. Meta **"5 episodes · ▤ Series"** from `rollup.episodeCount`. `hasNew` from
  `releasedAt` (series and standalone). Grids keep their old card.
- **`HeroSpotlight`** (`isMember` prop from the page's `isSubscriber`): a series candidate draws the same pill + chip in
  `.hero-meta` in place of `hero-badge-tier`, its `rating` as the rating tag, and Play =
  `seriesPlayLabel(ep.resume, 'Play first episode', { free: freePlayNote({ resume: ep.resume, rollup: { tier:
  ep.rollupTier, firstFree: ep.firstFree }, isMember }) })` → **"Play first episode · free"**.

### 6.6 The creator side

- `components/show/ShowCards.js`: `PREVIEW_BUILT = true` — the show card's **"Preview · not public yet"** and the ready
  state's **"Preview the page"** appear (podcasts link `/podcasts/<id>?preview=1`). The admin show page shares the card,
  so the team gets the same button.
- `components/show/EpisodeEditor.js`: the own-page block's link shows **"Open page"** when viewable, **"Preview page"**
  (`/episode/<id>?preview=1`) when the row is an episode (not a draft) whose status isn't `rejected`, else nothing.

### 6.7 `/podcasts/<id>?preview=1` (web only)

`getPodcastShowHubData(id, req, { preview })`: `findSeries(id, { preview: viewer })` when the public read finds nothing;
episodes from `getPodcastShowEpisodes(id, true, null, { statuses: ['approved', 'pending'] })` (a new last option; the
previewer is entitled, `age` null passes the age check) with every row's `adsEnabled` set false; the page shows `PreviewBar` (scope show) and the footnote, `noindex`, its inline video players
with ads off and no progress, the persistent audio player not saving progress (`playEpisode({ …, noProgress: true })` —
the context skips its saves when set).

---

## 7. App

Files: `mobile/src/app/series/[id].js`, `mobile/src/app/episode/[id].js`, `mobile/src/components/HeroSpotlight.js`,
`mobile/src/components/LibraryRows.js` (series card chips, `EpisodeStrip`'s `currentLabel` prop), new
`mobile/src/components/PreviewBar.js`, `mobile/src/components/BuyBits.js` (`BundleCard` compact, `OwnTitleCard`'s
heading word), `mobile/src/components/show/ShowCards.js` (`PREVIEW_BUILT = true`, the preview button for kind
'series'), `mobile/src/components/show/EpisodeEditor.js` (the preview link adds `?preview=1`, same condition as the
web), `mobile/src/components/show/ShowBits.js` (`episodePublicRoute(id, { preview })`, `publicRoute(show, {
preview })`), `mobile/src/components/PushListener.js` (§2 row 18), `mobile/src/app/stream.js`, the type and genre
screens (`isMember` to `HeroSpotlight`). Theme tokens only (`colors.ok`, `okTint(0.14)`, `oliveTint`); the same words as
§6.

- **Series screen**: `useLocalSearchParams()` → `id`, `season`, `preview`; GET `/api/series-hub?id=…&season=…` +
  `&preview=1`; a `redirect` → `router.replace('/podcasts/<id>')`. Under `TopNav`: `PreviewBar` when `preview` (its link:
  `/creator/show/<id>` in the app for owner / contributor; the team's `/admin/shows/<id>` opens the website with
  `Linking.openURL(absoluteUrl(…))`). Image hero (unchanged) with §6.2's meta row and Play / Save (Play routes
  `/episode/<id>?autoplay=1`, + `&preview=1`); BACK; the compact `BundleCard` (§6.2's words; `ownedNames` codes); tabs
  Episodes / Extras / About; season chips with labels (`router.setParams({ season })`); rows as §6.2 (thumb 120×68 with
  PlayIcon / LockIcon, code + tier word, title, "23 min", the description 2 lines, BuyChip / OwnedChip, **Details ›**
  44pt to `/episode/<id>`; preview notes); `sortEpisodes` (the hand sort goes). Extras: grouped, 2 columns. About: Genre,
  the credit boxes (a name with `href` → `hrefToRoute`), Year, Rating, Episodes, Shot at, Crew, Crew needed (taps →
  `hrefToRoute`).
- **Episode screen**: params `id`, `autoplay`, `trailer`, `preview`; `/api/episode-page?id=…` + `&preview=1`;
  `showPlayer` = `!hasPage || autoplay === '1' || trailer === '1'` (the `contentType === 'series'` rule goes). The V2
  landing (§6.4: the 16:9 strip with "Trailer" + the round button, BACK, the title block, the Play / Save / Tip / Back it
  row, the notes, the credits, `OwnTitleCard`, the strip with **"Now open"**); Play → `setShowPlayer(true)` and
  `router.setParams({ autoplay: '1' })`. The kicker → `/series/<id>?season=<n>`; See all the same; the row heading
  **"Extras"**. Preview: the bar; `POST /api/stream-token` with `preview: true`; `useWatchProgress` off; no Tip, Own, Buy
  or end card; `useCaptureBlock` as for any playback; a 403 `held` → the "Pulled" panel.
- **Heroes and rows**: `HeroSpotlight` series candidates draw the pill + chip and the rating, Play with the free note
  (`isMember` from the screen: the Stream feed's `isSubscriber`, the type / genre feeds' new `isSubscriber`);
  `LibraryRows` series cards the two chips (bottom-left, wrapping upward) and `hasNew` already computed by the server.
- **Creator screens**: the show card's **"Preview · not public yet"** (series only, not public) →
  `/series/<id>?preview=1`; the ready status card's **"Preview the page"** (series only); the editor's **"Preview
  page"** → `/episode/<id>?preview=1`.

---

## 8. Every state, what it shows (web and app alike unless said)

**Series page**

| State | Shows |
|---|---|
| Signed out, mixed show (E1 free) | **Tapa +** + **E1 free**, the rating box, **"Play S1 E1 · free"**, row words FREE / TAPA +, locks on Tapa + rows, Buy chips when priced, the compact bundle card; public CDN cache as today |
| Signed in non-member, finished E1 (E2 Tapa +) | the same chips; **"Play S1 E2"** (no note: E2 isn't free); in progress → **"Continue S1 E2"** |
| Member (Standard or better, or the team) | the same chips; **"Play S1 E1"**; no locks |
| Bundle owner | "You own this series…" line, no bundle card, no note, no locks, Owned chips |
| All free | one pill **Free with ads** (or **Free**), no row words, no note |
| All Tapa + | **Tapa +** only, no row words, no note |
| First three free / two free elsewhere | **E1–E3 free** / **2 free** |
| Season labels, `?season=2` | season 2 open, chip **"Season 2 · The Return"**; tapping Season 1 rewrites the URL |
| Thin episode row | title **"Episode 4"**, no description line (the show's isn't repeated) |
| Extras | the Extras tab with **"WITH THE SHOW"** and **"AFTER S1 E3 · TRANSFER"**; an extra on a pending episode never shows |
| An episode with its own page | its row has **Details ›** |
| Owner, private show, `?preview=1` (V3) | the bar (owner, review), **"Preview S1 E1"**, no Save / Buy, rows with **IN REVIEW · sent 3 h ago**, the footnote, `noindex`, `private, no-store` |
| Contributor / team, private show, `?preview=1` | their bar words; a contributor's rows for others' episodes aren't links |
| Stranger (signed in or out) on a private show, with or without `?preview=1` | 404, the same as a missing id |
| Owner on a public show with `?preview=1` | the ordinary page, no bar |
| Podcast show | 302 to `/podcasts/<id>` (query kept); the API answers the whole page with `redirect` and the app follows it |
| Before 118 | "Season N", no Details, Made by from the artist / owner, no credits beyond it, everything else as above |

**Episode page**

| State | Shows |
|---|---|
| Show episode, own page off, bare link | the player at once (as today), the kicker and See all with `?season=`, `<title>` with the show |
| Own page on, bare link | the V2 landing; Play → the player in place, URL `?autoplay=1` |
| Own page on, `?autoplay=1` | the player |
| Own page on, no notes | the description where the notes go, no heading |
| Own page on, Tapa + and a non-member | the landing; Play → today's lock panel ("Two ways to watch" / "Available to Tapa + members") |
| Thin episode | **"Episode 4"**, the show's description and genre label, Made by from the show |
| Owner / uploader / team, `?preview=1` (pending, or a private show) | the bar, plays (signed), no views / progress / ads / Tip / Own / end card, `noindex` |
| Held, owner previewing | the page and the "Pulled" panel; the team plays it |
| Stranger with `?preview=1` | 404 |
| Film / short | unchanged (its hero landing) |
| Extra, podcast or vertical opened bare | plays straight (own page off by type) |

---

## 9. Verification

**Web builder**

- `node scripts/test-show-rules.mjs` (§4.1 cases, both copies), `node scripts/test-series-resume.mjs` (§4.2), every
  other `scripts/test-*.mjs`, `npm run -s check:refs`, `npm run -s lint`, `next build`.
- **Stand-ins**: `fake-supabase-harvest.js` needs nothing new except, if missing, `status=in.(approved,pending)` filters
  and `comped_access` reads (check first). No dev-server restart unless no suite runs.
- **`pw/series-public-http.js`** (new; `PORT=3100`): seeds slug-id fixtures through the stand-in's REST and removes them
  at the end (`vs1f-stubstate` snapshot / restore), runs once with `/__shows118?mode=post` and once with `mode=pre`.
  Fixtures: **Dust Road** (`dust-road-sp4-show`, public, Mara's, 2 seasons, `seasons` [{2, 'The Return'}], `credits`
  { studio: { name: 'Harbor Films' }, producer: { name: 'Lux Tan' }, order: ['maker','studio','producer'] },
  `release_year` 2026, a show trailer): S1 E1 "Last Stop" free TV-PG, S1 E2 "The Long Way" Tapa + TV-14, S1 E3
  "Transfer" Tapa + TV-14 `has_page` true with two-paragraph notes and a trailer, S1 E4 thin (stored "Episode 4", no
  description, no genre), S2 E1 "Cold Open" Tapa + `has_page` true; extras "Behind the Wheel" (series), "Depot — deleted
  scene" (on S1 E3), one on a pending episode; prices on S2 E1 and the series. **Harbor Lights**
  (`harbor-lights-sp4-show`, pending, Mara's) with "First Crossing" S1 E1 pending, Dee's "Second Crossing" S1 E2
  pending. **Salt Radio** (`salt-radio-sp4-show`, podcast, approved, one episode). Three more one-line shows for the
  labels (all free, all Tapa +, E1–E3 free, 2 free). Viewers: signed out, Zed (non-member), Fan2 made a member by a
  `comped_access` row (it counts only for a verified primary address: check the stand-in Clerk marks Fan2's so; else
  use the admin, who has team access, as the member case and say so), Mara (owner), Dee (contributor), admin,
  sub-admin.
  1. `/api/series-hub` Dust Road: `rollup` (`mixed`, 'Tapa +', 'E1 free', rating 'TV-14', 5, 2), `credits` (three
     lines, Made by → `/profile/marareyes`), `year` 2026, `seasons` labels, `extraGroups` (two groups, the pending
     episode's extra absent), rows' `hasPage` (E3, S2 E1 true), E4's `desc` null and title "Episode 4", `isSubscriber`,
     `crew` / `shotAt` / `crewCalls` present; **no `paid_to`, `paidTo`, `submittedBy`, payee key anywhere** (a deep key
     scan); `freeIds` absent.
  2. The four label shows: 'Free with ads', 'Tapa +' alone, 'E1–E3 free', '2 free'.
  3. `?season=2` → `season` 2; `?season=9` → 1.
  4. Preview: Mara `?preview=1` on Harbor Lights → 200, `preview.role 'owner'`, V3's words, rows with `previewNote`
     `{ pill: 'In review', note: /sent .* ago|just now/ }`, `Cache-Control` private no-store; Dee → 'contributor', Mara's
     row `canOpen` false; admin / sub-admin → 'team'; Zed and signed out → 404 with and without `preview`; Mara
     `?preview=1` on Dust Road → no `preview`.
  5. `/series/<salt-radio>` → 302 `/podcasts/<id>`, `?preview=1` kept; the API answers `redirect`.
  6. `/api/episode-page`: E3 `hasPage`, `pageNotes` (two paragraphs), `credits`, `notesFrom` 'Mara'; E2 (`has_page`
     null) `pageNotes` null even after a stand-in write of notes; E4 "Episode 4" + the show's description; E3's
     `bonusContent` = the deleted scene first, then Behind the Wheel.
  7. Episode preview: Mara `?preview=1` on First Crossing → 200 `preview` (owner, pending, private-show words), no
     `purchase` / `bundle`, `tipping.enabled` false, `afterShow` null; Dee on First Crossing → 404, on her own (Second
     Crossing) → 200; Zed → 404. No view is counted: the stand-ins run without Redis, so assert it the way
     `pw/payees-http.js` case 12 was handled (the call not made, observed through whatever the stand-ins record; if
     nothing is observable, cover the branch with a small unit check and say so in the notes).
  8. `/api/stream-token` `{ episodeId: first-crossing, preview: true }`: Mara → 200 signed `src` + `preview: true`;
     without `preview` → 404; Zed with `preview` → 404; a held episode → Mara 403 `held`, admin 200; age-gated (17+,
     Mara with no age on file) → 200 in preview. `/api/captions/<id>?preview=1` the same gate.
  9. Feeds: `/api/stream-feed` hero candidate for Dust Road (featured for the run) carries `tierLabel`, `freeLabel`,
     `rating`, `firstCode`; a "New releases" card of Dust Road whose row holds only S2 E1 still says 'E1 free' and
     `episodeCount` 5; `/api/genre-feed` and `/api/type-feed` carry `isSubscriber`.
  10. Before 118 (`mode=pre`): every page 200, `seasons` "Season N", no `hasPage` true, `credits` one Made by line,
      preview still works.
- **`pw/series-public.js`** (new; browser, 390×844 touch and 1280×800, the fixtures above):
  1. Dust Road signed out at 390: the hero's pill + green chip text and colours (`--ok`), the rating box, "2 seasons ·
     5 episodes", the three credit spans in order, "2026", the seal, **"Play S1 E1 · free"**; at 1280 the same.
  2. Zed: "Play S1 E1 · free" (no history); after seeding "finished E1" → "Play S1 E2"; Fan2: "Play S1 E1", no locks.
  3. Rows: codes, FREE / TAPA + words, the lock on E2 for Zed, Buy $1.99 on S2 E1, **Details** only on E3 and S2 E1
     with its aria-label, E4 shows no description; the bundle card's three lines and "Buy $9.99"; a row tap lands on
     `/episode/<id>?autoplay=1` with the player; Details lands on the landing.
  4. Seasons: "Season 2 · The Return" chip; tapping it writes `?season=2` (no reload: a window marker survives); a
     reload opens season 2.
  5. Extras tab: the two headings, "Extra · 6 min", 2 columns at 390, 4 at 1280; the pending episode's extra absent.
  6. About: Made by linked to `/profile/marareyes`, Studio, Producer, Year, Rating TV-14, Episodes "5 across 2
     seasons".
  7. og tags: `og:image` absolute, the still; `og:type` `video.tv_show`; the episode page's `<title>` "S1 E3 ·
     Transfer — Dust Road · Studio Tapa TV" and `og:image`.
  8. E3 bare: the landing strip at 16:9 (width ÷ height ≈ 1.78 at 390), "Trailer" tag + the round button, the kicker
     link `?season=1`, Play / Save / Tip row, "NOTES FROM MARA" + two paragraphs, credit lines, the Own card after them,
     the strip with **"Now open"**; Play → the player in place, URL `?autoplay=1`, the strip's pill **"Now playing"**;
     the round trailer button plays the trailer. At 1280: two columns, the strip on the right.
  9. E3 with notes removed (stand-in write): the description where the notes were, no heading.
  10. E2 bare: the player at once (as today). A short: its hero landing unchanged. The deleted scene bare: plays.
  11. "See all" → `/series/<id>?season=1` with season 1 open.
  12. Preview as Mara at 390 (V3): the bar's words, "Open show page" → `/creator/show/<id>`, "Preview S1 E1", no Save,
      the IN REVIEW row, the footnote, `meta[name=robots]` noindex; tapping the row plays First Crossing with the bar,
      no Tip / Own, no end card; at 1280 the bar spans the page. As Dee: contributor words, Mara's row not a link. As
      the admin: team words, the link → `/admin/shows/<id>`. Zed: the 404 page.
  13. The creator side: Harbor Lights' show card shows **"Preview · not public yet"** and the ready state **"Preview the
      page"** (after approving First Crossing in the stand-in), both opening the preview; the editor's **"Preview page"**
      on a pending episode → `?preview=1`; a draft has none.
  14. Cards: the stream page's Dust Road card has the two chips inside the art, wrapping upward on a 110px card at
      390, and the browse hero reads "Play first episode · free" signed out.
  15. No horizontal overflow, no page errors, no console errors on any of the above; screenshots in `shots-slice4/`.
- **Update for the new behaviour** (web builder): `pw/show-page.js` A12 and I1 (they assert no Preview link "until slice
  4": now the link is there and opens the preview); anything asserting the series page's "Bonus Content" tab or the
  episode page's "Bonus Content" heading (grep first; `pw/shoot-episode-after.js` counts row cards, which stays).
- Add `series-public-http` and `series-public` to `final/run.sh`.

**App builder**: `cd mobile && EXPO_OFFLINE=1 CI=1 npx expo export --platform ios --output-dir <scratchpad>/expo-s4-ios`
and `--platform android … expo-s4-android`; **`pw/series-public-app-http.js`** (its own file): with a Bearer token and no
Origin, the payloads the two screens read — `series-hub` (cases 1, 3, 4, 5 as the app sends them, `preview=1`
included), `episode-page` (6, 7), `stream-token` with `preview: true` (8), the genre / type feeds' `isSubscriber` — and a
pure check that `hrefToRoute('/series/x?season=2')` keeps `season` (import the module the way `scripts/test-hosted-auth.mjs`
imports app code, or copy the function into the test with a diff check). Not device-tested.

**Must stay green** (`PORT=3100 SUFFIX=-s4 bash …/final/run.sh <names>`): `episode-after`, `end-card`, `resume-http`,
`resume-loop`, `trailer`, `page` (updated), `editors`, `lists`, `api-post`, `show-data`, `followups`, `make-public`,
`creator-path`, `queue`, `show-admin-http`, `show-admin`, `payees-http`, `payees`, `payees-app-http`, `money`,
`title-ids`, `walk390`, `walk1280`, `sweep-out`, `sweep-mara`, `sweep-admin`, and the new `series-public-http`,
`series-public`, `series-public-app-http`. Pure tests: `test-end-card`, `test-series-resume`, `test-show-rules`,
`test-early-access`, `test-purchases`, `test-tips`.

---

## 10. Who owns which file (no file has two owners; `lib/payees.js`, the PayeeCards, `pages/terms.js` and the tipping block are owned by neither)

| Web builder | App builder |
|---|---|
| `lib/showRules.js`, `mobile/src/lib/showRules.js`, `scripts/test-show-rules.mjs` | `mobile/src/app/series/[id].js` |
| `lib/seriesResume.js`, `mobile/src/lib/seriesResume.js`, `scripts/test-series-resume.mjs` | `mobile/src/app/episode/[id].js` |
| `lib/series.js`, `lib/episodes.js`, `lib/publicEpisodes.js`, `lib/podcastShow.js`, `lib/podcastShowHub.js` | `mobile/src/components/HeroSpotlight.js`, `LibraryRows.js` |
| `lib/showRollups.js`, `lib/publicCredits.js` (new) | `mobile/src/components/PreviewBar.js` (new) |
| `lib/seriesHub.js`, `lib/episodePage.js` (not the tipping block), `lib/playbackGate.js` | `mobile/src/components/BuyBits.js` |
| `lib/heroCandidates.js`, `lib/libraryCards.js`, `lib/streamFeed.js`, `lib/genreFeed.js`, `lib/typeFeed.js`, `lib/siteConfig.js` (`absoluteSiteUrl`) | `mobile/src/components/show/ShowCards.js`, `ShowBits.js`, `EpisodeEditor.js` |
| `pages/api/series-hub.js`, `episode-page.js`, `stream-token.js`, `captions/[id].js`, `genre-feed.js`, `type-feed.js` | `mobile/src/components/PushListener.js` |
| `pages/series/[id].js`, `pages/episode/[id].js`, `pages/podcasts/[id].js`, `pages/stream.js`, `pages/genre/[genre].js`, `pages/type/[type].js` | `mobile/src/app/stream.js`, the type and genre screens (`isMember` only) |
| `components/SeriesHero.js`, `HeroSpotlight.js`, `GenreRow.js`, `BuyBits.js`, `PreviewBar.js` (new), `components/show/ShowCards.js`, `components/show/EpisodeEditor.js`, `contexts/PodcastPlayerContext.js` (`noProgress` only) | Scratchpad: `pw/series-public-app-http.js`, `expo-s4-ios/`, `expo-s4-android/` |
| `styles/globals.css` | |
| Scratchpad: `pw/series-public-http.js`, `pw/series-public.js`, `pw/show-page.js` (A12, I1), `final/run.sh`, `shots-slice4/`, the stand-ins if they need a filter | |

**Order.** The web builder lands §4 (both copies + tests) and §5's payload
shapes first and says so; the app builder builds against this contract and the stand-ins meanwhile, reading only the
shapes in §5.3 / §5.4. One dev server (`start-dev-3100.sh`); nobody restarts it while a suite runs.

**For the orchestrator at commit time**: CLAUDE.md's Series revamp bullet gets the slice 4 paragraph (the roll-up chips,
the series page, preview, the own page, `PREVIEW_BUILT` on, no migration); the Own card's money sentence (§2, "Found
while reading") and the two questions below go to Jose.

---

## 11. Questions for Jose (only what the decisions and the canvas leave open)

1. **Should films and shorts get the new "own page" layout too?** The canvas drew it (V2) for a series episode: a 16:9
   strip with the trailer, then the title, Play / Save / Tip, the creator's notes, credits and the Own card. Films keep
   today's big hero for their landing. *Recommended: not in this slice* — ship it for show episodes, look at it on a
   real title, then move films over (they would also get the notes field) if you like it. *Instead:* move films now.
2. **Should an extra say what kind it is** — "Making-of", "Deleted scene", "Interview" — as the canvas's cards do
   ("MAKING-OF · 6 MIN")? Nothing records that today, so cards read "Extra · 6 min". *Recommended: later*, as a
   pick-one list on the extra's editor (one small migration: a column on episodes). *Instead:* add it now (a migration
   121, plus one field in the editors, web and app).
