# Series revamp: the show page

The design for adding a series, adding episodes to it, and editing or moving them, for creators and
admins, on the website and in the app. Designed 2026-10-31; Jose signed it off in parts on 2026-10-31
and 2026-11-01. **Nothing here is built yet.**

- Canvas (the boards): https://claude.ai/artifact/F9iNDTTZFJ4Y8ocaWaNv2Z
- How to read this file: "Jose's decisions" and "Amendments" win over "The spec" wherever they
  differ. The spec is the design round's synthesis; the amendments came from checking it against the
  code and from Jose's answers.

## Jose's decisions

The numbers are the canvas's Decisions board. Jose answered 2, 10, 11 and 13; everything else goes as
recommended unless it is listed under "Still open".

1. **No separate show review.** The episode's review card carries the show (poster, owner, description).
   *As changed by 2:* approving an episode no longer makes the show public by itself.
2. **Who makes a show public. Decided 2026-11-01, option A.** Episodes are reviewed as before, by any
   reviewer. Once one is approved, the show's owner or a full admin presses **Make it public**, so a whole
   season can open at once. Later episodes go live as they're approved. Details in the amendments.
3. **A show is never "declined" again.** Taking one down stores the reason on it; an older declined show
   gets Resubmit. *As recommended.*
4. **"Approve all in review" keeps each episode's own Who can watch** unless one is picked for the batch.
   The batch checks every episode first and sends the owner one notice. *As recommended.*
5. **The owner reorders, renumbers, changes seasons and moves episodes between their own shows at once**,
   with no new review. A move shows the numbers it changes first, with Undo; "Renumber from 1" is its own
   button; nothing renumbers a season silently. *As recommended.*
6. **On a live episode:** at once — description, genre, Made by, year, funding link, ad breaks, channels,
   captions, its own page, its place; waits for approval (visible, cancellable) — title, poster, still,
   title image, trailer, a new video file (the current one keeps playing); the team only — Who can watch
   and the rating. A draft or an episode in review applies everything at once. *As recommended.*
7. **A creator can't move an episode into or out of a show that has buyers, or one a channel has
   pinned.** An admin can, after the Move sheet says how many buyers gain or lose it and which slots lose
   their pin. *As recommended.*
8. **Add several: up to 30 files at a time**, uploading one after another while the tab or the app stays
   open; picking the same file again resumes it; each lands at the next free number in file-name order;
   audio podcasts come in by MP3 link or RSS feed. *As recommended.*
9. **A show's genre, rating, Who can watch and Made by are defaults**, copied onto each episode when it is
   added. A thin episode borrows the show's description, genre label, Made by and year, never its rating
   or Who can watch. *As recommended.*
10. **What viewers see of a mixed show. Decided 2026-11-01, option A:** a "Tapa +" pill plus a separate
    green chip — "E1 free", "E1–E3 free", "2 free"; "Free with ads" when everything is free; a
    non-member's Play reads "Play S1 E1 · free".
11. **An episode's own page is a switch, off by default for series episodes. Decided 2026-10-31: yes.**
12. **Trailers play through signed links**, never a public address. *As recommended.* (The upload side of
    this was fixed on 2026-10-31: trailers are uploaded without the signed-only flag again until they are
    signed on the way out.)
13. **Earnings go to the title's owner. Decided 2026-10-31.** Details in the amendments.
14. **Fix the money columns that can't hold a title's id.** *As recommended;* amendment 25 adds ad share's
    columns and suggests fixing all of them sooner, on their own.
15. **Removing a show takes its episodes and extras in one confirmation**; anything someone bought is
    withdrawn and kept for them. *As recommended.*
16. **Duplicate episode numbers already in the database are moved out of the way** (1001, 1002…), never
    guessed into an order. *As recommended.*
17. **Podcasts use the same show page**, in podcast words; vertical (Snippet) series are left as they are.
    *As recommended.*
18. **The app gets the creator's screens; the admin Shows pages stay on the laptop.** The app's review deck
    shows a new show's episodes with the show on the card; saver emails go out once a day, plus a "Tell
    savers" button. *As recommended.*

## Still open

Being gathered on 2026-11-01: three reviewers are checking the plan against the code for questions that
decisions 2 and 13 raised. So far:

1. **When an admin attaches a show to a producer, does the producer take over running it** (order, art,
   pricing, Make it public, removal), **or only get paid** while the creator who built it keeps running it?
   The two reviewers who looked recommended opposite answers.
2. **The title-id fix for Buy to own and ad share** (amendment 25): its own small migration now
   (recommended, so both work before the live-mode money test), or inside the series migration.

## Series spec — amendments after the refuter (2026-10-31)

All 21 refuter findings were checked against the code (the upload-link limit, playbackGate's
pending 404, rss-import's numbering and kind-less insert, edit-episode's status select,
seriesHidden) and accepted. These amendments override the synthesized spec where they differ.

### Blocking

1. **Add several needs a higher upload-link limit.** `/api/creator/get-upload-url` allows 20 an
   hour per account and per IP. When the request carries a `seriesId` the caller owns (or the
   caller is an admin), the limit is 60 an hour per account and per IP. Links are minted lazily,
   one per file as its turn comes (never 30 up front). The drop zone says "Up to 30 files at a
   time · they upload one after another". pw/show-page.js drops 30 files.
2. **A show's rating and tier are never read-time fallbacks.** `rating`, `tier`, `mainGenre` are
   copied onto the episode row when it is created (submitDraft, createShow's first episode,
   acceptApplication, rss-import) and never filled in at read time. An episode nobody rated stays
   17+ (the age policy). Changing the show's defaults changes only episodes added afterwards, and
   the defaults block says so ("applies to episodes added from now on"). Read-time fallbacks are
   presentational only: description, genre label, Made by (artist), year, and the title
   "Episode N". The channel engine, /api/channel/play, podcastShow, RSS and the sitemap need no
   change.
3. **Master-ready means a Cloudflare video that is ready, and nothing else.** `masterReady(row)`
   in lib/showRules.js: true when the row has `audio_url` and no `src`, or a non-Cloudflare `src`
   (Bunny, self-hosted, manual entry), or a Cloudflare uid whose state is `ready`. Approve is
   refused only for a Cloudflare uid that is uploading, processing or errored. pw/show-admin.js
   approves an audio podcast episode.

### Annoying

4. **One helper brings a show live.** `approveEpisodeAndShow` in lib/showPage.js is called by
   decideReviewItem, edit-episode's status change (the Library modal) and manual-episode. Each
   enforces `SHOW_LIVE_NEEDS_FULL_ADMIN`. "+ Create a show for a creator" with "Live now" is a
   full-admin action and needs a first episode (no live empty shows).
5. **Preview works.** lib/showPage.js gets a preview reader (owner, uploader or admin; every
   non-deleted episode of the show; `private, no-store`; `noindex`). playbackGate gets a preview
   branch: the owner (series.creator_id), the uploader or an admin may play any status except
   rejected; signed src; no view counted. `/podcasts/<id>?preview=1` follows the same rule.
6. **Declined and withdrawn rows stop holding their number.** The unique index's predicate adds
   `and status <> 'rejected' and withdrawn_at is null`. planMove / positionsFor treat those rows
   as not occupying a slot. "Send again for review" on a declined episode re-checks its slot and
   offers the next free number when it was taken meanwhile. A removal-requested row keeps its
   number (a denied removal restores it).
7. **RSS import keeps working.** rss-import creates its show through `createShow({ kind:
   'podcast' })`, numbers items with positionsFor / nextFreeNumber (an itunes number is honoured
   when free), and reports skipped duplicates in its answer. pw/show-data-http.js imports a feed.
8. **Podcasts get a real bulk path.** A podcast show's Add bar has "Import from an RSS feed"
   (rss-import with the show's id) beside "Paste an MP3 link" and the video drop zone. The page
   says plainly that audio comes in by link or feed. The "40-episode podcast in two drops" claim
   is limited to video podcasts.
9. **A staged replacement video is safe.** `episodes.pending_src` joins usedByOthers / videoInUse
   and "Protect every video". Approving it is refused until its Cloudflare state is ready. On
   approve: runtime from the new file's duration, an on-demand or ready ad plan goes back to draft
   with a notice, and the row is flagged "captions may be out of sync" (status card + admin card)
   until the captions are replaced or the flag is dismissed.
10. **The laptop panel and the upload queue survive navigation.** The show page opens the editor
    with `router.push('/creator/show/[id]?ep=<id>', '/creator/show/<id>/episode/<id>', { shallow:
    true })`; the episode page file renders the same ShowControlRoom with the panel open for a
    direct load. The file queue moves into UploadContext (a queue of `{ file, draftId, endpoint }`,
    still one upload at a time), so it survives in-app navigation. Banner: "Keep this tab open".
11. **Batch approve and batch send are specified.** decideReviewItem takes `{ notify: false,
    invalidate: false }` for batch callers. The batch sends one notice to the show's owner and one
    per other uploader naming their episodes. A batch is capped at 10 rows per request and the
    client loops ("Approving 10 of 24…"); the same for "Send N for review". Every request answers
    per-row results so a partial run is visible.
12. **Behind on migration 116.** The show page's Add bar says "Adding episodes here needs a
    database update (migration 116)" and links to `/creator/submit?type=series&series=<id>`, which
    still submits without drafts. 116 is run before 117. The web page gets the app's 503 wording.
13. **Edit show is a screen.** `/creator/show/[id]/edit` on a phone (web + app), the same right-hand
    panel as the episode editor on a laptop. Two tabs: Details (name — staged when live —, one line,
    about, year, funding link, the defaults block "applies to episodes added from now on", season
    labels, channels) and Art (poster, still, hero, title image, trailer; each shows Live / Waiting
    for approval · Cancel). The admin variant at /admin/shows/[id]/edit saves directly.

### Minor

14. **Reorder payload.** `{ episodes: [{ id, number }], drafts: [{ id, number }] }`: the RPC moves
    episodes, drafts are written after from the same plan. Reorder is gated on the show's owner or
    manage_episodes; the uploader rule applies to moving in and out of a show.
15. **The migration's de-duplication cannot collide.** Rows with `series_order <= 0` are set to null
    first (a notice per row). Duplicates are shoved to `max(series_order) over (show, season) +
    1000 + rn`. A DO block checks that no duplicates remain before `create unique index` and raises
    an exception listing them otherwise, so nothing is half-applied (the SQL Editor runs the script
    as one transaction).
16. **An empty show is not public.** getSeriesHubData answers notFound when a show has no public
    episodes (preview excepted), as podcastShowHub already does; getAllSeries and the hero pools
    leave it out the same way.
17. **Batch approve keeps each episode's tier.** The Decisions card's Who-can-watch select defaults to
    "Keep each episode's choice", with Free / Tapa + as explicit overrides. An approval never writes
    the show's default tier.
18. **Admin exposure and audit noise.** The Creators tab and the Owner card are full-admin only.
    Creator actions are audited with `details.actor: 'owner'`; the dashboard and /admin/audit-log
    leave them out by default; the show page's History shows both.
19. **The app's sorter.** mobile/src/lib/seriesResume.js adopts the same sortEpisodes in slice 1;
    scripts/test-series-resume.mjs gains null-number, tie and duplicate cases and imports both
    copies.
20. **Saver notices in one pass.** One pass over Stripe customers per run, matching each wishlist
    against the set of shows that dropped since the last run, with one shared cursor in
    series_drop_runs, as its own cron step.
22. **A pulled show can still replace its file** (raised while drawing the status card: a pull's
    reason is often "replace the file or send the licence"). While pulled, Replace the file (it goes
    to review like any new video), captions and page notes stay open; everything else waits.
23. **An extra tied to an episode that isn't public stays hidden** until that episode is live (raised
    while drawing the public page); it never falls back to "With the show".
24. **Night Bus's count in the story** is 8 episodes (the boards were corrected).

25. **Ad share has the same id mismatch as Buy to own** (found 2026-11-01 while checking decision 14).
    Every episode and series id is a text slug (`night-bus-last-stop-lx3k9a`), but migration 103 declared
    `ad_impression_days.episode_id uuid`, `record_ad_impression(p_ad uuid, p_episode uuid, …)` and
    `creator_ledger.episode_id uuid`, and `/api/house-ads/impression` only records the episode when it
    matches a uuid pattern, so no real episode has ever been recorded and ad share credits nothing (the
    advertiser is still charged, through `increment_house_ad_impression`). Buy to own fails earlier than
    decision 14 says: `getPriceRows` errors on the uuid column and returns no price, so the Buy card never
    shows, and saving a price throws. Fix for both (no live rows to convert): the four columns to text,
    `record_ad_impression` re-created with `p_episode text` (the uuid version dropped), the pixel checking
    a site id pattern instead of a uuid. Recommended: its own migration now, ahead of the series work
    (which then becomes 118), so Buy to own and ad share work before the live-mode money test.

21. **Pinned channel slots.** A creator's move of an episode pinned on a channel slot is refused
    ("Pinned on TapaTV — ask us to unpin it first"). An admin sees the slots on the Move sheet and
    the move clears those pins.

### Jose's answers (2026-10-31, after the canvas)

- **Decision 11 — yes.** An episode's own page is a switch, off by default for series episodes.
- **Decision 13 — changed.** Earnings go to the title's **owner**: "whoever created the series or the
  producer in charge of the income … the main user that we as admin can attach a series or
  episode/film/short to." Build it as one rule, `payeeOf(episode, series)` in lib/showRules.js:
  `episode.owner_id ?? series.creator_id ?? episode.submitted_by`. Migration 117 adds
  `episodes.owner_id` (nullable; null = follow the show's owner, else the uploader). Every lane uses
  the rule: title sales (the destination account and who may price), ad share (today it already
  falls back to the show's owner when there's no uploader), Creator Share's watched basis, the episode
  page's Tip button, the AI seal's switch, Your numbers and the Money page. Admins attach a producer
  on the admin show page's Owner card (the whole show) and on the admin episode editor (one title,
  standalone or inside a show), by verified email held by one account like series ownership today;
  the Owner card offers "Grant creator role" and the payouts gate opens for any owner. Money already
  credited stays where it was credited; the rule applies to money earned after it ships. Moving an
  episode between two shows with the same owner changes nothing; moving it to another owner's show
  moves its future earnings, so it is admin-only and the Move sheet says "Future earnings go to
  <owner>". The Terms (sections 4/5) need one sentence saying earnings go to the account a title is
  attached to; it joins the lawyer list.
- **Decision 10 — yes, sharper words wanted.** Options drawn on the canvas (board D10); waiting on his
  pick. Recommended: a separate green "E1 free" chip beside "Tapa +".
- **Decision 2 — "a full admin or a creator can bring the series to life."** The full-admin-only gate
  is gone either way. Asked which he means: the creator makes the show public when ready (episodes still
  reviewed), the show going public by itself with its first approved episode (any reviewer), or no
  review for an accepted creator's show.
- **The other fourteen** go as recommended unless he says otherwise.

### Jose's answers (2026-11-01)

