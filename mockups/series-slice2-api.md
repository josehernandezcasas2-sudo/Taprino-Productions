# Series revamp, slice 2 — the show page's API

What the creator's show page, the episode editor, Edit show, the hub's "Your shows" strip, Your work and the
submit page's Place block call (mockups/series-revamp-spec.md, "Build slices" § 2). Everything here is built
and checked against the stand-ins by the session scratchpad's `pw/show-api-http.js` (before 118, after 118 and
the stand-in's default). The server code is `lib/showPage.js` (server-only) behind `pages/api/show/**`, with
the route plumbing in `lib/showRoute.js`; the rules are `lib/showRules.js` (client-safe: pages import that,
never `lib/showPage.js`).

## Conventions (every `/api/show/**` route)

- **Who**: a signed-in creator, or someone on the team. Signed out → `401 { error: 'Sign in first.' }`; signed in
  but neither → `403 { error: 'Creator access required.' }`. The app sends its Bearer token (no Origin); the website
  sends its cookie. "The team" below = a full admin or a sub-admin with `manage_episodes` (their changes are
  always direct); a sub-admin without it may read (`canAccessAdmin`) but changes nothing.
- **Headers**: `Cache-Control: private, no-store` on every answer; CORS for the site's own origins
  (lib/cors.js); `OPTIONS` → 204. A method a route doesn't take → `405 { error: 'Method not allowed' }`.
- **Errors**: always `{ error: '<a line for the person>' }`, often with more fields (`code`, `field`, `holder`,
  `nextFree`…) listed per route. A 500 never carries a database or Stripe message: it is the route's own plain
  line ("Could not save the show.", …). Show the `error` line as it is.
- **Limits** (per account per hour; the per-IP limit is twice that): over → `429 { error: 'That’s a lot in a row —
  give it a little while.' }` with `Retry-After: 600`. The numbers are on each route. **Poll the show page at most
  every 15 seconds** (240 an hour).
- **Ids**: episode and series ids are text slugs; a draft id is the `creator_drafts` row's id (a uuid). An id
  that isn't one → 404 (shows/episodes) or 400 (`Which draft?`).
- **Words**: show / episode for a podcast, series / episode otherwise (`showNoun(kind)` in lib/showRules.js).
- **Audit**: every write writes one `audit_log` row whose `details` is JSON `{ actor: 'owner' | 'admin', words, … }`
  (`owner` = acting on your own show or upload). /admin/audit-log shows that JSON as text until slice 3 reads it.
- **Migrations**: 116 (`creator_drafts`) and 118 (shows) may not have run. Each route says what it does then; the
  table at the end sums it up. `GET /api/show/[id]` tells the page which it has: `migration { shows118, drafts116 }`.
- **Money**: nothing in slice 2 sets who is paid. The show page payload's `money` block (slice 1) is data only —
  don't draw "Runs it · Paid to" yet (Jose's questions 22–24 are open).

## Shapes

### A show summary (`GET /api/show`)

```
{ id, name, kind: 'series' | 'podcast' | 'vertical', noun: 'series' | 'show',
  status: 'pending' | 'approved' | 'rejected',
  state: 'live' | 'ready' | 'review' | 'drafts' | 'empty' | 'pulled' | 'removal' | 'declined',
  statusLabel,            // "Live", "Ready to go public", "Not public yet", "Pulled", "Removal requested", "Not this time"
  headline, level,        // the status card's headline; level ok | review | warn | neutral
  isPublic, isOwner, canEdit, poster, thumbnail, publicAt, createdAt, held, removalRequested,
  counts: { episodes, live, inReview, declined, drafts, extras, seasons },
  seasons: [{ number, label: 'Season 2 · The Return', episodes, inReview, drafts }],
  countLine,              // "S2 · 8 episodes · 1 in review", "1 episode · in review · 1 draft", "Nothing added yet"
  staged: { name, poster, thumbnail, heroImage, titleImage, trailer (booleans), episodes: <count>, any },   // the clock glyph
  needsYou: [lines],      // "Ready to go public", "2 episodes came back “Not this time”", numbering, failed files, captions
  problems: [{ code, level, words }],
  makePublic: { ok, code, reason } | null,   // owner or full admin; reason null when ok
  pickable, pickReason,   // for the pickers: "An admin declined this show", "Pulled while an admin looks at it",
                          // "Its removal is requested", "Vertical series are set up by the studio"
  href: '/creator/show/<id>' }
```

### The show page (`GET /api/show/[id]`, also `view` after `PATCH`)

```
{ show: { id, name, kind, status, state, statusLabel, headline, level, isPublic, description, year, fundingUrl,
          channelOptIn, defaults: { tier, rating, mainGenre, genre, artist, adsEnabled },   // each only when set
          credits: { studio: { name, userId } | null, producer: …, order: ['maker','studio','producer'] },
          creditLines: [{ key: 'maker' | 'studio' | 'producer', label: 'Made by' | 'Hosted by' | 'Studio' | 'Producer', name, userId }],
          seasonLabels: [{ number, name }],
          art: { poster, thumbnail, heroImage, titleImageUrl, trailer: { src (signed, 60 min), expiresAt, ref: { seriesId } } | null },
          staged: { name, description, poster, thumbnail, heroImage, titleImageUrl, titleImageRemoval,
                    trailer: { src (signed), expiresAt } | null } | null,          // owner / team only
          deletion: { requested, reason, at }, held, holdReason ("Rights / copyright: <note>"), decisionNote,
          cutArtPending,       // "Cut them from the first episode for me" still to happen
          publicAt, createdAt, ownerId, ownerName, canEditShow },
  seasons: [{ number, label, rows: [row…] }],      // rows in play order; gap rows where numbers are missing
  extras: [episode row + { kind: 'extra', anchor: { episodeId, code } | null }],
  problems: [{ code, level, words, season?, episodeIds }],     // the status card's lines (owner / team)
  counts: { episodes, live, inReview, declined, drafts, extras, seasons },
  money: …,             // data only, see Conventions
  price: { status, priceCents, pendingCents } | null,         // the whole-series price (Sell card)
  cascade: { words, counts, seriesBuyers } | null,            // the removal card's words before asking (owner / team)
  makePublic: { ok, code, reason } | null,                    // owner / full admin
  addBar: { drafts116, filesPerDrop: 30, draftsCap: 100, draftsUsed },   // draftsUsed = the viewer's drafts, every show
  viewer: { userId, isOwner, isAdmin, teamView, teamEdits, isContributor, canEditShow, seesWhoIsPaid },
  migration: { shows118, drafts116 }, fallback118 }
```

