# Series revamp, slice 5 (the app) — the show page's kit

What the app's creator half of the series revamp is built from (2026-11-04): New show, the show page, the
upload queue, the Move sheet and the shared pieces. The editors (episode / draft / Edit show screens) and the
lists (the hub's Your shows strip, Your work, the submit screen's Place block) build on these. The API is
`mockups/series-slice2-api.md`; the rules are `mobile/src/lib/showRules.js` (the website's
`lib/showRules.js` word for word — change both together, `node scripts/test-show-rules.mjs` diffs them).
The website's components these mirror are in `components/show/*` (`mockups/series-slice2-components.md`).

Verified by `npx expo export` (iOS + Android), check-refs, lint, the unit tests, and an HTTP walk of every
route the screens call with a Bearer token (`scratchpad/pw/app-show-http.js`, 91 checks). **Not on a device.**

## Screens and routes

| Route | File | Notes |
| --- | --- | --- |
| `/creator/show/new` | `mobile/src/app/creator/show/new.js` | New show. `router.replace` to `/creator/show/<id>?created=1` |
| `/creator/show/<id>` | `mobile/src/app/creator/show/[id]/index.js` | The show page. Params: `created=1` (the "is ready" flash), `ep=<episode id>` or `draft=<draft id>` (scrolls to that row and flashes it) |
| `/creator/show/<id>/episode/<episodeId>` (`?draft=1` for a draft) | `mobile/src/app/creator/show/[id]/episode/[episodeId].js` → `components/show/EpisodeEditor.js` (a draft: `DraftEditor.js`) | The episode / draft editor. The show page opens it from a row tap, Edit, Replace file. `?sent=1` (a draft just went for review) toasts "Sent for review" |
| `/creator/show/<id>/edit` (`?tab=art`) | `mobile/src/app/creator/show/[id]/edit.js` → `components/show/ShowEditor.js` | Edit show. The show page opens it from Edit show, the poster, and the staged / trailer problem lines |

All four have `headerShown: false` in `mobile/src/app/_layout.js` already — don't touch the layout.

The address builders are in `components/show/ShowBits.js` (below): `showRoute`, `episodeEditorRoute`,
`showEditRoute`, `submitRoute`, `publicRoute`, `episodePublicRoute`. Use them so every screen links the same way.

## Shared changes outside `components/show/`

