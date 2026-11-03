# Series revamp, slice 2 — the editors

The episode editor, the draft editor, Edit show, the Move sheet and the credits fields (spec Screens "Episode
editor" and "Move to… picker", amendment 13; boards EditorBasics, EditorMoreInfo, EditorPlace, MoveSheet,
ShowEditor, ShowEditorArt, ShowLaptop). Built on the routes in `mockups/series-slice2-api.md`; pages import
only `lib/showRules.js` (client-safe) and the client helpers, never `lib/showPage.js` / `lib/showRoute.js`.

| File | What it is |
| --- | --- |
| `components/show/EpisodeEditor.js` | The episode editor (default export). Loads the episode, or hands a draft to `DraftEditor`. |
| `components/show/DraftEditor.js` | The same screen for a draft (a `creator_drafts` row not sent yet). Opened by `EpisodeEditor`. |
| `components/show/ShowEditor.js` | Edit show: Details and Art. |
| `components/show/MoveSheet.js` | "Move to…": season, slot, another show, the preview, Move · Cancel. |
| `components/show/CreditsFields.js` | Studio / Producer / the order (decision 20), with the form helpers. |
| `components/show/EpisodeFields.js` | Fields the episode and draft editors share (title, one line / about, "Same as the show", the place block, More options). |
| `components/show/EditorBits.js` | The frame (both layouts), banners, staged boxes, art slots, switches, the toast, `callApi`, small hooks. |
| `pages/creator/show/[id]/episode/[episodeId].js` | The editor as a screen (`?draft=1` for a draft, `?layout=panel` to preview the laptop panel). |
| `pages/creator/show/[id]/edit.js` | Edit show as a screen (`?tab=art`, `?layout=panel`). |

## Layouts

Every editor takes `layout`:

- **`'page'`** (the default; phone first): the AccountShell-style Back pill to the show (`.acct-back.show-ed-back`,
  `/creator/show/<id>#ep-<episodeId>`), the head (eyebrow, status pill, title), the banners, the tabs as a sticky
  segmented control (`.show-tabs` / `.show-tab`, `role="tablist"`), one tab at a time, and the footer sticky at the
  bottom of the screen (`.show-ed-foot`). 640px wide and centred on a laptop. The route pages render it inside
  `HeaderNav` (Connect side, no tab bar, like the creator tool pages) with the site footer.
- **`'panel'`** (the control room on a laptop, amendment 10): the editor renders its own
  `<aside class="show-ed is-panel">`, `position: fixed` at the right edge, 420px wide (`min(420px, 100vw)`), from
  under the sticky header (`top: var(--show-ed-top)`, measured from `header.channel-bar` by `useHeaderOffset`) to
  the bottom of the screen, sliding in (0.22 s; none with reduced motion). The head carries a close button
  (`.show-ed-close` → `onClose`); the tabs become stacked sections with headings (`.show-ed-section-k`: BASICS,
  MORE INFO, PLACE / DETAILS, ART) in a scrolling middle (`.show-ed-scroll`); the footer is pinned to the panel's
  bottom with the second action and Save side by side and the status under them. Nothing else changes, so the
  control room only has to render `<EpisodeEditor layout="panel" … />` (or `ShowEditor`) beside its stage. It
  overlays the stage's right-hand 420px (z-index 30, under the Move sheet's 60); give the stage room or let it
  overlay, as the ShowLaptop board does. `?layout=panel` on the two route pages shows it over an empty page — a
  preview until the show page hosts it. The route pages wrap the editor in `<main class="show-ed-stage">` (a hook
  with no rules yet).