Rows (`kind`):

- `episode`: `{ id, title, displayTitle ("Episode 4" when it has none), season, seriesOrder, code: 'S1 E4', status,
  contentType, held, deletionRequested, withdrawnAt, inRunningOrder, runtime, thumbnail (its own art, never
  Cloudflare's frame), createdAt, releasedAt, mine }` — and for the owner, the team, or the viewer's own upload:
  `description, poster, tier, rating, mainGenre, genre, artist, releaseYear, adsEnabled, channelOptIn,
  fundingUrl, hasCaptions, captionsStale, hasTrailer, hasPage, hasPageChoice, pageNotes, master
  ('ready' | 'uploading' | 'processing' | 'error' | 'deleted' | 'audio' | 'external' | 'unknown' | 'none'),
  masterReady, rejectionReason, deletionReason, staged: { title, description, poster, thumbnail, newVideo },
  submittedBy, uploaderName (when someone else uploaded it), paidTo`. A contributor's view of the owner's rows
  stops at the first group. `master` is Cloudflare's word for the rows still in review (asked at most once a minute
  per file); an approved row isn't asked again and reads `unknown` — treat that as playing, never as "processing".
- `draft` (the viewer's own; the team also sees the owner's): `{ id, title, displayTitle, season, seriesOrder,
  code, status: 'draft', contentType, master, createdAt, updatedAt, mine }` and for the author `video: { uid,
  state, name, bytes, uploadUrl, runtimeSeconds } | null` (re-pick the same file to resume with `uploadUrl`),
  `file: { name, bytes } | null` (the file it was made from, before its upload starts), `audio: { bytes } | null`,
  `blocker` (why it can't be sent yet, or null) and `ready`. A draft row doesn't carry its `form` or `trailer`: the
  page reads them from `GET /api/creator/drafts?seriesId=<id>` (or keeps the `POST …/episodes` answer) before it
  saves one. Blockers: "It’s an extra — finish it on the submit page" (an extra's draft the three-step page filed
  under the show: it takes no number and isn't sent from here), "Add the file first", "Still uploading —
  keep this tab open, or pick the same file to resume", "Still processing", "The file failed — replace it",
  "The file is gone — add it again", "It’s a podcast episode — this show is a series", "It isn’t a podcast episode —
  this show is a podcast", "Pick a genre for it", "Its runtime isn’t known yet", "E4 in Season 1 is taken by “X”. The
  next free number is E9." (a draft whose file Cloudflare can't place yet reads "Still processing").
- `gap`: `{ id: 'gap-1-6', season, from, to, words: 'E6 is missing' | 'E6–E8 are missing' }`.

### The episode editor (`GET /api/show/episode/[id]`, also `view` after `PATCH`)

```
{ episode: { id, title, displayTitle, code, season, seriesOrder, status, statusLabel ("In review", "Live",
             "Approved · not public yet", "Not this time", "Pulled", "Pending deletion", "Withdrawn"), contentType,
             held, holdReason, deletionRequested, deletionReason, deletionRequestedAt, withdrawnAt, rejectionReason,
             createdAt, reviewedAt, releasedAt, description, pageNotes, hasPage, hasPageChoice (true | false | null),
             tier, rating, mainGenre, genre, artist, releaseYear, runtime, fundingUrl, adsEnabled, adBreakSeconds,
             channelOptIn, isOriginal, featured,
             inherited: { title, description, genre, artist, releaseYear } | null,   // what pages show (show's when blank)
             differs: { tier, rating, mainGenre, genre, artist, releaseYear, adsEnabled } | null,   // "Differs from the show · Reset"
             art: { poster, thumbnail, titleImageUrl, heroImage, showPoster, showThumbnail },
             trailer: { src (signed), expiresAt, ref: { episodeId } } | null,
             captions: { has, label, language, stale },
             master: { state, ready, durationSeconds },
             staged: { title, description, poster, thumbnail, video: { state, ready } | null },
             credits, creditLines, bonus: { parentType, parentId, code, parentTitle } | null,
             submittedBy, uploaderName },
  show: { id, name, kind, status, statusLabel, isPublic, ownerId, ownerName, defaults, year, description } | null,
  policy: { <field>: { mode: 'direct' | 'staged' | 'locked' | 'invite', line } },
  positions: { season, nextFree, taken: { <n>: { id, title, kind: 'episode' | 'draft' } }, gaps } | null,
  seasons: [{ number, label }],
  extras: [{ id, title, status }],            // extras anchored to this episode
  moveTargets: [{ id, name, kind, status, statusLabel, ok, reason, tag, lines }],   // the shows the viewer owns, but this one
                                                    // (the team picks anyone's from GET /api/show?all=1; /move checks again)
  viewer: { userId, isUploader, isRunner, team, canAccessAdmin },
  migration: { shows118 } }
```

`policy` covers every field of lib/showRules.js `FIELD_POLICY.episode`: title, description, poster, thumbnail,
titleImage, trailer, video, genre, mainGenre, artist, releaseYear, runtime, fundingUrl, adBreakSeconds,
adsEnabled, channelOptIn, captions, pageNotes, hasPage, season, seriesOrder, bonusParent, seriesId, credits,
paidTo, tier, rating, isOriginal, featured. `line` is null for direct, else the words to show under the field:
"Waits for approval; what’s there now stays until then", "The new file goes to an admin; the current one keeps
playing until then", "Ask us to change who can watch", "Ask us to change the rating", "Ask us about Tapa Original",
"Ask us about the hero spot", "Ask us to change this", "Only the person who uploaded it can change this", "Only the
show’s owner can change this", "Withdrawn and kept for its buyers", "Removal requested — cancel it to make changes",
"Pulled while an admin looks at it", "This can’t be changed here", for `paidTo` (mode `invite`, not built) "They’re
asked first; until they accept, the earnings keep going where they go now", and — **a live episode's title image and
trailer** — "A live episode’s title image and trailer can’t wait for approval yet — ask us to change them." (there is
no `pending_*` column for them on episodes; see "Not built").

## Routes

### `GET /api/show` — the viewer's shows (240 an hour)

`?mine=1` (the default): the shows the viewer owns, plus a show from before owners were recorded that they have
an episode in. `?all=1` (the team): every show, newest first, at most 300. → `{ shows: [summary] }`, newest
first. A show someone else owns that the viewer only uploaded into is not listed (it opens read-only by its URL).

### `POST /api/show` — New show (10 an hour, the same key as /api/creator/create-series)

Body: `{ name (required, ≤ 120), kind: 'series' | 'podcast' (default series), description (≤ 2,000),
defaults: { tier: 'free' | 'premium', rating, mainGenre, genre, artist, adsEnabled }, posterBase64,
posterFileName, thumbnailBase64, thumbnailFileName (data URLs: JPEG, PNG, WebP or GIF under 6 MB),
cutFromFirst: true ("Cut them from the first episode for me"), releaseYear, fundingUrl, channelOptIn, credits }`.

→ `200 { ok, id ('<name>-<stamp>-show'), name, kind, status: 'pending', href: '/creator/show/<id>', cutArtPending }`.
The show is private until Make it public. `cutFromFirst` with no art given: the first episode sent with a ready
video file has its frame cut into the show's poster and still (straight onto the show while no episode is
approved). Before 118 the kind, defaults, credits and the cut flag aren't kept (`cutArtPending: false`).

Refusals (400 unless said): "A show needs a name." · "A show’s name is limited to 120 characters." · "A show is
a series or a podcast." · "The description is limited to 2,000 characters." · "The defaults are Who can watch, the
rating, the genre, Made by and ads." · "That funding link doesn’t look right." · the credits' lines (below) ·
the artwork's own lines ("Image "x" is too large — please use a file under 6MB.", ""x" isn't a JPEG, PNG, WebP
or GIF image.") · 409 "A show with that id already exists.".

### `GET /api/show/[id]` — the show page (240 an hour)

The owner (series.creator_id), the team, or someone with an episode in it (a contributor: read-only, their own
rows in full). Anyone else, or no such show → `404 { error: 'That show isn’t there.' }`. Works before 118 (the
118 fields read as absent, `migration.shows118: false`) and before 116 (no draft rows, `addBar.drafts116: false`).

### `PATCH /api/show/[id]` — Edit show (60 an hour, bodies up to 10 MB)

The owner or the team. Body (every key optional):
`{ name, description, releaseYear, fundingUrl, channelOptIn, kind, defaults, seasons, credits, posterBase64,
posterFileName, thumbnailBase64, thumbnailFileName, heroImageBase64, heroImageFileName, titleImageBase64,
titleImageFileName, removeTitleImage: true, trailerUid, resubmit: true }`.

What a field does (lib/showRules.js `fieldPolicy`, target `show`): while the show has **no approved episode**
everything applies at once; once one is approved (public or "Ready to go public") **name, poster, still,
hero image, title image and trailer wait for approval** in `pending_*` (the live value stays; a newer one
replaces the waiting one with a notice and the replaced file is orphaned); description, year, funding link,
channels, defaults, season names and credits always apply at once. The team's change is always direct. While
the show is pulled or its removal is requested, every field is refused for its owner.

- `defaults` merge: a key you send replaces it, `null` or `''` removes it, the rest stay. They apply to episodes
  added from now on (never to episodes already there).
- `seasons`: the whole list `[{ number, name }]` (a name is cut at 80 characters, an empty one drops the label, a
  number listed twice keeps its first name; at most 100 named seasons, numbered 1–9999, else 400 "A show can name up
  to 100 seasons." / "Seasons are numbered from 1 to 9999.": the labels ride on every catalogue page's props). Or use
  `PATCH /seasons` (below) for one at a time, which refuses a name over 80.
- `credits`: `{ studio: { name, handle } | null | 'inherit', producer: …, order: ['studio','maker','producer'] }` —
  `handle` (with or without "@") links the line to that account (resolved here; the stored shape is
  `{ name, userId }`; a name is cut at 120), `null` = none, `'inherit'` = the show's (an episode's credits only), a
  key you leave out stays as it is, and `credits: null` clears both lines. A `userId` already stored for the line is
  kept when you send it back unchanged (with no `handle`). Refusals: 400 "Credits are a studio and a producer." · 400 "The studio
  credit is a name, and an @handle if they’re on the site." · 400 "No one on the site goes by @x." (`code: 'handle', field`).
- `kind`: `'series' | 'podcast'`, only while the show has no episode or draft.
- `removeTitleImage: true` waits as a removal (`pending_title_image_removal`) on a live show.
- `trailerUid`: the uploader's own Cloudflare video (`get-upload-url` with `kind: 'trailer'`); the team may give anyone's,
  but it has to exist (404 "Trailer: No video found with that ID.").
- `resubmit: true`: a declined show (status rejected, older rows) goes back to "not public yet".

→ `200 { ok, unchanged, applied: [fields], staged: [fields], notices: [lines], notSaved: [{ field, reason }], view }`.
Field names in `applied` / `staged`: name, description, releaseYear, fundingUrl, channelOptIn, kind, defaults,
seasons, credits, poster, thumbnail, heroImage, titleImage, titleImageRemoval, trailer, resubmit. `view` is the
show page payload without asking Cloudflare again (a draft's file shows its stored state, and an episode in
review's `master` may read `unknown` until the next GET: keep the file lines from the last GET). **Before 118**: defaults, seasons, credits and kind come back in
`notSaved` with "Needs a database update (migration 118)." and nothing else is touched for them.

Refusals: 404 "That show isn’t there." · 403 "Only the show’s owner can change it." (`code: 'who'`) · 403 a
locked field: `{ error: <line>, code: 'locked', field }` — "Pulled while an admin looks at it", "Removal requested —
cancel it to make changes", "A show’s kind is set once it has episodes" · 400 "A show needs a name." / "A
show’s name is limited to 120 characters." / "The description is limited to 2,000 characters." / "That year
doesn’t look right." / "That funding link doesn’t look right." / "A show is a series or a podcast." / "The
defaults are Who can watch, the rating, the genre, Made by and ads." / "Upload a title image or remove it — not
both." / "Trailer: that doesn’t look like a video id from this site." / "Trailer: <the ownership line>" (403
"Trailer: That video was uploaded by someone else.", 404 "Trailer: No video found with that ID.") · 409 "There’s
no title image to remove." (`nothing`) · 409 "That’s the trailer it has already." (`same-file`) · 409 "Only a
declined show can be sent again." (`not-declined`) · 403 "Pulled while an admin looks at it" (`locked`: a
taken-down show is reopened by an admin, not resubmitted) · the artwork's own lines (400).

