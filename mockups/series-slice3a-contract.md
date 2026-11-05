# Series revamp, slice 3a — the admin side of shows, and migration 120

The build contract for three builders working at once: **server** (data, rules, routes, the stand-ins and the
HTTP suite), **website** (the admin screens, the review queue, the creator's episode editor for 120, the browser
suite) and **app** (the episode editor for 120, nothing else). Written 2026-11-05 from
`mockups/series-revamp-spec.md` (the screens "Admin — Shows list", "Admin — Show page", "Review queue — submission
item", Build slice 3, the API and data sections, "Bugs folded in"), Jose's answers of 2026-10-31 → 2026-11-04 (which
win over the spec's screens), `mockups/series-slice2-api.md` / `series-slice2-components.md`, and the code as it stands
on branch `series-app` (6f20a07).

House rules that apply to every line below (CLAUDE.md, "Connect-side patterns" and the Series revamp bullet): title
ids are text slugs checked with `isTitleId`; a show episode's place is checked with `slotCheck` and refused with
`slotTakenBody`; episodes are ordered only by `sortEpisodes` / `compareEpisodes`; a stored title is never empty
(`numberTitle` / `syncNumberTitles` after any change of place); writes that carry newer columns go through
`insertCompat` / `updateCompat` and reads fall back without them; every new lib has its `isMissing…` fallback; a
route answers errors through `sendError` / `showRouteError` (`plainStatus: 400`, `internalError` marking — never
`err.message`); every write has a per-account limit next to the per-IP one; capability-gated routes use
`requireCapability`; user-chosen keys are checked with own-property checks; every notification type is registered
in `lib/notificationTypes.js` and its app mirror; colours are CSS tokens (web) / theme tokens (app); pages and
components import only client-safe modules (`lib/showRules.js`, `lib/showAdminRules.js`, `lib/reportReasons.js`,
`lib/siteConfig.js`, `lib/seriesResume.js`), never `lib/showPage.js`, `lib/showAdmin.js`, `lib/showDelete.js`,
`lib/stagedChanges.js`, `lib/seriesDrop.js`. No site class starts with `cl-`.

Nobody in this slice edits CLAUDE.md, commits or pushes; the orchestrator does that at the end.

---

## 1. What 3a builds, and what it does not

**Builds**

1. **Migration 120** — `episodes.pending_title_image_url`, `pending_title_image_removal`, `pending_trailer_src` (Jose's
   answer 25), its PGlite check, `supabase/check_migrations.sql` regenerated.
2. **The episode editors accept a waiting title image and trailer on a live episode** (web `components/show/EpisodeEditor.js`,
   app `mobile/src/components/show/EpisodeEditor.js`); the server stages them, lists them, lets the uploader take them
   back, and the team approves or denies them. Before 120 they are refused with the migration named.
3. **Admin → Shows** (`/admin/shows`): the list with filters, search, badges, "+ Create a show for a creator", and the
   Creators tab (full admins; the old OwnershipPanel roster). `/admin/ownership` redirects to `/admin/shows`.
4. **The admin show page** (`/admin/shows/<id>`, plus `/episode/<eid>` and `/edit` for the editors): `ShowControlRoom`
   in `mode="admin"` with the admin cards — About this show, Who runs it, Where it stands (Fix numbering, Make it
   public), Decisions (Approve all in review, Reject all, Hold, Take down, Restore, Tell savers), Waiting for approval
   (every staged change of the show and its episodes, Current → Proposed), Remove this show (the cascade), History —
   and inline Approve / Reject… on rows in review.
5. **The review queue**: submission items carry their show (`meta.show`, `meta.position`, `meta.slot`,
   `meta.masterReady`, `meta.blocked`), a signed master, and are grouped by show; Approve is refused on a taken slot,
   a missing number or an unready master; the `'series'` (Ready to go public) items are retired.
6. **`lib/showDelete.js` deleteShowCascade** — remove a show with its episodes and extras in one confirmation; anything
   someone bought is withdrawn and kept for them. `resolve-deletion` delegates to it for a show.
7. **`lib/stagedChanges.js`** — one place that lists and decides waiting changes per field (shows and episodes,
   120's three fields included); `resolve-artwork` and `resolve-edit` become thin callers with their old answers.
8. **`lib/seriesDrop.js`** — telling the people who saved a show about its new episodes: a daily step in the
   `expire-content` cron (capped, with a cursor in `series_drop_runs`) and the "Tell savers" button.
9. **Smaller pieces**: owner hand-over notifies both sides and clears the caches (`series-ownership` too); Orphaned
   media gets **Dismiss**; `queue-counts` counts 120's fields; ADMIN_NAV **Shows** with the `shows` badge; the audit log
   and the dashboard leave the creators' own rows out by default (amendment 18), the show's History keeps them;
   `cleanup-orphan` stops echoing `err.message`; the Library links a show's queue rows to its show page and opens the
   long-tail modal from `?edit=<id>`.

**Does not build (deferred, named so nobody builds them by accident)**

- **Slice 3b — who gets paid**: the paid-to picker, payee invites (`payee_invites` writes), `title_payees` writes,
  the "Runs it · Paid to" line, any money lane reading `payeeOf`, the Terms sentence. The Owner card here hands over
  *who runs* a show only. Until 3b flips `PAYEE_RULE_LIVE` (below) nothing says earnings move.
- **Slice 4 — the public pages**: `?preview=1`, the roll-up hero, `has_page` landing, `?season=`, og tags, the podcast
  redirect, Extras grouping on `/series/<id>`. `PREVIEW_BUILT` stays `false`; the admin page shows "View page" only
  for a public show.
- **Slice 5 (rest) — the app's admin**: the deck's New show block and slot line, "Shows" under the app admin home's
  "On the web". The app deck keeps working: it simply stops receiving `'series'` items and its Approve on a show
  episode now goes through the same server rule (a refused one shows the server's line, as any 409 does today).
- Season menu "Add above / below" and "Move all"; "Make it an extra" / "Make this part of a show"; Undo after a move to
  another show; dragging in the app; a wishlist table (saver notices stay a capped Stripe pass); deleting the
  caller-less routes and modals (slice 6); `supabase/health_check.sql` (unchanged: a read naming 120's columns would
  fail on a database without them).

---

## 2. Where the spec and the code disagree, and what wins

| # | The spec (or the code) said | What 3a does | Why |
|---|---|---|---|
| 1 | "A show goes live with its first approved episode, approved by a FULL admin" (`SHOW_LIVE_NEEDS_FULL_ADMIN`, `approveEpisodeAndShow`, "Approve · brings Night Bus live", "A full admin approves a new show") | **None of it.** Any `review_submissions` reviewer approves any episode; the show never flips. The queue's button is plain **Approve**; the show sub-card says "**Mara makes the show public once one is approved.**" `SHOW_LIVE_NEEDS_FULL_ADMIN` is not added. | Decision 2 (option A, 2026-11-01). `makeShowPublic` already exists and is the only way a private show goes public. |
| 2 | Admin show page: "'Approve the show now' for a legacy pending show"; Decisions: "'Approve all in review (N) · brings Night Bus live'" | **Make it public** lives in the "Where it stands" card for a full admin (`POST /api/show/<id>/public`, unchanged). A sub-admin sees it disabled: "**Mara or a full admin makes it public.**" A note under it: "It’s Mara’s call when the show opens — use this when they’ve asked you to." "Approve all in review" approves episodes only. | Decision 2. |
| 3 | The review queue's `'series'` kind (built in slice 1 as the stand-in for Make it public until "the show pages bring the button") | **Retired from the list**: `listReviewQueue` produces no `'series'` items, `counts.series` stays in the answer as `0`, the web chip and the "Make it public" wording in `ReviewQueue.js` go. `decideReviewItem` keeps the branch one release for a stale bundle: `approve` → `makeShowPublic` (full admin) as now; `reject` → 409 "**Shows aren’t declined any more — take one down from Admin → Shows if it has to come off.**" (`code: 'retired'`). | (a) Make it public is the owner's moment (decision 2: "so a whole season can open at once"); a queue item invites the team to press it before the owner is ready. (b) The queue is "needs your review" and nothing about a ready show needs review. (c) Its Reject wrote `status: 'rejected'`, which decision 3 retired. (d) Slices 2 and 3a now give the owner and a full admin the real button, with the show's context; the Shows list's "Ready to go public" filter finds them. `pages/api/admin/pending-series.js` (caller-less) follows: its `rejected` answers the same 409. |
| 4 | Decisions card: "Who can watch (show default), Tapa Original, Hero eligible" | **Dropped from Decisions.** The show's defaults are edited in Edit show (`PATCH /api/show/<id>`, direct for the team). Tapa Original and hero eligibility are per episode, in the episode editor (direct for the team). | A show has no Original / hero column; two places to edit defaults would drift. |
| 5 | "+ Create a show for a creator … 'Live now' tick needs review_submissions" | **No "Live now".** A show made for a creator is always private and follows Make it public. | Decision 2 + amendment 4 ("no live empty shows"). |
| 6 | Amendment 11: "A batch is capped at 10 rows per request and the client loops" | **One request approves up to 100 episodes** (`APPROVE_BATCH_MAX = 100`) with a single guarded `update … where id in (…) and status = 'pending'`; the protection calls run 5 at a time. A show with more answers `remaining` and the page sends the next request. | The cap existed because each row ran the whole per-row decision. One statement keeps "one notification, one audit line" true without a client-side batch id. |
| 7 | "Approve all … refuses the whole batch with the list" + one notification + one audit | Kept exactly: every row is checked first (`approvalBlocker`), any problem refuses the whole request with `problems`; then one notice per uploader (the owner gets one), one audit line. | — |
| 8 | Spec's "Earnings stay with <uploader>" vs. the code's `canMoveTo` line "**Future earnings go to <payee>**" (decision 13/19 rule) | `lib/showRules.js` gets `PAYEE_RULE_LIVE = false` (3b flips it). While false, `canMoveTo` reports `earningsMove: false` and, when the uploader isn't the target show's runner, the line "**Its earnings stay with <uploader name>.**" (fallback "Its earnings stay with whoever uploaded it."). | No money lane reads `payeeOf` until 3b; "Future earnings go to Dee" would be untrue on an admin's Move sheet today. |
| 9 | `resolve_staged { target, field, decision }` "resolve-artwork / resolve-edit logic" | The routes decide a whole row at once today. New `lib/stagedChanges.js decideStaged` decides **per field**; `resolve-artwork` (`fields` = every art field on the row, or `video`) and `resolve-edit` (every text field) call it and keep their request and answer shapes. | The Waiting for approval card has Approve / Deny per change; the Library cards keep their row buttons. |
| 10 | Cascade: "the series row is deleted or withdrawn" | `episodes.series_id → series(id)` has **no** `on delete cascade`, so a kept (bought) episode would block deleting its show. `cascadePlan` changes: `show.action = 'withdraw'` when the show has series buyers **or any kept row still has `series_id` = the show**; the words say so. | Found reading `supabase/schema.sql`. |
| 11 | Cascade capability: "manage_deletions (cascade confirm)" vs. "full admin for … cascade" | Confirming **an owner's request**: `manage_deletions`. **Removing without a request** ("Remove this show…"): full admins only, with a reason. Both need the show's name typed back. | Today's line (a manage_deletions sub-admin confirms requested deletions) kept; an unrequested wipe is new power. |
| 12 | Savers: "one shared cursor in series_drop_runs" — but the 118 table is keyed by `series_id` | A sentinel row `series_id = '__pass__'` holds the pass in progress: `customer_cursor` is JSON `{ "after": "<cus id>", "shows": ["…"], "until": "<iso>" }`, `last_episode_seen` the `until` of the last finished pass. A show's own row holds the newest release it has announced. | Fits 118's table without a migration. |
| 13 | "an email at most once per show per week" | Per **customer** per show per 7 days (`firstInWindow('series-drop-mail:<seriesId>:<customerId>', 604800)`); the button once per show per day (`firstInWindow('series-drop-tell:<seriesId>', 86400)`). | That is what keeps one person from being mailed twice. |
| 14 | Amendment 18 (Owner card and Creators tab full-admin only) vs. the screen "Who: … sub-admins act per capability" | Owner card and Creators tab: full admins only (hidden for sub-admins; the owner still shows in About this show). Everything else renders for any of the five capabilities and is disabled per capability with the lines in §5. | — |
| 15 | Admin show page "every control the creator has" (the Add bar, Sell…) | Admin mode **hides** the Add bar, drop zones, the upload queue, "+ Add season", the Sell card and the creator's "Remove this show" card; Move, ↑/↓, the E-badge, the editors and the channels switch stay (team). | The admin page is for decisions; drafts added there would belong to the admin. Hand entry stays in Library & queues. |
| 16 | Review queue item "Open: the signed master" — the code sends the raw `src` for submissions | Submissions now carry a signed master (`media.src` 2-hour signed HLS + `media.iframe`, as applications do); audio → `media.audio`; a self-hosted file keeps its address (`unsignedFallback`). | Every Cloudflare video demands a signed link; the raw manifest no longer plays. |

**"Bugs folded in" tagged slice 3, checked against the code (6f20a07)**

| Item | State |
|---|---|
| manual-episode makes a live show from a `manage_episodes` sub-admin | **Done in slice 1** (`createShow`; live only when the title is created approved — which needs `review_submissions` — *and* by a full admin or for the admin's own title). Nothing to do. |
| The review item's "New series · <user id>" card | Slice 1 turned it into "Ready to go public"; **3a retires it** (row 3) and adds the show to submission items. |
| Series deletion refused while episodes remain; extras / watch_history / notifications / title_prices left dangling | **Not done** (`resolve-deletion` still refuses) → `deleteShowCascade`. |
| Orphaned media has no Dismiss | **Not done** → `POST /api/admin/orphaned-media`. |
| Silent series decisions | `show_edit_*` from resolve-*: **done** (slice 1). `show_live`: **done** (`makeShowPublic`). `episode_moved_by_admin`: **done** (slice 2, `moveForViewer`). `show_deleted`, `show_deletion_denied`, `show_numbering_fixed`, `show_owner_changed`: registered but **never sent** → 3a sends them. `decision_note` on a take-down: **not stored** (`lib/moderation.js` skips series) → 3a. |
| resolve-* never invalidate `all_series_approved_v1`; Library badge omits the staged title image / counts withdrawn deletions | **Done** (slice 1) for shows; 3a adds **episodes'** title image / removal / trailer (120). |
| `pending_src` approved swaps the master | **Done** (slice 1, `resolve-artwork part: 'video'`); moves into `decideStaged` unchanged. |
| series-ownership notifies both and invalidates | **Not done** → `setShowOwner`. |
| notifySeriesDrop from the cron + Tell savers | **Not done** → `lib/seriesDrop.js`. |
| `reviewed_by` email vs id on series | `reviewed_by_user_id` is written by `createShow` (live) and the queue's reject; 3a writes it on take-down / restore / Make it public by an admin. |

---

## 3. Migration 120

File: `supabase/migrations/120_episode_staged_art.sql` (server builder). Exactly:

```sql
-- 120 — A live episode's new title image and trailer wait for approval
-- (the series revamp, slice 3a; written 2026-11-05).
--
-- Jose, 2026-11-04 (question 25): "the change should wait for approval".
-- On a live episode the title, the poster, the still and a new video file
-- already wait in pending_* columns while what is live keeps showing. A
-- show already keeps a waiting title image (pending_title_image_url), a
-- waiting removal of it (pending_title_image_removal) and a waiting trailer
-- (pending_trailer_src); an episode had nowhere to keep those three, so the
-- show page refused them on a live episode. These are the same three
-- columns on episodes:
--   pending_title_image_url      a new title image (PNG) waiting
--   pending_title_image_removal  "show the name as text again" waiting
--   pending_trailer_src          a new trailer (a Cloudflare address) waiting
-- An admin approves or denies each one (Admin → Shows → the show's
-- "Waiting for approval" card, or Library & queues); a denied file goes to
-- the orphaned-media list like every other dropped file.
--
-- Columns only, on a table migration 112 already locked to the site's own
-- server key: no row changes, nothing is copied. Safe to run more than
-- once. Before it has run, the site refuses those two changes on a live
-- episode with "needs a database update (migration 120)" and everything
-- else works as before.

begin;

alter table public.episodes add column if not exists pending_title_image_url text;
alter table public.episodes add column if not exists pending_title_image_removal boolean not null default false;
alter table public.episodes add column if not exists pending_trailer_src text;

comment on column public.episodes.pending_title_image_url is 'A new title image waiting for approval on a live episode; title_image_url stays live until then. Migration 120.';
comment on column public.episodes.pending_title_image_removal is 'True while removing the title image (the name shows as text again) waits for approval on a live episode. Migration 120.';
comment on column public.episodes.pending_trailer_src is 'A new trailer waiting for approval on a live episode; trailer_src keeps playing until then. Migration 120.';

-- Migration 112's rule. This creates no table; the line costs nothing.
alter table public.episodes enable row level security;

-- PostgREST picks the new columns up at once.
notify pgrst, 'reload schema';

commit;

-- What is there now (one row). On the first run every "waiting" count is 0.
select
  (select count(*) from information_schema.columns
     where table_schema = 'public' and table_name = 'episodes'
       and column_name in ('pending_title_image_url', 'pending_title_image_removal', 'pending_trailer_src')) as new_columns_expect_3,
  (select count(*) from public.episodes where pending_title_image_url is not null) as title_images_waiting,
  (select count(*) from public.episodes where pending_title_image_removal)        as title_image_removals_waiting,
  (select count(*) from public.episodes where pending_trailer_src is not null)     as trailers_waiting,
  (select relrowsecurity from pg_class where oid = 'public.episodes'::regclass)   as row_level_security_expect_true;
```

**Before 120 runs** (the code is a step ahead, as with 118):

- `lib/showPage.js` exports `EPISODE_120_COLUMNS = ['pending_title_image_url', 'pending_title_image_removal', 'pending_trailer_src']`
  and reads episodes in three tiers: `SELECT` (legacy + 118 + 120) → on a missing column `SELECT_118` (legacy + 118) →
  `SELECT_LEGACY`. `selectEpisodes` answers `{ rows, has118, has120 }`. (Today's two-tier fallback would drop the 118
  columns too when only 120 is missing — that must not happen.)
- A row read with `select('*')` has 120 when `Object.prototype.hasOwnProperty.call(row, 'pending_trailer_src')`
  (`episodeRowHas120(row)`).
- The episode editor's `policy` for `titleImage` and `trailer` on a live episode (non-team viewer) is
  `{ mode: 'locked', line: 'Changing a live episode’s title image or trailer needs a database update (migration 120).' }`
  (`LIVE_ART_120_MSG`). `PATCH /api/show/episode/[id]` sending either answers **503**
  `{ error: LIVE_ART_120_MSG, code: 'migration-120', field: 'titleImage' | 'trailer' }` before anything is uploaded.
  The team's change is direct and works as before. No 120 column is ever written unless the row has it
  (`updateCompat` lists them only as a safety net).
- `GET /api/show/episode/[id]` → `migration: { shows118, episodes120 }`; `GET /api/show/[id]` → `migration: { shows118, drafts116, episodes120 }`.
- `queue-counts`, `pending-artwork`, `sync-stream-protection`, `videoOwnership.usedByOthers`, `stagedChanges.listStaged`
  read without the columns (their own fallback each); nothing is counted; deciding one of the three on an episode
  answers 409 "Nothing is waiting on this one any more. Reload the list."
- Never a 500.

---

## 4. Server

### 4.1 Pure rules

**`lib/showRules.js` + `mobile/src/lib/showRules.js`** (word for word below the header; `scripts/test-show-rules.mjs`
diffs them):

- `export const PAYEE_RULE_LIVE = false;` and `canMoveTo(…, opts)` reads `opts.payeeRuleLive ?? PAYEE_RULE_LIVE`
  (§2 row 8). False → `earningsMove: false`, no "Future earnings…" line, plus `Its earnings stay with <name>.` when
  `uploaderOf(episode) !== runnerOf(targetShow)`. True → today's behaviour.
- `export function approvalBlocker(episode, { slotRows = [], state, show = null } = {})` → `null` or
  `{ status: 409, code, error, …extra }`, first match wins:
  1. `show` held → `{ code: 'show-held', error: 'Its show is pulled — restore the show first.' }`
  2. `show` removal requested → `{ code: 'show-removal', error: 'Its show’s removal is requested — decide that first.' }`
  3. a numbered episode (series/podcast with `series_id`) without a number → `{ code: 'unnumbered', error: 'Give it an episode number before approving it.' }`
  4. its slot taken (`slotCheck(slotRows, { season, number, excludeId })`) → `slotTakenBody(slot)` (code `taken`, `holder`, `nextFree`, `season`, `number`)
  5. `masterState(episode, state)`: `none` → `{ code: 'no-file', error: 'There’s no file to approve yet.' }`;
     `uploading` → `'Not yet: the video is still uploading.'`; `processing` → `'Not yet: Cloudflare is still processing the video.'`;
     `error` / `deleted` → `'Not yet: Cloudflare could not process the video — replace it first.'` (all `code: 'master-not-ready'`, `master`).
     `unknown` does not block (as `edit-episode` and amendment 3).
- `cascadePlan` (row 10 above): `show.action = 'withdraw'` when `seriesBuyers > 0` **or** any row with
  `action === 'withdraw'` has `seriesIdOf(row) === show.id`. Words when the show is kept for an episode's buyers:
  `… · 1 title has buyers, so it and the show are kept for them`. `adminWords` adds `the show is kept (a title in it has buyers)`.
- `showProblems` 'staged-episodes' also counts `pending_title_image_url` / `pendingTitleImageUrl`,
  `pending_trailer_src` / `pendingTrailerSrc`, and `pending_title_image_removal === true` / `pendingTitleImageRemoval === true`.
- Tests added to `scripts/test-show-rules.mjs` (both copies): `approvalBlocker` (each of the 5 codes, `unknown` passes,
  a standalone title skips 3–4), `cascadePlan` withdraw rule, `showProblems` with 120's fields, `canMoveTo` with
  `payeeRuleLive` false and true.

**`lib/showAdminRules.js`** (new, pure, client-safe, **imports nothing**; web only, no app mirror; tested by the new
`scripts/test-show-admin.mjs`):

```
SHOW_ADMIN_CAPS = ['manage_episodes', 'review_submissions', 'manage_artwork', 'manage_deletions', 'handle_flags']
CAP_LABELS = { manage_episodes: 'Create & edit episodes', review_submissions: 'Review creator submissions',
               manage_artwork: 'Approve pending artwork', manage_deletions: 'Resolve deletion requests',
               handle_flags: 'Flag content & handle reports' }        // copied from lib/capabilities.js; the test reads that file as text and checks each label
FULL_ADMIN_LINE = 'A full admin does this.'
capLine(cap) → `Needs “${CAP_LABELS[cap]}”.`
makePublicLine(ownerName) → `${ownerName || 'Its owner'} or a full admin makes it public.`
ADMIN_SHOW_FILTERS = [ ['all','All'], ['live','Live'], ['ready','Ready to go public'], ['first','Waiting on a first episode'],
  ['review','In review'], ['staged','Changes waiting'], ['pulled','Pulled'], ['removal','Removal requested'],
  ['podcasts','Podcasts'], ['problems','Problems'], ['week','Went public this week'] ]
adminShowFilterKeys(show, rows, { now }) → string[]       // which filters a show matches ('all' always)
adminShowBadges(show, rows) → [{ key, words, tone }]       // see §4.4 GET /api/admin/shows
batchSummary(problems, total) → string                     // see approveShowEpisodes
historyEntry(auditRow, names) → { id, at, action, actor: 'owner'|'admin'|null, who, words, targetType, targetId }
TIER_CHOICES = [['keep','Keep each episode’s choice'], ['free','Free with ads'], ['premium','Tapa + members']]
```

`ready` = private (status pending), not held, no removal, at least one approved in-running-order episode.
`first` = private with no approved episode. `review` = at least one episode `pending`. `staged` = any `pending_*`
on the show or its episodes (incl. 120). `problems` = `numberingProblems` finds a duplicate, parked or unnumbered
row, or the show is `empty` (no episodes) for more than 7 days. `week` = `public_at` within 7 days.

### 4.2 `lib/showPage.js` (changed)

- Export for the new libs (internal until now): `selectEpisodes`, `readShowRow`, `showSlotRows`, `readShowDrafts`,
  `draftAsRow`, `videoStateFor` (the 60-second memo per uid), `showBuyers`, `holdReasonFor`, `orphanFile`,
  `orphanArtwork`, `showAudit`, `auditWords`, `realName`, `codesWords`, `pinsFor`, `episodeRowHas118`. No behaviour change.
- 120 reads: `SELECT_118`, `SELECT` (with 120), `EPISODE_120_COLUMNS`, `episodeRowHas120`, `LIVE_ART_120_MSG`.
- `episodeView` (show page rows) `staged` adds `titleImage: Boolean(r.pending_title_image_url) || r.pending_title_image_removal === true`
  and `trailer: Boolean(r.pending_trailer_src)`. `getShowPage` passes 120 flags to `showProblems`; `migration.episodes120`.
  `listShowSummaries`' `staged.episodes` count includes the three.
- `episodePolicy(field, ctx)`: for `titleImage` / `trailer`, mode `staged` stays `staged` when the row has 120, else
  `{ mode: 'locked', line: LIVE_ART_120_MSG }`. `NO_STAGING_COLUMN` / `NO_STAGING_LINE` go.
- `getEpisodeEditor`: `episode.staged` adds `titleImageUrl` (url or null), `titleImageRemoval` (boolean),
  `trailer: { src (signed, 60 min, signTrailerSrc), expiresAt } | null` — the same keys a show's `staged` uses.
  `migration: { shows118, episodes120 }`.
- `updateEpisode` (mode `staged`, i.e. a creator on a live episode, row has 120):
  - title image upload → `pending_title_image_url = url`, `pending_title_image_removal = false`; a waiting image is
    orphaned with the notice "The new title image replaces the one that was waiting."; a waiting removal is replaced
    with "The new title image replaces the removal that was waiting." → `staged: ['titleImage']`.
  - `removeTitleImage: true` (needs a live title image, else 409 "There’s no title image to remove." `nothing`) →
    `pending_title_image_removal = true`, a waiting image orphaned and cleared ("Removing the title image replaces the
    new one that was waiting.") → `staged: ['titleImageRemoval']`.
  - `trailerUid` → ownership checked as now; same as the live one → 409 "That’s the trailer it has already."
    (`same-file`); same as the waiting one → 409 "That trailer is already waiting for approval." (`same-file`);
    a waiting trailer is orphaned ("The new trailer replaces the one that was waiting."); `pending_trailer_src = src`;
    `protectTrailers([src])` at once → `staged: ['trailer']`.
  - Row without 120 → the 503 in §3, checked before any upload.
- `cancelEpisodeStaged`: `EPISODE_STAGED` gains `titleImage` (`pending_title_image_url`, image; also clears
  `pending_title_image_removal`; a waiting removal alone counts as "something waiting") and `trailer`
  (`pending_trailer_src`, video). The refusal reads "Which change? title, description, poster, thumbnail, titleImage,
  trailer or video.". The route file `pages/api/show/episode/[id]/staged.js` needs no change.
- `canMoveTo` callers (`getEpisodeEditor` moveTargets, `moveForViewer`) pass nothing new (the constant decides).

### 4.3 New server libs

All throw `ShowError(line, status, extra)` (from `lib/showPage.js`) for anything the person caused and
`internalError(err, '<context>')` for database or Stripe failures. `rc` = `getRoleContext(req)` (`userId`, `email`,
`isAdmin`, permissions). `need(rc, cap)` throws `ShowError(capLine(cap), 403, { code: 'cap', cap })`;
`needFullAdmin(rc)` throws `ShowError(FULL_ADMIN_LINE, 403, { code: 'full-admin' })`. Every write writes one
`audit_log` row through `showAudit` with `details` = `auditWords('admin', words, extra)`.

#### `lib/stagedChanges.js`

```
STAGED_FIELDS = {
  series:  { name:'text', description:'text', poster:'art', thumbnail:'art', heroImage:'art', titleImage:'art', titleImageRemoval:'art', trailer:'art' },
  episode: { title:'text', description:'text', poster:'art', thumbnail:'art', titleImage:'art', titleImageRemoval:'art', trailer:'art', video:'video' } }
GROUP_CAP = { text: 'manage_episodes', art: 'manage_artwork', video: 'review_submissions' }
LABELS = { name:'Name', title:'Title', description:'Description', poster:'Poster', thumbnail:'Still', heroImage:'Hero image',
           titleImage:'Title image', titleImageRemoval:'Title image removal', trailer:'Trailer', video:'New video' }
```

- `listStaged(show, episodes, { has120 }, rc)` → items, show first, then episodes in `sortEpisodes` order:
  `{ key: '<target>:<id>:<field>', target, id, code ('S1 E3' | null), titleName ('Night Bus' | '“Pilot”'), field, group,
  label, kind: 'text' | 'image' | 'removal' | 'video', current, proposed, can (bool), needs (capLine or null),
  ready (video/trailer: bool), state ('ready'|'processing'|…), line (why Approve is off, or null) }`.
  Text: strings. Image: urls. Removal: `current` = live url, `proposed` = null. Trailer: `{ src (signed), expiresAt }` for
  both. New video: `{ src (signed 2 h), iframe }` for both (the way `signedMediaFor` does for applications); `ready`
  from `videoStateFor` + `masterReady`, `line` = the not-ready line (§ below).
- `decideStaged({ target, id, fields, decision, note }, rc)` → `{ ok, target, id, decided: [fields], notices }`.
  `target` 'series' | 'episode'; `id` `isTitleId` else 400 "Which title?"; `fields` a non-empty own-property subset of
  `STAGED_FIELDS[target]` else 400 "Which change?"; `decision` 'approve' | 'deny' else 400 'decision must be "approve"
  or "deny".'; `note` trimmed to 500. Every field's group capability is checked first (403 `capLine`). Fields not
  waiting any more → 409 "Nothing is waiting on this one any more. Reload the list.". The write is guarded on the
  decided fields' pending columns as read (`whereUnchanged`); nothing matched → 409 "That changed a moment ago.
  Reload the list and look again.".
  - **approve**: art → live column = pending (`poster`, `thumbnail`, `hero_image`, `title_image_url`, `trailer_src`;
    removal → `title_image_url = null`); text → `title`/`name` and `description`; video (episode) → refused unless
    ready (409 with `notReadyLine` words: "Not yet: the new video hasn’t finished uploading." / "Not yet: Cloudflare is
    still processing the new video." / "The new video failed to process on Cloudflare. Deny it, and the creator can
    upload it again." / "The new video is gone from Cloudflare. Deny it, and the creator can upload it again." /
    "Cloudflare didn’t say whether the new video is ready. Try again in a minute."), then today's video path
    (runtime from the file, ready ad plan → draft with its notice, `captions_stale_at` with its notice). The replaced
    live files are orphaned; a new trailer or video gets `syncStreamProtection`; a changed episode title runs
    `syncNumberTitles`.
  - **deny**: pending cleared; waiting files orphaned (image → `storage_image`, trailer/video → `cloudflare_video`).
  - Caches: `public_episodes_v1` always; `all_series_approved_v1` too for a show.
  - Audit (names kept from the routes): `approve_<target>_artwork` / `deny_<target>_artwork` (art fields),
    `approve_<target>_edit` / `deny_<target>_edit` (text), `show_video_approved` / `show_video_denied` (video); one
    row per group decided, `details` words list the fields and the note.
  - Notifications: the words and types `resolve-artwork` and `resolve-edit` send today, moved here
    (`artwork_approved` / `artwork_denied`, `edit_approved` / `edit_denied` to an episode's uploader; `show_edit_approved` /
    `show_edit_denied` to the show's owner when someone else, or for the show's own changes; `show_video_approved` /
    `show_video_denied`), with "title image", "title image removal" and "trailer" in the episode parts list; the
    note as " Note from the team: …". One notice per title per decision.
- `resolve-artwork` (`part: 'art'`) calls `decideStaged` with every art field waiting on the row (120's included when
  the row has them), `part: 'video'` with `['video']`; `resolve-edit` with every text field waiting. Their request and
  answer shapes (`{ ok, type, id, decision, part, … }`, the video answer's `runtime`, `adPlan`, `captionsMayBeOutOfSync`,
  `captionsFlagSaved`, `notices`) are unchanged; capability gates unchanged.

#### `lib/showAdmin.js`

- `listAdminShows(rc, { q, filter })` → the `GET /api/admin/shows` answer (§4.4). Reads every show (`select('*')`,
  newest first, at most 500), their episodes (one read, the columns the rules need, 120's when present), owners'
  names (`getPublicIdentities`) and emails (`listCreatorsAndAdmins` roster; an owner off the roster shows no email).
  `q` (≤ 80 chars) matches the name or the owner's email/name, case-insensitive.
- `getAdminShow(showId, rc)` → the `GET /api/admin/show/[id]` answer (§4.4).
- `approveShowEpisodes(showId, { episodeIds, tierOverride = 'keep' }, rc)` (`review_submissions`):
  `episodeIds` = `'all'` (every `pending` episode of the show in play order) or 1–100 ids (else 400 "Up to 100 at a
  time." `too-many`); `tierOverride` 'keep' | 'free' | 'premium' (else 400 "Who can watch is “free” or “premium”.").
  Checks, before writing anything: the show (404 "That show isn’t there."); every id is a `pending` episode of this
  show (else the whole request 409 `{ code: 'batch-blocked', error, problems }` with "That episode isn’t in review any
  more — reload the show."); `approvalBlocker` for each (Cloudflare states asked through `videoStateFor`, 10 at a time).
  Any problem → **409** `{ error: 'Nothing was approved — ' + batchSummary(problems, n) + '.', code: 'batch-blocked',
  problems: [{ episodeId, code: 'S1 E4', words }] }`. `batchSummary`: all master problems → "3 of 12 are still
  processing" (or "… still uploading" / "… failed"); otherwise the first problem's words + " — and 2 more" when more.
  Write: one `update episodes set status='approved', reviewed_by=rc.userId, reviewed_at=now, released_at=now
  [, tier] where id in (…) and status='pending' returning id` (released_at retried away on a database without it, as
  `decideReviewItem` does). Then `syncStreamProtection({ src, tier })` per approved row and `protectTrailers` (rows' and
  the show's), 5 at a time; `invalidateCache('public_episodes_v1')` (+ `all_series_approved_v1` when the show is public).
  Notices: one per uploader, type **`show_episodes_approved`**, href `/creator/show/<id>`:
  public show → "“Night Bus”: 12 episodes are live (S1 E1–E12)." / one → "“Pilot” (S1 E1) in “Night Bus” was approved and is live.";
  private show → owner: "“Night Bus”: 12 episodes approved (S1 E1–E12). It stays private until you make it public.",
  another uploader: "… It stays private until its owner makes it public.". One audit row
  `approve_show_episodes`, words "Night Bus: 12 approved (S1 E1–E12) · Who can watch: kept". Answer
  `{ ok, approved: [ids], skipped: [ids decided meanwhile], remaining (pending left), words: '12 approved', showPublic }`.
- `rejectShowEpisodes(showId, { episodeIds, reason }, rc)` (`review_submissions`): same id rules; `reason` optional,
  trimmed to 1,000; one update (`status='rejected'`, `rejection_reason`, `reviewed_by`, `reviewed_at`, guarded on
  `pending`); one notice per uploader, type **`show_episodes_rejected`**: "“Night Bus”: 3 episodes came back “Not this
  time” (S1 E2–E4): <reason>" / one: "“Pilot” (S1 E1) came back “Not this time”: <reason>"; audit `reject_show_episodes`.
  Answer `{ ok, rejected, skipped }`.
- `fixNumbering(showId, { season }, rc)` (`manage_episodes`): `seasonsAction(… { action: 'renumber', number: season })`
  as the team (`renumberFromOne` over the season's episodes and drafts, declined rows keep theirs); before 118 → 503
  `REORDER_118_MSG` (`migration-118`). Nothing changed → `{ ok, unchanged: true, words: 'Season 1 already runs E1–E4' }`,
  no notice. Else notice **`show_numbering_fixed`** to the owner: "We fixed the numbering in Season 1 of “Night Bus”:
  E5 becomes E4." (the plan's words), href `/creator/show/<id>`; audit `show_numbering_fixed`. Answer `{ ok, season, words, rows, drafts }`.
- `setShowOwner(showId, { email }, rc)` (full admin): `email` blank/null clears; else `findUserByEmail` (verified,
  unique) → 404 "No account has that email verified — they need to sign up first." ; same owner → 409 "They already
  run it." (`same`). `update series set creator_id` ; caches both; audit **`show_owner_changed`** ("Owner: a@x → b@y"
  or "Owner cleared"); notices type `show_owner_changed`: new owner "You run “Night Bus” now — its page is in Creator
  Studio." (href `/creator/show/<id>`); the previous owner "An admin handed “Night Bus” to another account. The episodes
  you uploaded are still yours." (href `/creator`). Answer `{ ok, owner: { id, name, email } | null, hasCreatorRole }`.
  `pages/api/admin/series-ownership.js` POST calls it (keeps `{ ok: true }`, adds `isTitleId` → 400 "seriesId is required.").
- `grantOwnerCreator(showId, rc)` (full admin): the owner's role is none/viewer → `setUserRole(owner, 'creator')`;
  already creator/team → 409 "They already have Creator Studio."; no owner → 409 "Pick who runs it first.". Audit
  `creator_role_granted` (target `user`).
- `createShowForCreator({ ownerEmail, name, kind, description, defaults, grantCreator }, rc)` (`manage_episodes`):
  owner by `findUserByEmail` (404 line as above); owner without the creator role and not on the team → unless
  `grantCreator` → 409 `{ code: 'no-creator-role', error: '<email> doesn’t have Creator Studio yet.', email }`;
  `grantCreator` by a non-full-admin → 403 "A full admin gives someone Creator Studio."; then `createShow({ name, kind,
  description, defaults, creatorId: owner.id, submittedBy: rc.email, submittedByUserId: rc.userId })` (private; its own
  lines for name/kind/defaults); notice **`show_set_up`** to the owner: "We set up “Night Bus” for you in Creator
  Studio. Add its episodes when you’re ready." (href `/creator/show/<id>`); audit `show_created` ("for <email>").
  Answer `{ ok, id, href: '/admin/shows/<id>', roleGranted }`.
- `holdShow(showId, { reason, note, emailOwner }, rc)` (`handle_flags`) → `flagContent({ targetType: 'series', … })`
  (its own refusal "Pick a reason."), audit `flag_content`.
- `takeDownShow(showId, { note }, rc)` (`handle_flags`) → `decide({ action: 'take_down', note })` (refusal "Say why,
  so the owner knows."), audit `content_take_down`.
- `restoreShow(showId, rc)` (`handle_flags`) → `decide({ action: 'restore' })`, audit `content_restore`.
- `denyShowRemoval(showId, { note }, rc)` (`manage_deletions`): no request → 409 "No removal is requested."
  (`not-requested`); clears `deletion_requested/_reason/_requested_at`; caches both; notice **`show_deletion_denied`**:
  "We kept “Night Bus” up instead of removing it.<note as ' Note from the team: …'>" (href show page); audit
  `deny_series_deletion`.
- `removeShow(showId, { confirmName, reason }, rc)`: requested → `manage_deletions`; not requested → full admin and
  `reason` required (400 "Say why, so the owner knows."; it is stored as the deletion reason "Removed by an admin:
  <reason>" before the cascade). Then `deleteShowCascade`.
- `showHistory(show, episodeIds, names)` → up to 60 `historyEntry` rows: `audit_log` where (`target_type = 'series'`
  and `target_id = show`) or (`target_type = 'episode'` and `target_id in (ids)`), newest first.

#### `lib/showDelete.js` — `deleteShowCascade(showId, { actor, confirmName, reason, byAdmin })`

1. Read the show (404), its episodes (`series_id`), its extras (bonus rows with `series_id` = show, or `bonus_parent_type
   'series'` = show, or `'episode'` in its episode ids), buyers (`showBuyers`), channel slots
   (`channel_slots` where `series_id` = show or `episode_id`/`pin_episode_id` in ids: the count), outside references
   (`crew_calls` `project_type='series'`/`project_id`, `productions` and `location_credits` `release_type`/`release_id`
   pointing at the show or a title: the count, each read failing soft to 0), the show's drafts (`creator_drafts` where
   `form->>seriesId` = show, any user).
2. `confirmName` must equal the show's name, trimmed, case-insensitive, else **409** `{ code: 'confirm-name', error:
   'Type the show’s name exactly to remove it.' }`.
3. `plan = cascadePlan(show, episodes, extras, buyers, { channelSlots, outsideReferences })`.
4. Kept rows (`action: 'withdraw'`): `withdrawn_at = now`, `deletion_requested = true`, `deletion_reason` = the
   request's (or "Removed with its show"), `deletion_requested_at` kept or now; `title_prices` for them → status `off`,
   `pending_cents/sale_*` null.
5. Deleted rows, extras first then episodes: every file orphaned (`src`, `pending_src`, `trailer_src`,
   `pending_trailer_src`, `poster`, `thumbnail`, `pending_poster`, `pending_thumbnail`, `title_image_url`,
   `pending_title_image_url`, `hero_image`); a private caption track removed (`removePrivate`, best effort); then
   `watch_history`, `notifications` (`episode_id in ids`), `title_prices` (`target_type 'episode'`), open
   `content_reports` → `upheld` + `resolved_at`, open `content_flags` → `resolved_at`, `resolution 'removed'`; then the
   `episodes` rows (`channel_slots`, schedule rows and ad plans go by their foreign keys).
6. The show: `plan.show.action === 'withdraw'` → `withdrawn_at = now` (it stays `deletion_requested`, hidden) and its
   price `off`; else its files orphaned (poster, thumbnail, hero, title image, trailer and every `pending_*`), its
   `title_prices` row, `series_drop_runs` row and pending `payee_invites` deleted, its reports/flags closed, the row
   deleted.
7. Drafts: each one's `video_uid` / `trailer_uid` recorded as orphaned (never deleted here), the rows deleted.
8. Caches both. Audit **`confirm_series_deletion`** words "Night Bus: 6 episodes and 2 extras deleted, 1 kept for its
   buyers, 1 channel slot dropped" (+ `extra: { counts }`). Notices: the owner **`show_deleted`** (href `/creator`):
   requested → "“Night Bus” was removed, as you asked.<' 1 episode someone bought is kept for them.'>"; by an admin →
   "An admin removed “Night Bus”: <reason>"; every other uploader of a deleted or kept episode one `deletion_confirmed`
   "“<title>” was removed with its show."
9. Answer `{ ok, plan: { words, adminWords, counts }, deleted: { episodes, extras, show: bool }, withdrawn: { episodes,
   extras, show: bool }, media: n }`.

The steps are written so a failure part-way leaves the show requested-for-removal and the same call can be run again
(each step re-reads what is still there). `lib/testContent.js` is not changed.

#### `lib/seriesDrop.js`

```
SAVER_CUSTOMERS_PER_RUN = Number(process.env.SERIES_DROP_MAX_CUSTOMERS) || 1000   (the env only for the stand-in suite)
PASS_ROW = '__pass__'
```
- New episodes of a show = approved, in its running order (series/podcast), not held, not withdrawn, no removal,
  `released_at` after the show's announced mark and at most now, `available_from` empty or past; the show public
  (approved, not held, no removal, not withdrawn). The announced mark = its `series_drop_runs.last_episode_seen`, else
  `now − 36 h`.
- `runSaverStep({ now })` (the cron): a pass in progress (the `__pass__` row's `customer_cursor` JSON) continues with
  its `shows` and `until`; else a new pass = every show with new episodes, `until = now` (none → `{ ok, shows: [] }`).
  Pages `getStripe().customers.list({ limit: 100, starting_after })` until `SAVER_CUSTOMERS_PER_RUN` customers are
  checked. A customer matches when `metadata.wishlist` (comma-separated ids) holds a show of the pass, has an email and
  `metadata.newsletter !== 'opted_out'`; per matched show `firstInWindow('series-drop-mail:<seriesId>:<customerId>', 604800)`;
  one email per customer through `sendEmail` (lib/notify.js): subject "A new episode of Night Bus" / "3 new episodes of
  Night Bus" / "New episodes of 2 shows you saved"; body one escaped line per show "<strong>Night Bus</strong> — 3 new
  episodes" with `https://www.studiotapatv.site/series/<id>` (`/podcasts/<id>` for a podcast) and the foot "You saved
  these on Studio Tapa TV. Take a show off My List to stop these: https://www.studiotapatv.site/wishlist". Not finished →
  the cursor is stored; finished → each show's row `last_episode_seen = until`, the pass row's cursor null.
  Answer `{ ok, shows: [ids], checked, matched, sent, finished }`. A database without `series_drop_runs`
  (`isMissingSeriesDropTable`) → one capped pass, no cursor, mark = `now − 36 h`.
- `tellSaversNow(showId, rc)` (full admin): the show public else 409 "Only a public show has savers to tell."
  (`not-public`); `firstInWindow('series-drop-tell:<id>', 86400)` else 429 `{ code: 'told-today', error: 'Its savers
  were told less than a day ago.' }`; no new episodes since the show's mark → 409 `{ code: 'nothing-new', error: 'Nothing
  new since its savers were last told.' }`; then a one-show pass (its own cursor in its row's `customer_cursor`,
  same JSON) → answer as above + `lastToldAt`. Audit `tell_savers`.
- `pages/api/notify-series-drop.js` (secret route) calls `tellSaversNow` with a system actor and keeps its answer
  `{ ok, seriesId, checked, notified }` (`notified` = matched).

### 4.4 Routes

All new routes: `applyCors`, OPTIONS 204, `Cache-Control: private, no-store`, 405 for other methods,
`requireCapability(req, res, SHOW_ADMIN_CAPS)` first (403 `{ error: 'You do not have permission to do this.' }`), then the
action's own capability inside the lib, per-account limit + per-IP twice that (`showLimit` from `lib/showRoute.js`;
over → 429 "That’s a lot in a row — give it a little while."), errors through `showRouteError` (a `ShowError` keeps its
line and extra fields).

**`GET /api/admin/shows?filter=&q=`** (300/h) →
```
{ shows: [{ id, name, kind, kindLabel ('Series'|'Podcast'|'Vertical'), status, state, statusLabel, level, isPublic,
            publicAt, createdAt, poster, thumbnail, owner: { id, name, email } | null,
            counts: { episodes, live, inReview, declined, extras, seasons }, countLine ('S2 · 9 episodes'),
            badges: [{ key, words, tone }], href: '/admin/shows/<id>' }],
  counts: { all, live, ready, first, review, staged, pulled, removal, podcasts, problems, week },
  filter, q, migration: { shows118 } }
```
Badges (`adminShowBadges`, in this order): `review` "2 in review" (review) · `ready` "Ready to go public" (ok) ·
`staged` "Changes waiting" (review) · `video` "New file waiting" (review) · `removal` "Removal requested" (neutral) ·
`pulled` "Pulled" (danger) · `duplicate` "E4 twice" (warn) · `numbers` "Numbers to fix" (warn: gap/parked/unnumbered)
· `noart` "No art" (warn: no poster and no still) · `empty` "Empty" (neutral). A bad `filter` reads as `all`.

**`POST /api/admin/shows`** (30/h) `{ action: 'create', ownerEmail, name, kind, description, defaults: { tier, rating,
mainGenre }, grantCreator }` → `createShowForCreator`. Other `action` → 400 'action must be "create".'.

**`GET /api/admin/show/[id]`** (600/h) → 404 "That show isn’t there." for a non-title id or a missing show; else
```
{ show: { id, name, kind, status, state, statusLabel, headline, isPublic, publicAt, createdAt, held, holdReason,
          takenDown (status rejected + held + decision note), decisionNote, deletion: { requested, reason, at } },
  owner: { id, name, email, accountAgeDays, hasCreatorRole, otherShows, otherTitles, accountHref } | null,   // full admins only; null otherwise
  ownerName,                                                                         // everyone (for the lines)
  facts: { seriesBuyers, episodeBuyers, channelSlots: [{ channel, slots }], openReports,
           files: { ready, processing, uploading, failed, unknown }, trailer: state | null },   // files = the episodes in review
  review: { count, rows: { [episodeId]: { code, tier, blocked: { code, line, nextFree } | null, master, editedAt } },
            batch: { ok, count, line } },                                            // line = 'Not yet: …' when !ok
  staged: [ item… ],                                                                  // lib/stagedChanges.js listStaged
  removal: { requested, reason, at, plan: { words, adminWords, counts }, needsReason: !requested },
  history: [ entry… ],
  makePublic: { ok, code, reason } | null,                                            // canMakePublic as a full admin would
  can: { approve, edit, art, deletions, flags, fullAdmin, makePublic, owner, tellSavers, removeUnrequested },
  needs: { approve, edit, art, deletions, flags, fullAdmin, makePublic },             // the disabled lines (capLine…)
  savers: { lastToldAt },
  flagReasons: FLAG_REASONS,
  migration: { shows118, episodes120 } }
```
`editedAt` = the newest owner-actor `audit_log` row (`edit_episode`, `replace_video`, `stage_video`) on that episode
after its `created_at`, else null. `accountAgeDays` from `lib/accountAge.js`.

**`POST /api/admin/show/[id]`** (300/h; `tell_savers` also 10/h) `{ action, … }`:

| action | body | capability | lib | answer |
|---|---|---|---|---|
| `approve` | `episodeIds: [ids] \| 'all'`, `tierOverride` | review_submissions | approveShowEpisodes | `{ ok, approved, skipped, remaining, words, showPublic }` / 409 `batch-blocked` |
| `reject` | `episodeIds`, `reason` | review_submissions | rejectShowEpisodes | `{ ok, rejected, skipped }` |
| `fix_numbering` | `season` | manage_episodes | fixNumbering | `{ ok, season, words, rows, drafts }` / `{ ok, unchanged }` / 503 |
| `staged` | `items: [{ target, id, field }]` (1–50), `decision`, `note` | per field | decideStaged, grouped per title | `{ ok, results: [{ key, ok, error?, notices? }] }` (each item stands alone) |
| `hold` | `reason`, `note`, `emailOwner` | handle_flags | holdShow | `{ ok }` |
| `take_down` | `note` | handle_flags | takeDownShow | `{ ok }` |
| `restore` | — | handle_flags | restoreShow | `{ ok, status }` |
| `owner` | `email` (or null) | full admin | setShowOwner | `{ ok, owner, hasCreatorRole }` |
| `grant_creator` | — | full admin | grantOwnerCreator | `{ ok }` |
| `remove` | `confirmName`, `reason` | manage_deletions (requested) / full admin | removeShow → deleteShowCascade | cascade answer |
| `deny_removal` | `note` | manage_deletions | denyShowRemoval | `{ ok }` |
| `tell_savers` | — | full admin | tellSaversNow | `{ ok, checked, matched, sent, finished, lastToldAt }` |

An unknown action → 400 "Which action?". Make it public stays `POST /api/show/[id]/public` (the owner or a full admin,
unchanged); moving, renumbering and editing stay the `/api/show/**` routes (the team = full admin or manage_episodes).

**Changed routes**

- `GET /api/admin/review-queue` — `listReviewQueue(rc, { light })`: `light` (queue-counts) skips everything below but
  the counts. Submission items (§4.5). No `'series'` items; `counts.series = 0`. `POST` spreads a thrown error's `extra`
  into the 4xx answer (`{ error, code, holder, nextFree, … }`), like `showRouteError`.
- `POST /api/admin/resolve-artwork`, `resolve-edit` — thin callers of `decideStaged` (§4.3).
- `POST /api/admin/resolve-deletion` — `isTitleId` on `id`; a show: `confirm` → `removeShow` with `confirmName` (without
  it → 409 `{ code: 'confirm-name', error: 'Type the show’s name to remove it — or open it in Admin → Shows to see what goes with it.', href: '/admin/shows/<id>#removal' }`);
  `deny` → `denyShowRemoval`. Episodes unchanged.
- `GET /api/admin/pending-artwork` — episodes add `currentTitleImageUrl`, `pendingTitleImageUrl`, `pendingTitleImageRemoval`,
  `currentTrailerSrc`, `pendingTrailerSrc` (read without them before 120).
- `GET /api/admin/pending-deletions` — series rows add `href: '/admin/shows/<id>#removal'`.
- `GET /api/admin/queue-counts` — episodes' 120 fields counted in `library.artwork` and `shows` (three-tier read:
  with 120 + `pending_src`, with `pending_src`, without); `listReviewQueue(rc, { light: true })`.
- `GET/POST /api/admin/orphaned-media` — `POST { orphanId }` (manage_deletions, 120/h) = **Dismiss**: deletes the
  `orphaned_media` row only → `{ ok }`; 404 "Not found — it may have already been cleaned up."; audit `dismiss_orphan`.
- `POST /api/admin/cleanup-orphan` — its 500 becomes `sendError(res, err, 'admin/cleanup-orphan', 'Could not delete this.')`.
- `GET /api/admin/audit-log?owners=1` — default leaves out rows whose `details` is JSON with `actor: 'owner'`,
  except `show_live`; `?owners=1` keeps them. Reads 400, answers ≤ 200. Entries add `words` (the JSON's words, else the text) and `actor`.
- `GET /api/admin/library?id=<titleId>` — exactly that row (for the Library's `?edit=`).
- `POST /api/admin/sync-stream-protection` — covers `episodes.pending_trailer_src` (read without it before 120).
- `pages/api/cron/expire-content.js` — after flagging, `runSaverStep()` (caught); its answer and audit line carry
  `savers: { shows, checked, sent, finished }`.
- `lib/videoOwnership.js` `usedByOthers` — its own lookup for `episodes.pending_trailer_src` (skipped when missing).
- `lib/moderation.js` — series take-down: `{ status: 'rejected', moderation_hold: true, decision_note: reason,
  reviewed_by_user_id }` through `updateCompat` (118 columns dropped before 118). Series restore: when the row was
  `rejected` with a `decision_note` before the restore, `status = public_at ? 'approved' : 'pending'`, `decision_note = null`;
  the owner's words: back to approved → "“Night Bus” was reviewed and is back up."; back to private → "“Night Bus” was
  reviewed: it’s private again until you make it public.". Other targets unchanged.
- `lib/adminNav.js` — Content group: `{ href: '/admin/shows', label: 'Shows', badge: 'shows', caps: SHOW_ADMIN_CAPS }`
  after "Library & queues"; "Series ownership" removed; `ADMIN_REDIRECTS['/admin/ownership'] = '/admin/shows'`.

### 4.5 The review queue (`lib/reviewQueue.js`)

- `export const QUEUE_KINDS = ['submission', 'ad', 'channel', 'location', 'price', 'application']`;
  `DECIDABLE_KINDS = [...QUEUE_KINDS, 'series']`.
- Submission items (not `light`):
  - `title`: `episodeDisplayTitle`; `subtitle`: a show episode "Night Bus · S1 E4 · 22 min · Mara Reyes"; standalone
    "Short · Drama · 12 min · Mara Reyes" (names from `getPublicIdentities`, never an id).
  - `media`: a ready Cloudflare master → `{ src (signed, 2 h), iframe, poster }`; audio → `{ audio: audio_url, poster }`;
    self-hosted → `{ src, poster }`; otherwise `{ src: null, poster }`. At most 100 items are signed per read (tokens
    are cached); the rest get `src: null` and `meta.openOnShowPage: true`.
  - `meta.show` (show episodes): `{ id, name, kind, stage: 'new' | 'private' | 'live' | 'pulled' | 'removal', poster,
    description, ownerId, ownerName, ownerAccountAgeDays, defaultsLine ('Tapa + · TV-14 · Drama' or null),
    waitingCount (its other episodes in review), href: '/admin/shows/<id>', makesPublic: 'Mara makes the show public
    once one is approved.' | null }` (`new` = private with no approved episode; `private` = private with one).
  - `meta.position` 'S1 E4' | null; `meta.slot` `{ free, words }` — free "S1 E4 · the number is free", else the
    blocker's words; `meta.master` (state), `meta.masterReady`; `meta.blocked` = `approvalBlocker(...).error` | null.
    Cloudflare states through `videoStateFor` (60-second memo), at most 40 asked per read (the rest `unknown`, which
    doesn't block). Account ages for at most 20 owners per read.
  - Order: by `createdAt` as today, except a show's submissions sit together at its oldest item's place, in play order
    (so the page can group consecutive items).
- `decideReviewItem` for a `submission`:
  - a numbered show episode → `approveShowEpisodes(showId, { episodeIds: [id], tierOverride: tierOverride || 'keep' })` /
    `rejectShowEpisodes(showId, { episodeIds: [id], reason })` — one path for a show's episodes;
  - a standalone title → today's path plus `approvalBlocker` (master only) before writing;
  - refusals carry `extra` (`code`, `holder`, `nextFree`, `master`) to the route.
- `kind: 'series'` → §2 row 3.

### 4.6 Notification types (register in `lib/notificationTypes.js` and `mobile/src/lib/notificationTypes.js`)

New: `show_episodes_approved: kind('Episodes approved', 'clapperboard', 'show')`,
`show_episodes_rejected: kind('Not this time', 'clapperboard', 'show')`,
`show_set_up: kind('A show set up for you', 'clapperboard', 'show')`.
Now sent (already registered): `show_deleted`, `show_deletion_denied`, `show_numbering_fixed`, `show_owner_changed`.
`show_new_episodes` and `show_pulled` stay registered and unsent (savers are emailed; a hold tells the owner through
`moderation`, as today).

### 4.7 Audit actions written in 3a

`approve_show_episodes`, `reject_show_episodes`, `show_numbering_fixed`, `show_owner_changed`, `creator_role_granted`,
`show_created`, `flag_content`, `content_take_down`, `content_restore`, `deny_series_deletion`,
`confirm_series_deletion`, `tell_savers`, `dismiss_orphan`, and `decideStaged`'s `approve_/deny_<target>_artwork`,
`approve_/deny_<target>_edit`, `show_video_approved/denied`. Admin rows use `auditWords('admin', …)` so History and the
audit log read their `words`.

---

## 5. Website

### 5.1 Files and components

| File | What |
|---|---|
| `pages/admin/shows/index.js` | `adminPageProps(ctx, { caps: SHOW_ADMIN_CAPS })`; `AdminShell title="Shows" crumbs={['Content']} wide`, intro "Every series and podcast: what’s in review, what waits for approval, and who runs each one."; renders `ShowsList` (`?tab=creators` → `CreatorRoster`, full admins only; a sub-admin's `?tab=creators` shows the list). |
| `pages/admin/shows/[id].js`, `[id]/episode/[episodeId].js`, `[id]/edit.js` | The creator pages' structure (`isTitleId` → 404; `?ep=`/`?draft=`/`?edit=` shallow routing; the phone screens for the editors) inside `AdminShell title="Shows" crumbs={['Content']} wide`, rendering `ShowControlRoom mode="admin"`, `EpisodeEditor mode="admin"`, `ShowEditor mode="admin"`. `?created=1` flashes "Night Bus is set up. Mara can add its episodes from Creator Studio." |
| `pages/admin/ownership.js` | A bare redirect to `/admin/shows` (like `theme.js`). |
| `pages/admin/audit-log.js` | A switch "Show creators’ own changes" → `?owners=1`. |
| `components/admin/ShowsList.js` | Search, chips, rows, the create form. |
| `components/admin/CreatorRoster.js` | The roster half of `OwnershipPanel` (which becomes caller-less, kept). |
| `components/admin/CreateShowForm.js` | "+ Create a show for a creator". |
| `components/show/admin/FactsCard.js`, `OwnerCard.js`, `AdminStatusCard.js`, `DecisionsCard.js`, `StagedChangesCard.js`, `RemovalCard.js`, `HistoryCard.js`, `adminBits.js` | The admin cards (props: `admin` = the GET answer, `view` = the room's payload, `onAction(action, body) → Promise<{ ok, data, error, status }>`, `onDone()` reload). |
| `components/show/ShowControlRoom.js` | `mode="admin"` (below). |
| `components/show/SeasonSection.js` | Admin row actions when `ctx.admin`; 120 row flags. |
| `components/show/EpisodeEditor.js` | 120 (§5.6); `mode="admin"` already changes the Back link. |
| `components/admin/ReviewQueue.js` | §5.5. |
| `components/admin/LibraryPanel.js` | Series rows → "Open the show →" (`/admin/shows/<id>`, `#removal` for deletions; the series Confirm button goes); episode artwork rows list "title image", "title image removal", "trailer"; Orphaned media "Dismiss"; `?edit=<id>` opens `AdminEditEpisodeModal` for that row (`/api/admin/library?id=`). |
| `styles/globals.css` | A block between `/* --- series revamp: admin (slice 3a) --- */` and its end marker: `.adm-shows-*`, `.show-adm-*`, `.rq-show*`, `.rq-group*`. Tokens only. |

### 5.2 `ShowControlRoom mode="admin"`

Loads `GET /api/show/<id>` as today (poll 20 s) **and** `GET /api/admin/show/<id>` (on load, after every action, after
an editor save or a move). Back pill: "All shows" → `/admin/shows`. Hidden in admin mode: the Add bar, drop zones, the
upload queue panel, "+ Add season", the Sell card, the creator's Remove card, the creator flash. `ShowStatusCard` is
replaced by `AdminStatusCard`.

- **Phone** (one column): Back pill · Show card · About this show · Who runs it (full admins) · Where it stands ·
  Decisions · Waiting for approval · Channels switch (team) · the seasons · Extras · Remove this show · History.
- **Laptop** (from 1024px, inside AdminShell `wide`): left 360px sticky — Show card, About this show, Who runs it, Where
  it stands, Decisions, Waiting for approval, Channels; right — the seasons, Extras, Remove this show, History. The
  editors open as the 420px panel exactly as in creator mode.
- `ctx.admin` for `SeasonSection`: `{ rows: admin.review.rows, can, needs, onApprove(id, tier), onReject(id, reason), onUseNumber(id, n) }`.

### 5.3 The words, card by card

**About this show** — "Run by Mara Reyes · mara@example.com · account 2 years old · 3 other shows · 14 titles" (sub-admins:
"Run by Mara Reyes") / "No one runs it yet"; "Bought: whole series 2 · episodes 5" / "No one has bought anything in it
yet"; "On channels: TapaTV (2 slots)" / "Not on any channel"; "Open reports: 3 · All content & flags →" / "No open
reports"; "Files in review: 11 ready · 1 processing · 1 failed"; "Trailer: ready" / "Trailer: still processing" /
"Trailer: failed"; "Created Oct 31 · Public since Nov 3" / "Created Oct 31 · Private".

**Who runs it** (full admins only) — current owner + "Open their account →"; without Creator Studio: "They don’t have
Creator Studio, so they can’t open the show page." + **Give them Creator Studio**; field "Hand it to (their email)" +
**Hand it over**; link "Clear the owner" → confirm "Nobody will run Night Bus until you pick someone. Clear it?"; the
note "They get its page in Creator Studio. Episodes keep the person who uploaded them, and nothing about earnings
changes."; done → toast "Mara runs Night Bus now. Both of you were told."

**Where it stands** — the headline (`show.headline`) and by state: empty/drafts "Nothing has been sent for review yet."
· review "The first episode is in review. Once one is approved, Mara makes the show public." · ready "Mara chooses when
it goes public — maybe once more episodes are approved." + **Make it public** (full admin; confirm "Make Night Bus
public? Its 3 approved episodes go live now and Premium’s early screening starts again. This can’t be undone.";
sub-admin: disabled + "Mara or a full admin makes it public.") + note "It’s Mara’s call when the show opens — use this
when they’ve asked you to." · pulled "Pulled while the team looks at it: <reason>. Restore it under Decisions." · removal
"Mara asked to remove it on Nov 3. Decide under Remove this show." · declined "An older decline, from before shows were
reviewed by episode. Mara can resubmit it." Then the problem lines (`view.problems`, not `delay`); each numbering
problem gets **Fix numbering in Season 1** (manage_episodes; confirm "Renumber Season 1 from E1 in play order? Some
episodes may change number; Mara is told."; else disabled + "Needs “Create & edit episodes”."). Toast: the answer's words.

**Decisions** — "3 in review" / "Nothing in review."; select "Who can watch" (`TIER_CHOICES`, default "Keep each
episode’s choice"); **Approve all in review (3)** (disabled with `review.batch.line`, e.g. "Not yet: 1 of 3 is still
processing."; a 409 shows its error and marks the listed rows); **Reject all in review…** → textarea "What needs fixing
(Mara reads this)" + **Send them back** / Cancel. Without review_submissions both disabled + "Needs “Review creator
submissions”.". Moderation (handle_flags; else disabled + "Needs “Flag content & handle reports”."): not held →
**Hold…** (reason select from `flagReasons`, note "A line for Mara (optional)", tick "Email Mara too", **Pull it**) and
**Take down…** (textarea "Why (Mara reads this)", **Take it down**, confirm "Take Night Bus down? It comes off the site
and Mara sees your reason."); held → "Pulled: <reason>" or "Taken down: <note>" + **Restore**. Savers (full admins,
public show): **Tell savers**, "Last told Nov 4" / "Not told yet", help "People who saved it get one email about its
newest episodes. The daily run does this by itself."; done → "Told 14 people (1,000 checked)." / 409/429 lines.

**Waiting for approval** — "Nothing waiting." or groups ("Night Bus (the show)", "S1 E3 · “Pilot”") of items: text
"Now: …" / "Proposed: …"; image two thumbnails "Live now → Proposed"; removal "Live now → the name as text"; trailer and
new video two players ("Live now" / "Proposed", `<video>` with the signed src, the iframe for a new video) + the state
line ("Still processing" etc.). **Approve** / **Deny…** (note "A note for them (optional)" + **Deny it**); **Approve all**
(every item the viewer can, one request). Disabled per item with `item.needs` or `item.line`.

**Remove this show** (`id="removal"`) — requested: "Mara asked to remove it on Nov 3: “<reason>”." + `plan.adminWords`
+ field "Type the show’s name to remove it" + **Remove the show** (danger; enabled only when the typed name matches) +
**Keep it — deny the request** (optional note). Not requested (full admins): collapsed **Remove this show…** → reason
"Why (Mara reads this)" + plan + typed name + **Remove the show**. Without manage_deletions: disabled + "Needs “Resolve
deletion requests”."; unrequested for a sub-admin: "A full admin does this.". Done → `router.replace('/admin/shows?removed=<name>')`
and the list flashes "Night Bus was removed: <plan words>."

**History** — "Nov 4, 3:12 pm · Mara · S1: E7→E3" (owner rows say the owner's name, admin rows the admin's email +
"(admin)"); 20 shown, "Show all" up to 60; "Nothing yet."

**Rows in review** (SeasonSection, `ctx.admin`): **Approve** + **Reject…** (inline reason, **Send it back**) + a mini
select "Free" / "Tapa +" (defaults to the row's tier); blocked → Approve disabled and the line in the meta (warn); code
`taken`/`unnumbered` with manage_episodes → **Use E9** (`PATCH /api/show/episode/<id> { seriesOrder: 9 }`, then the
rail reloads). Meta adds "edited 2 min ago". Kebab adds "Open in Library modal" (`/admin/library?edit=<id>`) and, on
approved rows, "Ad plan" (`/ad-plan/<id>`); a row with a removal request: **Confirm removal** / **Keep it**
(`/api/admin/resolve-deletion`, manage_deletions). 120 flags for every mode: "Art waiting for approval" also when
`staged.titleImage`; "New trailer waiting" when `staged.trailer`.

### 5.4 The Shows list

Phone: search ("Search by name or owner email"), chips scrolling sideways (`ADMIN_SHOW_FILTERS` with counts, "All 24"),
rows (48px 2:3 poster, name, kind tag, status pill, "Mara Reyes · mara@…" / "(no owner)", count line, badges) linking to
`/admin/shows/<id>`, **+ Create a show for a creator** (manage_episodes; else disabled + "Needs “Create & edit
episodes”."). Laptop: the chips in one wrapping row, rows as a 2-column grid from 1200px. States: "Loading…", "No shows
match.", the route's error line, before 118 "Kinds, defaults and “Went public this week” need a database update
(migration 118).". Tabs "Shows" | "Creators" (full admins).

Create form (a sheet on a phone): "Who runs it (their email)", "Name", Series | Podcast, "One line about it", Who can
watch (Free with ads / Tapa + members), Rating (`RatingOptions`), Genre (main genres) → **Create the show**; the
`no-creator-role` 409 → "mara@example.com doesn’t have Creator Studio yet." + **Give it to them and create** (full
admins) / a sub-admin reads "Ask a full admin to give them Creator Studio first.".

### 5.5 The review queue (`ReviewQueue.js`)

The Series chip and the "Make it public" wording go. Consecutive items with the same `meta.show.id` draw under one
header (`.rq-group`): 40px poster, name, "S1 E1–E12 · 12 in review", **Open show page →**. A submission row's eyebrow:
`new` "NEW SHOW" · `private` "SHOW · NOT PUBLIC YET" · `live` "SHOW · LIVE" · `pulled` "SHOW · PULLED" (danger) ·
`removal` "SHOW · REMOVAL REQUESTED". Approve is plain "Approve"; disabled with `meta.blocked` shown under the subtitle
(warn). Open: the iframe (else `<video>` / `<audio>`), the `.rq-show` sub-card (56px poster, eyebrow, name, kind, "by
Mara Reyes · account 2 years old", the description in two lines, the defaults line, "11 more episodes waiting",
`meta.show.makesPublic`), the slot line, a "Who can watch" select (Free with ads / Tapa + members, default the item's
tier), the key/values. A 409 shows its error and reloads the queue.

### 5.6 The creator's episode editor and 120 (web; `components/show/EpisodeEditor.js`)

Copy `ShowEditor`'s Art patterns:
- Banner "Changes awaiting review:" adds "a new title image" (Cancel → field `titleImage`), "removing the title image"
  (Cancel → `titleImage`), "a new trailer" (Cancel → `trailer`).
- Title image `ArtSlot`: status `files.titleImage || removeTitle ? 'new' : (st.titleImageUrl || st.titleImageRemoval) ?
  'waiting' : art.titleImageUrl ? 'live' : null`; `staged={st.titleImageUrl}`; `stagedNote="Visitors see the live title
  image until we approve this one."`; `onCancelStaged` → `cancelStaged('titleImage')`; `emptyTitle` "Removed when you
  save" / "Removal waits for approval" / "None"; **Remove** hidden while a removal waits; `pickedNote` "Goes to review
  when you save" when the policy is staged.
- Trailer card: pill "Waiting for approval" when `st.trailer` and nothing uploading; the box "A new trailer waits for
  approval" + "The current one keeps playing until then." (no live trailer: "No trailer plays until then.") + Cancel;
  the button reads "Replace the trailer" when there is a live or a waiting one.
- Before 120 the two slots read the policy's line (locked); a 503 `migration-120` shows its error line.

---

## 6. App (`mobile/src/components/show/EpisodeEditor.js`, nothing else)

Mirror `mobile/src/components/show/ShowEditor.js`'s Art tab:
1. `stagedFields` adds `st.titleImageUrl → { field: 'titleImage', words: 'a new title image' }`,
   `st.titleImageRemoval → { field: 'titleImage', words: 'removing the title image' }`, `st.trailer → { field:
   'trailer', words: 'a new trailer' }` (where `st = ep.staged || {}`).
2. Title image `ArtSlot`: `status={st.titleImageUrl || st.titleImageRemoval ? 'waiting' : art.titleImageUrl ? 'live' : null}`,
   `staged={st.titleImageUrl || null}`, `stagedNote="Visitors see the live title image until we approve this one."`,
   `onCancelStaged={canAct ? () => cancelStaged('titleImage') : null}`, `cancelBusy={busy === 'cancel-titleImage'}`,
   `emptyTitle={st.titleImageRemoval ? 'Removal waits for approval' : 'None'}`; **Remove** hidden while
   `st.titleImageRemoval`; Upload/Replace label counts a waiting image.
3. `saveArt`'s toast already says "The title image waits for approval" when the answer's `staged` is non-empty; the
   removal Alert's toast reads "Removing the title image waits for approval" through the same path.
4. Trailer card: the mono state reads `WAITING FOR APPROVAL` when `st.trailer` and nothing is uploading; under it
   `<StagedBox title="A new trailer waits for approval" onCancel={canAct ? () => cancelStaged('trailer') : null} busy={busy === 'cancel-trailer'}>`
   with "The current one keeps playing until then." / "No trailer plays until then."; the button label "Replace the
   trailer" when `ep.trailer || st.trailer`; `attachTrailer`'s toast already says "The trailer waits for approval".
5. Before 120 the policy's locked line shows under both (FieldNote); a 503 shows `r.error` like any refusal.

No route, screen, lib or theme change in the app. `mobile/src/lib/showRules.js` and `notificationTypes.js` are the
server builder's.

---

## 7. Verification

**Server builder**
- `scripts/check-migration-120.mjs` (PGlite, `buildDb(119)`): the three columns absent; run 120; their types (text,
  boolean not null default false, text) and comments; an episode stages, reads back, clears; the closing select's row
  (3, 0, 0, 0, true); RLS on; a second run changes nothing. `node scripts/migration-status.mjs` regenerates
  `supabase/check_migrations.sql` and its proof includes 120.
- `node scripts/test-show-rules.mjs` (new cases, both copies), the new `node scripts/test-show-admin.mjs`,
  `node scripts/test-notification-types.mjs`, every other `scripts/test-*.mjs`, `npm run -s check:refs`, `npm run -s lint`.
- Stand-ins (scratchpad): `fake-supabase-harvest.js` `/__mode120?mode=pre|post|off` (pre: the three episode columns
  42703 in a select/filter and PGRST204 in a write, stripped from rows; post: present with defaults); `fake-clerk.js`
  `/__roles?user=&role=&perms=a,b` (sub-admin permissions) and the metadata PATCH storing the role; `fake-stripe-tips.js`
  `/__customers` (seed customers with `metadata.wishlist`, paged `GET /v1/customers` with `starting_after`).
- `pw/show-admin-http.js` (before 118, before 120, after; tokens for `user_admin`, a sub-admin per capability, Mara,
  another uploader):
  1. 401 signed out, 403 for a creator, 403 per action for the wrong sub-admin with the capability line.
  2. The list: filters and counts, search by name and owner email, badges, a podcast, "Went public this week".
  3. Queue: a private show's episode has `meta.show` (stage `new`), position, slot, master, a signed iframe; no
     `'series'` items, `counts.series` 0; a `review_submissions` sub-admin approves it — 200, the show stays pending,
     one `show_episodes_approved` "stays private until you make it public", `released_at` set; `kind: 'series'`
     reject → 409 `retired`.
  4. Approve refused: taken slot (pre-118 duplicate) 409 `taken` + holder + nextFree; no number 409 `unnumbered`; a
     processing master 409 `master-not-ready`; `unknown` passes.
  5. Approve all in review (12): refused whole with 3 processing (nothing approved, 3 problems, "3 of 12 are still
     processing"); after `/__ready`, all 12 with ONE notice to the owner and ONE audit line; `tierOverride` keep vs premium.
  6. Reject all with a reason: one notice per uploader, `rejection_reason` on each.
  7. Make it public by a full admin (`/api/show/<id>/public`); a sub-admin 403 with the route's line.
  8. Fix numbering renumbers only that season, notifies `show_numbering_fixed`, audits; in order → `unchanged`.
  9. An admin's move into another owner's show: "Its earnings stay with …", no "Future earnings", `buyersAffected`,
     written, `episode_moved_by_admin`.
  10. Staged: a poster approved (old orphaned, `artwork_approved` + `show_edit_approved`, cache cleared), denied with a
      note; 120: Mara stages a title image, a removal and a trailer on a live episode → the editor GET shows them →
      Cancel works → staged again → the admin approves the trailer (swapped, old orphaned, protected) and denies the
      image (orphaned); before 120 → 503 `migration-120` and the policy line; `pending_src` approved swaps the master.
  11. Hold, Take down (status rejected, held, `decision_note`), Restore (public → approved; private → pending; note cleared).
  12. Cascade: wrong name 409 `confirm-name`; a bought episode withdrawn and the show withdrawn with it; the rest
      deleted with their `watch_history` / `notifications` / `title_prices` rows, files orphaned, drafts gone,
      channel slots gone, `show_deleted`, the audit counts; no buyers → the show row deleted; unrequested by a
      sub-admin 403, by a full admin without a reason 400; deny → cleared + `show_deletion_denied`;
      `resolve-deletion` for a show without `confirmName` → 409 with the href.
  13. Owner change notifies both, clears the caches; `series-ownership` the same; Give them Creator Studio.
  14. Tell savers against the fake Stripe: matched counted, once a day (429 `told-today`), `nothing-new`; the cron step
      with `SERIES_DROP_MAX_CUSTOMERS=2` stores a cursor, the next run finishes and marks the shows; the weekly
      per-customer window.
  15. History lists owner and admin rows; the audit log hides owner rows (but `show_live`), `?owners=1` shows them.
  16. Orphaned media Dismiss deletes the row only; a second time 404.
  17. Create a show for a creator: private, owned, `show_set_up`; `no-creator-role` → `grantCreator` by a full admin.
  18. `queue-counts`: `shows` and `library` count the 120 fields.
- Update for the retired kind and the new notice type: `pw/pub-make-public.js` (the queue no longer lists ready shows;
  the Make it public route checks stay) and `verify2/queue-notice-http.js` (a private show's approve sends
  `show_episodes_approved` with the same truth). Add `admin-http` and `admin-browser` to `final/run.sh`.

**Website builder**
- `pw/show-admin.js` at 390 and 1280 (signed-in admin + one sub-admin): the nav's Shows with its badge; the list's
  chips, search, the Creators tab (full admin only); `/admin/ownership` lands on `/admin/shows`; a show page's cards in
  the order of §5.2, both layouts; Approve all, a row's Approve / Reject / Use E9; Waiting for approval with two
  thumbnails and two players; the typed name enabling Remove; a sub-admin's disabled lines; the review queue's group
  header, sub-card, eyebrow and disabled Approve line; Library's Dismiss and "Open the show →"; Mara's editor on a live
  episode: the title image and trailer open, "Waiting for approval" + Cancel; no horizontal overflow, no page errors,
  screenshots in `shots-slice3a/`.
- `next build`.

**App builder**: `cd mobile && EXPO_OFFLINE=1 CI=1 npx expo export --platform ios` and `--platform android` into the
scratchpad (`expo-3a-ios`, `expo-3a-android`); the editor's GET/PATCH/DELETE for the three fields with a Bearer token
(cases from item 10 above, run from `pw/show-admin-http.js`'s Mara section).

**Must stay green**: `api-pre`, `api-post`, `api-off`, `editors`, `lists`, `page`, `show-data`, `followups`, `slot`,
`slot-race`, `make-public` (updated), `queue` (updated), `creator-path`, `money`, `title-ids`, `library-modal`,
`resume-http`, `end-card`, `episode-after`, `trailer`, `walk390`, `walk1280`, `sweep-out`, `sweep-mara`, `sweep-admin`
(`PORT=3100 SUFFIX=-3a bash …/final/run.sh <names>`).

---

## 8. Who owns which file (no file has two owners)

| Server builder | Website builder | App builder |
|---|---|---|
| `supabase/migrations/120_episode_staged_art.sql` | `pages/admin/shows/index.js` | `mobile/src/components/show/EpisodeEditor.js` |
| `scripts/check-migration-120.mjs` | `pages/admin/shows/[id].js` | |
| `supabase/check_migrations.sql` (regenerated) | `pages/admin/shows/[id]/episode/[episodeId].js` | |
| `scripts/test-show-rules.mjs`, `scripts/test-show-admin.mjs` (new) | `pages/admin/shows/[id]/edit.js` | |
| `lib/showRules.js`, `mobile/src/lib/showRules.js` | `pages/admin/ownership.js` | |
| `lib/showAdminRules.js` (new) | `pages/admin/audit-log.js` | |
| `lib/notificationTypes.js`, `mobile/src/lib/notificationTypes.js` | `components/admin/ShowsList.js` (new) | |
| `lib/showPage.js` | `components/admin/CreatorRoster.js` (new) | |
| `lib/showAdmin.js`, `lib/showDelete.js`, `lib/stagedChanges.js`, `lib/seriesDrop.js` (new) | `components/admin/CreateShowForm.js` (new) | |
| `lib/reviewQueue.js`, `lib/moderation.js`, `lib/videoOwnership.js`, `lib/adminNav.js` | `components/show/admin/*.js` (new) | |
| `pages/api/admin/shows.js`, `pages/api/admin/show/[id].js` (new) | `components/show/ShowControlRoom.js`, `SeasonSection.js`, `EpisodeEditor.js` (and `EditorBits.js`, `ShowCards.js` if needed) | |
| `pages/api/admin/{review-queue,resolve-artwork,resolve-edit,resolve-deletion,series-ownership,queue-counts,pending-artwork,pending-deletions,orphaned-media,cleanup-orphan,audit-log,library,sync-stream-protection,pending-series}.js` | `components/admin/ReviewQueue.js`, `components/admin/LibraryPanel.js` | |
| `pages/api/cron/expire-content.js`, `pages/api/notify-series-drop.js` | `styles/globals.css` | |
| Scratchpad: `fake-supabase-harvest.js`, `fake-clerk.js`, `fake-stripe-tips.js`, `pw/show-admin-http.js` (new), `pw/pub-make-public.js`, `verify2/queue-notice-http.js`, `final/run.sh` | Scratchpad: `pw/show-admin.js` (new), `shots-slice3a/` | Scratchpad: `expo-3a-ios/`, `expo-3a-android/` |

Order: the server builder lands `lib/showRules.js`, `lib/showAdminRules.js`, the notification types and the route
shapes first (the website builder can build against this contract and the stand-ins meanwhile); the app builder
needs only `GET /api/show/episode/[id]`'s `staged` keys from §4.2. Only one dev server runs on the worktree
(`start-dev-3100.sh`); builders share it and never restart it while another suite runs.

---

## Server builder's notes (2026-11-05)

Built as the contract says, except where listed here. Everything below is in the tree; `npm run -s check:refs`,
`npm run -s lint`, every `scripts/test-*.mjs` (incl. the new `test-show-admin.mjs`, 8 checks, and 6 new cases in
`test-show-rules.mjs`, 117 checks) and `node scripts/check-migration-120.mjs` (13 checks) pass;
`supabase/check_migrations.sql` is regenerated ("every migration through 120 is in"). Every new write was run as SQL on
PGlite `buildDb(120)` (scratchpad `s3a/check-writes-pg.mjs`, 12 checks — it also proves row 10: deleting a show with a
kept episode filed in it is refused by the foreign key). No dev server was started, so no route has been exercised
over HTTP yet.

**For the website and app builders**

- `GET /api/show/episode/[id]` → `episode.staged` adds `titleImageUrl` (url | null), `titleImageRemoval` (bool),
  `trailer` (`{ src, expiresAt }` | null); `migration: { shows118, episodes120 }`. `GET /api/show/[id]` →
  `migration.episodes120`; each row's `staged` adds `titleImage` / `trailer` (booleans). Before 120 the policy for
  `titleImage` / `trailer` on a live episode is `{ mode: 'locked', line: 'Changing a live episode’s title image or
  trailer needs a database update (migration 120).' }` and a PATCH sending either answers **503** `{ error, code:
  'migration-120', field }`. After 120 the PATCH answers `staged: ['titleImage' | 'titleImageRemoval' | 'trailer']`
  with the contract's notices; a removal already waiting answers `unchanged: true`. `DELETE
  /api/show/episode/[id]/staged?field=titleImage|trailer` cancels (titleImage clears a waiting removal too).
- `approveShowEpisodes` refusals: `'all'` or 2+ ids with any problem → 409 `{ code: 'batch-blocked', error: 'Nothing
  was approved — …', problems: [{ episodeId, code: 'S1 E4', master, blockCode, words: 'S1 E4: …', nextFree?, holder? }] }`.
  **A request naming exactly one id** (a row's Approve, the review queue) answers that episode's own blocker instead:
  409 `{ error, code: 'taken'|'unnumbered'|'master-not-ready'|'no-file'|'show-held'|'show-removal', holder?, nextFree?,
  season?, number?, master?, problems }`. An id not in review (or not this show's) → 409 `batch-blocked` with "That
  episode isn’t in review any more — reload the show."; nothing in review → 409 `nothing`; an empty/bad list → 400
  "Which episodes?"; over 100 → 400 `too-many`.
- `batchSummary(problems, total)` reads each problem's `master` (not `code`): all one kind → "3 of 12 are still
  processing" / "… still uploading" / "2 of 5 failed to process"; otherwise the first problem's words with a leading
  "Not yet: " dropped, + " — and N more". `review.batch.line` is `Not yet: <summary>.`
- `GET /api/admin/show/[id]`: `can.makePublic` = full admin **and** the rule says ready; `needs.makePublic` =
  `makePublicLine(ownerName)` for a sub-admin, else the rule's reason while not ready (null when ready).
  `facts.trailer` is a `masterState` word (`ready`, `processing`, `uploading`, `error`, `deleted`, `unknown`,
  `external`). `owner.accountAgeDays` is floored (null when Clerk can't say). `history` holds up to 60 entries.
  `staged` items include the show's extras' waiting changes too. Trailer items carry `ready`/`state` but `line` stays
  null (a trailer isn't held back by its state); a new video's `line` is the not-ready words.
- `POST /api/admin/show/[id] { action: 'staged' }` groups the items per title and decides each title's fields in one
  `decideStaged` call; `decideStaged` writes **one audit row and one notice per group** (art / text / video) per title
  — the contract's "one notice per title per decision" holds when the fields are of one group (always so from the
  Library's two routes). Result items carry `{ key, ok, notices }` or `{ key, ok: false, error, code?, videoState? }`.
  `decideStaged` errors: 400 "Which title?" / "Which change?" / decision line; 403 `cap` with `capLine`; 404 "Not
  found."; 409 `nothing` ("Nothing is waiting on this one any more. Reload the list."), `changed` ("That changed a
  moment ago…"), `not-ready` (+ `videoState`) with the not-ready words.
- `setShowOwner` clearing the owner tells the previous owner "An admin took “Night Bus” out of your Creator Studio.
  The episodes you uploaded are still yours." (the contract only gave the hand-over words). Clearing a show that has
  no owner answers 409 `same` "They already run it." — don't offer "Clear the owner" when there is none. 404 code is
  `no-account`.
- `grantOwnerCreator` codes: `no-owner` ("Pick who runs it first."), `has-role` ("They already have Creator Studio.").
- `createShowForCreator`: 400 "Who runs it? Type their email." / "A show needs a name." / "A show is a series or a
  podcast."; 404 `no-account`; 409 `no-creator-role` `{ email }`; 403 `full-admin` "A full admin gives someone
  Creator Studio.". The role is granted after the show is made; if that grant fails the answer says `roleGranted:
  false` (the page's Give them Creator Studio covers it).
- `tellSaversNow`: 403 `full-admin`; 409 `not-public`; **503 `no-stripe`** "Saved shows are kept in Stripe, which
  isn’t set up here." (new); 429 `told-today`; 409 `nothing-new`. Order as the contract (told-today before
  nothing-new, so a press with nothing new still uses up the day). The cron step answers `skipped: 'no-stripe'`
  without Stripe.
- `GET /api/admin/shows` rows also carry `level`; `countLine` counts no drafts (the admin list doesn't read anyone's
  drafts); `counts.extras` counts extras filed in the show (`series_id`), not those anchored by `bonus_parent_*` only.
  `migration.shows118` is read off the newest show (probed with a one-row read when there is none).
- Review queue: `GET /api/admin/review-queue?light=1` is the counts-only read. Submission items keep their old `meta`
  keys (`contentType`, `genre`, `runtime`, `artist`, `tier`, `rating`, `hasCaptions`) beside the new ones; an audio
  item's `media` is `{ src: null, audio, poster }`; `meta.slot` is null for a standalone title; `meta.show.waitingCount`
  leaves extras out. A show episode's Approve / Reject from the queue sends `show_episodes_approved` /
  `show_episodes_rejected` (href `/creator/show/<id>`) and the audit row `approve_show_episodes` /
  `reject_show_episodes` on the **show** (not `approve_submission` on the episode); a standalone title keeps
  `episode_approved` / `episode_rejected`. The single-episode notices name the title by `episodeDisplayTitle`
  ("“Episode 1” (S1 E1) in “Quay Lights” was approved. It stays private until you make it public.").
- `resolve-deletion` for a show: `confirm` needs `confirmName` (409 with `href` otherwise); a 200 merges the cascade
  answer (`plan`, `deleted`, `withdrawn`, `media`). `deny` takes an optional `note`. A non-title `id` → 400.
- `GET /api/admin/pending-artwork` episodes' `currentTrailerSrc` / `pendingTrailerSrc` are the **stored** manifest
  addresses (as the series rows' always were) — they don't play (every Cloudflare video is signed-only); the admin
  show page's Waiting for approval card has signed players.
- `GET /api/admin/library?id=` answers `{ episodes: [row] }` (the list's shape) or 404 "That title isn’t there.".
- `GET /api/admin/audit-log` adds `owners` (bool) to the answer; each entry `words` and `actor`.
- `POST /api/admin/orphaned-media { orphanId }`: a non-uuid id → 404 (the column is a uuid); `cleanup-orphan` does the
  same now.

**Deviations from the contract's text**

1. `lib/showAdminRules.js` imports `lib/showRules.js` (explicit `.js`, as `lib/endCardRules.js` does) for
   `numberingProblems` / `kindOf` / `inRunningOrder` instead of importing nothing — both are pure and client-safe.
2. `lib/moderation.js` restore: the series words use curly quotes; a pulled private show (held, not taken down)
   restored reads the private words too ("…: it’s private again until you make it public.").
3. Own-property checks added to `cancelShowStaged` / `cancelEpisodeStaged` (`field=constructor` was a prototype read).
4. `moveForViewer` now asks for the uploader's name too (for "Its earnings stay with Mara Reyes.").
5. `makeShowPublic` writes `reviewed_by_user_id` when someone other than the owner presses it (row "reviewed_by email
   vs id").
6. `deleteShowCascade` records draft uploads with `recordOrphan` directly; a kept row's `title_prices` also clears
   `sale_*` with `sale_members_only = false` (the column is `not null`). `lib/showDelete.js` also exports
   `cascadePreview(show, episodes, extras)` (read-only; used by `getAdminShow`).
7. Not done here (no dev server in this run): `pw/show-admin-http.js` and the `admin-http` / `admin-browser` entries in
   `final/run.sh`. Updated for the retired kind and the new notices: `pw/pub-make-public.js` (no `'series'` items,
   `counts.series` 0, Make it public through `/api/show/<id>/public`, reject → 409 `retired`; its browser card block is
   gone) and `verify2/queue-notice-http.js` (`show_episodes_*` words, the show's audit row). The stand-ins are edited
   but were not running: `fake-supabase-harvest.js` `/__mode120?mode=pre|post|off`, `fake-clerk.js` `/__roles?…&perms=a,b`
   and the metadata PATCH storing role + permissions, `fake-stripe-tips.js` `POST /__customers` (a JSON array of
   `{ id, email, metadata: { wishlist } }`) and a paged `GET /v1/customers` (`limit`, `starting_after`). The
   before-versions are in the scratchpad's `s3a/`.

### After the two reviews (2026-11-05)

- **What the reviewer saw.** Every waiting change carries `seen` (a 16-hex fingerprint of the waiting value,
  `lib/stagedChanges.js` `stagedSeen`; never the value — a video's stored address stays on the server), and so does
  each episode in review (`review.rows[id].seen`, of its file). The `staged` action's items, `approve` (`seen:
  { episodeId: mark }`), and the Library's `resolve-artwork` / `resolve-edit` (`seen: { field: mark }` from
  `pending-artwork` / `pending-edits`) send it back; a change replaced since answers 409 `changed` ("That changed a moment
  ago…") and nothing is decided. Without `seen` (an older page) the old behaviour stands. Approve writes each episode
  guarded on its `src` too. A waiting trailer Cloudflare reports as failed, gone, uploading or processing has a `line`
  and can't be approved (`trailerNotReadyLine`).
- **Taking a change back** is the uploader's (an episode) or the owner's (a show) only: the team decides under Waiting
  for approval, where Deny tells them (403 `who` otherwise). Every take-back and every creator's staged write is
  guarded on the value it read, so a value an admin just approved is never orphaned.
- **Removing a show**: buyers are read strictly (`showBuyers(…, { strict: true })`: a purchase at Checkout under 24 h or
  under dispute counts, ids in 100s, paged; an unreadable read refuses with 503 `buyers-unknown`, and the card says it
  can't count them); ad plays in months not credited yet are credited before the rows go (`creditAdShareBeforeDelete`
  in `lib/adShare.js`, also on one episode's removal; 503 `ad-share` if it can't); a file a kept row or the kept show
  still uses isn't orphaned, and Orphaned media's Delete refuses a picture a title still shows (`imageInUse`); the show
  is claimed (only the call that withdrew or deleted it audits and notifies); a withdrawn show is no open request
  (`removal.requested` false, `removal.withdrawnAt`, badge "Removed · kept for buyers", Remove/Keep → 409
  `withdrawn`); an admin's removal that stopped part-way ("Removed by an admin: …") is finished only by a full admin, as
  the admin's.
- **Hand-over** writes the previous owner into `series.paid_to` when it's empty (a whole-series sale pays
  `seriesSalePayee` = `paid_to ?? creator_id`), so nothing about earnings changes; before 118 a hand-over of a series on
  sale is refused (409 `priced`).
- Owners' emails on the Shows list are for full admins only; the list and the queue's show rows are read in pages of
  1,000; the audit log reads JSON details only for the show pages' own actions (`JSON_DETAIL_ACTIONS`); Tell savers
  gives its day back when no pass ran and hides Stripe's and Clerk's text; holding a private show says it stays private.