- **Decision 2 — option A: the creator picks the moment.** A show has no review of its own and no
  "first approval brings it live". Episodes are reviewed as before, by any reviewer
  (`SHOW_LIVE_NEEDS_FULL_ADMIN` is dropped). Once at least one episode is approved, the show's owner
  or a full admin presses **Make it public**; until then the show and its approved episodes stay
  private (owner/admin preview, noindex, 404 for strangers). After it is public, each later episode
  goes live when it is approved. The creator's status card gains the state "Ready to go public"
  (board C5, 2B) with Make it public + Preview; the admin show page's Decisions card has Make it public
  (enabled for a full admin once an episode is approved; a sub-admin sees it disabled: "Mara or a full
  admin"); the queue's button is plain "Approve" and the show card says "Mara makes the show public once
  one is approved". `approveEpisodeAndShow` becomes `approveEpisode` (no show flip) plus a separate
  `makeShowPublic(showId, actor)` (owner or full admin; needs ≥ 1 approved episode; sets
  `series.status = 'approved'` + `public_at`; stamps `released_at` on the episodes approved while the show
  was private, so early screenings and "New episode" start from the public moment; one notification +
  audit line; invalidates the caches). An accepted application's series stays as today: Accept is a full
  admin's decision, so the show goes public with S1E1 at once. Two words follow from it: the hub's show
  card reads **Ready to go public** while the show is private with an approved episode, and the hub's
  "Waiting on the show" row (an approved episode of a private show, in Needs you) becomes "Ready to go
  public" with Make it public on the row.
- **Decision 10 — option A.** A "Tapa +" pill plus a separate green chip: "E1 free" / "E1–E3 free" /
  "2 free"; "Free with ads" when everything is free; members see the same chips; a non-member's Play
  reads "Play S1 E1 · free". `showRollup` returns `{ tier: 'premium'|'free'|'mixed', freeLabel }`.

## The spec

### The show page — one control room for a series or podcast (Creator Studio + Admin), built for many episodes

The judges split 2–1: the creator and admin lenses picked "Many episodes fast" (the Season board) for its publish and approve paths, the engineer picked "One show page" (the control room) for fitting the codebase and never rewriting what shipped on 2026-10-31. The engineer's mustNots rule out three of the board's mechanisms (a two-at-a-time UploadContext, a nested 'batch' review kind, a video_state column), so this spec keeps the board's promises and builds them on the control room's mechanics: ONE page per show, /creator/show/<id>, rendered by one `ShowControlRoom` component that the admin opens at /admin/shows/<id> with a Decisions rail added. Drop one or thirty files on it and each becomes a 116 draft uploading in turn (the existing one-upload-at-a-time rule, resumable by re-picking the file), numbered next-free in file-name order, landing in its season as 'Draft · uploading'. 'Send N for review' turns drafts into pending episodes in one request. A show has no review of its own: it goes live when a FULL admin approves its first episode (a one-line flag `SHOW_LIVE_NEEDS_FULL_ADMIN` keeps today's capability line until Jose relaxes it), and the review queue stays one flat item per episode — each carrying a 'New show' sub-card — while the admin show page offers 'Approve all in review (N)' that validates every slot first and runs the same guarded decision per row with ONE owner notification and ONE audit line. Order is the owner's business: renumber, re-season and move within shows you own apply at once, never change status, never silently renumber other rows (a move shows exactly which numbers shift; 'Renumber from 1' is an explicit action), and the database finally holds (series_id, season, series_order) unique after a visible, logged de-duplication. Episodes keep their /episode/<id> URL; 'optional page' is an explicit `has_page` switch that turns a cold visit into the landing view with the episode's own notes. Money never moves: `episodes.submitted_by` stays the payee in every lane and a show owner moves only what they uploaded. Trailers are signed on the way out like masters (the creator trailers uploaded since 2026-10-25 start playing again), the podcast-detaching admin save, the '__new__' sentinel, the id collision in acceptApplication, the uuid money columns and the dead ownership regex are fixed in the same slices. The app mirrors the creator screens (↑/↓ and sheets, no drag, no new native dependency); the admin's long pages stay on the laptop where Jose reviews.

### Principles

- One page per show, one component for both roles: `components/show/ShowControlRoom.js` in mode 'creator' (/creator/show/<id>) or 'admin' (/admin/shows/<id>, adds the Decisions rail and direct writes). Nothing about a show is edited in a modal any more; pickers may be sheets, the editor is a route.
- Build only on what shipped on 2026-10-31: the 116 `creator_drafts` row is the unsent episode, `UploadContext.startVideoUpload` (one upload at a time, resume by re-picking) is the uploader, `/api/creator/get-upload-url` is the only mint, the review queue's flat normalised item carries the show as `meta.show`, `AdminEditEpisodeModal` stays reachable for the long tail. No second mint route, no two-at-a-time queue, no nested batch kind, no new native dependency.
- Order is structure, not content: season, number, show (within the owner's shows), extras' anchor, captions, channel opt-in and `has_page` apply at once at any status and never change status. Title, poster, still, title image, trailer and the video itself stay staged on a live title (visible, cancellable). Tier, rating, Tapa Original and hero eligibility on a live title are admin-only — entitlement never changes without a human.
- Numbers are honest: auto next-free when blank, editable by tapping the badge, unique per (show, season) at the database, gaps shown and never bridged, duplicates refused with the two candidates. A move shows which numbers shift before it commits; nothing renumbers a season silently.
- A show goes live with its first approved episode, approved by a full admin by default (`SHOW_LIVE_NEEDS_FULL_ADMIN = true`, one constant). A show with zero approved episodes is never public (`seriesHidden` stays the one hide rule). Every decision on a show or a staged change stores a reason and notifies the owner through a registered notification type.
- Money never moves by accident: `episodes.submitted_by` is the payee in every lane; `series.creator_id` arranges. An owner moves only episodes they uploaded; an admin may move anything and is shown 'earnings stay with <uploader>' and, when a show has series buyers, 'N buyers gain/lose this episode'. A creator's move in or out of a show with buyers is refused.
- Every Cloudflare video on the path is signed on the way out — masters and trailers alike — through `signedSrcForStoredUrl` with `unsignedFallback`, failing closed to null (the hero falls back to its image). No unsigned mint, no 'Protect every video' exception.
- Migration 117 cannot fail on Jose's real data and the code survives without it: every new column optional with a default and read through SELECT/SELECT_LEGACY + missingColumn, writes through insertCompat/updateCompat, the unique index only after the logged de-duplication, the status CHECK only when no row would violate it, every statement re-runnable, the RLS line at the end; the reorder RPC has a two-phase negative-number JS fallback and RPC-only features answer 503 naming 'migration 117'.
- Every route on the path: applyCors + OPTIONS + 'Cache-Control: private, no-store'; getRoleContext or requireCapability per action; a per-account checkRateLimit beside the per-IP one; checkVideoOwnership on every uid from the browser; recordOrphan on every replaced file; invalidateCache('public_episodes_v1') and ('all_series_approved_v1') on every public-facing write; recordAudit on every write (creator writes too); sendError(res, err, '<route>', fallback, { plainStatus: 400 }) with internalError marking — never err.message.
- Pages and the app import only client-safe modules (`lib/showRules.js`, `lib/submitRules.js`, `lib/seriesResume.js`, `lib/creatorRights.js`); `lib/showPage.js`, `lib/showDelete.js`, `lib/seriesDrop.js` are server-only. `mobile/src/lib/showRules.js` mirrors `lib/showRules.js` word for word ('change both together'). No site class starts with `cl-`.
- One sorter everywhere: `sortEpisodes` from `lib/seriesResume.js` ((season ?? 1), then (seriesOrder ?? last), then createdAt, then id) replaces every hand copy, including episodePage's (season || 0).
- No Stripe-customer pagination inside a request anyone is waiting on: saver notices run from the daily cron, once per show per day, capped with a continuation, and the admin show page has a 'Tell savers' button; the spec says plainly that a wishlist table is a later round.
- Vocabulary stays the site's: Creator Studio, Your work, Submit a title, In review / Needs you / Live / Not this time / Pulled / Draft, Tapa +, 'Who can watch', 'Not for AI training'; show / episode for a podcast, series / episode otherwise (`showNoun`).

### Decisions the design made

1. **Which design is the base, and how are the judges' conflicts resolved?** The product promises of 'Many episodes fast' (drop many files, see them land in order, approve a show at once, one notification per batch) built on the mechanics of 'One show page' (one ShowControlRoom component for creator and admin, drafts as unsent episodes, the flat review item with meta.show, AdminEditEpisodeModal kept for the long tail). Where the two conflict the engineer's mustNots win on mechanism and the creator/admin lenses win on behaviour: sequential uploads through the existing UploadContext (not two at a time), one request to send N drafts (lib function shared with submit-episode), 'Approve all in review' on the admin show page (not a nested queue kind), slot validation before any approve, one notification per batch.
   Why: Two judges picked the board for what it lets a creator and Jose DO on a 40-episode podcast; the third showed its three new mechanisms rewrite what shipped on 10-31 and reshape the queue in three renderers. Keeping the behaviour and swapping the mechanism costs nothing the user sees.
2. **Does a show need its own review step, or does it go live when its first episode is approved — and may a sub-admin do it?** No separate step. A show stays `status: pending` (invisible, previewable by its owner at /series/<id>?preview=1) until an admin approves any episode filed under it; `decideReviewItem` for a submission whose parent show is pending approves the show in the same write (status approved, reviewed_by_user_id, reviewed_at; released_at on the episode), notifies the owner `show_live` + `episode_approved`, invalidates both caches, audits `show_live`. The review item carries `meta.show` and renders a 'New show' sub-card; the approve button reads 'Approve · brings Night Bus live' with an untickable note. `SHOW_LIVE_NEEDS_FULL_ADMIN = true` in lib/showRules.js: a `review_submissions` sub-admin's Approve on the first episode of a pending show is refused 403 'A full admin approves a new show' (the button renders disabled with that line); later episodes of a live show approve normally. Rejecting the episode leaves the show pending with the note on the episode. The 'series' kind leaves QUEUE_KINDS; shows with zero episodes appear on /admin/shows under 'Waiting on a first episode' and never in the queue.
   Why: It removes the silent full-admin-only decision, the 'Live but invisible' pile, the reason-less rejected show and the 'nothing to review' series card in one move, and matches acceptApplication's path (show + S1E1 in one step). The flag keeps today's capability line exactly until Jose says otherwise — the lens-2 and lens-3 mustNots. *(Jose confirms.)*
3. **Should a show have one tier / rating / genre / artist of its own, or stay derived from its episodes?** Both, cleanly separated: the show carries DEFAULTS (`series.defaults jsonb`: tier, rating, mainGenre, genre, artist, adsEnabled) typed once, copied onto every new episode at creation and used as read-time fallbacks for a thin episode (rowToEpisode/rowToPublicEpisode, beside the existing art fallback). What viewers see of the SHOW is a roll-up through one rule, `showRollup(episodes, show)` in lib/showRules.js: tier = 'Tapa +' if any public episode is premium, with 'pilot free' when the first is free ('Tapa + · pilot free'); rating = the highest minimum age among episodes; genre = the most common mainGenre; 'Made by' = defaults.artist, else the owner's display name, else the first episode's artist. SeriesHero, heroCandidates, libraryCards, the About tab and the app read the roll-up.
   Why: Defaults end the repetition that makes a batch painful without inventing a show-level truth that can contradict its episodes (lens 3's dual-truth worst for design 1); the roll-up ends the hero reading the first episode's tier while every card rolls up 'any premium → premium'. Jose to confirm the mixed-tier wording. *(Jose confirms.)*
4. **Who owns a show's episodes for money and credit, and may a show owner add or move episodes they did not upload?** Unchanged: `episodes.submitted_by` stays the uploader and the payee of every lane (Creator Share watched basis, ad share, title sales, Your numbers, Tip, seal, early access). `series.creator_id` controls the show page: order, seasons, labels, art, defaults. The owner may add episodes (then submitted_by = them) and reorder every row of their show, but may move OUT of or INTO a show only episodes they uploaded; a row uploaded by someone else shows 'uploaded by <name>' and no move handle for the owner. An admin may move anything; the picker shows 'Earnings stay with <uploader>' when the two differ. No ownership transfer rewrites submitted_by; no co-owners.
   Why: Changing who gets paid is a Terms section 4/5 and lawyer question; the redesign changes who can ORDER things without changing who gets PAID. Design 2's 're-credit the episodes' checkbox is dropped (lens 2 mustNot). *(Jose confirms.)*
5. **What does 'optional per-episode page' mean?** Every episode keeps its /episode/<id> URL (player, Up next, the strip, the end card, My List, Continue Watching, notifications' hrefs, purchases, the sitemap and the app's deep links all key on it). The option is `episodes.has_page boolean` (null = by type: standalone → page, series/podcast episode → player; true/false explicit) plus `episodes.page_notes text` (≤4,000, blank-line paragraphs). has_page on: a visit without ?autoplay renders the landing view a film already gets (HeroSpotlight art or signed trailer, kicker linking to the show, title, meta, the notes as paragraphs, Play/Continue from the resume point, OwnTitleCard, crew / Shot at, the season strip), the series page's row gets a 'Details' affordance, og:image is set from the still. has_page off: a cold visit renders the player strip as today. The creator flips 'Give this episode its own page' in the episode editor; flipping it on reveals notes, trailer and hero image. Sitemap and search are NOT changed by this round: every episode URL stays listed as today; what gets indexed is a separate decision in forJose.
   Why: A URL-less episode breaks eight consumers; what a creator means by 'a page for more info' is the landing view with text, which a series episode never gets today (and the Own card never renders). The sitemap/search exclusion three designs slipped in is a product decision, not an engineering rule — lens 2's mustNot. *(Jose confirms.)*
6. **Should bonus content sit inside the numbered order or stay a separate shelf?** A separate Extras shelf at the bottom of the show page (bonus_parent_type 'series'), each extra optionally anchored to one episode ('after S1 E3' = bonus_parent_type 'episode'); the episode editor shows the extras anchored to it. Extras are never numbered, can be re-anchored (show ↔ an episode) and reordered among themselves (series_order reused as shelf order, outside the unique index). The admin edit-episode route learns content_type 'bonus' + the parent fields with existence checks so an admin can do the same. Extras count toward the cascade delete.
   Why: Numbering extras would feed them into Up next, the end card, resume and the channel engine, all of which read series_order; the anchor keeps the 'after the episode' feeling. Fixes the blocking admin-modal gap.
7. **Are podcasts part of this redesign, and should /series/<podcastId> redirect?** Yes, same page: migration 117 adds `series.kind` ('series' | 'podcast' | 'vertical', backfilled from the episodes' content types). kind decides the vocabulary (show/episode, 'Hosted by'), hides the trailer/hero/title-image slots for podcasts, offers the MP3 link import, collapses seasons to one running list when a podcast has a single season (RSS keeps itunes:season/episode), and filters every picker (a podcast episode joins only a podcast show). Public /podcasts/<id> stays the flat page; `/series/<id>` 302s to /podcasts/<id> when kind is 'podcast' and `/api/series-hub` answers `{ redirect }`.
   Why: Creator and admin pain is identical for podcasts and the table is shared; the public page is already right for the medium. The redirect closes the critic's 'podcast rendered as a series with an un-playable Play'.
8. **Keep or retire vertical series?** Freeze: `series.kind` allows 'vertical' so existing groupings keep their meaning and the browse page / discover playback keep working; the show page refuses to open a vertical show for creators ('Vertical series are set up by the studio') and the admin page opens it read-only except numbering. No editor, no pill on New show, the submit path is not taught to set series_id for vertical. Decide later whether to promote ('Snippet series') or remove.
   Why: A shipped surface with no author is not worth an editor this round; freezing costs one line in the rules. Lens 3's mustNot. *(Jose confirms.)*
9. **After approval, may the owner renumber, re-season or move episodes without re-review, and does moving a live episode to another show unpublish it?** Yes, within the shows they own, applied at once, audited (`show_reorder`, `show_move`), no status change, the title stays live. Guard: a creator's move in or out of a show that `hasBuyersIncludingSeries` is refused with 'This show has buyers — ask us'; an admin may, and the Move sheet shows 'N series buyers gain/lose this episode' before the write. Moving across owners is admin-only (creator gets 409 'Only an admin can move a title between owners'). Replacing the video on a live title no longer unpublishes it: the new master is staged as `pending_src` (the old one keeps playing) and approved as 'New video' on the admin show page; on a pending or rejected row the swap applies at once (a rejected row goes back to pending). 'Not this time' episodes also get 'Send again for review' (status pending) after any edit, so fixing the metadata alone can resubmit.
   Why: Review is about the content, not its position; a creator fixing 'E3 should be E2' should not take a show off the air, and a colour-grade fix should not make a live show vanish. The buyers refusal sits exactly where the one money consequence is; the admin is never blocked absolutely (lens 2 mustNot). *(Jose confirms.)*
10. **Should a season be an entity, should numbers be auto-assigned, are gaps allowed, and what does a drag do to other rows' numbers?** Season stays a number on each episode (117 backfills `season = 1` where null for series/podcast rows); the show row gets `seasons jsonb` = [{ number, name }] for optional labels ('Season 2 · The Return'). Numbers are auto-assigned to the next free slot (`nextFreeNumber`), editable by tapping the E-badge; gaps are allowed but flagged in the status card ('E2 is missing in Season 1'), never bridged; duplicates are refused by the server (409 with the two candidates: 'Swap with E3' | 'Insert here and shift') and by the unique partial index. A drag or ↑/↓ is an INSERT: `planMove(rows, episodeId, targetIndex)` rotates the dragged row through the occupied numbers between source and target and leaves every other number (and every gap) alone; the toast says exactly what changed ('E7 → E3; E3–E6 become E4–E7 · Undo') for 8 s. 'Renumber from 1' is an explicit season action with its own confirm. Alt-drop or the badge's 'Swap with E3' swaps two numbers only.
   Why: A season table would touch every reader for a label nobody asked for; the jsonb gives the label. Auto-next-free is what 'Add several' needs. The insert-rotation keeps a viewer's 'S1 E5' in Continue Watching, RSS and shared links stable unless the creator chose to touch it — both the lens-1 graft and the lens-2 mustNot. *(Jose confirms.)*
11. **Should deleting a show cascade with one confirmation, and does withdraw-for-buyers apply per episode or to the show?** Cascade with one confirmation on both sides: the creator's 'Remove this show…' card shows `cascadePlan` words ('Night Bus, its 6 episodes and 2 extras · 2 titles have buyers and will be kept for them') before the request, which hides everything at once as today; the admin's Confirm on /admin/shows/<id> shows the same counts plus channel slots that drop, asks for the show's name typed back, and runs `deleteShowCascade` (lib/showDelete.js, lib/testContent's order): per title, buyers → withdrawn_at + price off (a series purchase withdraws every episode and the show row; an episode purchase withdraws that episode only); the rest deleted with watch_history, notifications and title_prices rows cleaned and every file orphaned; extras reached through bonus_parent_id go with them; channel_slots cascade by FK; the series row is deleted or withdrawn. Outside references (crew_calls, productions, location_credits) keep the text id and show 'a removed show'.
   Why: Today the admin is refused while any episode remains and has no bulk tool; bonus clips are orphaned; the only cascade is Test content, which skips the buyer check. Withdraw is already per row in Buy to own and must stay per bought scope. *(Jose confirms.)*
12. **Should trailers stay public (unsigned) or be signed like masters?** Signed. Every creator trailer since 2026-10-25 is already minted `requireSignedURLs: true` and stored/played raw, so it cannot play. `lib/seriesHub.js`, `lib/episodePage.js`, `lib/heroCandidates.js`, `lib/podcastShowHub.js`, the stream/genre/type feeds and both APIs sign `trailerSrc` on the way out through `signedSrcForStoredUrl` (60-minute token so it outlives the 300 s CDN cache; `unsignedFallback` keeps a self-hosted file; null when signing fails). `/api/stream-token` gains `part: 'trailer'` (gate: exists, not held, parent not hidden; no tier, no age; 240/h) as the `refreshSrc` for SeriesHero / HeroSpotlight, which fall back to the hero image on an hls error. Approve runs `syncStreamProtection` on trailer_src too; 'Protect every video' covers series.trailer_src / pending_trailer_src. SeriesMediaForm's own tus loop is replaced by `startVideoUpload(kind 'trailer')`.
   Why: The anti-harvest rule is 'every Cloudflare Stream video demands a signed URL whatever its tier'; a trailer-only unsigned mint would be undone by the next protection sweep. Design 3's refresh path makes it hold on a long-open tab. *(Jose confirms.)*
13. **Should savers be told automatically when an approved episode joins a saved show, and does a new episode of a Tapa+ show hold 24 h for Standard?** Automatic but never inside a request: `lib/seriesDrop.js notifySeriesDrop(seriesId, { since })` runs from the daily `/api/cron/expire-content` run (one extra step) for shows that gained a live episode since the last run (approved, or a scheduled `available_from` that passed), once per show per day (`firstInWindow('series-drop:<seriesId>', 86400)`) with the count ('3 new episodes of Night Bus'), to every wishlist holding the series id — the existing Stripe-customer loop, capped at 1,000 customers per run with a stored continuation cursor; an email at most once per show per week. The admin show page has a 'Tell savers' button (the old manual route, now one click from the show, also deduped). 'New episode' banners read released_at. The 24 h early screening stays per premium episode exactly as `earlyAccessState` applies it today. A wishlist table is a later round and is listed in notBuilt.
   Why: My List already promises the email; the only missing piece is a trigger that does not multiply a Stripe pagination by the episode count or run inside the approve request (lens 2 and lens 3 mustNots). *(Jose confirms.)*
14. **Can a rejected show be re-submitted or edited back into review?** With no show-level review, a show is only ever 'rejected' by a moderation take-down; 117 adds `series.decision_note` so the reason is stored and the show page's status card shows it ('Pulled by an admin: <reason>' + 'Email us'); an admin's Restore reopens it. Existing rejected rows (no reason stored) get the card 'An admin declined this show. Fix what it needs and press Resubmit' → status pending; its first approved episode brings it live. Episodes cannot be filed into a rejected, held or deletion-requested show (the pickers grey them with the reason).
   Why: Terminal, reason-less, un-notified rejection is the gap; making the show follow its episodes removes the state rather than papering over it.
15. **Should a show be transferable or co-owned?** Transfer stays an admin action, now an 'Owner' card on /admin/shows/<id> (the series-ownership route behind it, now notifying both accounts and invalidating the series cache); /admin/ownership redirects there (ADMIN_REDIRECTS); the OwnershipPanel's creator roster moves to /admin/shows?tab=creators. No co-owners, no re-crediting of episodes.
   Why: Co-ownership changes payouts (decision 4) and needs a Terms answer; transfer already exists and only needed a home. *(Jose confirms.)*
16. **Which show and episode fields apply at once and which stay staged for a live title?** One table, `FIELD_POLICY` in lib/showRules.js, `fieldPolicy(field, { role, status }) → 'direct' | 'staged' | 'locked'`. Admin: always direct. Pending / draft / rejected title or show: everything direct (the row is still in review; edit-submission's `.eq('status','pending')` WHERE stays). LIVE episode, creator: staged = title (pending_title), poster/thumbnail (pending_poster/thumbnail), title image, trailer, video (pending_src); direct = description, genre, mainGenre, artist, year, runtime, funding link, ad breaks, channel opt-in, captions, has_page, page_notes, season, number, show (own shows, buyers guard), extras' anchor; locked = tier, rating, Tapa Original, hero eligibility ('Ask us to change who can watch'). LIVE show, owner: staged = name, poster, thumbnail, hero image, title image, trailer (pending_*); direct = description, year, funding link, channel opt-in, season labels, defaults (future episodes only). Every staged value is returned by the API beside the live one and the owner can Cancel it (clears pending_*, orphans the staged file); a new staged value replaces the old one with a notice.
   Why: The staged pattern protects what appears on cards across the site and already works; the complaints were invisibility and no cancel, not the staging itself. No `pending_fields` jsonb: a second staging mechanism beside the pending_* columns was the lens-3 risk, and with tier/rating locked nothing else needs staging. Jose to confirm that a live show's or episode's description may change without review. *(Jose confirms.)*
17. **How does 'Add several' work without a second upload path?** Up to 30 files per drop (said on the zone). Each file becomes a 116 draft at once through `POST /api/show/<id>/episodes` (form prefilled from the show's defaults, season = the section it was dropped on, seriesOrder = next free in file-name order, title from `titleFromFilename`, season/number read from `parseEpisodeCode` 'S01E03' / 'Ep 3' / '1x03' when present, runtime from `readVideoMetadata`). Uploads go through `UploadContext.startVideoUpload` strictly one at a time: the page keeps its own queue of Files and starts the next when `done` settles; rows read 'Queued' until their turn, then 'Uploading 41%'. A closed tab stops the queue; each draft keeps its tus `upload_url`, so re-picking the same files resumes each one ('Keep this tab open until the uploads finish' banner; 'Pick the same file to resume' on a stopped row). `listDrafts` cap rises from 20 to 100 and takes `seriesId`. 'Send N for review' (season header or show-level) posts `POST /api/show/<id>/send { draftIds }` once; the server runs the submit-episode core (`submitDraft` in lib/showPage.js, shared with submit-episode) per draft inside one request, validating every slot and uid first, answering `{ created, skipped: [{ draftId, reason }] }`. The three-step /creator/submit stays for a single title and for people who start from a file.
   Why: Lens 1 and 2 need the 40-episode podcast to be two drops and one Send; lens 3 forbids changing the one-upload rule or minting 30 addresses in one call. A client-side queue over the existing uploader gives both; the app does the same over tusUpload's one-at-a-time rule.

### Screens

#### Creator Studio hub — Your shows strip

- Route: /creator (web) · /creator (app)
- Who: Creators and admins (existing gate)
- Platform: web + app
- Replaces: the 'Series management' link in .cs-links; /creator/series (308 → /creator, or → /creator/show/<id> when ?series= is in the query)

Phone:

- Head 'Your titles, in one place.' (as built)
- Submit a title button + type pills (as built)
- NEW section head 'Your shows' + quiet count
- Horizontal strip of .cs-show-card cards 132px wide: 2:3 poster (or dashed slot), name (2 lines), kind chip Series | Podcast, status chip Live / Not public yet / In review / Pulled / Removal requested, count line 'S1 · 4 episodes · 2 in review', a clock glyph when a staged change waits
- Last card: dashed '+ New show' → /creator/show/new
- Drafts pile (as built; a row whose form.seriesId is set reads 'in <show>' and its row link is 'Open show')
- In review / Needs you / Live piles (as built; a row in a show reads 'Night Bus · S1 E3 · title' and links to /creator/show/<seriesId>#ep-<id>; an approved episode of a still-pending show sits in Needs you as 'Waiting on the show', never in Live)
- Links row: Your work, Your numbers, Money, Pitch Room ('Series management' removed)

Laptop: The strip becomes a grid of up to 4 cards across above the three piles; 'All N shows' link when more.

States:

- no shows: one dashed card 'Start a show — a series or a podcast gets its own page'
- loading: 3 skeleton cards
- strip fetch error: the strip hides, the piles still render
- pending show: 'Not public yet' chip; rejected (legacy): 'Not this time' in warn colour

Notes: Data from GET /api/show?mine=1 (summaries). Hub piles read the show's status from the payload (seriesStatus on my-submissions) so 'Live' never names an invisible episode. needsYou() moves to lib/showRules.js and is the one definition for the hub, Your work and the app.

#### New show

- Route: /creator/show/new (web) · /creator/show/new (app)
- Who: Creators and admins
- Platform: web + app
- Replaces: SeriesMediaForm 'new' mode on /creator/series; components/AddSeriesForm.js (caller-less)

Phone:

- Back pill 'Creator Studio' (AccountShell-style .acct-back with BackArrowIcon)
- Eyebrow 'NEW SHOW' · H1 'Start a show' · lede 'Name it now; episodes come next. It goes public with its first approved episode.'
- One .apl-card: Name (≤120, required)
- Kind pills: Series | Podcast (showNoun words; locked once an episode exists; no Vertical pill)
- One line about it (≤2,000) + help 'You can write more later'
- <details open> 'Defaults for its episodes' (apl-grid2): Genre (MAIN_GENRES pills), Rating (RatingOptions), Who can watch (Free with ads | Tapa +), Made by (prefilled with the display name), 'Ads between scenes' switch
- Art: Poster 2:3 + Still 16:9 slots (.apl-art-slot), or the ticked 'Cut them from the first episode for me'
- Primary 'Create the show' → POST /api/show → /creator/show/<id> with a flash 'Night Bus is ready. Drop its episodes.'
- Link 'Have the first episode ready? Start from the file instead' → /creator/submit?type=series

Laptop: The same 640px .apl stage centred; the two art slots side by side; the defaults fold open inline.

States:

- blocked line under the button until a name is typed (stepBlocker style)
- saving
- server validation line (plainStatus 400)
- rate limited: 10/h per account (the create-series key)

Notes: Creates the row pending with creator_id = me, submitted_by (email) + submitted_by_user_id, kind, defaults, channel_opt_in false, through insertCompat. The three-step submit's inline '+ New show' box stays for people who start from a file and now goes through the same createShow() AFTER every other validation passes (no orphan show on a 400; no channel tick copied from the episode); its success screen offers 'Open the show page'.

#### Show page (the control room, creator mode)

- Route: /creator/show/[id] (web) · /creator/show/[id] (app)
- Who: The show's owner (series.creator_id) or an admin (who is sent to /admin/shows/<id>); a creator who only uploaded episodes into someone else's show sees it read-only with their own rows actionable
- Platform: web + app
- Replaces: /creator/series (SeriesMediaForm, NameDescPanel, ArtPills, DeleteRequestModal for series); the show-level gear menu on /creator/my-work (Edit show details / Sell / Add bonus); EditSubmissionModal's show/season/number fields and the '__new__' option

Phone:

- HeaderNav (Connect side, hamburger only like the creator tool pages)
- Back pill 'Creator Studio'
- Show card (.show-card): 2:3 poster 96px (tap → Edit show, art tab), name (Fraunces) or title image, kind chip Series | Podcast, status chip, count line 'S2 · 9 episodes · 3 in review', description (2 lines), buttons 'Edit show' · 'View page' (live) / 'Preview · not public yet' (pending → /series/<id>?preview=1); staged chips under the name when pending_* is set: 'New name waiting · Cancel', 'New poster waiting · Cancel'
- Status card (.apl-status level review|ok|warn|neutral): headline ('Live' / 'Not public yet — your first episode is in review' / 'Not public yet — add your first episode' / 'Pulled by an admin: <reason>' / 'Removal requested on <date>') then problem lines from showProblems(), each linking to its row: 'E2 is missing in Season 1', '2 episodes share E4 in Season 2 — pick one', '1 episode has no number', 'Episode 5's file failed — replace it', '3 live episodes have no captions', 'Trailer still processing', 'Changes reach visitors within a few minutes'
- Add bar: '+ Add episode' (primary) · '+ Add several' · 'Paste a link' (podcast: 'Paste an MP3 link'); a drop zone opens at the bottom of the chosen season (default: the last season); under it, while uploads run, one compact .apl-progress row per file (name, %, speed, ETA, 'Queued', 'Pick the same file to resume') and the banner 'Keep this tab open until the uploads finish'
- Season section (.show-season), one per season: header 'Season 1' (+ ' · <label>'), 'n episodes', 'Send N for review' when drafts are ready, kebab (Rename season, Add a season above / below, Renumber from 1…, Move all to…); rows (.show-row): ↑/↓ (phone) or the grip ⋮⋮ (pointer), E-badge 'E4' (tap → inline number input; a taken number shows 'E4 is Cold Open — Swap | Insert here'), 16:9 thumb 88×50 (own still, else the show's still, never Cloudflare's frame), title (2 lines, placeholder 'Episode 4'), status pill Draft / Queued / Uploading 41% / Processing / In review / Live / Not this time / Pulled / Pending deletion, meta line ('22 min', 'Needs captions', 'Art waiting for approval', 'uploaded by <name>'); row tap → the episode editor; row kebab: Edit, Move to…, Give it its own page / Use the player only, Replace file, Captions, View page (live), Remove…
- Gap row (.show-row.gap, dashed): 'E2 is missing — add here or renumber'
- '+ Add season' dashed block (appends the next number; nothing is written until an episode lands there)
- Extras section: 16:9 cards of bonus clips with 'With the show' / 'After S1 E3' tag, '+ Add extra' (→ /creator/submit?type=bonus&series=<id>), kebab Edit · Place after… · Remove…
- Sell card (live shows only): series price state pill (none / in review / on / off) + 'Sell the whole series' / 'Price and sales' → SellTitleModal (series target)
- Channels row: 'Let channels air the whole show' switch (.chan-optin, direct)
- Quiet line 'Remove this show…' → the removal card (reason + cascadePlan words) / 'Removal requested on <date> · Cancel'

Laptop: From 1024px the stage is 1080px in two columns: left 360px sticky (Show card, Status card, Sell card, Channels, Remove line), right 696px (Add bar, Seasons, Extras). The episode editor opens as a 420px panel sliding in from the right over the stage (the route still changes, shallow). Drag by the grip: Pointer Events following ScheduleTimeline's startDrag state machine (4px click threshold, body.show-dragging, a ghost row, a drop line between rows, season headers glow as drop targets via data-season + data-droppable, auto-scroll near the edges, elementFromPoint drop detection); Alt-drop onto a row = swap. Every drop shows the planMove toast ('E7 → E3; E3–E6 become E4–E7 · Undo', 8 s) and posts once.

States:

- pending show, no episodes: the status card says 'Add your first episode'; one empty Season 1 with the drop zone open
- pending show with drafts / in review rows
- live show (rows mixed Live / In review / Draft)
- pulled (moderation_hold): red status card with the reason; writes disabled except captions and page notes
- removal requested: grey status card, writes disabled, Cancel request
- rejected (legacy rows): card 'An admin declined this show' + Resubmit
- read-only (contributor, not owner): no Edit show, no handles on others' rows; own rows keep Edit / Replace / Captions; note 'Only <owner> can change the show'
- dragging (laptop): ghost row, drop line, season heads glowing
- reorder refused (409): the server's line, rows revert
- behind on migration 117: renders from the legacy select (no defaults, no season labels); ↑/↓ and the grip disabled with 'Reordering needs a database update (migration 117)'; Add several refused with the same line until the unique index exists

Notes: Payload = GET /api/show/<id> (lib/showPage.js getShowPage). Rows are sorted by the one sortEpisodes. Drafts (creator_drafts with form.seriesId = this show) appear in their season as 'Draft' rows. CSS block .show-* next to .cs-*; the grip is .show-grip (never cl-*). The page says 'Changes reach visitors within a few minutes' rather than pretending otherwise (45 s catalogue + 300 s CDN).

#### Episode editor (a route, drawn as a panel on a laptop)

- Route: /creator/show/[id]/episode/[episodeId] (web; also #ep-<id> deep links from the hub) · /creator/show/[id]/episode/[episodeId] (app)
- Who: The episode's uploader (submitted_by) for everything; the show owner for Place and Extras only; admins (every field direct) at /admin/shows/[id]/episode/[episodeId]
- Platform: web + app
- Replaces: the seven creator modals' entry points for show episodes on /creator/my-work; the app's episode action sheet's edit rows

Phone:

- Back pill '<Show name>' (→ the show page, row highlighted)
- Eyebrow 'NIGHT BUS · S1 E3' + status pill (Draft / In review / Live / Not this time / Pulled / Pending deletion) · title
- Banner when relevant: 'Changes awaiting review: title, poster · since <date> · Cancel' (one Cancel per field) / 'Not this time: <admin's note>' + 'Send again for review' / 'Pulled: <reason>' / 'Removal requested · Cancel'
- Tabs (.show-tabs, sticky): Basics · More info · Place
- BASICS — The file card (MediaProgress-style): state from videoStateLine, runtime, size, resolution; 'Replace the file' drop (startVideoUpload kind 'main', resume on re-pick); on a live title the card first says 'The new file goes to an admin; the current one keeps playing until then' (pending_src); on a pending row 'The old file will no longer be used'
- BASICS — Season stepper · Number stepper (next free hinted; a taken number shows 'E4 is Cold Open — Swap | Insert here')
- BASICS — Title (placeholder 'Episode 4') · One line about it (≤300)
- MORE INFO — About it (≤4,000) · Still 16:9 + Poster 2:3 slots ('Using the show's art' until set; 'Cut from the film' button) · Title image (PNG, Remove)
- MORE INFO — 'Same as the show' chips for Genre · Rating · Who can watch · Made by · Year (tap opens the field; a set value shows 'Differs from the show · Reset'); on a LIVE title Who can watch and Rating render locked with 'Ask us to change who can watch'
- MORE INFO — Captions (web: SRT/VTT + language + label + Remove, immediate; app: 'Add captions on the website' link)
- MORE INFO — Trailer slot (startVideoUpload kind 'trailer', plays signed in the preview) · Funding link
- MORE INFO — 'Give this episode its own page' switch + explanation ('People can open a page with notes, credits and the trailer; otherwise it plays straight from the show'); when on: Notes (≤4,000, blank lines = paragraphs) + 'Preview page'
- MORE INFO — Extras attached to this episode (list + '+ Add extra')
- MORE INFO — <details> More options: Ad breaks, Let channels air it, Hero eligibility (request; admin-only on live), Tapa Original (admin-only)
- PLACE — Season picker · Number · 'Move to another show' picker (own shows of the same kind, status-labelled; rejected / removal-requested / vertical greyed with the reason; a show with buyers greyed 'has buyers — ask us'); 'Make it an extra' link (bonus clip: 'Attached to' picker instead)
- PLACE — 'Remove this episode…' (reason; copy depends on status: 'hidden from the site right away' only when live) / 'Cancel removal'
- Sticky footer: Save ('Saved' toast for direct fields; 'Save · 2 changes go to review' listing staged ones), 'Send for review' for a ready draft, 'View page' for a live title, status line ('In review since <date>' / 'Live since <date>')

Laptop: A 420px right panel over the show page (the row highlighted behind it); the three tabs become stacked sections with the footer pinned to the panel's bottom. Admin variant adds a Status card at the top (pending/approved/rejected + reason, Featured, Discover curated for vertical, Cloudflare uid swap with Check and the 'no video attached' double-confirm) and every field saves directly with an audit row; 'Open in Library modal' stays for the long tail (ad plan, availability dates).

States:

- draft: everything direct; Send for review enabled once the master is ready
- in review: everything direct into the live columns (edit-submission's rule, enforced in the WHERE); the admin page shows 'edited 2 min ago' on the row
- live: fieldPolicy applies; staged fields carry a clock glyph in their label and show the waiting value with Cancel
- not this time: the note + 'Send again for review'
- pulled: read-only with the reason except captions and notes
- pending deletion: read-only + Cancel request
- standalone title (no show): the Place tab offers 'Make this part of a show' (own shows, same kind) while pending or for an admin

Notes: Saves go to PATCH /api/show/episode/<id> (one route for creator and admin, policy-driven); the video to POST /api/show/episode/<id>/video; captions stay on add-captions (4 MB body). The old modals (EditSubmissionModal, RequestEditModal, ArtworkModal, ReplaceVideoModal, CaptionUploadModal, DeleteRequestModal for episodes) are no longer opened from Your work for show episodes; they stay in the tree for standalone titles until the next pass.

#### Move to… picker (sheet)

- Route: inside the show page and the episode editor (web: a small sheet; app: a bottom-sheet Modal)
- Who: Owner, uploader, admin
- Platform: web + app

Phone:

- Title 'Move E3 · Cold Open'
- Season chips of this show (+ 'New season N')
- Slot: 'End of season (E9)' default, or a number input with the live conflict line ('E4 is taken — Swap | Insert here')
- 'Another show' list: the viewer's shows of the same kind, status-labelled; greyed with the reason: '(removal requested)', '(not this time)', '(has buyers — ask us)', '(vertical — studio only)'; admin: every show, with 'Earnings stay with <uploader>' and 'N series buyers gain/lose this episode' lines when they apply
- Preview line from planMove: 'E3 → S2 E1; S1 E4–E7 keep their numbers'
- Buttons: Move · Cancel

Laptop: The same as a popover anchored to the row.

States:

- refused (409 ownership / buyers / kind mismatch): the line, nothing moves
- behind on 117: 'Moving needs a database update (migration 117)'

Notes: POST /api/show/<id>/move; the channel engine's bookmark falls back to episode 1 when the bookmarked episode leaves a show (indexOfEpisode) — the sheet says so when the show is on a channel.

#### Your work (grouped list) — show groups become links

- Route: /creator/my-work (web) · /account/my-work (app)
- Who: Creators and admins
- Platform: web + app
- Replaces: the show-level gear menu; the seven modals as the way to edit a show episode

Phone:

- Head, stats strip (labels In review / Live), search, pills, Needs attention toggle (as built; Needs attention = the hub's needsYou())
- Show group header: name, kind tag, count, 'Open show page →' (the gear menu is gone)
- Season sub-heading when more than one season
- Rows sorted by sortEpisodes, 'S1 E3' code before the title, status pill, flags (incl. 'Title change waiting' when pending_title is set, 'New video waiting' when pending_src is set, 'Pulled: <reason>'); the pencil opens the episode editor; the gear keeps View page / Copy link / Sell
- Bonus clips listed under their show as 'Extras' (web and app)
- Standalone groups unchanged

Laptop: Unchanged layout.

States:

- ?status=pending|approved|rejected and ?attention=1 honoured on web AND app (the app reads useLocalSearchParams at last)

Notes: my-submissions adds pendingTitle/pendingDescription, pendingSrc, titleImageUrl, discoverCurated, hasVideo/hasAudio, holdReason, seriesKind, seriesStatus and sorts rows within a show; its Cloudflare status calls are memoised 60 s per uid. Public links in the app use the www host.

#### Submit a title — the show block on step 2 (updated)

- Route: /creator/submit (web) · /creator/submit (app)
- Who: Creators and admins
- Platform: web + app

Phone:

- Show select: the creator's shows of this type's kind (series type → kind series, podcast → podcast), each '(in review)' / '(removal requested — can't add)' / '(not this time — fix it first)' (disabled when greyed); '+ New show' inline box as built
- Season chips (1..S+1) · Episode number with the 'E4 · next free' chip and the live conflict line from GET /api/show/<id>/positions ('E3 is taken by Pilot — Use E4 | Swap')
- ?series=&season=&number= prefill all three (the show page's '+ Add episode' link passes them)

Laptop: Unchanged.

States:

- no shows yet: the picker is just '+ New show'
- conflict: Submit blocked until resolved (the server answers 409 with the candidates too)

Notes: submit-episode: the inline show is created last (rolled back on failure), seriesOrder blank → next free (never 1), '__new__' refused 400 'Name the new show', a show that is rejected / held / removal-requested / another kind refused, defaults copied from the show onto the row, a 23505 from the unique index retried once with the next free number.

#### Admin — Shows list

- Route: /admin/shows
- Who: Full admins; sub-admins with manage_episodes or review_submissions (ADMIN_NAV Content group entry 'Shows', badge 'shows' = episodes in review + staged changes + removal requests across shows)
- Platform: web
- Replaces: ADMIN_NAV 'Series ownership' (ADMIN_REDIRECTS /admin/ownership → /admin/shows); the series rows of the Library's pending cards (which now link here)

Phone:

- AdminShell crumbs 'Admin / Shows'
- Search (name, owner email)
- Filter chips with counts: All · Live · Waiting on a first episode · Has items in review · Staged changes · Pulled · Removal requested · Podcasts · Problems
- Rows (.adm-card): 48px poster, name, kind tag, owner (name + email via listCreatorsAndAdmins batch, '(no owner)' when creator_id is null), 'S2 · 9 episodes', badges '2 in review' / 'art waiting' / 'new video waiting' / 'removal requested' / 'E4 twice' / 'no art' / 'empty', → /admin/shows/<id>
- '+ Create a show for a creator' (owner email, name, kind, defaults; inserted pending with submitted_by = the admin, creator_id = the owner; 'Live now' tick needs review_submissions)
- Tab 'Creators' = the old OwnershipPanel roster

Laptop: The same list in the admin main column; filters in one row.

States:

- empty filter
- loading
- 403 per capability
- behind on 117: kind and badges derived from episodes only

Notes: GET /api/admin/shows. manual-episode's newSeriesName goes through the same createShow() and comes out pending unless 'Live now' is ticked.

#### Admin — Show page (ShowControlRoom in admin mode + Decisions rail)

- Route: /admin/shows/[id]
- Who: Full admins; sub-admins act per capability: review_submissions (episode decisions on a live show), manage_episodes (edit, move, numbering), manage_artwork (staged art), manage_deletions (cascade confirm), handle_flags (hold / take down); the page renders every control and disables what the viewer lacks with 'Needs <cap>' / 'A full admin approves a new show'
- Platform: web
- Replaces: nothing deleted; Library & queues keeps the flat list and the modal; the Series chip leaves the review queue; /admin/ownership redirects here

Phone:

- AdminShell crumbs 'Admin / Shows / <name>'
- Show card (as the creator sees it) + facts the creator does not: owner name · email · account age · other titles, buyers (series N · episodes M), channel slots using the show, open moderation reports, the Cloudflare state of every master and trailer
- Owner card: email field + Save (series-ownership logic, audited, notifies both accounts), 'Grant creator role' when the owner lacks it, link to /admin/accounts?user=
- Status card: the creator's problem lines + 'Fix numbering' (renumbers the flagged season 1..n in sorted order, audited show_numbering_fixed, notifies the owner) + 'Approve the show now' for a legacy pending show that already has live-ready episodes
- Decisions card: 'Approve all in review (N)' (disabled with the count when any master is not ready or any slot is taken/unnumbered: '3 of 12 still processing', 'E4 taken — fix first'), Who can watch select for the batch, 'Reject all… (one reason)'; Who can watch (show default), Tapa Original, Hero eligible, Hold… (FLAG_REASONS + note → moderation_hold through lib/moderation.js), Take down… (note required → status rejected + hold, decision_note stored), Restore, 'Tell savers' (notifySeriesDrop, deduped)
- Staged changes card: one row per pending_* on the show and its episodes — text as Current → Proposed, art as two thumbnails side by side, a trailer or new video as two players — ✓ Approve / ✕ Deny with an optional note (the note travels in show_edit_denied / artwork_denied), 'Approve all'
- Season sections: everything the creator has plus inline Approve / Reject… (reason) on 'In review' rows (decideReviewItem, 409 on a stale row; refused on a taken slot with 'Fix number' inline input and 'Approve as E7?' = the next free), per-row Who can watch select, 'edited 2 min ago' on rows the creator saved while in review, 'Open in Library modal' (AdminEditEpisodeModal for the long tail), Ad plan link for live rows; Move to… lists every show with the earnings and buyers lines
- Extras section: same plus re-anchor
- Removal card (when requested or on 'Remove…'): the creator's reason, cascadePlan ('9 episodes · 2 extras · 1 with buyers (kept for them) · channel slots: 1 · outside references kept by title'), type the show's name → 'Remove the show' (deleteShowCascade) · 'Deny — restore it'
- History: audit_log rows for target series:<id> and its episodes, newest first

Laptop: Left 360px sticky (Show card + facts, Owner, Status, Decisions, Staged changes), right (Seasons with drag, Extras, Removal, History).

States:

- pending show with nothing to approve (drafts only)
- pending show with a first episode ready: 'Approve all in review (N) · brings Night Bus live' (full admin; a sub-admin sees it disabled with the line)
- live
- pulled
- removal requested
- legacy vertical show: read-only except numbering
- stale decision (409): the line, the card refreshes
- behind on 117: order writes fall back to the two-phase sequential write; a note says so

Notes: POST /api/admin/show/<id> { action } gated per action. 'Approve all' validates every row first (series_id, season, series_order present, slot unique, master ready) and refuses the whole batch with the list when anything fails; then runs decideReviewItem per row (same guards), flips a pending show live on the first success, sends ONE owner notification ('Night Bus: 12 episodes are live' / 'Night Bus is live'), ONE audit line (approve_show_pending · 12), invalidates both caches once. Savers are told by the cron, not here.

#### Review queue — submission item with its show (web list, dashboard compact queue, app deck)

- Route: /admin/review · /admin (compact) · app /admin/review?kind=submission
- Who: review_submissions and full admins
- Platform: web + app
- Replaces: the bare 'New series · <email>' card; the app deck's 'Check artwork on the web' card for shows

Phone:

- Row subtitle: 'Night Bus · S1 E4 · 22 min · Mara Quinn' (creator name resolved, not the id); eyebrow 'NEW SHOW' when the show is pending
- Consecutive items of the same show are drawn under one show header in the list (client-side grouping by meta.show.id, the items stay flat): poster, name, 'S1 E1–E12 · 12 in review', 'Open show page →'
- Open: the signed master (iframe / video), then the .rq-show sub-card (56px poster, 'NEW SHOW' or 'SHOW · LIVE', name, kind, owner name + account age, description, defaults line, 'N more episodes waiting'), the slot line ('S1 E4 · slot free ✓' or 'E4 is taken by The Fall — fix on the show page'), the key/values
- Approve = 'Approve · brings Night Bus live' when isNew (full admin; a sub-admin sees it disabled with 'A full admin approves a new show'), with the Who-can-watch select (writes the show's default tier for a first episode); Reject… with the reason
- Approve refused (409) on a taken slot, a missing number or an unready master ('Not yet')

Laptop: Unchanged .rq-row list with the group header and the sub-card in .rq-detail.

States:

- show live (plain sub-card)
- show pending ('NEW SHOW', approve wording)
- show pulled (red eyebrow; Approve disabled: 'Restore the show first')
- slot taken / unready (Approve disabled with the line)

Notes: item.meta.show = { id, name, kind, status, isNew, poster, ownerName, ownerAccountAgeDays, waitingCount, href }, item.meta.position = 'S1 E4', item.meta.slot = 'free' | 'taken by …', item.meta.masterReady (Cloudflare state memoised 60 s per uid). The 'series' kind produces no items (decideReviewItem keeps the branch one release for a stale app bundle).

#### Public series page (updated)

- Route: /series/[id] (?season=N, ?preview=1) · podcast kind → 302 /podcasts/<id>
- Who: Anyone; preview for the owner and admins
- Platform: web + app

Phone:

- Preview bar (.welcome-bar style) for owner/admin while not live: 'Only you can see this — it goes public with the first approved episode' + 'Open show page'
- SeriesHero (56%): kicker 'Series' (+ Tapa Original), title / title image, description, showRollup tier pill ('Tapa +' / 'Free with ads' / 'Tapa + · pilot free'), rollup rating box, 'N seasons · M episodes', 'Made by <rollup>', year when set, seal; background = SIGNED trailer (refreshSrc through stream-token part 'trailer'), else hero image on hls error
- Play (resume-aware) + Save this series (as built)
- Back pill, BoughtBanner, 'You own this series', BundleCard (owned episodes named 'S1 E3')
- Tabs Episodes · Extras (renamed from Bonus) · About
- Season tabs read and write ?season= (router.replace), with the season label from series.seasons ('Season 2 · The Return')
- Episode rows: 'S1 E3', own still when present, title, 2-line description, runtime, BuyChip/OwnedChip; tap = play (?autoplay=1); a 'Details' chevron when has_page → /episode/<id>
- Extras tab: cards grouped 'With the show' / 'After S1 E3'
- About: genre, rating, Made by, year, Crew needed, Crew, Shot at (web AND app)

Laptop: Unchanged skeleton.

States:

- live
- preview (owner/admin, any status, noindex)
- podcast → redirect
- 404 for strangers while pending

Notes: /api/series-hub adds isSubscriber, isAdmin, isOwner, kind, rollup, seasonLabels, crew, shotAt, crewCalls, preview, signed trailerSrc, hasPage per row; og:title/og:image/og:description from the show's art. The app's hub keeps its image hero (no trailer video) and now draws locks only for a non-member.

#### Public episode page (updated)

- Route: /episode/[id] (?autoplay=1, ?preview=1)
- Who: Anyone past the gates; owner/admin preview on a pending show
- Platform: web + app

Phone:

- has_page off (default for a show's episodes): the after-Play page exactly as built — 16:9 player strip, .ep-head kicker 'NIGHT BUS · SEASON 1 · EPISODE 2' → /series/<id>?season=1, title (defaults to 'Episode N'), meta, four round actions, Up next, description (falls back to the show's), credits line, Accessibility, the season strip ('See all' → /series/<id>?season=<n>), Extras anchored to this episode, the end card
- has_page on, no ?autoplay: the landing view — HeroSpotlight art or signed trailer, kicker, title, meta, the notes as paragraphs (.ep-notes), Made by + seal, crew / Shot at, Play / Continue, OwnTitleCard, the season strip; Play switches to the player in place (router.replace ?autoplay=1)
- Preview bar for owner/admin on a pending show (playbackGate already lets them through)

Laptop: Unchanged two-column after-Play layout; the landing view is the standalone title's layout.

States:

- playing
- landing (has_page)
- locked (unchanged)
- preview

Notes: nextEpisode/previousEpisode/the strip use the one sortEpisodes; <title> = 'S1 E3 · Title — Night Bus'; og:image = still, else the show's poster; trailerSrc signed, the Trailer action hidden when null. Thin-episode fallbacks (title, description, genre, rating, tier, artist, year) come from the show's defaults in rowToEpisode/rowToPublicEpisode.

#### App — New show, Show page, Episode editor

- Route: mobile/src/app/creator/show/new.js · creator/show/[id].js · creator/show/[id]/episode/[episodeId].js
- Who: Owner or admin
- Platform: app

Phone:

- AccountFrame (TopNav, Back pill → /creator, title = show name)
- Show card (CreatorBits kit), Status card (StatusCard levels), Add bar: 'Add an episode' (pickVideo), 'Add several' (pickVideo with allowsMultipleSelection + selectionLimit 30 → one draft per asset through POST /api/show/<id>/episodes as each upload is minted; the screen's own queue feeds mobile/src/lib/tusUpload.js one at a time; rows 'Queued' until their turn; 'Keep the app open until the uploads finish' StatusCard), 'Paste a link'
- Season sections with ↑/↓ on every row and the E-badge stepper (no drag), 'Send N for review'; row kebab opens the bottom-sheet Modal (my-work.js's sheet pattern): Edit, Move to…, Its own page on/off, Replace file, View, Remove
- Move to… = a second sheet (season chips, slot input, Another show list with the greyed reasons)
- Extras, Sell (SellTitleSheet series), Channels Switch, 'Remove this show…' with the cascade words
- Episode editor screen: the same three tabs with Field/Input/Chips/Switch; art via pickImageAsDataUrl (saves at once, the app's habit); trailer via startTusUpload kind 'trailer'; captions row 'Add captions on the website'; SaveRow from AccountBits listing what goes to review

Laptop: n/a

States:

- same as web; behind on 117 → ↑/↓ disabled with the migration line; the drafts footer says 'The server is being updated' on a 503 instead of blaming the connection

Notes: _layout.js headerShown:false for the three screens; PushListener routes /creator/show/<id> and /creator/show/<id>/episode/<id> (and opens the site for /admin/shows/<id>); TopNav/BottomNav rows unchanged ('Creator Studio' is the entry). mobile/src/lib/showRules.js mirrors lib/showRules.js word for word. Verified with expo export, not a device.

#### App — admin deck (submission card with its show)

- Route: mobile/src/app/admin/review.js
- Who: Admins and sub-admins
- Platform: app

Phone:

- Submission card: subtitle 'Night Bus · S1 E4 · Mara', the New show block (poster, name, kind, owner, 'Approving this brings the show live') when meta.show.isNew, the slot line
- Approve (Free / Tapa + chips) — disabled with the line for a sub-admin on a first episode, or on a taken slot / unready master; Reject… with reason
- The 'series' kind's 'Check artwork on the web' card is gone; admin/index.js lists 'Shows' under 'On the web' → /admin/shows

Laptop: n/a

States:

- single episode of a live show
- first episode of a new show
- blocked (slot / master / capability)

Notes: The admin list and the admin show page stay web-only this round.

### The creator's path

1. 1. Start a show — /creator → 'Your shows' strip → '+ New show' → /creator/show/new: name, Series | Podcast, one line, defaults (genre, rating, who can watch, Made by, ads), poster + still or 'cut from the first episode', Create. The row is pending, visible only to you; the show page opens with 'Add your first episode'. (People who start from a file keep the three-step submit's inline '+ New show'; it lands on the same page.)
2. 2. Add one episode — on the show page, '+ Add episode' opens a drop zone at the bottom of the chosen season; the file starts uploading the second it is dropped (UploadContext.startVideoUpload through /api/creator/get-upload-url) and a draft is written at once (POST /api/show/<id>/episodes with seriesId, season, seriesOrder = next free, title = file name, runtime read in the browser), so the row appears immediately as 'Draft · uploading 12%'. Nothing else is required: title, description, art, genre, rating and tier inherit from the show. 'Pick the same file to resume' when it stops.
3. 3. Add several — '+ Add several' takes up to 30 files: N drafts, numbered next-free in file-name order (S01E03 / Ep 3 / 1x03 in a name sets season/number), queued through the one uploader one after another ('Queued' → 'Uploading' → 'Processing' → 'Ready'); 'Sort by filename / date' reorders them before numbering; the banner says to keep the tab open and that re-picking the same files resumes. Titles edit inline on the rows.
4. 4. Send for review — a ready draft row shows 'Send for review'; the season header (or the show) shows 'Send N for review' when several are ready. One POST /api/show/<id>/send { draftIds } validates every slot and uid first and turns the drafts into pending episodes (the drafts are deleted keeping their media); rows flip to 'In review'; the status card reads 'Not public yet — your first episode is in review'. The one attestation sentence (ATTESTATION) is ticked once per send batch.
5. 5. See it as seasons — each season is a section with its own header (label, count, kebab), rows in running order with E-badge, thumb, title, status pill and meta; a dashed gap row where a number is missing; the status card lists what is in the way (numbering, failed masters, missing captions, staged changes, the show's own state).
6. 6. It goes live — an admin approves the first episode; the show flips live in the same write; you get 'Night Bus is live' (bell + push + email); 'View page' replaces 'Preview'; the hub's strip shows 'Live · S1 · 12 episodes'. Later approvals of a batch send ONE notice ('12 episodes of Night Bus are live').
7. 7. Edit an episode — tap a row → the episode editor (a route; a right panel on a laptop, a page on a phone): Basics (file, season, number, title, one line), More info (about, own still/poster, 'Same as the show' chips, captions, trailer, funding link, 'Give this episode its own page' + notes, extras, folded options), Place (season, number, move to another show, remove). Direct fields save at once ('Saved'); on a live title the title, art, trailer and a replaced video wait for approval and show 'Changes awaiting review · Cancel'; who can watch and the rating are locked on a live title ('Ask us'). A 'Not this time' title shows the note and 'Send again for review'.
8. 8. Reorder and move — laptop: drag the grip or ↑/↓ (Alt+↑/↓ on the keyboard); phone and app: ↑/↓ and the row's 'Move to…' sheet. Every change is one request; the toast says exactly which numbers changed ('E7 → E3; E3–E6 become E4–E7 · Undo') and nothing else moves; gaps stay unless you press 'Renumber from 1'. Typing a taken number offers 'Swap with E3' or 'Insert here'. Dropping onto another season's header moves the episode there; 'Move to another show' lists your shows of the same kind (a show with buyers is greyed 'ask us'). Live titles stay live; visitors see the new order within a few minutes.
9. 9. Edit the show itself — Show card → Edit show: name (staged when live), description, year, funding link, defaults for future episodes, season labels, channels switch; Art tab: poster, still, hero, title image, trailer (uploads through the same uploader, plays signed in the preview) — each slot shows the live file and, when one waits, the staged one with Cancel. 'Preview page' opens /series/<id>?preview=1 while pending. 'Sell the whole series' when live.
10. 10. Extras — '+ Add extra' (the submit page with type=bonus&series=<id>); each extra shows 'With the show' / 'After S1 E3' with 'Place after…' and ↑/↓; the public page lists it under that episode and in the Extras tab.
11. 11. Remove the show — 'Remove this show…' shows the cascade words ('Night Bus, its 6 episodes and 2 extras · 2 titles have buyers and will be kept for them') and takes a reason; everything hides at once; 'Removal requested on <date> · Cancel' until an admin confirms; you get show_deleted or show_deletion_denied.
12. 12. Be told — show_live, show_pulled (with the reason), show_edit_approved / show_edit_denied (with the admin's note), show_video_approved / denied, show_deleted / show_deletion_denied, episode_moved_by_admin ('An admin moved E3 to Season 2'), show_numbering_fixed, plus the existing episode_* types; every one carries href /creator/show/<id>(#ep-<id>) and reaches the app's PushListener.

### The admin's path

1. 1. A first episode arrives — /admin/review (web) or the deck (app): the submission row reads 'NEW SHOW · Night Bus · S1 E1 · 24 min · Mara Quinn'; items of the same show sit under one show header ('S1 E1–E12 · 12 in review · Open show page →'). Open shows the signed master and the New show sub-card (poster, name, kind, owner name + account age + other titles, description, defaults, '11 more episodes waiting'), the slot line and the key/values. A full admin picks Who can watch and presses 'Approve · brings Night Bus live': the episode goes live with released_at, the show flips approved in the same write, caches invalidate, the owner gets show_live + episode_approved, the queue fires taprino:admin-queue-changed. A sub-admin sees the button disabled with 'A full admin approves a new show'. Reject… keeps the show pending with the note on the episode. Approve is refused on a taken slot, a missing number or an unready master.
2. 2. Approve a whole show on a Sunday — 'Open show page →' lands on /admin/shows/<id>: the Decisions card's 'Approve all in review (12)' validates every row first (refusing with the list when '3 of 12 still processing' or 'E4 taken'), then runs the same guarded decision per row, flips a pending show live on the first success, sends ONE owner notification and writes ONE audit line; Who can watch applies to all; 'Reject all… (one reason)' likewise. Nine shows is nine clicks plus spot checks (Play ▸ on any row), not seventy.
3. 3. Fix numbering, art, details in place — the same seasons as the owner sees with drag / ↑↓ / Move to… (any show, with 'Earnings stay with <uploader>' and 'N series buyers gain/lose this episode' shown before the write; audited show_reorder / show_move; the uploader notified episode_moved_by_admin only when an admin did it), 'Fix numbering' for a flagged season (one click, audited, notifies), inline 'Fix number' on a pending row with 'Approve as E7?' = the next free; the episode editor in admin mode saves every field directly; the long tail (ad breaks, availability, discover_curated, Cloudflare swap with Check) stays in AdminEditEpisodeModal from the row's 'Open in Library modal' — that route now keeps podcasts in their show, accepts bonus + parents, labels the show picker by status and refuses a show that does not exist.
4. 4. Decide staged changes with context — the Staged changes card shows every pending_* on the show and its episodes as Current → Proposed (text), two thumbnails (art) or two players (trailer / new video), ✓ Approve / ✕ Deny with an optional note, 'Approve all'. Approve copies pending → live, orphans the losing file, runs syncStreamProtection (video), invalidates all_series_approved_v1 (the stale-cache gap), audits, notifies the owner through series.creator_id; Deny notifies with the note. Library & queues keeps the same cards for standalone titles.
5. 5. Hold, take down, restore — Decisions card: Hold… (FLAG_REASONS + note → moderation_hold through lib/moderation.js, which already tells the owner), Take down… (note required → status rejected + hold; the note stored in series.decision_note so the creator's status card shows it), Restore. The status card shows the hold reason.
6. 6. Remove a show — when the owner requested removal (or the admin presses Remove…), the Removal card shows the cascade summary (N episodes, M extras, K with buyers → withdrawn and kept for them, channel slots that drop, outside references kept by title) and asks for the show's name typed back; 'Remove the show' runs deleteShowCascade, orphans every file, invalidates both caches, audits confirm_series_deletion with the counts, notifies show_deleted. 'Deny — restore it' clears the request and notifies show_deletion_denied. The Library's pending-deletions card links here for shows instead of refusing.
7. 7. Ownership and hand entry — Owner card: email + Save (series-ownership route, audited, both accounts notified, cache invalidated), 'Grant creator role'. '+ Create a show for a creator' on /admin/shows inserts a pending, attributed show with defaults; manual-episode's newSeriesName goes through the same createShow() and is pending unless 'Live now' (review_submissions) is ticked — a manage_episodes sub-admin can no longer make a live show by accident.
8. 8. Tell savers and see the history — 'Tell savers' runs the deduped notifySeriesDrop for this show (the cron does it daily anyway); the History section lists audit_log rows for the show and its episodes, newest first — creator writes on this path (reorder, move, show edits) are audited too with adminId = the creator (details 'by the owner'), so the timeline is complete.

### An episode's own page

Every episode keeps its /episode/<id> URL and the after-Play page built on 2026-10-29 keeps its shape exactly: the 16:9 player strip under the header (signed master, 'Resumed from' toast, content advisory, the end card), .ep-head with the kicker 'NIGHT BUS · SEASON 1 · EPISODE 2' linking to /series/<id>?season=1, the title, the meta line ('22 min · genre · year', rating box, tier pill, Tapa Original), the four round actions (Save, Tip, Own · $, Trailer / Full episode, Back it), the Up next card, the description, the credits line (Made by, seal, crew, Shot at, Report), Accessibility, the season strip and the Extras row. What changes: (1) a THIN episode is complete — its title defaults to 'Episode N' (the kicker carries the number anyway) and its description, genre, rating box, tier pill, 'Made by' and year fall back to the show's defaults in rowToEpisode / rowToPublicEpisode beside the existing art fallback, so a creator who only dropped files still has a finished page; (2) the OPTIONAL page is `has_page`: when it is on and the visit carries no ?autoplay, the page renders the landing view a film already gets — HeroSpotlight with the still or the signed trailer, the kicker linking to the show, the title or title image, the meta line, the creator's Notes as paragraphs (.ep-notes), Made by + seal, crew and Shot at, Play / Continue from the resume point, the full OwnTitleCard (price, refund promise, 'own the whole series' link) — and Play switches to the player in place (router.replace with ?autoplay=1); when it is off (the default for a show's episodes) a cold visit renders the player strip as today; (3) 'See all' in the season strip carries ?season=<n> so the series page opens on that season; (4) nextEpisode / previousEpisode and the strip use the one sortEpisodes ((season ?? 1), (seriesOrder ?? last), createdAt), so Up next, the end card and the show page agree and a null-season episode no longer sorts before season 1; (5) the trailer is signed on the way out and the Trailer action hides when signing fails; (6) <title> is 'S1 E2 · <episode title> — <Show> · Studio Tapa TV' and og:image is the still, else the show's poster; (7) an owner or admin can open any episode of a pending show with ?preview=1 under a preview bar (playbackGate already lets the creator and admins through); (8) Extras anchored to this episode appear as its Bonus row, and a bonus clip opens the same way from both pages (the landing when it has a page, else the player). Podcast episodes keep routing to /podcasts/<showId>. The sitemap and individual search results are NOT changed by this round — every episode URL stays listed as today; indexing only has_page episodes (the show standing in for the rest) is a decision for Jose in forJose. The app's episode screen mirrors all of it: its showPlayer initial state reads hasPage instead of forcing true for series episodes, the landing reuses HeroSpotlight, See all passes the season, and the thin-episode fallbacks arrive in the payload.

### The public series page

/series/<id> keeps its skeleton (SeriesHero at 56%, Back, BoughtBanner, 'You own this series', BundleCard, tabs, season tabs, rows) and gains what the show now knows about itself. The hero reads the roll-up, not the first episode: the tier pill is 'Tapa +' when any public episode is premium, 'Tapa + · pilot free' when the first is free, else 'Free with ads'; the rating box is the highest minimum age among episodes; 'Made by' is the show's defaults.artist, else the owner's display name, else the first episode's artist; the year shows when set; the background is the SIGNED trailer (refreshSrc through /api/stream-token part 'trailer'; the hero falls back to its image on an hls error), else the hero image. Season tabs read and write ?season=N (router.replace) and carry the label from series.seasons ('Season 2 · The Return'); the Bonus tab is called Extras and groups 'With the show' / 'After S1 E3'; each episode row shows its code 'S1 E3', its own still when it has one, the title, a two-line description (falling back to nothing, not the show's blurb), runtime and BuyChip/OwnedChip; a row tap plays (?autoplay=1) and a 'Details' chevron appears when the episode has a page; the BundleCard names owned episodes 'S1 E3'. The About tab lists genre, rating, Made by, year, Crew needed, Crew and Shot at on web AND app. An owner or admin opens a pending, held or removal-requested show with ?preview=1 under a bar 'Only you can see this — it goes public with the first approved episode' (findSeries takes { preview: viewer }; noindex; private, no-store), and sees nothing otherwise different; strangers still get 404. A show whose kind is 'podcast' 302s to /podcasts/<id> (the API answers { redirect }); a 'vertical' kind keeps today's browse surface. og:title / og:image / og:description come from the show's own name, poster and description. /api/series-hub now sends isSubscriber, isAdmin, isOwner, kind, rollup { tier, rating, madeBy, firstFree }, seasonLabels, crew, shotAt, crewCalls, preview, hasPage per row and the signed trailerSrc, so the app's locks show only for a non-member, the BundleCard speaks to members correctly and the About tab matches the web. The page stays CDN-cached 300 s for signed-out visitors; the show page tells the creator that visitors see changes within a few minutes.

### Data changes

- **series (migration 117_shows.sql)**: Add optional columns: kind text not null default 'series' check (kind in ('series','podcast','vertical')), backfilled from the episodes' content types ('podcast' when any podcast episode and no series episode, 'vertical' when all are vertical); defaults jsonb not null default '{}' (tier, rating, mainGenre, genre, artist, adsEnabled), backfilled from each show's first episode by sortEpisodes order; seasons jsonb not null default '[]' ([{ number, name }]); decision_note text; submitted_by_user_id text and reviewed_by_user_id text (the Clerk ids; the email columns stay for old rows). Backfill creator_id from the episodes' submitted_by only where creator_id is null AND every episode of the show shares one submitted_by (raise notice per show left unowned). `update series set status = 'approved' where status is null`; then a DO block that adds `series_status_check check (status in ('pending','approved','rejected'))` only when no other value exists, otherwise raises a notice listing the offenders for Jose.
  Why: The show needs to describe itself as defaults (decision 3), know its kind (podcast redirect, pickers, vocabulary), name its seasons (decision 10), remember why it was taken down (decision 14) and be joined to Clerk the way episodes are. Every column is optional with a default, so lib/series.js reads a missing column as absent (SELECT / SELECT_LEGACY + missingColumn) and writes go through updateCompat until Jose runs it; the creator_id backfill retires the dead UUID-regex fallback with data, safely.
- **episodes (117)**: Add has_page boolean (null = by type), page_notes text, pending_src text (a staged replacement manifest on a live title). Then: `update episodes set season = 1 where series_id is not null and season is null and content_type in ('series','podcast')`; then the de-duplication shove — `with d as (select id, row_number() over (partition by series_id, season, series_order order by created_at) rn from episodes where series_id is not null and series_order is not null and content_type in ('series','podcast')) update episodes e set series_order = e.series_order * 1000 + d.rn from d where d.id = e.id and d.rn > 1 returning e.id, e.series_id, e.season, e.series_order` inside a DO block that RAISES NOTICE one line per shoved row ('<show> S<season>: <id> → E<new>') so Jose reads exactly which viewer-facing numbers moved; then `create unique index if not exists episodes_show_position_uq on episodes (series_id, season, series_order) where series_id is not null and season is not null and series_order is not null and content_type in ('series','podcast')`; and `create index if not exists episodes_bonus_parent_idx on episodes (bonus_parent_type, bonus_parent_id) where bonus_parent_id is not null`.
  Why: The unique index is the only thing that actually stops two S1E1s, and the shove (series_order × 1000 + rn, a visible, reversible move the status card flags as a gap) makes it creatable on existing data without guessing an order; the notices keep Jose informed (lens-2 and lens-4 grafts). has_page/page_notes are the optional page (decision 5); pending_src keeps a live title playing while its replacement waits (decision 9). Bonus and vertical rows are excluded so extras need no number. Missing columns read as 'by type' / none.
- **functions (117)**: `reorder_show_season(p_series_id text, p_season int, p_ids text[], p_numbers int[])` and `move_episode(p_id text, p_series_id text, p_season int, p_number int, p_shift boolean)` as plpgsql security definer: both verify every id belongs to p_series_id (and p_season for reorder) and raise otherwise, set the affected rows' series_order to negative values first, then to the final numbers (p_numbers, or 1..n when null; move with p_shift pushes the occupied numbers from p_number up by one), in one transaction, returning the new rows. `revoke execute on function … from public; grant execute … to service_role` (migration 112's rule). lib/showPage.js calls the RPC and, when PostgREST answers 404 for the function, falls back to the two-phase JS write (negatives, then finals, each phase awaited) — and the route's answer carries `fallback: true` so the page can show 'Order saves one row at a time until migration 117 runs'.
  Why: Both existing bulk reorders write N parallel updates with no transaction; under a unique index a naive in-place renumber collides mid-way, so the swap goes through negatives and a function keeps it atomic. The fallback keeps a database behind on 117 working honestly.
- **title_prices, purchases (117)**: `alter table title_prices alter column target_id type text using target_id::text; alter table purchases alter column target_id type text using target_id::text;` with the unique (target_type, target_id) and the partial indexes dropped and recreated around it where Postgres needs it. No live rows exist yet.
  Why: The map's blocking find: 097 declared target_id uuid while every title id is a text slug, so Buy to own cannot write a real price or purchase against a database built from schema.sql; this is the series bundle's table. Jose confirms (a money-table alteration that must land before the first live sale).
- **creator_drafts (116, shape unchanged)**: No schema change. The show page writes drafts with form.seriesId / season / seriesOrder set (and the show's defaults copied into form); lib/creatorDrafts.js listDrafts takes { seriesId } and its cap rises from 20 to 100; the drafts of a show appear as 'Draft' rows in its seasons; Send for review turns each into an episode through the shared submitDraft core.
  Why: A new 'draft' episode status would ripple through every public reader; the 116 table already holds a form plus an upload in flight and is exactly the row an unsent episode is. The 20-cap would have hidden 20 of 40 podcast drafts.
- **notifications, audit_log (no schema change)**: New notification types registered in lib/notificationTypes.js (type → { label, icon, routeKind }), the existing ~90 strings listed too (no behaviour change for them; notifyCreator warns in dev on an unregistered type): show_live, show_pulled, show_edit_approved, show_edit_denied, show_video_approved, show_video_denied, show_deleted, show_deletion_denied, episode_moved_by_admin, show_numbering_fixed, show_owner_changed, show_new_episodes (savers), plus the existing episode_* / artwork_* / edit_* / deletion_* types. New audit actions: show_created, show_updated, show_reorder, show_move, show_numbering_fixed, show_season_renamed, show_live, approve_show_pending (with the count), reject_show_pending, show_video_approved/denied, show_owner_changed, confirm_series_deletion (now with counts), tell_savers.
  Why: Series decisions are silent today and notification types are free strings with no registry; the series work is the first to add a handful, so it adds the registry the app's PushListener reads.
- **series_drop_runs (optional, 117)**: A tiny table `series_drop_runs (series_id text primary key, last_episode_seen timestamptz, customer_cursor text, updated_at timestamptz)` with `enable row level security`, so the daily cron knows which shows gained a live episode since the last run and where a capped Stripe pagination stopped.
  Why: notifySeriesDrop must run outside any request, once per show per day, capped with a continuation; without a cursor a show with more than 1,000 members' customers would never finish. Code reads a missing table as 'run once with no cursor' (isMissingSeriesDropTable).
- **all of 117**: One file, supabase/migrations/117_shows.sql, re-runnable (if not exists / DO blocks / create or replace function), every statement guarded, ending with `alter table series enable row level security; alter table episodes enable row level security; alter table series_drop_runs enable row level security;` and a comment pointing at 112. Handed over as SQL in chat; CLAUDE.md marks it applied once Jose confirms, like 116.
  Why: The repo's migration convention and the 'cannot fail half-way on Jose's real data' rule.

### API changes

- `GET /api/show?mine=1 · POST /api/show`: New. GET lists the caller's shows (creator_id; admins ?all=1) as hub summaries { id, name, kind, status, statusLabel, poster, seasons, episodeCount, pendingCount, draftCount, stagedCount, removalRequested, problems }. POST creates one { name, kind, description, defaults, posterBase64, thumbnailBase64, cutFromFirst } → { id } through lib/showPage.js createShow (pending, creator_id = me, submitted_by email + submitted_by_user_id, kind, defaults, channel_opt_in false, insertCompat; id = `${slug}-${ts}-show`). 10/h per account (the create-series key). /api/creator/create-series becomes a thin alias; manual-episode's newSeriesName and acceptApplication's show insert call createShow too (acceptApplication passes its own id so the show and its S1E1 never share one).
- `GET /api/show/[id]`: New: the control-room payload from getShowPage(id, viewer) — show { id, name, kind, status, description, year, fundingUrl, channelOptIn, defaults, art { poster, thumbnail, heroImage, titleImageUrl, trailerSrc (signed) }, staged { name, poster, thumbnail, heroImage, titleImageUrl, titleImageRemoval, trailerSrc }, seasons [{ number, label }], deletion { requested, reason, at }, held, holdReason, decisionNote, ownerId, ownerName, canEditShow, isAdminView }, seasonsList [{ number, label, episodes: rows (id, kind 'episode' | 'draft', title, season, seriesOrder, status, held, deletionRequested, cloudflareState, runtime, thumbnail (own else null), overrides, staged { title, poster, thumbnail, src }, captionsUrl, hasPage, uploadedBy (admin view), draft { id, uploadUrl, videoName, videoBytes, state }) }], extras, problems (showProblems), price, counts, viewer { isOwner, isAdmin, caps }, buyers { series, episodes } (admin), fallback117. Owner, a contributor (read-only view) or canAccessAdmin; private no-store; 240/h per account; sendError; fails soft to the legacy select before 117.
- `PATCH /api/show/[id]`: New: show fields { name, description, year, fundingUrl, channelOptIn, defaults, seasons, posterBase64, thumbnailBase64, heroImageBase64, titleImageBase64, removeTitleImage, trailerUid, cancelStaged: ['name','poster',…], resubmit: true }. Owner or admin; fieldPolicy decides direct vs pending_* for a live show (admin always direct); trailerUid through checkVideoOwnership; images through uploadArtworkImage + capImage; replaced files orphaned; invalidateCache('all_series_approved_v1') on any direct change; audit show_updated; 60/h per account. request-series-edit, series-media and request-series-deletion stay as aliases for one release.
- `POST /api/show/[id]/episodes`: New: add one or many drafts { items: [{ videoUid?, uploadUrl?, videoName, videoBytes, runtimeSeconds, title?, season?, seriesOrder?, importUrl?, audioUrl? }] } (≤30) → { drafts }. Each becomes a creator_drafts row with form prefilled from the show's defaults and seriesOrder = nextFreeNumber(existing + earlier items, season); uids ownership-checked; the per-account drafts limit (240/h) applies; a link import goes through the existing import-video-url / import-audio-url logic. Refused before 117 with 503 naming the migration (the unique index must exist before a batch).
- `POST /api/show/[id]/send`: New: { draftIds } → runs submitDraft (the submit-episode core, extracted into lib/showPage.js and used by both) per draft inside one request after validating every slot, uid and the show's state first; copies the show's defaults onto each row; refuses a taken (season, number) with the two candidates; answers { created: [ids], skipped: [{ draftId, reason }] }; one audit; 20/h per account (the creator-submit key counts the batch as one).
- `POST /api/show/[id]/reorder`: New: { season, episodeIds, numbers? } (every id must be in that show and season; drafts included — a draft is renumbered in its form) → reorder_show_season RPC or the two-phase fallback; the client sends the result of planMove so the server writes exactly the numbers the toast announced; audited show_reorder ('S1: E7 → E3; E3–E6 → E4–E7'); owner (own uploads for rows that change) or manage_episodes; 120/h per account; invalidateCache('public_episodes_v1').
- `POST /api/show/[id]/move`: New: { episodeId, toShowId?, toSeason?, toNumber?, shift?, closeGap? } → canMoveTo (same kind; the viewer owns the target or is admin; episode.submittedBy === viewer unless admin; target not rejected / held / deletion-requested / vertical; a creator refused when source or target hasBuyersIncludingSeries) → move_episode RPC or fallback; audited show_move; the answer carries earningsStayWith and buyersAffected for the admin's sheet; the uploader notified episode_moved_by_admin when an admin did it; 60/h per account.
- `POST /api/show/[id]/seasons`: New: { action: 'rename' | 'insert' | 'remove_empty' | 'move_all' | 'renumber', number, label?, toNumber? } — labels live in series.seasons; insert / remove / move_all renumber seasons on the affected episodes in one two-phase write; 'renumber' is the explicit 'Renumber from 1' (reorder with numbers 1..n); audited show_season_renamed / show_reorder.
- `GET /api/show/[id]/positions?season=`: New: { taken: { 3: { id, title } }, nextFree, gaps } for the submit page's prefill and the editors' live conflict line; owner / contributor / admin; 240/h.
- `PATCH /api/show/episode/[id] · POST /api/show/episode/[id]/video · DELETE /api/show/episode/[id]/staged`: New: the episode editor's save for uploader / owner (Place only) / admin: { title, description, season, seriesOrder, overrides { tier, rating, genre, mainGenre, artist, releaseYear } | null per key, runtime, fundingUrl, adsEnabled, adBreakSeconds, channelOptIn, hasPage, pageNotes, posterBase64, thumbnailBase64, titleImageBase64, removeTitleImage, trailerUid, bonusParentType/Id (extras), resubmit: true }. fieldPolicy per field: direct while pending / rejected (enforced with the status in the WHERE), staged (pending_title / pending_poster / pending_thumbnail / title image / trailer) or locked (tier, rating, isOriginal, featured → 403 'Ask us to change who can watch') on a live row for creators, always direct for admins (syncStreamProtection on a tier/src change, audit edit_episode, notify on a status change). /video: { videoUid } ownership-checked → pending / rejected: src swapped at once (old uid orphaned; a rejected row back to pending, answer { resubmitted }); live: pending_src staged, the live file keeps playing. DELETE staged { fields } cancels staged values and orphans staged files. '__new__' is refused everywhere. Replaces edit-submission / request-episode-edit / add-artwork / replace-video / request-episode-deletion as UI entries for show episodes (they stay as thin forwards for one release so a week-old app bundle keeps working); 60/h per account.
- `POST /api/admin/review-queue (lib/reviewQueue.js)`: QUEUE_KINDS drops 'series' (decideReviewItem keeps the branch one release). A submission item gains meta.show { id, name, kind, status, isNew, poster, ownerName, ownerAccountAgeDays, waitingCount, href }, meta.position 'S1 E4', meta.slot 'free' | 'taken by …', meta.masterReady (Cloudflare state memoised 60 s per uid in lib/cloudflareUpload.js). decideReviewItem approve on a show episode: validate series_id, season, series_order present and the slot unique (409 'E4 is taken in Season 1 — fix numbering on the show page') and the master ready (409 'Not yet'); when the parent show is pending: refuse 403 for a non-full-admin while SHOW_LIVE_NEEDS_FULL_ADMIN, else update series set status approved, reviewed_by_user_id, reviewed_at where status = 'pending', set series.defaults.tier from tierOverride, notifyCreator show_live to series.creator_id, invalidate both caches, audit show_live. approve runs syncStreamProtection on trailer_src too and no longer calls notifySeriesDrop inline (the cron does).
- `GET /api/admin/shows · POST /api/admin/show/[id]`: New: the list with filters, counts and problems (manage_episodes | review_submissions); the admin actions { action: 'owner' (email | null → series-ownership logic, audited, both notified, cache invalidated), 'defaults' (tier / rating / original / hero), 'hold' | 'takedown' | 'restore' (lib/moderation.js; decision_note stored), 'fix_numbering' { season }, 'approve_show' (legacy pending show with live-ready episodes), 'approve_pending' { tierOverride } / 'reject_pending' { reason } (validate all, then decideReviewItem per row, one notification, one audit), 'resolve_staged' { target, field, decision, note } (resolve-artwork / resolve-edit logic + pending_src 'New video'; notifies the owner; invalidates all_series_approved_v1), 'cascade_delete' { confirmName } (lib/showDelete.js deleteShowCascade), 'deny_deletion', 'tell_savers' }. requireCapability per action (full admin for owner, cascade and a pending show's approve_pending); sendError; every action audited.
- `POST /api/admin/resolve-artwork · resolve-edit · resolve-deletion · queue-counts`: Fixes: notify the series owner (series.creator_id) on approve/deny of a show's staged art or name (show_edit_approved / show_edit_denied with the note); invalidateCache('all_series_approved_v1') after a series change; resolve-artwork handles pending_src ('New video') on episodes; resolve-deletion on a series delegates to deleteShowCascade instead of refusing; queue-counts counts pending_title_image_url / pending_title_image_removal / pending_src and filters deletions on withdrawn_at is null; a new badge key 'shows'.
- `POST /api/admin/edit-episode`: Fixes folded (the route and the modal stay for the long tail): null series_id / season / series_order only when the new content_type is neither 'series' nor 'podcast' (typeNeedsShow); VALID_CONTENT_TYPES gains 'bonus' and EDITABLE_FIELDS gains bonusParentType / bonusParentId with existence and type checks; the chosen seriesId must exist and not be deletion-requested / held; the modal sends only changed fields (no more discover_curated reset, title image reads from the payload); a cross-owner move answers earningsStayWith; reviewed_by stays the user id.
- `GET /api/series-hub · pages/series/[id].js (lib/seriesHub.js)`: Adds isSubscriber, isAdmin, isOwner, isCreator, kind, rollup { tier, rating, madeBy, firstFree }, seasonLabels, crew, shotAt, crewCalls, hasPage per row, preview; signs trailerSrc (60-minute token); honours ?season=; ?preview=1 for owner/admin bypasses findSeries' status filter (noindex, private, preview: true); kind 'podcast' → 302 /podcasts/<id> (API { redirect }); og tags.
- `GET /api/episode-page · pages/episode/[id].js (lib/episodePage.js)`: Thin-episode fallbacks (title 'Episode N', description, genre, rating, tier, artist, year from the show's defaults), hasPage + pageNotes (decides the landing), seeAllHref with ?season=, one sortEpisodes, signed trailerSrc, og:image, ?preview=1 for owner/admin on a pending show, extras anchored to the episode.
- `POST /api/stream-token`: Gains { episodeId | seriesId, part: 'trailer' } behind a light gate (exists, not held, parent not hidden; no tier, no age) as the refreshSrc for SeriesHero / HeroSpotlight; 240/h per viewer like the master.
- `GET /api/creator/list-series · GET /api/creator/my-submissions`: list-series returns kind, status, deletionRequested, held, episodeCount, pickable (not rejected / held / deletion-requested / vertical, same kind) and labels for every show picker (submit page, Move sheet, app). my-submissions adds pendingTitle / pendingDescription / pendingSrc, titleImageUrl, discoverCurated, hasVideo / hasAudio, holdReason (from content_moderation), seriesKind, seriesStatus, sorts rows within a show by sortEpisodes, uses own art else the show's still (never Cloudflare's frame), and memoises its Cloudflare calls 60 s per uid.
- `pages/api/notify-series-drop.js → lib/seriesDrop.js + /api/cron/expire-content`: The loop moves into notifySeriesDrop(seriesId, { since, cursor }) run from the daily expire-content cron for shows that gained a live episode since the last run (series_drop_runs), once per show per day (firstInWindow), capped at 1,000 customers per run with a stored cursor, an email at most once per show per week; the admin route stays as the manual 'Tell savers' (deduped the same way). Never called inside approve.
- `pages/creator/series.js · components/SeriesMediaForm.js · /admin/ownership`: /creator/series → 308 to /creator (or /creator/show/<id> when ?series= is in the query); SeriesMediaForm and AddSeriesForm become caller-less (kept in the tree like CreatorSubmissionForm); /admin/ownership → ADMIN_REDIRECTS /admin/shows. The app's 'Series management' help text goes.
- `lib/series.js · lib/creatorApplications.js · lib/showRules.js · lib/notificationTypes.js`: lib/series.js: the UUID regex at line 102 goes (the fallback keeps creator_id-null shows the creator has episodes in, scoped by .in() on an array); getAllSeriesForCreator takes { includeRejected, includeDeletionRequested, kind }; findSeries(id, { preview: viewer }); rowToSeries gains kind, defaults, seasons, decisionNote, fundingUrl, channelOptIn; one signTrailer helper. acceptApplication mints distinct ids (`-show` suffix), sets kind and defaults from the application, notifies show_live. lib/showRules.js (pure, client-safe, tested by scripts/test-show-rules.mjs, mirrored in mobile): see rules. lib/notificationTypes.js: the registry.

### Rules

- lib/showRules.js is pure and client-safe, mirrored word for word in mobile/src/lib/showRules.js, tested by scripts/test-show-rules.mjs: sortEpisodes re-exported from lib/seriesResume.js; SHOW_KINDS, kindForType, showNoun; nextFreeNumber(rows, season); positionsFor(rows, season) → { taken, nextFree, gaps }; numberingProblems(rows) → [{ code: 'duplicate' | 'gap' | 'unnumbered', season, numbers, episodeIds }]; planMove(rows, episodeId, targetIndex | { season, number, shift }) → { ids, numbers, changed: [{ id, from, to }], words }; renumberFromOne(rows, season); planBatch(files, { season, startAt, sortBy }) → rows with titles and slots; titleFromFilename; parseEpisodeCode('S01E03' | 'Ep 3' | '1x03'); FIELD_POLICY + fieldPolicy(field, { role, status }) → 'direct' | 'staged' | 'locked'; canMoveTo(episode, targetShow, viewer, { buyers }) → { ok, reason }; showRollup(episodes, show) → { tier, tierLabel, firstFree, rating, mainGenre, madeBy }; showStatusLabel(show, rows); showProblems(show, rows) → the status card's lines; episodeDisplayTitle(ep, show); inheritedField(ep, show, key); episodeHasPage(ep); cascadePlan(show, episodes, extras, buyers) → rows + words; needsYou (moved here from pages/creator.js); SHOW_LIVE_NEEDS_FULL_ADMIN = true; FILES_PER_DROP = 30; DRAFTS_CAP = 100.
- Position is the owner's business: reorder, renumber, re-season and move within shows the viewer owns apply at once, are audited, and never change status. A move is an insert that rotates only the occupied numbers between source and target and shows them before committing; 'Renumber from 1' is explicit; gaps are allowed and flagged, never bridged; duplicates are impossible (server 409 with 'Swap' / 'Insert here' + the unique partial index as backstop). Moving across owners is admin-only; a creator's move in or out of a show with buyers is refused; an admin sees the earnings and buyers consequences and decides.
- A show has no review of its own: it is pending until any episode under it is approved by a full admin (SHOW_LIVE_NEEDS_FULL_ADMIN); that approval flips it live in the same write and notifies the owner. A show with zero approved episodes is never public (seriesHidden stays the one hide rule). Approve — single or batch — never lands an episode on a taken slot, a missing number or an unready master; it refuses with the slot and the candidates.
- Entitlement never changes without a human: a live episode's tier, rating, Tapa Original and hero eligibility are locked for creators (admins change them, syncStreamProtection runs); the show's default tier applies only to episodes created after the change.
- Thin episodes are complete: a show episode with no own title / description / art / genre / rating / tier / artist / year inherits the show's defaults in rowToEpisode / rowToPublicEpisode — never a blank page. The sitemap and search are not changed by this round.
- Drafts are the unsent episodes: an added file is a creator_drafts row with the show, season and number in its form, listed in its season as 'Draft', uploading through the existing one-upload-at-a-time rule (web UploadContext, app tusUpload) from a page-side queue; Send for review turns drafts into pending episodes through the one submitDraft core; discarding deletes the video unless something else uses it (videoInUse).
- Staged changes are visible and cancellable: /api/show and /api/show/episode return pending_* beside the live values; the owner can cancel their own staged change (clears pending_*, orphans the staged file); a new staged value replaces the old one with a notice. There is no second staging mechanism: tier and rating are locked, everything else on a live title is either direct or one of the existing pending_* columns (+ pending_src).
- Every decision on a show or a staged change stores a reason (decision_note, rejection_reason, the deny note in the notification) and notifies series.creator_id with a type from lib/notificationTypes.js; a batch approval sends one notification and one audit line, never N.
- Every Cloudflare video on the path demands a signed URL — masters and trailers alike — and is signed on the way out (signedSrcForStoredUrl + unsignedFallback; null when minting fails; the UI hides the Trailer action / hero video when null); approve runs syncStreamProtection on trailer_src; stream-token part 'trailer' is the refresh path.
- No Stripe-customer pagination inside a request: saver notices run from the daily cron once per show per day, capped at 1,000 customers with a stored cursor, or from the admin's 'Tell savers' button (deduped the same way).
- Every write to series / episodes goes through lib/showPage.js with insertCompat / updateCompat and the SELECT / SELECT_LEGACY + missingColumn read, so a database on 116 renders the show page from the old columns, hides the new controls, and answers 503 naming 'migration 117' for RPC-only features (reorder falls back to the two-phase write and says so; Add several is refused until the unique index exists).
- Every route on the path: applyCors + OPTIONS + 'Cache-Control: private, no-store'; getRoleContext or requireCapability per action (list form where a page has several caps); a per-account checkRateLimit key beside the per-IP one (show create 10/h, show patch 60/h, episodes/drafts 240/h, send 20/h, reorder 120/h, move 60/h, episode patch 60/h, positions 240/h, trailer token 240/h); checkVideoOwnership on every uid from the browser; recordOrphan on every replaced file; invalidateCache('public_episodes_v1') / ('all_series_approved_v1') on every public-facing write; recordAudit on every write (creator writes too, adminId = the creator, details 'by the owner'); sendError(res, err, '<route>', fallback, { plainStatus: 400 }) with internalError marking in the lib — never res.status(500).json({ error: err.message }).
- Ids are distinct: a show id carries '-show' before or after the timestamp and never equals an episode id; a batch minting several ids in one millisecond appends a counter. reviewed_by_user_id / submitted_by_user_id are written on series from now on.
- Kind matches: an episode joins only a show of its kind; /series/<id> serves kind series, /podcasts/<id> kind podcast; a vertical show opens read-only for the studio only.
- Pages and the app import only lib/showRules.js, lib/submitRules.js, lib/creatorRights.js and lib/seriesResume.js; lib/showPage.js, lib/showDelete.js and lib/seriesDrop.js are server-only; no site class may start with cl-; the web drag follows ScheduleTimeline's pointer-event state machine and the drag handle is .show-grip; the app never drags.
- One sorter only: sortEpisodes from lib/seriesResume.js ((season ?? 1), (seriesOrder ?? last), createdAt, id) replaces every hand copy — seriesHub, heroCandidates, purchases, pages/series/[id], episodePage's (season || 0), channelEngine's own sort.
- AdminEditEpisodeModal and /api/admin/edit-episode stay reachable (row kebab 'Open in Library modal') with their bugs fixed now; the Library's pending cards keep working for standalone titles; nothing is deleted until the show page covers its long tail and the Playwright suites prove it.
- Verification follows the house pattern: scripts/test-show-rules.mjs; pw/show-data-http.js (slice 1), pw/show-page.js (slice 2, 390 + 1280), pw/show-admin.js (slice 3), pw/series-public.js (slice 4); the existing pw/series-resume-http.js, pw/series-resume-loop.js, pw/end-card.js and pw/shoot-episode-after.js re-run green; the app with expo export (iOS + Android), not a device.

### Bugs folded in

- Creator trailers cannot play (minted requireSignedURLs: true since 2026-10-25, stored and played raw): signed on the way out in lib/seriesHub.js, lib/episodePage.js, lib/heroCandidates.js, lib/podcastShowHub.js, the stream/genre/type feeds and both APIs (60-minute tokens, unsignedFallback for self-hosted files), stream-token part 'trailer' as the refresh, SeriesHero/HeroSpotlight fall back to the image on an hls error, approve protects trailer_src, 'Protect every video' covers series.trailer_src / pending_trailer_src (slice 1).
- The admin 'Edit full details' modal detaches any podcast episode from its show (the route nulls series_id/season/series_order whenever content_type !== 'series'): edit-episode nulls them only when the new type is neither 'series' nor 'podcast'; the modal sends only changed fields (also fixing the discover_curated reset and the title-image 'Not set') (slice 1).
- The admin modal offers 'Bonus content' + a parent picker the route refuses and never stores: VALID_CONTENT_TYPES gains 'bonus', EDITABLE_FIELDS gains bonusParentType/bonusParentId with existence/type validation (slice 1).
- acceptApplication gives the show and its S1E1 the identical id (slugId twice in one millisecond): createShow({ id: `${slug}-${ts}-show` }); the wishlist and recs stores stop colliding; a one-off script lists existing collisions (none expected before 116 runs) (slice 1).
- The '__new__' sentinel detaches an episode from every show without creating one: refused 400 'Name the new show' by submit-episode and the episode route; the option is gone from the pickers; the inline '+ New show' creates a real pending show AFTER validation (slice 1/2).
- Duplicate season + number, gaps and the null-season sort split: season = 1 backfill, the logged de-duplication shove, the unique partial index, server 409 with Swap/Insert, status-card flags, admin 'Fix numbering', one sortEpisodes with a created_at/id tie-break (slice 1).
- Silent series decisions: show_live on first approval, show_edit_approved/denied from resolve-artwork/resolve-edit (now notifying series.creator_id with the note and invalidating all_series_approved_v1), show_deleted/show_deletion_denied from the cascade, show_pulled via moderation (already there) with decision_note stored, show_owner_changed from series-ownership, episode_moved_by_admin, show_numbering_fixed (slices 1 + 3).
- The legacy ownership fallback in getAllSeriesForCreator matches only UUID-shaped ids, so pre-038 shows vanish from the creator's list: the regex goes; 117 backfills creator_id where every episode agrees; the remaining fallback uses .in() on an array (slice 1).
- Buy to own target_id uuid vs text slug ids (blocking data bug): both columns altered to text in 117.
- series.status null rows and no CHECK: nulls normalised to 'approved', the CHECK added only when nothing violates it (117).
- manual-episode inserts a live, unattributed show from a manage_episodes sub-admin: goes through createShow (pending, attributed, defaults) with an explicit 'Live now' tick gated by review_submissions (slice 3).
- The inline new show is inserted before validation (orphan pending shows on a 400) and inherits the episode's channel tick: created last, rolled back on failure, channel_opt_in false (slice 1).
- The review item's 'New series · <user id>' subtitle with nothing to review: the 'series' kind is retired; the submission item carries the New show sub-card with the owner's name and account age, the signed master and the slot line (slice 3).
- An approved episode of a pending/rejected show counted as 'Live' in Creator Studio: the hub's piles and Your work read the show's status (seriesStatus on my-submissions; 'Waiting on the show' in Needs you), and with show-goes-live-on-first-approval the state can only arise for legacy rows (slice 2).
- A rejected show indistinguishable from a live one and still fileable: status chips everywhere, decision_note shown, the pickers grey rejected / held / removal-requested shows with the reason, submit-episode refuses them (slices 1/2).
- Series deletion refused while episodes remain; bonus clips, watch_history, notifications and title_prices rows left dangling: deleteShowCascade (buyers → withdrawn per bought scope, extras by bonus_parent_id, the cleanup in lib/testContent's order) behind one confirmation on both sides (slice 3).
- Staged title/description edits invisible and uncancellable, two overlapping ways to edit a pending title, request-edit routes unlimited and status-blind: the editor shows every staged change with Cancel, the policy table decides direct vs staged, caps and per-account limits on the new routes, the old routes forward (slice 2).
- Replace video on a live title unpublishes it and the widget's copy is wrong for a pending row: pending_src staged on a live title (the old keeps playing), state-aware copy in the file card, a rejected title gets 'Send again for review' without a new file (slice 2).
- hasVideo/hasAudio read by Your work but never emitted; the row thumbnail falls back to Cloudflare's frame that cannot load; one Cloudflare call per episode per load: my-submissions emits them, uses own art else the show's still, memoises the calls 60 s per uid (slice 2).
- Needs attention vs Needs you disagree: one needsYou() in lib/showRules.js used by the hub, Your work and the app (slice 2).
- Series artwork/edit approvals never invalidate all_series_approved_v1; the Library badge omits the staged title image and counts withdrawn deletions; reviewed_by email vs id on series: fixed in resolve-* / queue-counts / the new id columns (slices 1/3).
- Hero tier/rating from the first episode on web and app; the app's series hub never learns the member (locks and BundleCard wrong for Tapa+ members) and lacks Crew / Shot at: showRollup + isSubscriber / crew / shotAt / crewCalls on /api/series-hub (slice 4/5).
- 'See all' lands on the first season; season tabs not in the URL; og tags missing; a series episode's <title> omits the show: ?season= read and written, og:image from the still/poster, the title with the show name (slice 4).
- A series episode never gets the landing view / Own card: has_page renders it (slice 4).
- A podcast show rendered as a series with an un-playable Play (critic): series.kind + the 302 (slice 1/4).
- An admin unable to approve a show from the app; the deck's 'Check artwork on the web': the show rides with the episode the deck already approves (slice 5).
- The app's Your work ignores ?status= / ?attention=1, lists a show's bonus clips under 'Other', uses the apex host for public links, cannot change season/number/show after submit, cannot give a show its art: the show screens, the editor, useLocalSearchParams, Extras under their show, the www host (slice 5).
- The University-style reorder anti-patterns are not copied: the reorder and move routes audit, the functions check every id belongs to the show, errors go through sendError, a per-account limit sits beside the per-IP one (slice 1/2).
- Orphaned media has no 'Dismiss' although the 409 tells the admin to dismiss: a Dismiss action that deletes the orphaned_media row only (slice 3).

### The app

The app gets the same three creator screens and the same decisions, built from the pieces the creator path already mirrored and without a new native dependency. New screens under mobile/src/app/creator/show/: new.js (AccountFrame, CreatorBits Field/Input/Chips/Switch, pickImageAsDataUrl for poster/still, POST /api/show, router.replace to the show page), [id].js (AccountFrame with the show's name as title and Back → /creator; the same section order as the web phone layout: ShowCard, StatusCard (CreatorBits levels), the Add bar — pickVideo single; pickVideo with allowsMultipleSelection + selectionLimit 30 for 'Add several', one draft per asset through POST /api/show/<id>/episodes as each upload is minted, the screen's own queue feeding mobile/src/lib/tusUpload.js one asset at a time so startTusUpload's one-at-a-time rule still holds, rows 'Queued' until their turn, a 'Keep the app open until the uploads finish' StatusCard; 'Paste a link' — season sections with ↑/↓ on every row and the E-badge stepper (no drag: the app has no sortable list and a PanResponder reorder is a build of its own), 'Send N for review', Extras, SellTitleSheet, the Channels Switch, 'Remove this show…' with the cascade words), and [id]/episode/[episodeId].js (the editor as a screen: Basics / More info / Place as stacked cards, the file card replacing through startTusUpload kind 'main' with the state-aware copy, art via pickImageAsDataUrl saved the moment it changes (the app's habit), the 'Same as the show' chips, the 'Give this episode its own page' Switch + notes, the trailer through startTusUpload kind 'trailer', captions 'Add captions on the website' (no document picker, as today), the Place card with a Move to… bottom sheet (season chips, slot input, Another show list with the greyed reasons), Remove with the reason modal, SaveRow from AccountBits listing what goes to review). The row kebab opens the bottom-sheet Modal (my-work.js's sheetBackdrop/sheet pattern). The hub (creator/index.js) gets the 'Your shows' horizontal FlatList + '+ New show', routes In review / Needs you rows to the show screen when they belong to a show, and passes ?status= / ?attention=1 to Your work, which reads them with useLocalSearchParams at last; account/my-work.js show groups get 'Open show page →', lose the show-level sheet rows, sort by season/number with the 'S1 E3' code, list extras under their show and use the www host. mobile/src/lib/showRules.js mirrors lib/showRules.js word for word (the 'change both together' header); mobile/src/lib/notificationTypes.js mirrors the registry for PushListener's icon/route map. The public side: series/[id].js reads kind, rollup, isSubscriber, seasonLabels, crew/shotAt/crewCalls, hasPage per row and preview (image hero, no trailer video, unchanged), honours ?season=, shows the preview bar for the owner/admin and follows the podcast redirect; episode/[id].js gets the thin-episode fallbacks from the API, the signed trailer, the landing when hasPage and no autoplay (HeroSpotlight already exists), See all with the season. Admin: admin/review.js shows the New show block and the slot line on a submission card, disables Approve with the line for a sub-admin on a first episode, and loses the series kind; admin/index.js lists 'Shows' under 'On the web' → /admin/shows (the admin list and the admin show page stay web-only this round; the deck already carries the decisions that matter on a phone). Wiring: _layout.js headerShown:false for creator/show/new, creator/show/[id] and creator/show/[id]/episode/[episodeId]; PushListener routes /creator/show/<id> and /creator/show/<id>/episode/<id> (and opens the site for /admin/shows/<id>); TopNav/BottomNav rows unchanged ('Creator Studio' is the entry). The drafts footer says 'The server is being updated' on a 503 instead of blaming the connection. Verified with expo export (iOS + Android) and the pure tests, not a device, like every creator screen so far; a device pass goes on Jose's checklist.

### Build slices

#### 1 · Data, rules and the bugs (website only, nothing visible changes)

migration 117_shows.sql (series kind / defaults / seasons / decision_note / id columns / creator_id backfill / status normalise + guarded CHECK; episodes has_page / page_notes / pending_src, season = 1 backfill, the logged de-duplication shove, the unique partial index, the bonus index; reorder_show_season + move_episode security-definer functions with service_role grants; title_prices / purchases target_id → text; series_drop_runs; the RLS lines); lib/showRules.js + scripts/test-show-rules.mjs + mobile/src/lib/showRules.js; lib/notificationTypes.js (+ mobile mirror); lib/seriesResume.js sortEpisodes with the tie-break adopted by seriesHub, heroCandidates, purchases, pages/series/[id], episodePage, channelEngine; lib/series.js (kind, defaults, regex fix, picker filters, findSeries preview, signTrailer); lib/showPage.js (getShowPage, createShow, submitDraft extracted from submit-episode, SELECT_LEGACY + insertCompat/updateCompat, the RPC + fallback, isMissing fallbacks); trailer signing everywhere + stream-token part 'trailer' + SeriesHero/HeroSpotlight refreshSrc and image fallback + approve protects trailer_src; edit-episode podcast/bonus/changed-fields fixes; acceptApplication distinct ids + createShow; manual-episode through createShow (pending unless 'Live now'); submit-episode validate-then-insert, next-free numbers, '__new__' refused, defaults copied, 23505 retry; resolve-artwork/resolve-edit notify the series owner + invalidate + pending_src; queue-counts fixes; thin-episode fallbacks in rowToEpisode/rowToPublicEpisode; the podcast 302; ?season= on seriesHub; my-submissions additions + the 60 s Cloudflare memo; listDrafts cap 100 + seriesId; CLAUDE.md migration bullet; hand the SQL over in chat.

Verify: node scripts/test-show-rules.mjs (planMove, positionsFor, numberingProblems, fieldPolicy, canMoveTo, showRollup, cascadePlan, parseEpisodeCode, titleFromFilename), every existing scripts/test-*.mjs, npm run lint, npm run check:refs; pw/show-data-http.js against the stubs: a show created with defaults and distinct ids, a trailer signed on series-hub / episode-page and refreshed through stream-token part 'trailer' (null when the fake Cloudflare fails), a podcast episode saved through edit-episode keeps its show, bonus + parent saved, '__new__' refused, a taken slot 409s with the two candidates, the RPC reorder and the two-phase fallback leave the same numbers, the 302 for a podcast kind, thin fallbacks on /api/episode-page, resolve-edit notifies series.creator_id; pw/series-resume-http.js and pw/series-resume-loop.js still green.

#### 2 · The creator's show page on the web

pages/creator/show/{new,[id],[id]/episode/[episodeId]}.js; components/show/{ShowControlRoom,ShowCard,ShowStatusCard,AddEpisodesBar,SeasonSection,EpisodeRow,EpisodeEditor,MoveSheet,ExtrasShelf,RemoveShowCard}.js; the .show-* CSS block next to .cs-* (.show-grip, body.show-dragging, the gap row, the tabs); the Pointer-Events drag lifted from ScheduleTimeline's startDrag into a small useSortableRows hook (planMove preview, Alt-drop swap, the Undo toast); the page-side upload queue over UploadContext.startVideoUpload (one at a time, resume by re-pick, 'Keep this tab open' banner, 30 files per drop); the routes GET/POST /api/show, PATCH /api/show/[id], /api/show/[id]/{episodes,send,reorder,move,seasons,positions}, PATCH /api/show/episode/[id] + /video + DELETE staged; the hub's 'Your shows' strip (+ needsYou from showRules, 'Waiting on the show'); /creator/series 308; Your work's group header link, season sub-headings, codes, flags (title / new video waiting), one needsYou(); the submit page's Place block (kind filter, next-free chip, conflict line, ?season=&number= prefill); the old creator routes forwarding to the new ones.

Verify: pw/show-page.js at 390 and 1280 against the stubs (fake Cloudflare + Supabase stub + minted session): create a show, add one episode from the drop zone and watch the draft row appear with the runtime read from the file, add six files at once and see them queue one at a time with next-free numbers in file-name order, stop and resume one by re-picking, Send 6 for review in one request with a skipped row reported, drag E7 above E3 and see only E3–E7 change with the toast and Undo, Alt-drop swap, ↑/↓ and the Move sheet across seasons and to another own show, a move into a show with buyers refused for the creator, typing a taken number offers Swap / Insert, the editor's three tabs with direct saves, staged saves with Cancel and locked tier/rating on a live row, pending_src on a live replace with the old src still served, 'Give this episode its own page', the status card's flags for a gap and a failed master, the 503 line before 117, no overflow, no page errors; screenshots for the canvas note; pw/creator-path.js still green.

#### 3 · The admin side on the web

lib/reviewQueue.js (series kind out, meta.show / position / slot / masterReady, slot and master validation, SHOW_LIVE_NEEDS_FULL_ADMIN, approve-brings-show-live, no inline saver loop); components/admin/ReviewQueue.js (show grouping header, the New show sub-card, 'Approve · brings <show> live', disabled states with the line); pages/admin/shows/{index,[id],[id]/episode/[episodeId]}.js in AdminShell with ShowControlRoom mode='admin' + the Decisions rail (facts, Owner, Status with Fix numbering, Decisions with Approve all in review / Reject all / Who can watch / Hold / Take down / Restore / Tell savers, Staged changes with Current → Proposed + two thumbnails / two players + notes, inline Approve/Reject on rows with 'Fix number' / 'Approve as E7?', 'edited N min ago', 'Open in Library modal', the Removal card with cascadePlan and the typed name, History); /api/admin/shows + /api/admin/show/[id] actions; lib/showDelete.js deleteShowCascade (resolve-deletion delegates for series); ADMIN_NAV 'Shows' + badge 'shows' + ADMIN_REDIRECTS /admin/ownership; the Creators tab from OwnershipPanel; '+ Create a show for a creator'; Orphaned media 'Dismiss'; lib/seriesDrop.js notifySeriesDrop wired to the daily expire-content cron with series_drop_runs and to 'Tell savers'; series-ownership notifies both and invalidates.

Verify: pw/show-admin.js against the stubs: a first-episode Approve by a full admin flips the show (show_live + episode_approved rows, both caches invalidated, one audit), the same by a review_submissions sub-admin refused 403 with the line and the button disabled, Approve refused on a taken slot / missing number / unready master, 'Approve all in review (12)' refuses the whole batch when 3 are processing and then approves all with ONE owner notification and ONE audit line, the New show sub-card and the group header, Fix numbering renumbers only the flagged season and notifies, an admin Move across owners shows earningsStayWith and buyersAffected and is written, staged approve/deny notifies series.creator_id with the note and invalidates all_series_approved_v1, pending_src approved swaps the master, Hold / Take down (decision_note stored) / Restore, the cascade summary and counts with a bought episode withdrawn and the rest deleted with their watch_history / notifications / title_prices rows, Deny restores, the Owner change notifies both, Tell savers runs the capped loop once per show per day against the fake Stripe with a cursor, History rows listed, 403 per capability for a sub-admin per action, Orphaned media Dismiss.

#### 4 · The public pages

SeriesHero / HeroSpotlight: showRollup tier pill ('Tapa + · pilot free'), rating, Made by, year, season labels, signed trailer with refreshSrc and the image fallback; pages/series/[id].js + /api/series-hub additions (isSubscriber, isAdmin, isOwner, kind, rollup, seasonLabels, crew/shotAt/crewCalls, hasPage, preview), ?season= read and written, the Extras tab grouped by anchor, 'Details' chevron on has_page rows, BundleCard codes with season, the preview bar, og tags, the podcast 302; pages/episode/[id].js + /api/episode-page: the has_page landing view with notes, See all with ?season=, the <title> with the show name, og:image, ?preview=1, extras anchored to the episode, the Trailer action hidden when null; libraryCards / GenreRow read the roll-up; 'New episode' reads released_at.

Verify: pw/series-public.js against the stubs: the roll-up pill for a free-pilot show, the rating box, Made by from defaults / owner / first episode, ?season=2 opens season 2 and the label shows, Extras under their episode, the signed trailer src in the page and a refresh through stream-token, the preview bar for the owner and 404 for a stranger on a pending show, the 302 for a podcast kind, og tags, a has_page episode renders the landing view with notes and the Own card then plays on Play, a thin episode shows 'Episode 4' with the show's description and genre, See all carries the season; pw/shoot-episode-after.js, pw/end-card.js, pw/series-resume-http.js still green; the pure end-card and series-resume tests.

#### 5 · The app

mobile/src/lib/showRules.js + notificationTypes.js mirrors (already written in slice 1, wired here); creator/show/new.js, creator/show/[id].js (sections, the one-at-a-time asset queue over tusUpload, ↑/↓, the E-badge stepper, Send N, the kebab sheet, the Move sheet, Extras, SellTitleSheet, Channels, Remove), creator/show/[id]/episode/[episodeId].js (the editor screen); the hub's Your shows strip + ?status=/?attention= hand-off; account/my-work.js changes (sort, codes, Open show page, extras under the show, useLocalSearchParams, www host, the 'server is being updated' footer); series/[id].js and episode/[id].js payload additions (rollup, isSubscriber, seasonLabels, crew/shotAt/crewCalls, ?season=, preview, hasPage landing, signed trailer, See all with season); admin/review.js New show block + slot line + disabled Approve with the line, series kind gone; admin/index.js 'Shows' on the web; _layout.js + PushListener wiring.

Verify: npx expo export --platform ios and --platform android bundle; node scripts/test-show-rules.mjs on the mirror (the same test file imports both copies and diffs their exports); a Playwright run of every API payload the screens read (show summaries, show page, positions, series-hub, episode-page) with a Bearer token against the stubs; a device pass goes on Jose's checklist (open a show, add two files, ↑/↓ one, send for review; approve from the deck and see the show go live).

#### 6 · Ship

CLAUDE.md: the show page bullet (routes, rules, FIELD_POLICY, SHOW_LIVE_NEEDS_FULL_ADMIN, the retired surfaces, the cron step, migration 117 'written, not yet run' until Jose confirms); the canvas note with the screenshots; npm run lint, npm run check:refs, every scripts/test-*.mjs, every pw suite; commit and push per slice (each slice ships on its own; the forwards keep the old routes alive one release); the report with the 117 SQL, the raise-notice lines to read in the SQL Editor, and Jose's confirm list.

Verify: The CI workflow (check-refs + tests + audit) green on the push; Vercel deploy green; a signed-in sweep (pw/sweep.js out|mara|admin at 1280 and 390) with no new page errors or overflow; the post-deploy checklist for Jose: run 117, open /creator/show/new, /admin/shows and a /series/<id>?preview=1 while signed in and out.

### Retired

- /creator/series (Series management) — 308 to /creator or /creator/show/<id>; components/SeriesMediaForm.js, NameDescPanel and ArtPills become caller-less (kept in the tree like CreatorSubmissionForm); components/AddSeriesForm.js stays caller-less.
- The show-level gear menu on /creator/my-work (Edit show details / Sell the whole series / Add bonus content) — the group header's 'Open show page →' replaces it; the app's show action sheet rows likewise.
- EditSubmissionModal's show / season / number fields and the '__new__' option (the modal stays for standalone pending titles until the next pass); RequestEditModal, ArtworkModal, ReplaceVideoModal, CaptionUploadModal and DeleteRequestModal as entry points for SHOW episodes on Your work (the components stay for standalone titles).
- The review queue's 'series' kind (QUEUE_KINDS) and its chip; the app deck's 'Check artwork on the web' card for shows; decideReviewItem's series branch after one release.
- ADMIN_NAV 'Series ownership' (/admin/ownership → /admin/shows via ADMIN_REDIRECTS; the OwnershipPanel roster lives on /admin/shows?tab=creators).
- The 'Series management' link on the Creator Studio hub (web) and the app's help text 'Its own poster and trailer come later, from the website's Series management'.
- SeriesMediaForm's private tus loop (the trailer upload goes through UploadContext.startVideoUpload kind 'trailer').
- The manual /api/notify-series-drop as the only path (it stays as 'Tell savers'); the inline unsigned trailer manifests on every page.
- The old creator routes edit-submission, request-episode-edit, request-series-edit, add-artwork (episode half), replace-video, series-media, request-series-deletion, request-episode-deletion, create-series as UI entries — they become thin forwards to the new routes for one release, then go.
- The four caller-less review routes (pending-series, review-submission, bulk-review, pending-submissions) once nothing imports them (check:refs), in slice 6.

### Not built in this round

- A wishlist table (My List lives in Stripe customer metadata) — saver notices stay a capped, cursor-continued daily loop plus a button; the real fix is its own small round.
- Co-ownership / collaborators on a show, and any re-crediting of episodes' earnings on an ownership transfer (a Terms section 4/5 and lawyer question).
- A vertical ('Snippet series') editor: vertical shows are frozen read-only; the submit path is not taught to set series_id for vertical.
- Season entities (per-season art, release dates) beyond the jsonb label; a per-season release schedule.
- Drag-and-drop in the app (↑/↓, the E-badge stepper and the Move sheet are the reorder; no sortable-list or PanResponder build) and touch drag on the phone web (↑/↓ and the sheet).
- Captions from the app (no document picker — 'Add captions on the website').
- A second upload path: no two-at-a-time queue, no multi-address mint route, no expo-keep-awake; a long batch needs the tab or the app open and resumes file by file when re-picked.
- Changing the sitemap or search to list only has_page episodes — every episode URL stays listed as today until Jose decides (forJose).
- The admin Shows list and admin show page in the app (the deck approves; the pages open in the browser).
- Folding standalone films/shorts into the episode editor (their modals stay for one more round; the obvious next pass).
- Automatic ad-break or caption generation for batch-added episodes; per-episode stills cut automatically for a show's episodes (a show's episode keeps the show's art unless the creator sets its own or presses 'Cut from the film').
- Reversing a show's channel bookmark when an episode moves (lib/channelPlan.js indexOfEpisode falls back to episode 1; noted on the Move sheet, not changed).
- A podcast-hub redesign in the app (podcasts/[id].js keeps its pre-redesign shape) and the public podcast page's seasons.
- Deleting the retired modals and SeriesMediaForm from the tree (caller-less for one round, removed in a later cleanup once the suites prove the editor covers them).

### For Jose (the design round's own questions, before the canvas renumbered them as 1–18)

1. **A show goes live with its first approved episode — no separate 'New series' review card — and only a FULL admin may bring a new show live (a sub-admin approves later episodes of a live show).**
   - Recommended: Yes to both. One decision with the film in front of you, no more invisible approved episodes, and your capability line stays exactly as today; `SHOW_LIVE_NEEDS_FULL_ADMIN` is one constant if you later want sub-admins to do it.
   - Alternatives: (a) Let review_submissions sub-admins bring a show live too (flip the constant). (b) Keep a separate show decision with a richer card and a notification (one more queue item per show; the 'approved episode of a pending show' state stays possible).
   - Why it matters: It decides who can publish a new show on the site and removes a step you have today.
2. **Show-level tier / rating / genre / 'Made by' are DEFAULTS copied onto each new episode (and read-time fallbacks for thin episodes); what viewers see of the show is a roll-up: 'Tapa +' when any episode is premium, 'Tapa + · pilot free' when the pilot is free, the highest rating.**
   - Recommended: Yes; confirm the mixed-tier wording ('pilot free' vs 'some episodes free').
   - Alternatives: A true show-level tier/rating that every episode inherits (loses the free-pilot pattern and complicates Buy to own and early screenings); or keep deriving everything from episodes (every episode's genre and rating typed by hand).
   - Why it matters: It is what the hero, every card and the About tab say about a show, and how much a creator has to type per episode.
3. **Money stays with the uploader (episodes.submitted_by); the show owner only arranges, and may move only episodes they uploaded; an admin may move anything and is shown who keeps the earnings; no co-owners this round.**
   - Recommended: Yes for this round.
   - Alternatives: Pay the show owner for every episode of their show (changes Creator Share, ad share, title sales and tips attribution and needs Terms language and the lawyer); collaborators with a split (a design round of its own).
   - Why it matters: Nothing in this redesign changes who gets paid; the alternatives do.
4. **'Optional per-episode page' = a per-episode switch that turns a cold visit into the landing view (notes, credits, trailer, the Own card); every episode keeps its /episode/<id> URL; default off for a show's episodes; the sitemap and search are unchanged.**
   - Recommended: Yes, default off for series episodes, sitemap and search as today.
   - Alternatives: Default on for every episode; list only has_page episodes in the sitemap and search results (the show stands in for the rest — fewer 'Episode 4' hits with the show's blurb, fewer indexable pages); a true URL-less episode (breaks My List, notifications, Continue Watching, purchases, the end card — not recommended).
   - Why it matters: It is what 'a page for more info' means to a viewer and what Google sees of a show.
5. **The owner reorders, renumbers and re-seasons a live show at once (no re-review) and moves episodes between their own shows at once; a move changes only the numbers between source and target and shows them first; 'Renumber from 1' is explicit; a creator's move in or out of a show with buyers is refused (an admin may, seeing the consequence).**
   - Recommended: Yes.
   - Alternatives: Stage order changes for approval like content (doubles your queue); renumber a season contiguously on every drag (changes 'S1 E5' in viewers' Continue Watching and RSS); block admins too when a show has buyers.
   - Why it matters: It is how often a creator has to ask you to fix a number, and whether a viewer's episode numbers ever shift under them.
6. **Which fields on a LIVE title apply at once and which wait for approval: title, poster, still, title image, trailer and a replaced video wait (visible, cancellable; the old video keeps playing); description, genre, Made by, year, runtime, funding link, ad breaks, channels, captions, the page switch and position apply at once; who can watch and the rating are admin-only.**
   - Recommended: Yes.
   - Alternatives: Everything at once with post-moderation (you have Flag & pull) — simplest for creators, riskier on cards; everything staged (today's rule extended) — the most admin work; let creators change tier/rating on live titles (entitlement changes without a human); keep replace-video's unpublish.
   - Why it matters: It sets how much of a live show a creator can change without you, and whether a colour-grade fix takes a show off the air.
7. **Trailers are signed like masters (60-minute tokens, a refresh path in the hero), not public.**
   - Recommended: Yes — your anti-harvest rule, and the creator trailers uploaded since 2026-10-25 start playing again.
   - Alternatives: A trailer-only unsigned mint plus an exception in 'Protect every video' (a permanent public manifest per show).
   - Why it matters: Whether any Cloudflare video on the site is ever public.
8. **People who saved a show are told automatically when it gains live episodes — from the daily cron, once per show per day, capped at 1,000 Stripe customers per run with a continuation, plus a 'Tell savers' button on the admin show page; a new Tapa+ episode still holds 24 h for Standard like any premium title.**
   - Recommended: Yes, with the honest note that My List lives in Stripe metadata and a wishlist table is a later round.
   - Alternatives: Keep the manual button only; or hold the notice until the early-screening window ends so Standard members are told when they can actually watch.
   - Why it matters: My List already promises the email; this decides when it is sent and what it costs.
9. **Alter title_prices.target_id and purchases.target_id from uuid to text in migration 117.**
   - Recommended: Yes, before the first live sale — the columns cannot hold a real episode or series id today.
   - Alternatives: Leave it and discover it on the first Checkout webhook (the row insert fails after the customer paid).
   - Why it matters: It is a change to the money tables.
10. **Deleting a show cascades with one admin confirmation (and the creator sees the same cascade words before requesting); anything with buyers is withdrawn instead — the whole show for a series purchase, one episode for an episode purchase.**
   - Recommended: Yes.
   - Alternatives: Keep today's refusal until every episode is handled one by one; never delete, only hide.
   - Why it matters: Whether a show can ever be removed cleanly and what buyers keep.
11. **Podcasts use the same show page (podcast vocabulary, MP3 import, one running list when there is one season); /series/<podcast> redirects to /podcasts/<id>; the public podcast page is unchanged.**
   - Recommended: Yes.
   - Alternatives: Leave podcasts on today's path until they are actually uploaded (two editors for one table).
   - Why it matters: One editor for everything in the series table.
12. **Vertical series are frozen: no editor, no pill, the browse page keeps whatever exists.**
   - Recommended: Yes, until Snippets get a creator-side grouping.
   - Alternatives: Build a 'Snippet series' kind on the show page now (the submit path must learn to set series_id for vertical); or remove the vertical browse page and the end-card slide.
   - Why it matters: A shipped public surface with no author either gets an owner or goes.
13. **Rejected shows: no show-level rejection any more (a take-down stores its reason on the show); existing rejected rows get 'Resubmit'.**
   - Recommended: Yes.
   - Alternatives: Keep rejection as a terminal state and only add the reason column.
   - Why it matters: Whether a creator can ever recover a declined show.
14. **Ownership transfer stays an admin action (an Owner card on the admin show page, notifying both accounts); no co-owners.**
   - Recommended: Yes.
   - Alternatives: Collaborators with a share split now (needs the money decision above first).
   - Why it matters: Who may arrange a show, kept separate from who is paid.
15. **The 'Add several' limit is 30 files per drop, uploaded one at a time through the existing uploader with the tab (or the app) kept open; re-picking the same files resumes.**
   - Recommended: Yes — no second upload path, no new native dependency, the honest limit said on the drop zone.
   - Alternatives: Two uploads in flight (a rewrite of the one-upload rule the creator path just stabilised); a ZIP / CSV import; one episode at a time only (today).
   - Why it matters: How a 40-episode podcast gets onto the site, and whether the upload code that shipped on 10-31 is touched.
16. **App scope this round: the creator's show screens and the episode editor (↑/↓ and sheets, no drag); the admin Shows list and admin show page stay web-only (the deck approves and shows the New show card).**
   - Recommended: Yes — matches 'the app mirrors the website' for creators; the admin's long pages stay on the laptop where you review.
   - Alternatives: Also build /admin/shows in the app (another 2 days); or defer the whole app half to a later slice.
   - Why it matters: Three days of the plan and what you can do from your phone on a Sunday.
17. **The migration's de-duplication: existing duplicate (show, season, number) rows are shoved to 1001/1002… (a visible gap the status card flags, each row printed as a notice in the SQL Editor), rather than guessed into an order.**
   - Recommended: Yes — you read the list and fix the handful on the show page; nothing is reordered for you.
   - Alternatives: Renumber duplicates by created_at automatically (silently changes viewer-facing numbers); defer the unique index until the admin page shows no conflicts (duplicates stay possible until you remember).
   - Why it matters: Whether any episode number changes without a person deciding it.