### `DELETE /api/show/[id]/staged?field=` — take back a waiting change (60 an hour)

`field`: name, description, poster, thumbnail, heroImage, titleImage (also clears a waiting removal) or trailer.
The owner or the team. The waiting file is orphaned. → `200 { ok, cancelled: field }`.
Refusals: 400 "Which change? name, description, poster, thumbnail, heroImage, titleImage or trailer." · 404 ·
403 (`who`) · 409 "Nothing is waiting for approval there." (`nothing-staged`).

### `POST /api/show/[id]/removal` — Remove this show… / Cancel request (20 an hour)

The same logic as `/api/creator/request-series-deletion` (lib/showPage.js `setShowRemoval`); an admin confirms it
(slice 3). The owner or a full admin. Body `{ action: 'request', reason } | { action: 'cancel' }`. The show leaves
the site while it waits. → `200 { ok, seriesId, deletionRequested }`. Show the card's words from the page's
`cascade.words` before asking.
Refusals: 400 'action must be "request" or "cancel".' · 404 · 403 "Only the creator of this series can do that." ·
400 "A reason is required to request deletion." · 400 "Keep the reason under 1,000 characters." · 409 "Its removal
is already requested." (`requested`) · 409 "No removal is requested." (`not-requested`).

### `POST /api/show/[id]/episodes` — + Add episode / + Add several (240 an hour, the drafts key)