- **`AccountFrame`** (`mobile/src/components/account/AccountBits.js`) takes three more props, all optional:
  - `back={{ href, label }}` — the Back pill goes back to that screen with that label (`router.dismissTo(href)`: down
    the stack when it's there, else in this screen's place — `navigate` pushed a second copy on top, because Expo
    Router's NAVIGATE pushes unless it is the current route). The show page
    and New show pass `{ href: '/creator', label: 'Creator Studio' }`; an editor passes
    `{ href: showRoute(showId), label: show.name }`.
  - `overlay` — drawn after the ScrollView, fixed (the toast: `overlay={<RoomToast … />}`).
  - `refreshControl` — passed to the ScrollView.
  - The show screens give it `dashboard={!isLoaded ? null : { isSignedIn }}` from Clerk's `useAuth()` — the frame
    then draws the spinner / sign-in states, and the screen handles its own load errors inside the frame.
- **`pickVideos({ limit = 30 })`** in `mobile/src/components/CreatorBits.js`: several videos at once
  (`allowsMultipleSelection`, `selectionLimit`, `orderedSelection`, Passthrough), `[]` when nothing was picked.
  `pickVideo` is unchanged.
- **`abortUpload(line)`** in `mobile/src/lib/tusUpload.js`: stops the transfer in flight (its `done` never
  settles afterwards — the caller stops waiting). Used by the queue when a draft is discarded mid-upload.
  `startTusUpload` / the one-at-a-time rule are unchanged.
- **`okTint(a)`** in `mobile/src/lib/theme.js`: `colors.ok`'s tint, next to `brassTint` / `oliveTint`.
- **`pickImageAsDataUrl({ width, format })`** (`CreatorBits.js`): `format: 'png'` keeps transparency (a title image);
  JPEG stays the default.
- **`RoomToast({ toast, onClose, bottom })`** (`ShowBits.js`): `bottom` lifts the toast over a bar fixed at the foot
  (the editors' Save bar).
- **The upload queue** (`showUploadQueue.js`): an item with `freshStart: true` now uploads even when its draft's file
  is already processing or ready (the draft editor's "Replace the file"); before, it was skipped as "has its file".
- **`undoMoveSteps`** (both `lib/showRules.js` copies, website too): a move made *inside one season* through
  `/move` (the Move sheet's typed number with Insert here or Swap) is now undone with **one `/reorder`** of every
  row back to its old number. Before, the first step moved the row back to a place that was held by then and the
  server answered 409 — Undo never worked for those moves, on the website either. Cross-season moves are undone
  as before (a `/move` back, then a `/reorder` per season); a swap across seasons can't be undone (null → the
  toast has no Undo). Tests added (111 show-rules checks).

## `mobile/src/lib/showApi.js`

- `showCall(method, path, body, getToken) → Promise<{ ok, status, data, error }>` — every `/api/show/**` call
  (and the drafts, pricing, import routes the show page uses). Bearer token from `freshToken(getToken)`, JSON
  body, the whole answer back: `status` and `data.code` matter (`taken`, `migration-116`, `migration-118`,
  `locked`, `who`…). `error` is the server's own line; a network failure is `OFFLINE_LINE` ("Couldn’t reach the
  site — check the connection and try again.", status 0). A 403 `{ suspended }` reaches the suspension gate.
  `getToken` may be Clerk's getter, a token string or null. **Pass a stable getter** (the screens wrap Clerk's in a
  ref + `useCallback`, see the show screen) so a `useCallback` that depends on it doesn't change every render.
- `migrationRefusal(r) → { code, line } | null` — a 503 whose `code` is `migration-11x`. Show `line` and grey the
  control; never blame the connection.
- `showPath(id)` → `/api/show/<encoded id>`.

## `mobile/src/lib/showUploadQueue.js` — the upload queue

Module state (survives moving between screens, not a closed app). One transfer at a time through
`startTusUpload`; while another caller's upload runs (the submit screen, an editor's Replace the file) the queue
waits and carries on when it ends (it subscribes to `tusUpload`).

- `enqueueShowUploads(items, getToken)` — `items: [{ draftId, asset, showId, showName, label, runtimeSeconds,
  freshStart }]`. `asset` is an expo-image-picker video asset. `label` is what the rows and the panel say
  (`"S1 E3 · Title"`). `freshStart: true` starts the file afresh even when the draft has a stopped upload of the
  same name and size (a *different* file picked for a draft).
- `cancelShowUpload(draftId)` — a queued file goes; the uploading one is stopped (its tus address stays on the
  draft). Call it **before** discarding a draft.
- `retryShowUploads({ showId | draftIds }, getToken)` — "Try again": stopped files go back in line.
- `useShowQueue(showId) → { items, paused, uploads, live, upload }` — `uploads` is `{ [draftId]: { key, status:
  'queued' | 'starting' | 'uploading' | 'uploaded' | 'stopped', pct, eta ("3 min left"), after (the label it
  waits for), error, name, bytes, label } }` for the rows and `rowPill(row, { upload })`; `paused` is the line
  when an upload link couldn't be had (a limit); `live` = something is queued or moving. Re-renders once a second
  while a file moves.
- `subscribeShowQueue(fn)`, `showQueueState()`, `uploadsFor(queue, upload, showId)` — the same, lower level.
- `assetName(asset)`, `assetFile(asset) → { name, size }`, `assetRuntime(asset) → seconds | null` — the name and
  size an asset uploads under (the same rule as `startTusUpload`). Use `assetFile` with `fileMatches(file, row)`
  ("Pick the same file to resume").

What one file does, request by request (the website's UploadContext queue): `GET /api/creator/drafts?id=` (a gone
draft is skipped; one with a processing/ready video is skipped) → `startTusUpload({ urlPath:
'/api/creator/get-upload-url?seriesId=<show>', kind: 'main', resumeUrl })` → `POST /api/creator/drafts { id,
form, video: { uid, state: 'uploading', name, bytes, uploadUrl, runtimeSeconds }, trailer }` (form and trailer
read just before: that route replaces all three) → again with tus's own address when it is known → again with
`state: 'processing'` when the last byte is in.

## `mobile/src/components/show/ShowBits.js` — the kit

- **Addresses**: `showRoute(showId, params?)`, `episodeEditorRoute(showId, episodeId, draft?)`,
  `showEditRoute(showId, tab?)` (`'art'` → `?tab=art`), `submitRoute({ kind, showId, season, number, type })`
  (`/creator/submit?type=series|podcast|<type>&series=&season=&number=`), `publicRoute(show)` (`/series/<id>`, or
  `/podcasts/<id>` for a podcast), `episodePublicRoute(id)`, `askUs(subject)` (mailto the contact address).
- **Words**: `ago(iso)`, `minutesOf(runtime)` ("24 min"), `bytesShort`, `shortDate` (Pacific, "Nov 4"),
  `countLine(seasons)` ("S2 · 8 episodes · 1 in review · 2 drafts"), `PREMIUM_WORD` ("Tapa +").
- **Glyphs** (react-native-svg, `{ size, color }`): `KebabIcon`, `ArrowUpIcon`, `ArrowDownIcon`, `CheckIcon`,
  `PlusIcon`, `SendIcon`, `UploadIcon`, `ChevronIcon`, `NoEyeIcon`, `BanIcon`, `InfoIcon`. The rest come from
  `components/WorkIcons.js` (Clock, Warning, Trash, Pencil, Eye, Undo, ExternalLink, Link, Close).
- **Tones**: `TONE[ok | review | warn | danger | neutral] → { fg, bg, border }` (rowPill's tones, theme tints only).
- `Pill({ label, tone, dot })`, `StateChip({ state, label })` (the show's state: live / ready / review / drafts /
  empty / pulled / removal / declined), `KindChip({ kind })`.
- `Behind({ line })` — the info line for a migration that hasn't run (the server's words).
- `Sheet({ visible = true, title, eyebrow, onClose, children, foot })` — a bottom-sheet Modal: grab bar, eyebrow,
  title, ×, a body that scrolls, a foot that stays in sight, the keyboard kept off the fields, backdrop tap closes.
  **Render it conditionally** (`{open ? <Sheet …/> : null}`) so its state starts fresh each time.
- `ActionSheet({ visible, title, eyebrow, items, onClose })` — `items: [{ key, label, icon, onPress, danger,
  disabled, note } | { divider: true } | falsy]`. It closes first and runs the item after `HANDOFF_MS` (400 ms):
  iOS won't present the next sheet, an `Alert` or the photo picker while one is still sliding away. Do the same
  wait if you open a sheet from a sheet yourself.
- `Chip({ on, label, onPress, dashed, disabled, icon, children })` — a choice chip (season, slot, order).
- `SmallButton({ label, onPress, disabled, busy, tone: 'plain' | 'primary' | 'danger', icon })`, `LinkText`.
- `useRoomToast() → { toast, say }` and `RoomToast({ toast, onClose })` — `say({ tone: 'ok' | 'warn', title,
  lines, undo: async () => … }, ms)`; the toast sits above the bottom nav (pass it as `AccountFrame`'s `overlay`).
  Moves use 8000 ms with `undo`; plain notices 3000–6000.
- `ss` — the styles (card, eyebrow, p, small, mono, error, okText, link, row, wrap, chips/chip/chipOn, input,
  textarea, sheetLabel, sheetActions, pressed, disabled…).

## `mobile/src/components/show/ShowCards.js`

- `ShowCard({ view, canEdit, onEdit(tab: 'details' | 'art'), onView, onCancelStaged(field), busy })` — poster
  (tap → art), name or title image, kind + state chips, count line, the description's first paragraph, the
  waiting changes with Cancel (`busy === 'staged-<field>'`), Edit show, View page (public only).
- `ShowStatusCard({ view, contributor, onProblem(problem), onMakePublic, onCancelRemoval, onResubmit, busy })` —
  the headline and body per `show.state` (the website's words), Make it public (`busy === 'public'`), Cancel
  request, Resubmit, the problem lines (each calls `onProblem`), "Changes reach visitors within a few minutes".
- `SellCard({ view, episodePrices, onOpen })`, `ChannelsCard({ view, canEdit, locked, busy, onToggle(on) })`,
  `RemoveShowCard({ view, canRequest, busy, onRequest(reason), onCancel })` (the cascade words before asking).
- `ExtrasShelf({ view, ctx, onOpen(extra), onMenu(extra), onAdd })` — `ctx` needs `isOwner`, `team`, `canAdd`,
  `flashId`.
- `PREVIEW_BUILT = false` — the private preview is slice 4; keep its links hidden.

## `mobile/src/components/show/SeasonSection.js`

- `SeasonSection({ season: { number, label, rows, empty }, ctx, actions, children })` — the header (label,
  counts, the season's menu sheet: name it / Renumber from 1… / Start Season N+1), "Send N for review", the rename
  field, the Renumber confirm, the rows (episodes, drafts, gap rows), then `children` (the empty season's buttons).
  `ctx` and `actions` are listed at the top of the file.
- `rowMeta(row, ctx, upload) → [{ text, tone }]` — a row's meta line (the website's words).
- `rowMenuItems(row, ctx, actions) → items` for `ActionSheet` — Edit, Move to…, Give it its own page / Use the
  player only (greyed before 118), Replace file, View page, Pick the (same) file to resume, Discard / Remove…;
  `actions: { open, openMove, togglePage, pickFile, discard, askRemove, viewPublic }`.
- A row: ↑/↓ (disabled at the ends, while busy, before 118), the E-badge (tap → a number field; Done or blur
  commits once), thumb (own still, else the show's), title, `rowPill`, meta, kebab. A taken number shows the
  conflict box: Swap / Insert here / Use E<nextFree> / Cancel and planMove's preview lines.

## `mobile/src/components/show/AddEpisodesBar.js`

- `AddEpisodesBar({ view, ctx, onAddOne, onAddSeveral, onLink, busy })` — "+ Add episode" (primary), Add several,
  Paste a link / Paste an MP3 link; before 116 both grey with `ctx.behind116Line` (or the page's
  `addBar.drafts116 === false`) and "Submit one at a time instead"; the drafts-cap note; the closed line
  (`ctx.closedLine`) when nothing can be added.
- `QueuePanel({ items, uploads, paused, stopped, onRetry, onResumePick })` — the file moving in full, two queued
  lines + "N more queued", stopped files, "Uploads paused: <line> · Try again", "Pick the same files to resume",
  and **"Keep the app open until the uploads finish"** while anything is live.
- `AddSeveralSheet({ assets, resumes, season, seasons, rows, showName, onSeason, onConfirm({ assets, sortBy }),
  onClose, busy, error })` — the plan (`planBatch`) before anything is made: season chips (+ the next one), order
  by File name or the order they were picked (`sortBy: 'name' | 'given'` — picker assets have no date), each file's
  number, "Fills the gap", "E5 is taken by X — this one goes to E9".
- `LinkSheet({ podcast, showName, onSubmit(url), onClose, busy, error })`.

## `mobile/src/components/show/MoveSheet.js` — for the editors' Place card too

`<MoveSheet show episode myShows onMoved onClose visible? />` — render it conditionally.

- `show: { id, name, kind, seasons: [{ number, label }] }` — from the editor payload: `show.id/name/kind` and
  `payload.seasons`.
- `episode: { id, kind: 'episode' | 'draft', title, displayTitle, season, seriesOrder, code, status }`.
- `myShows`: the editor payload's `moveTargets` (`{ id, name, kind, statusLabel, ok, reason, tag, lines }`) — or
  `null` while loading (it says "Reading your shows…"), or `GET /api/show` summaries (the show page uses those).
- `onMoved(result)` — the `/move` answer plus `{ toShowId, season, number }`. Build the Undo with
  `undoMoveSteps(result.rows, episode.id)` when `!result.toShowId` (each step: `showCall('POST',
  `${showPath(showId)}/${step.route}`, step.body, getToken)`), toast `result.words` + `result.lines`.
- It reads `GET /api/show/<id>/positions?season=&exclude=` itself (this show and the target), plans with
  `planMove`, shows the preview, posts `/move`, and on a 409 `taken` offers Swap them / Insert it there / Use
  E<nextFree>. A greyed show shows its reason when tapped.

## `mobile/src/components/show/RowSheets.js`

- `RemoveEpisodeSheet({ row, live, busy, error, onSubmit(reason), onClose })` — "hidden from the site right
  away" only when `live`.
- `PlaceExtraSheet({ extra, showId, episodes, busy, error, onPlace(parentType, parentId), onClose })`.

## The show page (`app/creator/show/[id]/index.js`) — how it behaves

- Reads `GET /api/show/<id>` on every focus (and `GET /api/creator/drafts?seriesId=` first, which refreshes the
  drafts' Cloudflare state); polls every 20 s while something is in flux and the screen is in front and the app
  active; reads again 1.2 s after a file finishes.
- Order is the website's phone order: flash, show card, status card, Add bar, queue panel, the 118 line, seasons,
  + Add season, Extras, Sell (public shows, owner/team), channels, Remove this show….
- ↑/↓ and a typed number are planned with `planMove`; one season → `/reorder` (the rows move at once and come back
  on a refusal), else `/move` with `mode: 'insert'`; the toast says the words with Undo for 8 s.
- Add several: `pickVideos(30)` → files that are a stopped draft's own resume it; one new file is added at once;
  more open the AddSeveralSheet → `POST …/episodes` → `enqueueShowUploads` (drafts matched to assets by
  `fileName`).
- Send N for review posts `…/send` in tens ("Sending 10 of 24…"); each skipped draft's reason goes on its row.
- Make it public: an `Alert` (the website's words) → `POST …/public`.
- A 503 `migration-116` / `migration-118` from any call is remembered: the line shows and the controls grey.
- Not in the app: drag, Alt-swap, the RSS import (website only), captions (the editor says "Add captions on the
  website"), who gets paid.

## The editors (`components/show/EpisodeEditor.js`, `DraftEditor.js`, `ShowEditor.js`)

The website's `components/show/EpisodeEditor.js` / `DraftEditor.js` / `ShowEditor.js` as phone screens, the same
words. Verified by both exports, check-refs, lint, the unit tests and `scratchpad/pw/app-editors-http.js` (81 checks:
every route the editors call with a Bearer token, before and after 118, before 116, plus the editors' own pure helpers
cut out of these files and run on the real answers). **Not on a device.**

- **The episode editor** — Basics · More info · Place **stacked** (section heads, cards), not tabs. Reads
  `GET /api/show/episode/<id>`; a 404 there falls back to `GET /api/creator/drafts?id=` (a draft opens `DraftEditor`).
  Every field follows the payload's `policy`: direct (applies on Save), staged (the clock, "Goes to review when you
  save", the waiting value in a `StagedBox` with Cancel → `DELETE …/staged?field=`), locked / invite (the lock and the
  server's own line; Who can watch and the rating read "Locked while live" with the ask links). The Save bar
  (`EditorFoot`) is fixed above the bottom nav: `saveSummary`'s label and note ("Save · 1 change goes to review"), a
  taken number's line, the error, the status dot + line, View page. A stored "Episode N" shows as an empty title with
  that placeholder. **The app's habits**: a poster / still / title image (PNG) is saved the moment it's picked, "Cut
  from the film" the moment it's pressed, Remove (title image) after an Alert; a trailer is attached the moment its
  upload ends (`startTusUpload` kind `trailer`, then `PATCH { trailerUid }`); "Replace the file" is `startTusUpload`
  kind `main` (`/api/creator/get-upload-url?seriesId=`) then `POST …/video` (the server's message under the card; a
  stopped one resumes when the same file is picked again while the app runs). Captions: the state and "Add captions on
  the website" (opens the site's editor). Its own page + Notes, Credits, Extras with this episode (+ Add extra), More
  options (folded). Place: season chips (+ New season), the − E + stepper, a taken number's box (Swap / Insert here →
  `POST /move` with `mode`, toasted with Undo from `undoMoveSteps`; Use E<nextFree>), Move to another show… (`MoveSheet`
  with `moveTargets`; a move away `router.replace`s to the other show's editor), an extra's "Attached to" chips, Remove
  this episode… with the reason / Cancel removal. Banners: Changes awaiting review (Cancel each), Not this time + Send
  again for review (`resubmit: true` with the changes), Pulled, Removal requested + Cancel, Withdrawn, before 118.
- **The draft editor** — the same screen over `/api/creator/drafts`: everything direct; Save re-reads the draft and
  sends its whole form with its current video and trailer; **Send for review** (the bar's main button) →
  `POST /api/show/<id>/send` → `router.replace` to the new episode's editor with `?sent=1` (a skip shows its reason and
  takes `nextFree`); Discard (Alert) → `cancelShowUpload` + `DELETE /api/creator/drafts`; the file goes through the
  show's upload queue (the row's progress / Queued / stopped lines show here); Place: a draft holder offers Swap /
  Insert here, an episode holder only "Use E<n>"; Move to another show… (`GET /api/show`).
- **Edit show** — Details · Art as a tab row (`?tab=art` opens Art). Policy from `fieldPolicy` / `fieldPolicyLine`
  (`policyCtx(view)`, the website's). Details save with the bar (name — waits once an episode is approved —, one line +
  about, year, funding link, the kind while empty, the defaults, season names, credits, channels); Art saves each
  picture the moment it's picked and the trailer when its upload ends; Cancel on every waiting change. Banners: not the
  owner, Pulled, Removal requested + Cancel, declined + Resubmit, Changes awaiting review, before 118.
- **Leaving with unsaved changes** asks first (`useLeaveGuard` = Expo Router's `usePreventRemove`): the Back pill, the
  hardware back, a swipe back. A push from the bottom nav keeps the editor (and its changes) under the new screen.

### `components/show/EditorBits.js`

`useShowAuth()` → `{ isLoaded, isSignedIn, getToken (stable), call(method, path, body), dashboard }` · `useInFront()`
→ `() => bool` (focused and the app active: the polls) · `useLeaveGuard(dirty)` → `go(fn)` (leave on purpose) ·
`useKeyboardShown()` (the Save bar steps aside) · `useFootSpace()` → `{ footH, setFootH, toastBottom, spacer }` ·
`isOpen(policy)`, `masterWords(state)`, `PILL_TONE`, `NOT_SAVED_WORDS`, `LOCKED_FALLBACK`, `DIRECT`, `NEEDS_118`,
`openOnWebsite(path)` · `EditorHead({ eyebrow, pill, title })`, `SectionHead({ label })`, `TabRow({ tabs, active,
onTab })`, `Banner({ level, icon, title, action })`, `FieldHead({ label, hint, staged, locked, count, max })`,
`FieldNote({ policy, edited })`, `ClockLine`, `EdInput` (ShowBits' input, `disabled`), `ChoiceChips({ options, value,
onChange, disabled })`, `Toggle`, `SwitchRow({ title, on, onChange, disabled, policy })`, `StagedBox({ title, value,
onCancel, busy, cancelLabel })`, `CancelButton`, `UploadLine({ name, bytesLabel, right, pct, meta, failed })`,
`ArtSlot({ kind: poster | still | hero | title, label, status: live | waiting | none, policy, live, fallback,
fallbackTag, staged, stagedNote, onCancelStaged, busy, actions })`, `EditorFoot({ onHeight })`, `FootNote`,
`SaveButton`, `StatusLine`, `LockIcon`, `eb` (styles).

### `components/show/EpisodeFields.js`, `CreditsFields.js`

`TitleField`, `OneLineField`, `AboutField`, `SameAsShow({ ctx, inShow })` (ctx = `{ form, set, defaults, showYear,
resets, reset, pol, titleForAsk }`), `PlaceBlock({ place })` (the website's `place` object), `MoreOptions({ form, set,
pol, live })`, `StagedLegend`. `CreditsFields({ value, onChange, inherit, showCredits, makerName, makerLabel,
policy })` with `creditsToForm(raw, { inherit })`, `creditsFormBody(form, { inherit })`, `creditsFormKey` — the
website's form shape and body, word for word; the selects are chips.

## For the next agents

- **Editors**: open `episodeEditorRoute` / `showEditRoute` params `id`, `episodeId`, `draft=1`, `tab=art`. Use
  `AccountFrame` with `back={{ href: showRoute(showId), label: showName }}` and `overlay={<RoomToast/>}`,
  `showCall` for every request, `MoveSheet` from the Place card, `Sheet`/`ActionSheet`/`Chip`/`SmallButton`/
  `Behind` from the kit. For "Replace the file" / the trailer use `startTusUpload` (`urlPath:
  '/api/creator/get-upload-url?seriesId=<show>'`, kind `main` / `trailer`); the queue waits while it runs. After a
  save, `router.back()` (the show page re-reads on focus).
- **Lists**: built (below).

## The lists: the hub, Your work, the submit screen's Place block, the routes (built 2026-11-04)

The website's `pages/creator.js`, `pages/creator/my-work.js` and `pages/creator/submit.js` step 2, in the app.
Verified by both exports, check-refs, lint, the unit tests and `scratchpad/pw/app-lists-http.js` (47 checks, Bearer
token, stand-ins restored). **Not on a device.**

- **The hub** (`mobile/src/app/creator/index.js`): the Your shows strip (a horizontal `FlatList` of 128 px cards from
  `GET /api/show?mine=1`, vertical shows left out: poster or a dashed slot with the name, a clock when
  `staged.any`, `KindChip` + `StateChip` with `statusLabel`, `countLine`; the dashed "+ New show" card last;
  skeletons while it loads; "Start a show" when there are none; hidden when the call fails). Piles: a show's row
  has the "NIGHT BUS · S1 E3" eyebrow (the code is never cut) and opens `showRoute(sid, { ep })`; Needs you
  (`needsYou` from the app's showRules) has one "Ready to go public" row per private show with Make it public
  (when `summary.makePublic.ok`: an `Alert` with the website's words → `POST /api/show/<id>/public` → both lists
  reload, a flash with "Open the show page" or the server's line), then the titles' own reasons, then the show's
  numbering problems (gap / duplicate / parked / unnumbered); an approved episode of a private show is never Live;
  a show's drafts share one row ("Open show", "Continue here" unless `form.addedFrom === 'show'`, Discard for a
  lone draft). "All N in Your work" passes `?status=pending|approved` / `?attention=1`. `?submitted=&show=` (from
  the submit screen) adds "Open the show page" to the flash.
- **Your work** (`mobile/src/app/account/my-work.js`): reads `?status=` / `?attention=1` with
  `useLocalSearchParams` (and again when the hub opens it with others); "Live" and the Live filter mean on the
  site (`isLive`: a private show's approved episode isn't); Needs attention = `needsYou`; search covers the show's
  name. A show's titles (extras too, through their parent) sit under a header that opens the show screen ("Open
  show page" ›; kind chip, state chip unless live, `countLine`); the show menu (Edit show details / Sell the whole
  series / Add bonus content) is gone. Rows in `sortEpisodes` order with the "S1 E3" code, "Season N" headings
  when there are several, "Extras" last, the status words (In review / Not this time / Pulled / Removal requested /
  Show pulled / Approved · not public yet / Live), the meta line and the flags of what waits (title, description,
  new video, art) or is wrong (failed file, no captions, stale captions); the pencil opens
  `episodeEditorRoute(showId, id)`; a tap opens a sheet (Edit episode / Open on the show page / View page / Copy
  link / Sell). Films, shorts and Snippets keep their rows and sheet. Copied links use `https://www.studiotapatv.site`.
- **The submit screen** (`mobile/src/app/creator/submit.js`): reads `?type=&series=&season=&number=&draft=` (a
  `series` without a `type` takes the show's kind once list-series answers). Step 2 starts with the Place block
  for series / podcast / bonus: a picker field (art, name, "statusLabel · countLine") that opens a `Sheet` of the
  shows of the type's kind (`list-series` merged with `GET /api/show?mine=1`, or `?all=1` for a full admin via
  `useAdminRole`), each with `showPickerTag`'s words, refused ones greyed (+ `pickReason`), and "+ New series/show"
  (the inline name + about, "stays private until you make it public"); season `Chip`s with their labels + "+ N ·
  new"; "E [ n ]" with "E4 · next free" (`nextFreeExcept`, the draft being placed left out) from `GET
  /api/show/<id>/positions` (300 ms after the last change); a taken number → "E3 is taken by <title>" with Use E4
  and — when `summary.canEdit` (or an admin / the show's creator before the summaries answer) — Swap (the holder
  moves to the next free number when the title is sent: fresh positions, `POST …/move`, then submit-episode; a
  failed send moves it back). Next / Submit are blocked while the show takes nothing or the number is taken; a 409
  `taken` at send goes back to step 2. A draft save that answers 503 stops saving and the footer reads "The server
  is being updated: <the server's line>". After a send into a show the hub's flash offers "Open the show page".
- **Routes** (`mobile/src/components/PushListener.js` `hrefToRoute`, used by pushes, the bell and the home desk):
  `/creator/show/new`, `/creator/show/<id>` (the website's `#ep-<id>` / `#draft-<id>` anchor or `?ep=` / `?draft=`
  become `?ep=` / `?draft=`), `/creator/show/<id>/episode/<eid>` (`?draft=1` kept), `/creator/show/<id>/edit`
  (`?tab=art` kept), `/creator/series?series=<id>` → the show screen (bare → `/creator`), `/creator/my-work` →
  Your work; `/admin/shows/<id>` opens the website. `notificationTypes.js` needed no change.