The footer in both: the primary button (`.show-ed-primary`) — Save, or Send for review on a draft — then a row
(`.show-ed-foot-meta`) with the second action (`.show-ed-second`: View page, or a draft's Save) and the status line
(`.show-ed-status`, a dot in the pill's tone). Above it: what goes to review (`.show-ed-foot-note`, from
`saveSummary`), a blocked number (`.show-ed-foot-note.is-warn`), the error line (`.show-ed-error`, `role="alert"`).
A short toast (`.show-ed-toast`, `aria-live`) says what saved, what waits, what didn't save.

## EpisodeEditor

```jsx
<EpisodeEditor showId episodeId mode="creator" layout="page" isDraft={false}
  onClose={() => …} onSaved={(episode, info) => …} onDirtyChange={(dirty) => …} />
```

| Prop | |
| --- | --- |
| `showId` | The show in the URL (links, the upload's `seriesId`, the place routes). The episode's own show (`view.show.id`) wins when they differ. |
| `episodeId` | An episode id, or a draft's id. |
| `mode` | `'creator'` (this slice). `'admin'` only changes the Back link (`/admin/shows/<id>`); the API decides what applies. |
| `layout` | `'page'` \| `'panel'`. |
| `isDraft` | Skip the episode read: the control room knows the row is a draft. Without it, a 404 from the episode read is retried as a draft (`GET /api/creator/drafts?id=`). |
| `onClose()` | The panel's ×, and a page after a discarded draft (the routes pass "go to the show page"). Asks first when there are unsaved changes. |
| `onSaved(episode, info)` | After each save: the editor payload's `episode` and `{ applied, staged }`. After a move: `{ moved: true, words }`, or `{ movedTo: <showId> }` when it left the show (a page then replaces the URL with the new show's). From a draft: `(draftValues, { draft: true })` on Save, `({ id, season, seriesOrder, code, title, status: 'pending' }, { sentFromDraft: <draftId> })` on Send for review (a page then opens the new episode's editor), `({ id, kind: 'draft' }, { discarded: true })` on Discard. |
| `onDirtyChange(dirty)` | Unsaved changes on or off (false again when the editor unmounts), so the host can ask before switching rows. Closing the tab asks by itself (`beforeunload`); in-app navigation isn't intercepted (the control room changes the route shallowly). |

What it reads and writes:

- `GET /api/show/episode/[id]` — everything; `policy[field] = { mode, line }` decides each field: **direct**
  (saved), **staged** (clock glyph on the label; waits for approval; the box under the field shows "Goes to review
  when you save · Live now: …" while typing and "Waiting for approval: … · Cancel" after), **locked** / **invite**
  (disabled, the policy's line under it). The Save button reads `saveSummary` (`lib/showRules.js`): "Save",
  "Save · applies at once", "Save · 2 changes go to review" + "Goes to review: the new title and the poster; the rest
  applies at once".
- `PATCH /api/show/episode/[id]` — only the fields that changed (the description, a credit, a reset…); art as data
  URLs; `cutFromFilm`; `removeTitleImage`; `trailerUid`; `resubmit: true` from "Send again for review". The answer's
  `view` re-initialises the form; `notSaved` (before 118) and `notices` go to the toast.
- `DELETE /api/show/episode/[id]/staged?field=` — every Cancel (banner rows, the title box, art slots, the file).
- `POST /api/show/episode/[id]/video` — Replace the file: the upload runs through `UploadContext.startVideoUpload`
  (`kind: 'main'`, `urlEndpoint: /api/creator/get-upload-url?seriesId=<show>` for the 60-an-hour limit), and the
  moment it is up the uid is posted. A stopped upload resumes when the same file is picked again: the tus address is
  kept in `localStorage['showEd.replace.<episodeId>']` (name + size must match). The card's words follow the
  status: live "A new file goes to us first; this one keeps playing until we approve it.", in review "The new file
  replaces this one; it stays in review.", declined "It goes back to review with the new file."
- `POST /api/creator/add-captions` — captions apply at once (the uploader only; one track per title).
- `POST /api/show/episode/[id]/removal` — Remove this episode… (a reason) / Cancel.
- `GET /api/show/[id]/positions?season=&exclude=` — another season's numbers for the place block.
- `POST /api/show/[id]/move` — Swap / Insert here from the place block, and the Move sheet.
- `GET /api/show/[id]` — only for an extra: the episodes it can hang after.

Tabs (`page`) or sections (`panel`):

- **Basics** — the file card (`.show-ed-file`: state from `masterWords`, runtime; on a page a drop zone
  `.show-ed-drop`, in the panel a "Replace file" pill in the row; a waiting new file with Cancel; the upload's
  progress), Title ("Episode N" placeholder for a thin episode), One line about it (300).
- **More info** — the legend on a live title, About it (the rest of the description: an episode has one
  `description` column, split by `splitDescription` / joined by `joinDescription`), Poster 2:3 + Still 16:9 (own, or
  the show's art behind "Using the show's art"; Upload / Replace / Cut from the film / Undo; waiting = live and
  proposed side by side with Cancel), Title image (PNG; Remove), "Same as the show" (`SameAsShow`: Genre, Made by,
  Year, Rating, Who can watch — tap a row to open it; "Differs from the show" + "Reset to the show's" sends `null`;
  Rating and Who can watch read "Locked while live" with the mailto line to ask), Captions, Trailer (`kind:
  'trailer'`; saved with Save once uploaded), Funding link, Give this episode its own page + Notes + Preview page,
  Credits (`CreditsFields`, inheriting the show's), Extras with this episode (+ Add extra →
  `/creator/submit?type=bonus&series=<id>`), More options (runtime, ad breaks, ads, Let channels air it, the hero
  request, Tapa Original).
- **Place** — season chips (+ New season), the number stepper with "Was S1 E3 · E5 is the next free number"; a taken
  number shows "E4 is Night Shift — Swap | Insert here | Use E5" with what each does (planMove's words; "Either way"
  when they agree) and holds Save; a free number saves with Save (PATCH). Move to another show… (the Move sheet),
  Remove this episode…. An extra gets "Attached to" (with the show / after an episode). A standalone title says
  putting it into a show isn't built yet.
- **Banners** — Changes awaiting review (one Cancel per field), Not this time (+ Send again for review; a number taken
  meanwhile comes back as the next free one and the toast says so), Pulled (+ what still works), Removal requested
  (+ Cancel), Withdrawn, and "needs migration 118" when `migration.shows118` is false.

## DraftEditor (inside EpisodeEditor)

Everything applies at once. Reads `GET /api/creator/drafts?id=` (+ `GET /api/show/[id]` for the show, the season
labels and the draft row's `blocker` / `ready`); saves with `POST /api/creator/drafts { id, form, video, trailer }` —
that route replaces all three, so every save sends the draft's current video and trailer back. Add / Replace the
file uploads with `startVideoUpload` and saves the draft's video at once (`state: 'uploading'` with the tus address,
then `'processing'`); the same file picked again resumes. The place block writes the form's season / number (a number
an episode holds is refused with "Use E9"; another of the viewer's drafts: Swap / Insert here through `/move` with
`draftId`). Send for review saves first, posts `POST /api/show/[id]/send { draftIds: [id] }` and, on a page, opens the
new episode's editor; a skipped draft shows the reason (and its next free number). Discard deletes it
(`DELETE /api/creator/drafts`). The poster and still, captions, a trailer, its own page and the credits are said to
come once it's sent (the drafts route keeps no art, and the send route takes a draft's trailer only when its stored
state is `ready`, which nothing sets — see Open issues).

## ShowEditor

```jsx
<ShowEditor showId mode="creator" layout="page" tab="details" onClose onSaved={(show, info) => …} onDirtyChange />
```

Reads `GET /api/show/[id]`; what a change does comes from `fieldPolicy(field, { target: 'show', isAdmin:
viewer.teamEdits, isRunner: viewer.isOwner, status, held, deletionRequested, approvedEpisodes, episodeCount })` —
the same rule the route runs. Saves `PATCH /api/show/[id]` (changed fields only: `defaults` as the changed keys, the
whole `seasons` list, `credits`, art as data URLs, `removeTitleImage`, `trailerUid`, `resubmit`); Cancel is
`DELETE /api/show/[id]/staged?field=`; Cancel removal is `POST /api/show/[id]/removal { action: 'cancel' }`.

- **Details** — Name (waits once an episode is approved: "Changing a live show's name goes to us first.", the waiting
  name with Cancel), One line about it + About it (the show's one description, 2,000 in all), Year, Funding link,
  What it is (Series | Podcast, only while the show has no episode or draft), Defaults · applies to episodes added
  from now on (genre pills, specific genre, rating, Who can watch, Made by / Hosted by, Ads between scenes; "Episodes
  already added keep their own rating and who can watch."), Season names (one per season; the line reads it back:
  "The show page reads “Season 1 · Night One”."), Credits, Let channels air the whole show.
- **Art** — Poster, Still, Hero image, Title image (PNG, Remove), Trailer; each Live / Waiting for approval (live and
  proposed side by side, Cancel) / None / "Goes to review" or "Not saved yet" for a picked file; a podcast has the
  poster and the still only. The tab carries the clock glyph while anything waits.
- **Banners** — only the owner (or the team) can change it, Pulled, Removal requested (+ Cancel), an admin declined
  it (+ Resubmit), Changes awaiting review (one Cancel per field), needs migration 118.

## MoveSheet

```jsx
<MoveSheet show={{ id, name, kind, seasons: [{ number, label }] }}
  episode={{ id, kind: 'episode' | 'draft', title, displayTitle, season, seriesOrder, code, status }}
  myShows={targets} anchorRect={rowRect /* optional */}
  onMoved={(result) => …} onClose={() => …} />
```

- `myShows`: either the episode editor's `moveTargets` (`{ id, name, kind, statusLabel, ok, reason, tag, lines }`)
  or `GET /api/show` summaries (`{ id, name, kind, statusLabel, pickable, pickReason }`); `null` while the host is
  still reading them ("Reading your shows…"). The current show is left
  out of it and drawn first as "This series / This show"; another kind is greyed "(podcast — an episode joins its own
  kind)"; a refused show is greyed with its tag and, when tapped, says the reason.
- Season chips of the target show (+ New season N), the slot: End of season (E9) by default, the first gap
  ("E4 · free"), or a typed number with the live line ("E1 is “Last Stop” — Swap | Insert here"; a draft can't push
  an episode along and says so). Numbers come from `GET /api/show/<target>/positions?season=&exclude=`.
- The preview line is `planMove` on those numbers — the server's own rule ("E3 → E1; E1–E2 become E2–E3", "Night
  Shift → Harbor Lights, S1 E1; S1 E2–E4 keep their numbers") — plus the target's lines ("It leaves the site until
  Harbor Lights goes public; its buyers keep playing it"). It sits with the buttons, outside the scrolling list.
- Move posts `/api/show/<show.id>/move` (`episodeId` or `draftId`, `toShowId`, `toSeason`, `toNumber`, `mode`).
  `onMoved` gets the answer + `{ toShowId, season, number }`; the sheet closes itself. A refusal (409 / 403 / 503…)
  is shown and nothing moves; a 409 `taken` answer offers Swap them / Insert it there / Use E9.
- A bottom sheet on a phone (a scrolling body, the preview and buttons fixed at its foot); from 900px a centred
  460px dialog, or — with `anchorRect` — a popover beside the row, kept on the screen. Escape and the backdrop close
  it.

## CreditsFields

```jsx
<CreditsFields idPrefix value={form} onChange inherit={isEpisode} showCredits makerName makerLabel="Made by" policy />
```

The form is `{ studio, producer, top, hadOrder }`, each line `{ mode: 'inherit' | 'none' | 'own', name, handle,
userId }`. `creditsToForm(raw, { inherit })` reads `series.credits` / `episodes.credits`; `creditsFormBody(form,
{ inherit, showOrder })` is the body the routes take (`'inherit'`, `null`, `{ name, handle }` to link an account by
@handle, `{ name, userId }` to keep a stored link, and `order` with the chosen line on top); `creditsFormKey` compares
two forms. A linked line reads "Linked to their account on the site · Unlink"; the preview line reads the result
("On the page: Studio Night Owl Films · Made by Mara Reyes · Producer Samira Dale"). Locked (`policy.mode` not
direct) for anyone but the show's owner and the team.

## lib/showRules.js additions (mirrored word for word in mobile/src/lib/showRules.js)

- `ONE_LINE_MAX` (300), `splitDescription(text)` → `{ oneLine, about }` (the first paragraph when it's one short line,
  else all "about"), `joinDescription(oneLine, about)`; split then join gives the text back, so an untouched
  description is never rewritten.
- `saveSummary(changes)` → `{ label, note, staged, direct, count }` for the Save button.
- `scripts/test-show-rules.mjs` covers both (2 new blocks, on the web and the app copy).

## Class names

`.show-ed` (+ `.is-page`, `.is-panel`, `.is-waiting`), `.show-ed-head`, `-eyebrow`, `-pill` (`.tone-ok|review|warn|
danger|neutral`), `-h1`, `-close`, `-banner` (`.level-…`), `-banner-list`, `.show-tabs`, `.show-tab`, `-section`,
`-section-k`, `-scroll`, `-field`, `-label`, `-count`, `-input`, `-select`, `-textarea`, `-line` (`.locked`),
`-edited`, `-hint`, `-legend`, `-staged`, `-cancel`, `-card`, `-card-k`, `-file*`, `-drop`, `-art`, `-art-slot`,
`-art-*`, `-same*`, `-chip-same`, `-reset`, `-switch-row`, `-cap-*`, `-more*`, `-place`, `-chips`, `-chip`,
`-stepper`, `-conflict`, `-choice`, `-remove`, `-danger`, `-mini`, `-slot`, `-link`, `-foot`, `-foot-actions`,
`-primary`, `-second`, `-foot-meta`, `-foot-note`, `-status`, `-toast*`, `-error`; `.show-sheet`, `.show-sheet-panel`,
`-body`, `-foot`, `-head`, `-title`, `-block`, `-shows`, `-show`, `-preview`, `-lines`, `-actions`; `.show-credits*`.
All in `styles/globals.css` between `/* --- series revamp: editors (slice 2) --- */` and its end marker; colours are
tokens (cream tints mix `--ink` with transparent).

## Not built here, and why

- **Make it an extra** / **Make this part of a show** (the Place tab): the server has no route for either yet
  (`mockups/series-slice2-api.md`, "Not built"); the Place tab says so with a line to ask the studio.
- **A live episode's title image and trailer**: refused by the server with its own line (no `pending_*` column to
  wait in); the slots show that line instead of an upload.
- **More than one caption language**: a title holds one track (`captions_url` + label + language); the card offers
  Replace / Remove, not "Add another language".
- **A draft's art, captions, trailer, own page and credits**: added once it's sent (the drafts route keeps no art;
  `/api/show/[id]/send` takes a draft's trailer only when its stored state is `ready`, which nothing sets — a server
  gap noted in the slice report).
- **Undo after a move from the editor**: the editor says what moved (toast); Undo lives on the show page's toast.
- **The board's three-across "Same as the show" grid in the panel**: the panel uses the same list as the phone.
- **"Preview page"** opens `/episode/<id>` for a live title and `/episode/<id>?preview=1` otherwise — the landing view
  and the preview mode are slice 4's.

## Verified

`pw/show-editors.js` in the session scratchpad (the stand-in's default mode; Mara and a fresh creator, 390 and 1280;
screenshots in `shots-slice2/editors/`; it cleans up only what it made). Not exercised in a browser: the before-118 /
before-116 states (the stand-in is shared and wasn't switched); they follow the API's answers and the `migration`
flags.