Each file becomes a **draft** at once (creator_drafts), before its upload starts. The owner (or a legacy owner) or
the team. Body:
`{ season?, sortBy?: 'name' (default) | 'date' | 'given', items: [{ videoName, videoBytes, runtimeSeconds,
lastModified, title?, season?, seriesOrder?, videoUid?, uploadUrl?, audioUrl?, audioBytes? }] }` (1–30 items).

- `season`: the section it was dropped on; default the show's last season (1 for a new show).
- Numbers: a number in the file's name is kept when free (S01E05, s1e5, 1x05, Ep 5, E05…; with a season it
  sets the season too), the rest take the next free numbers in file-name order (or date / given order); an
  explicit `seriesOrder` is kept when free. A taken number goes to the next free one with a `note` ("E5 is taken,
  so it goes to E10").
- Titles from the file name (lib/showRules.js `titleFromFilename`); `''` when nothing is left — it reads "Episode
  N" everywhere.
- The form takes the show's defaults (its own, or before 118 what most of its episodes have): tier, rating,
  main genre, genre, Made by, ads; channels off.
- `videoUid` (an upload already made: the uploader's own) / `audioUrl` (an MP3 link already imported with
  `/api/creator/import-audio-url`) ride on the draft; usually neither — the upload is attached later (below).

→ `200 { ok, season, drafts: [draft view + { season, seriesOrder, code, title, displayTitle, fromCode, note,
fileName }], skipped: [{ index, name, reason }] }`. A draft view is `{ id, form, video, trailer, createdAt,
updatedAt }` (the same as `/api/creator/drafts`). Per-item `skipped` reasons: "That doesn’t look like a video id
from this site.", "That file is in this drop twice.", "That video was uploaded by someone else." (and the other
ownership lines), "That audio link doesn’t look right.", "A title is limited to 200 characters.", "No episode
number left".

Refusals: 404 · 403 "You can only add episodes to your own series." (`who`) · 400 "Add at least one file." · 400
"Up to 30 files at a time." (`too-many`, `max: 30`) · 409 "You can keep up to 100 drafts — send or discard some
first (you have 94)." (`drafts-full`, `used`, `cap`) · 400 (`code: 'show-closed'`) "Vertical series are set up by
the studio." / "That show’s removal is requested — it takes nothing new." / "An admin declined that show —
resubmit it before adding to it." / "That show is pulled while an admin looks at it — nothing can be added for
now." (the last two not for the team) · 400 "Seasons are numbered from 1." · **before 116**: `503 { error: 'Adding
episodes here needs a database update (migration 116).', code: 'migration-116', submitHref:
'/creator/submit?type=series&series=<id>' }` (`type=podcast` for a podcast; the three-step submit page still works
then: link to `submitHref`). The checks run in that order: who, the items, then the drafts table, then the show.

**Then, one file at a time** (never 30 links up front): mint the upload with
`POST /api/creator/get-upload-url?seriesId=<id>` (or `seriesId` in the body; `{ fileSize, fileName, kind: 'main' }`
→ `{ uploadUrl, uid, method: 'tus' }`; **60 an hour** for one of your own shows, 20 otherwise; over → 429 "Too many
upload requests — please wait a bit and try again.") — with
UploadContext: `startVideoUpload(file, { urlEndpoint: '/api/creator/get-upload-url?seriesId=<id>', resumeUrl:
draft.video?.uploadUrl, kind: 'main', onUrl })` — and save it onto its draft with `PATCH /api/creator/drafts
{ id: draft.id, video: { uid, state: 'uploading', name, bytes, uploadUrl, runtimeSeconds } }` → `{ draft }`.
**A PATCH is a partial change** (2026-11-04, `lib/draftPatch.js`): the `form` keys sent replace those keys and every
other key stays; `video` / `trailer` are touched only when sent (null clears one — a replaced or cleared video is
deleted from Cloudflare when nothing else uses it); the server merges onto the row as it is now, guarded by
`updated_at`, and answers 409 "The draft changed while it was saving — try again." if it kept changing. So the queue
sends only the video and the draft editor only the fields the person changed, and neither puts back the other's
older copy (the whole-draft `POST { id, form, video, trailer }`, which replaces all three, still works for an old
client). Re-picking the same file resumes it from `video.uploadUrl`. A draft is edited (title, genre, number…) with
the same PATCH; `GET /api/creator/drafts?seriesId=<id>` lists the viewer's drafts of a
show, `?id=` reads one; `DELETE /api/creator/drafts` with the body `{ id }` discards it (and its video when nothing
else uses it). The drafts route and this one share one limit (240 an hour); its own 429 reads "Saving too often.
Give it a moment.".

### `POST /api/show/[id]/send` — Send N for review (20 an hour, submit-episode's key: a batch counts once)

Body `{ draftIds: [up to 10] }` — the viewer's own drafts of this show. Loop on the client for more ("Sending 10
of 24…"). Every draft is checked first (Cloudflare's word on its file now, a genre, a runtime, its number free),
then each is sent through the same core as `/api/creator/submit-episode` (`submitDraft`, thin: the show's
defaults fill what the draft left blank; the title may be empty — stored `''`, read as "Episode N"; description
and Made by may be blank — the show's are shown), one after the other. The draft is deleted, its video kept.
→ `200 { ok, created: [{ draftId, id, season, seriesOrder, code, title }], skipped: [{ draftId, reason, nextFree? }] }`.
A draft's trailer (one made on the three-step page) goes with it once Cloudflare has the whole file (processing or
ready, asked at send); a trailer whose upload never finished is left out and recorded as an orphan. One
`show_sent_for_review` notice to the show's owner per request ("Night Bus: 3 episodes are in review (S2
E4–E6)." → `/creator/show/<id>`) and one audit line.

Skipped reasons: the draft blockers (see Shapes), "That draft isn’t there any more.", "That draft belongs to
another show.", a number another draft of the same request took first ("E4 in Season 1 is taken by “X”. The next
free number is E9.", with `nextFree`), the submit core's own lines, "Could not send it — try again.".
Refusals: 400 "Which drafts?" · 400 "Up to 10 at a time — send the rest in the next go." (`too-many`, `max: 10`) ·
404 · 403 (`who`) · **before 116**: `503 { error: 'Drafts need a database update (migration 116).', code: 'migration-116' }`.

### `POST /api/show/[id]/reorder` — a drag, ↑/↓, a number typed in one season (120 an hour)

Body: lib/showRules.js `planMove(rows, id, target)`'s single-season shape (amendment 14) —
`{ season, episodes: [{ id, number }], drafts: [{ id, number }] }`: send exactly the plan's `season`,
`episodes` and `drafts` (the plan has them when everything stays in one season of one show). The owner (any
row) or the team; drafts only the viewer's own (the team: any). The drafts are read and checked first (a draft gone,
moved or someone else's refuses the whole change, nothing moves); then episodes move through `reorder_show_season` in
one transaction, then the drafts' forms. Nothing changes status; a live show stays live.
→ `200 { ok, rows: [{ id, seriesId, season, number, fromSeriesId, fromSeason, fromNumber }], drafts: [{ id,
number }], words: 'E4→E1, E1→E2, E2→E3, E3→E4' }`. **Undo** = post the plan's `undo` the same way.

Refusals: 404 · 403 "Only the show’s owner can change its order." (`who`) · 409 "Removal requested — cancel it to
make changes." / "Pulled while an admin looks at it." (`locked`) · 400 "Send the episodes and drafts with their new
numbers." · 400 "Seasons are numbered from 1." / "Which episode?" / "Which draft?" / "Episode numbers run from 1 to
9999." / "An episode is listed twice." / "Two episodes were given the same number." · 409 "E5 is taken — reload the
show and try again." (`taken`: a number another episode keeps; refresh and re-plan) · 400 "One of those episodes
isn’t in that season of this show any more — reload the show." / "One of those drafts isn’t in this show any more
— reload the show." / "One of those drafts isn’t in that season any more — reload the show." · 403 "That draft
isn’t yours to renumber." · **before 118**: `503 { error: 'Reordering needs a database update (migration 118).',
code: 'migration-118' }` (disable the grip and ↑/↓ with that line).

### `POST /api/show/[id]/move` — Move to… (60 an hour)

Body: `{ episodeId | draftId, toShowId?, toSeason?, toNumber?, mode?: 'swap' | 'insert', closeGap?: true }`.
- No `toShowId`: inside this show. `toSeason` alone = the end of that season. `toNumber` free = it takes it;
  taken and no `mode` → 409 with the choices; `mode: 'insert'` (or `shift: true`) = it takes it and the rows from
  there move one along; `mode: 'swap'` = the two trade places (one show only).
- `toShowId`: another show of the same kind; season 1 unless `toSeason`; the end of the season unless `toNumber`.
- `closeGap: true`: the rows after it in the season it leaves move up.

Who (lib/showRules.js `canMoveTo`): inside a show — its owner or the team. Into another show — a creator moves
only what they uploaded, between their own shows of the same kind, never in or out of a show with whole-series
buyers, never off a slot a channel pinned, never a live standalone title; the team moves anything (a channel's
pins on it are cleared, and the uploader is told: `episode_moved_by_admin` → `/creator/show/<target>`).

→ episode: `200 { ok, words: 'E7 → E3; E3–E6 become E4–E7', rows: [as reorder], lines: ['Future earnings go to…',
'1 series buyer loses this episode', 'It leaves the site until X goes public; its buyers keep playing it',
'A channel that was up to this episode starts the show again from episode 1', …], earningsMove, buyersAffected:
{ lose, gain }, leavesSite }`; nothing to do → `{ ok, unchanged: true, words: 'Nothing moves', rows: [], lines: [] }`.
→ draft: `200 { ok, words, drafts: [{ id, season, number, seriesId? }], lines: [] }`.

Recipe: run `planMove` on the page first; when the plan is single-season use `/reorder` with its shape (drafts in
the way move along too); otherwise use `/move`. A move between seasons or shows doesn't renumber drafts in the way:
the status card then flags the shared number.

Refusals: 404 "That show isn’t there." / "That show isn’t there any more." (the target) / "That episode isn’t in
this show any more — reload the show." · 400 "Which episode?" · 409 `locked` (the show pulled or being removed) ·
canMoveTo's (`{ error, code, tag }`; 403 for `who`, `uploader`, `target-owner`, `owners`; 404 for `missing`,
`no-target`; else 409): "Only the show’s owner can change its order." (`who`) · "Only the person who uploaded it
can move it to another show." (`uploader`) · "It can only go into one of your own shows." (`target-owner`) · "Only
an admin can move a title between owners." (`owners`) · "This show has buyers — ask us." (`buyers`, tag "(has
buyers — ask us)") · "Pinned on TapaTV — ask us to unpin it first." (`pinned`) · "A podcast episode only joins a
podcast." / "Only podcast episodes join a podcast." / "It only joins a show of its own kind." / "Only series and
podcast episodes join a show." (`kind`, tag "(another kind)" or "(vertical — studio only)") · "Vertical series are
set up by the studio." (`vertical`) · "That show was declined — resubmit it first." (`target-declined`, "(not this
time)") · "That show’s removal is requested." (`target-removal`, "(removal requested)") · "That show is pulled while
an admin looks at it." (`target-held`, "(pulled)") · "It’s withdrawn and kept for its buyers." · "Its removal is
requested — cancel that first." · "Pulled while an admin looks at it." · "Extras are placed with “Place after…”, not
moved." · "Ask us to put a live title into a show." (`live-standalone`) · a typed number that is taken: `409 {
error: 'E4 is Night Shift — swap them, or insert it there', code: 'taken', holder: { id, title, season, number },
choices: ['swap', 'insert'] (['insert'] across shows), nextFree }` · planMove's other refusals (409 with its
`code`): "Send it again for review before it takes a place." (`not-in-order`), "2 episodes share E4 — sort that out
first." (`duplicate`), "Swapping works inside one show — use Insert here." (`swap-shows`), "It has no number to
swap — use Insert here." (`swap-unnumbered`), "E900 sits outside the running order — give it its own number first."
(`parked`), "Seasons are numbered from 1." / "Episode numbers start at 1." / "Episode numbers go up to 9999." ·
**before 118** (episodes): `503 { error: 'Moving needs a database update (migration 118).', code: 'migration-118' }`.
Drafts: 400 "Which draft?" · 404 "That draft isn’t in this show any more — reload the show." · 403 "It can only go
into one of your own shows." · the target show's `show-closed` lines · 409 "An episode holds that place — a draft
doesn’t move episodes along. Pick a free number, or send the draft first." (`taken`, `nextFree`) · before 116: 503
"Drafts need a database update (migration 116).". A draft moves before 118 too.

### `PATCH /api/show/[id]/seasons` — season names, a new season, Renumber from 1 (60 an hour)

The owner or the team (not while pulled or being removed: 409 `locked`).
- `{ action: 'rename', number, label }` (label up to 80; empty removes it) → `200 { ok, season, label: 'Season 1 ·
  Night One', seasons: [{ number, name }] }`. Before 118: `503 { error: 'Season names need a database update
  (migration 118).', code: 'migration-118' }`.
- `{ action: 'add', label? }` → `200 { ok, season: <the next number>, label: 'Season 3' }`. Nothing is written unless
  a label is given (then as rename; before 118 the 503 above). The season exists once an episode lands in it.
- `{ action: 'renumber', number }` — "Renumber from 1": the season's rows in play order (drafts too) get 1, 2, 3…;
  declined rows keep theirs → `200 { ok, season, words: 'E5 becomes E4', rows, drafts }`; already in order →
  `{ ok, season, words: 'Season 1 already runs E1–E4', rows: [], drafts: [] }`. Before 118: 503 "Reordering needs a
  database update (migration 118)." (`migration-118`).

Refusals: 400 'action must be "rename", "add" or "renumber".' · 400 "A show can name up to 100 seasons." / "Seasons
are numbered from 1 to 9999." (naming one; taking a name away always works) · 404 · 403 "Only the show’s owner can change its
seasons." (`who`) · 400 "A season’s name is limited to 80 characters." · 400 "Which season?" · 409 a renumber the
rules refuse (`{ error, code }`) · the reorder refusals above.

### `GET /api/show/[id]/positions?season=&number=&exclude=` — numbers for the Place block and steppers (240 an hour)

The owner, a contributor or the team (else 404). → `200 { season, label, kind, taken: { <n>: { id, title, status,
kind: 'episode' | 'draft' } }, nextFree (past every episode and the viewer's drafts), gaps: [{ from, to }], parked,
duplicates: { <n>: [ids] }, unnumbered: [ids], seasons: [{ number, label }], nextSeason }`. With `number`: `check:
{ number, free, episodeFree, code: 'free' | 'taken' | 'draft', words ('E3 is taken by “Pilot”', 'E4 is your draft
“Cold Open”', 'E6 is free'), holder: { id, title } | null, draftHolder: { id, title } | null, nextFree }` — `exclude`
is the row being placed (its own number counts as free). Episodes decide what the server accepts (`episodeFree`);
a draft holding the number is named so the page can steer around it.
Refusals: 404 · 400 "Seasons are numbered from 1." · 400 "Episode numbers run from 1 to 9999.".

### `POST /api/show/[id]/public` — Make it public (20 an hour)

The owner or a full admin (decision 2), once an episode is approved. One-way: status approved, `public_at` now, the
approved episodes' release clock restarts (Premium's early screening and "New episode" start now), the trailers are
protected, one `show_live` notice to the owner (its link is `/creator/series?series=<id>`: **the slice-2 pages make
/creator/series forward to /creator/show/<id>**), one audit line. → `200 { ok, id, publicAt, released: [episode ids] }`.
Refusals (`{ error, code }`): 409 "Once an episode is approved, it can go public." (`empty`) · 403 "Only the show’s
owner or a full admin can make it public." (`who`) · 409 "It’s public already." (`public`) · 409 "Pulled while an
admin looks at it." (`held`) · 409 "Its removal is requested." (`removal`) · 409 "An admin declined this show —
resubmit it first." (`declined`) · 409 "Vertical series are set up by the studio." (`vertical`) · 404 "That show
isn’t there any more." (`missing`) · 409 "It went public a moment ago — reload the page." (`public`).

### `GET /api/show/episode/[id]` — the episode editor (240 an hour)

Its uploader, the show's owner, or the team (reads); anyone else → `404 { error: 'That episode isn’t there.' }`.
Drafts aren't episodes: a draft row opens with `GET /api/creator/drafts?id=` and saves with `POST /api/creator/drafts`.

### `PATCH /api/show/episode/[id]` — the editor's save (60 an hour, bodies up to 10 MB)

Body (every key optional): `{ title, description, pageNotes, hasPage: true | false | null, credits, tier, rating,
mainGenre, genre, artist, releaseYear, runtime ('MM:SS' | 'H:MM:SS') | runtimeSeconds, fundingUrl, adsEnabled,
channelOptIn, isOriginal, featured, adBreakSeconds: [seconds] (up to 20; `[]` = the pre-roll only, stored as `[0]`), season, seriesOrder, bonusParentType:
'series' | 'episode', bonusParentId, posterBase64, posterFileName, thumbnailBase64, thumbnailFileName,
cutFromFilm: true | 'poster' | 'thumbnail', titleImageBase64, titleImageFileName, removeTitleImage: true,
trailerUid, resubmit: true }`.

Each field follows `policy` (the GET's map): **direct** — written at once (on a title in review the write is
guarded by its status, so a review decision in between isn't overwritten); **staged** — on a live title the title,
poster and still wait in `pending_title` / `pending_poster` / `pending_thumbnail` (the live one stays; a newer one
replaces the waiting one with a notice; sending the live title again cancels a waiting title, and a waiting picture is
taken back with `DELETE …/staged`); **locked** — refused only when the
value actually changes (sending the current value back is fine). `null` for tier / rating / mainGenre = "Reset to the
show's" (they take the show's default now); for genre / artist / releaseYear = blank, so pages show the show's.
`season` / `seriesOrder` are the show owner's (its uploader can't renumber it); a taken number answers the slot 409.
`bonusParentType` / `bonusParentId` place an extra with the show or after one of its episodes (owner or uploader).
`cutFromFilm` cuts the poster and/or still from its own (ready) Cloudflare file. `resubmit: true` sends a "Not this
time" title back to review (`message`: "It’s back in review."); its number is re-checked: still free → kept, taken
meanwhile → the next free one (`renumbered`, and `message`: "It’s back in review as episode 9 — episode 4 was taken while
it was declined. You can change the number while it’s in review."). Episodes have one `description` column (up to 4,000): the editor's "One line about it"
and "About it" both edit it. Captions stay on `/api/creator/add-captions` (4 MB bodies).

→ `200 { ok, unchanged, applied: [fields], staged: [fields], notices, notSaved, renumbered?: { season, from, to },
message?, view }`. Field names: title, description, pageNotes, hasPage, credits, tier, rating, mainGenre, genre,
artist, releaseYear, runtime, fundingUrl, adsEnabled, channelOptIn, isOriginal, featured, adBreakSeconds, place,
bonusParent, resubmit, poster, thumbnail, titleImage, titleImageRemoval, trailer. **Before 118** pageNotes, hasPage
and credits come back in `notSaved` ("Needs a database update (migration 118).").

Refusals: 404 "That episode isn’t there." · 403 `{ error: <policy line>, code: 'locked', field }` (lines under
Shapes; e.g. "Ask us to change who can watch", "Only the person who uploaded it can change this", "A live episode’s
title image and trailer can’t wait for approval yet — ask us to change them.") · 409 the slot answer `{ error: 'E4 in
Season 1 is taken by “Night Shift”. The next free number is E9.', code: 'taken', season, number, holder: { id, title },
nextFree }` · 400 "A title is limited to 200 characters." / "Give it a title." (a title outside a show) / "A live
episode keeps its title while a new one waits — type the new one." / "The description is limited to 4,000
characters." / "A few lines about it." (a title outside a show) / "The notes are limited to 4,000 characters." / "Who
can watch is “free” or “premium”." / "Pick a genre for it." / "That year doesn’t look right." / "The runtime, as
MM:SS (or H:MM:SS)." / "That funding link doesn’t look right." / "Ad breaks are a list of times (up to 20)." / "Ad
breaks are times from 0:00." / "Only an episode in a show has a season and a number." / "Seasons are numbered from 1."
/ "Episode numbers run from 1 to 9999." / "Give it a number." / "Only an extra is placed with the show or after an
episode." / "That extra isn’t in a show." / "An extra sits with the show or after one of its episodes." / "After which
episode?" / "That episode isn’t in this show." / "Upload a title image or remove it — not both." / "Trailer: …" / the
credits' lines / the artwork's lines · 409 "Only a title that came back “Not this time” can be sent again."
(`not-declined`) · 403 "Only the person who uploaded it can send it again." (`who`) · 409 "Pulled while an admin looks at
it." (`locked`: a declined title that is pulled, or in a pulled show, waits for an admin; the team may) · 409 "Removal requested — cancel
it to make changes." (`locked`) · 409 "Its file has to finish processing before a frame can be cut from it."
(`not-ready`) · 409 "Only a video can give a frame — upload the art instead." (`no-video`) · 409 "Couldn’t cut a
frame from the film just now — try again, or upload the art." (`cut-failed`) · 409 "There’s no title image to remove."
(`nothing`) · 409 "That’s the trailer it has already." (`same-file`) · 409 "It changed a moment ago (a review,
perhaps) — reload and try again." (`stale`).

### `POST /api/show/episode/[id]/video` — Replace the file (30 an hour)

Body `{ videoUid }` (an upload made with `get-upload-url`, `kind: 'main'`: the uploader's own). Its uploader or the
team (the show's owner can't replace someone else's file); the team may give anyone's upload, but it has to exist
(404 "No video found with that ID." — nothing is replaced and the current file isn't orphaned).
- **Live**: the new file waits in `pending_src` for an admin; the current one keeps playing (also while pulled).
  → `{ ok, episodeId, staged: true, resubmitted: false, message: 'The new file goes to us first; the current one
  keeps playing until we approve it.' }`. A newer file replaces the waiting one (orphaned). The admin's approval
  screen for it is slice 3 (`/api/admin/resolve-artwork` already handles `pending_src`).
- **In review**: replaced at once → `{ staged: false, resubmitted: false, message: 'The new file replaces the old one;
  it’s still in review.' }`.
- **Not this time**: replaced and back in review → `{ resubmitted: true, message: 'It’s back in review with the new
  file.' }` (or, when its number was taken meanwhile, `renumbered` and "It’s back in review with the new file as
  episode 9 — episode 4 was taken while it was declined.").
- The team on a live title: replaced at once ("The new file plays from now on.").
The old (or replaced waiting) video is orphaned only after the save.
Refusals: 400 "That doesn’t look like a video id from this site." · 404 · 403 `locked` (the video policy's line) ·
403 "That video was uploaded by someone else." / 404 "No video found with that ID." / 403 "That video is already used
by someone else." · 409 "That’s the file it plays already." (`same-file`) · 409 "That file is already waiting for
approval." (`same-file`) · 409 "Another episode took its number just now — try again." (`taken`) · 409 `stale` · 500
"Could not resolve the uploaded video — is Cloudflare Stream fully configured?" · **before 118** (a live title): `503
{ error: 'Replacing a live episode’s file needs a database update (migration 118).', code: 'migration-118' }`.

### `DELETE /api/show/episode/[id]/staged?field=` — take back a waiting change (60 an hour)

`field`: title, description (an older edit request), poster, thumbnail or video. Its uploader or the team. The
waiting file is orphaned. → `200 { ok, cancelled }`. Refusals: 400 "Which change? title, description, poster,
thumbnail or video." · 404 · 403 "Only the person who uploaded it can take that back." (`who`) · 409 "Nothing is
waiting for approval there." (`nothing-staged`).

### `POST /api/show/episode/[id]/removal` — Remove this episode… / Cancel removal (20 an hour)

The same logic as `/api/creator/request-episode-deletion` (lib/showPage.js `setEpisodeRemoval`). Its uploader.
Body `{ action: 'request', reason } | { action: 'cancel' }`. A live title is hidden from the site at once (say so only
then: `hiddenNow`). → `200 { ok, episodeId, deletionRequested, hiddenNow }`. While it waits, every field is locked.
Refusals: 400 'action must be "request" or "cancel".' · 404 "Episode not found." · 403 "That episode does not belong to
you." · 400 "A reason is required to request deletion." · 400 "Keep the reason under 1,000 characters." · 409 "It’s
withdrawn already and kept for its buyers." (`withdrawn`) · 409 "Its removal is already requested." (`requested`) · 409
"No removal is requested." (`not-requested`).

## The older creator routes

They keep their callers and their answers:
- `/api/creator/get-upload-url`: now 60 an hour (per account and per IP) when the body or query names one of the
  caller's own shows (`seriesId`) or the caller is an admin; 20 otherwise (one counter: links for a show count
  toward the 20 of a later single submit).
- `/api/creator/create-series`: a thin alias of New show (`createShowFromForm`): same `{ ok, id, name }`, the id now
  ends in `-show`, the show is private and owned (as before), with its artwork.
- `/api/creator/request-series-deletion`, `/api/creator/request-episode-deletion`: their checks and answers as
  before (asking twice is still fine there); the write, the cache and an audit line are shared with the removal
  routes above.
- Unchanged: `edit-submission`, `request-episode-edit`, `request-series-edit` (still stages a show's description),
  `add-artwork`, `replace-video` (still sends a live title back to review), `series-media` (always stages),
  `submit-episode` (the three-step page), `drafts`, `add-captions`, `import-audio-url`, `import-video-url`,
  `list-series`, `my-submissions`.

## Before a migration has run

| | before 116 (no `creator_drafts`) | before 118 (no show columns) |
| --- | --- | --- |
| GET /api/show, /api/show/[id] | work; no draft rows; `addBar.drafts116: false` | work; 118 fields absent; `migration.shows118: false` |
| POST /api/show | works | works; kind, defaults, credits, cut flag not kept |
| PATCH /api/show/[id] | works | works; defaults, seasons, credits, kind → `notSaved` |
| POST …/episodes | **503** "Adding episodes here needs a database update (migration 116)." + `submitHref` | works (defaults from the show's episodes) |
| POST …/send | **503** "Drafts need a database update (migration 116)." | works |
| POST …/reorder | works for episodes; drafts **503** "Drafts need a database update (migration 116)." | **503** "Reordering needs a database update (migration 118)." |
| POST …/move | episodes work; drafts **503** "Drafts need a database update (migration 116)." | episodes **503** "Moving needs a database update (migration 118)."; drafts work |
| PATCH …/seasons | works (renumber: episodes only) | rename / named add **503** "Season names need a database update (migration 118)."; renumber 503 (reordering) |
| GET …/positions | works (no drafts) | works |
| POST …/public | works | works (no `public_at`) |
| GET/PATCH /api/show/episode/[id] | works | works; pageNotes, hasPage, credits → `notSaved` |
| POST …/video | works | a live title **503** "Replacing a live episode’s file needs a database update (migration 118)."; in review / declined work |

## Not built in slice 2 (the server side)

- Waiting changes to a **live episode's title image or trailer**: episodes have no `pending_title_image_url` /
  `pending_trailer_src`, so they are refused with their own line rather than applied unreviewed. Needs a migration
  (119) and resolve-artwork support (slice 3) — or a decision that they apply at once.
- "Make it an extra" (turning an episode into an extra) and "Make this part of a show" (`seriesId` on a show-less
  episode) in the editor's Place tab.
- Choosing who gets paid (`paid_to`, payee invites) — waits on Jose's questions 22–24.
- The admin side: approving a waiting `pending_src` / show art in a show page, the admin show pages (slice 3).
- Thin episodes are stored with an empty title (`''`): the pages read "Episode N" (lib/showRules.js
  `inheritedField`), but places that print `episodes.title` directly — the review queue's approve notice, an RSS feed,
  a purchase's title snapshot — show nothing until they learn the same fallback.
