# Private screening links — as built: the server and the viewer (builder A, 2026-11-21)

The contract is `mockups/private-screenings-contract.md`; this is what builder A
made against it, every difference from it, the words added, and the tests.

## What was built

- **`lib/screenings.js`** (server only): the whole feature's server side.
  - who may (`mayManageTarget` / `mayManageLink`): a full admin; whoever runs the
    target — a show: `series.creator_id`; an episode: `titleRunnerOf(episode, itsShow)`
    (an extra's show through `bonus_parent_*`, its parent episode's show included);
    a 109 row with a `production_id` and no password: its `owner_id` too. An
    uploader of one episode in another person's show gets 403 for the show and
    for that episode.
  - what a link plays (`loadTarget`, `linkEpisodes`): an episode approved or in
    review whose `screenerTitleProblem` is null; a show not held, withdrawn,
    declined or on its way out, its episodes (never extras) that pass, in
    `sortEpisodes` order; `season` / `episodes` scope = the ids kept at creation,
    filtered by what still passes.
  - the creator's functions behind the routes (`listForTarget`, `createLink`,
    `passwordSuggestion`, `linkDetail`, `updateLink`, `newLinkPassword`,
    `endLink`, `discardLink`, `runAgain`), every input checked with
    `validateLink` (update passes `existing`); a season link stores the
    season's playable ids at creation; run again takes `againWindow` unless a
    window is sent, a new token, a new password (a suggestion unless one is sent)
    and `run_from`.
  - the viewer's (`readViewerPage`, `openLink`, `playLink`, `beatLink`) in the
    contract's order of checks, the open counted with a compare-and-swap on
    `views` (re-read and retried up to five times), the video address minted
    before the count (a link that can't be signed costs no open).
  - the Distribution page's reads (`productionScreenings`, `liveScreeningCount`,
    `endLinkFromDistribution`) and the daily step (`runScreeningDailyStep`).
  - `ScreeningError` + `sendScreeningError` (the contract's error bodies as they
    are, anything else through `sendError`, never a database's text).
- **`lib/screeningCrypto.js`**: token (18 random bytes, base64url), visit key,
  guest cookie, `suggestion()` (`suggestPassword` with `crypto.randomInt`),
  `hashPassword` / `verifyPassword` (scrypt N=16384 r=8 p=1, `timingSafeEqual`,
  a stored value that isn't ours never matches and never throws),
  `encryptPassword` / `decryptPassword` (AES-256-GCM, key = sha256 of
  `SCREENING_SECRET` else `SUPABASE_SERVICE_ROLE_KEY` else `'tapa-local'`; an
  unreadable copy is `null`), `deviceKeyOf` (24 hex), `sessionKeyOf` (full
  sha256), `ipHashOf` (the 109 salt, 24 hex).
- **`lib/screeningRoute.js`**: CORS, OPTIONS, `private, no-store`, methods,
  `wellFormedBody`, the limits (per account beside per address, twice as
  generous), `noindex` on the viewer's routes, `originOf` = `requestOrigin(req)`.
- **Routes**: `pages/api/screenings/index.js` (GET, POST),
  `pages/api/screenings/password.js`, `pages/api/screenings/[id]/index.js`
  (GET, PATCH update | password | end, DELETE), `pages/api/screenings/[id]/again.js`,
  `pages/api/screener/[token]/{open,play,beat}.js`. `pages/api/screener/[token].js`
  is deleted.
- **`pages/screener/[token].js`** rebuilt: every state, the password form (a
  legacy link: Watch with no field), the player (`VideoPlayer`, ads off, no
  advisory, `refreshSrc` → play, `heading`), the moving watermark (moved into the
  full-screen element through a portal while the player is full screen), a
  show's episode list (moving between them is a play, never an open; the next
  plays when one ends), the 20-second beat (reads `video.tp-video`'s
  `paused` / `currentTime` / `duration`, and once more when the tab is hidden),
  the stop messages (a new password or a run-out visit puts the form back with
  the reason; a second screen offers Try again), `sessionStorage`
  `tapa_scr:<token>` (a reload resumes the visit at its place without a new
  open), Sign in through `SignInHere` (signed-in-only and named links, and the
  "Sign in" in the password note for `anyone` links). Times are Pacific in the
  server's render and the viewer's own ("… your time") after mount;
  `noindex`, `private, no-store`, the right-click block. Styles `.scr-*` in
  `styles/globals.css` (the existing block extended: `.scr-shell`, `.scr-bar`,
  `.scr-door`, `.scr-form`, `.scr-field`, `.scr-btn`, `.scr-error`, `.scr-count`,
  `.scr-layout` (player + a 340px side from 1024px), `.scr-panel`, `.scr-eps` /
  `.scr-ep`, `.scr-fact`, `.scr-mini`, `.scr-note`, `.scr-linkbtn`); tokens and
  `rgba(var(--…-rgb), a)` tints only; 44px targets; checked at 320, 390 and 1280.
- **`lib/distribution.js`**: `screenings: { links, href, canManage }` in place
  of `screeners` (the release's links plus the production's old screeners,
  newest first; `href` = `targetTabHref(release)` or null; `canManage` = the
  viewer runs the release (or is a full admin)); the checklist's `screenersLive`
  = live links of the release or the old screeners (`linkState` `live`), in
  `getDistribution` and `distributionChecklist` alike. `createScreener`,
  `revokeScreener`, `openScreener` and the viewKey code are gone.
  `pages/api/productions/[id]/screeners.js`: POST → 410
  `{ error: SCREENING_WORDS.distributionLine }`, DELETE `{ screenerId }` → ends it
  through `endLink`. `pages/api/productions/[id]/distribution.js` passes the
  request's origin.
- **The daily step** (`runScreeningDailyStep`, from
  `pages/api/cron/expire-content.js`, isolated like the other steps, in the
  audit line and the answer's `screenings`): owners told of links that ended
  (`screening_ended`, href `targetTabHref`; claimed on `ended_notified_at`; End
  it now marks its own at once; a link that ended more than three days before
  the run — 109's old screeners on the first run — is marked without a notice),
  daily summaries for `notify: 'daily'` (`screening_summary`, yesterday on the
  Pacific clock, claimed on `summary_sent_on`, sent only when there were opens),
  and the view and refusal rows of links that ended more than `keepDaysAfterEnd`
  days ago deleted (the link itself is kept until discarded). Before 128:
  `{ ready: false }`.
- **Notification types** (both copies of `notificationTypes.js`):
  `screening_opened`, `screening_ended`, `screening_summary` (clapperboard) and
  `screening_guessing` (lock), route kind `creator` (the row's href always wins).
- **Privacy** (`pages/privacy.js`, updated November 21, 2026): "If you open a
  private screening" (what the maker sees, the guest cookie, the hashed address
  for the lock, no watch history, deleted on discard and a year after the end at
  the latest) and a line in "How long we keep it". **Terms** section 6 (`#private-screenings`):
  never record, copy or re-show a private screening, or pass its link or password
  on; `TEXT_UPDATED` 2026-11-21.
- `lib/privateBetaRules.js`: the `/api/screener/` comment (the prefix was
  already open). `dev/test-rig/checks/sec-titles.mjs`: its screener section
  moved to the new routes (and says what a 109 screener does before 128).

## The answers, against the contract

Every route answers what the contract says. Additions (nothing removed or renamed):

- **Link** carries `named.people: [{ userId, name, handle }]` beside
  `named.userIds` / `named.emails` (the coordinator's request: public display
  name and @handle of each named account from `getPublicProfilesByIds`, `[]`
  when none; a failed read gives `name: null`). Every route that answers a Link
  fills it (list, create, one link, update, password, end, again, the
  Distribution page).
- Error bodies: 401 `{ error }`; 404 `{ code: 'not-found', error }`; 429
  `{ code: 'limit', error }` (with `Retry-After`); 400 `{ error, field }` for an
  unknown PATCH `action` too (`field: 'action'`) and a bad `?target=` (`field: 'target'`).
- The viewer's refusals use these statuses: `gone` 404, `unavailable` 409,
  `not_yet` 409 (also `opensAt`), `ended` / `stopped` 410, `country` 403,
  `signin` / `named` 401, `named_other` 403, `suspended` 403, `locked` 429
  (`retryAt`, ISO), `password` 403 (`triesLeft`), `opens` / `person_opens` /
  `screen` 409, `session` / `password_changed` 401. The fifth wrong password in
  the hour answers `locked` at once. `error` is the line filled on the Pacific
  clock; the page writes its own in the viewer's time.
- `current.expiresAt` is an ISO string.
- `play` for an episode not on the link: 404 `{ error, reason: 'gone' }`.
- `beat` may also stop with `gone` (the link was discarded mid-visit) or
  `not_yet` read as `session`; a beat naming an episode other than the one the
  visit was last handed (open, then play) changes nothing.
- The viewer page's props are `{ page, token, renderedAt }` (`renderedAt` keeps
  the countdown's first render the same on both sides).
- The Distribution page's DELETE answers `{ ok: true, link }`; `getDistribution`
  takes an optional `origin`; a link the viewer doesn't run carries
  `password: null` there. `GET /api/productions/<id>/distribution` keeps
  answering **`screeners: []` and `episodes: []`** beside `screenings` (the
  coordinator, for the app builder: installed builds call `d.screeners.filter(…)`
  and `d.episodes.length` and would crash without them; the owner's-episodes
  read behind the old screener form is gone, nothing is made there any more).
- `/api/messages/people` answers `displayName` / `avatarUrl` (not `name` /
  `avatar`), per the coordinator; not touched here.

## Limits

New links and runs again 40 a day per account (`SCREENING.newPerDay`); creator
reads 120 a minute, writes 60 an hour, the password route 60 a minute (per
account, twice that per address); the viewer's open 30 per 10 minutes per
address, play 240 an hour, beat 900 an hour; turned-away rows at most 200 a
link a day; the wrong-password lock 5 from one address in the hour; the owner
told once a (Pacific) day after 20 wrong passwords.

## Words added

At the very end of both `lib/screeningRules.js` and
`mobile/src/lib/screeningRules.js` (byte-identical; `test-screening-rules.mjs`
passes): `SCREENING_WORDS_SERVER` — `signIn`, `badTarget`, `targetGone`,
`linkGone`, `unavailable`, `ended`, `notEnded`, `tooMany`, `slowDown`,
`badAction`, `noEpisode`, `ownerFallback`, and `viewer: { forLabel, from,
worksUntil, yourTime, until, signIn, signedInAs, opening, tryAgain, failed,
episodes, thisLink, playing, thisScreen, playingHere, ends, home }`. No existing
export changed. (The two password lines the PATCH `password` action answers are
`validateLink`'s own sentences, repeated.)

## Before migration 128

Every creator route answers 503 `migration-128`; the viewer's page shows
`unavailable` for every link (a 109 screener can't be read as a link without
128's columns, and the old route is gone — **run 128 with this deploy**) and its
open answers 503; the Distribution page lists the old screeners (legacy, no
password) and counts them; the daily step reads `{ ready: false }`.

## Tests

- `node scripts/test-screening-rules.mjs` 14, `test-notification-types.mjs` 7
  (111 types), `test-sign-in-here.mjs`, `test-private-beta.mjs`,
  `test-sec-titles.mjs` and every other `scripts/test-*.mjs` (71 files): pass.
- `dev/test-rig/checks/private-screenings.mjs` after 128: **163 ok, 0 FAIL**
  (run several times; it seeds and removes its own rows), including the browser
  half at 390, 1280 and 320. Before 128 (`RIG_MIGRATE_TO=127 RIG_REBUILD=1`):
  **7 ok, 0 FAIL**.
- `dev/test-rig/checks/sec-titles.mjs`: 81 ok after 128, 77 ok before.
- `dev/test-rig/checks/productions-dashboard.mjs` (the checklist read changed):
  201 ok. `node dev/test-rig/smoke.mjs --http-only`: no 5xx.
- `npm run check:refs`, `npm run lint`: clean.

## Left undone, and honest limits

- The website's Distribution page (`pages/productions/[id]/distribution.js`, B)
  and the app's distribution screen (C) still read `screeners` until their
  halves are merged; the API no longer answers it.
- iOS Safari plays full screen in the native video layer, where nothing can be
  drawn over the picture: the watermark is there inline and in the browser's
  own full screen elsewhere (as before).
- A guest's "each person" limit counts by the `tapa_scr` cookie: a guest who
  clears cookies or uses another browser is a new guest (the total cap and the
  password still hold). One screen at a time is by beats, so it frees up two
  minutes after the last beat while playing.
- The wrong-password lock and the open limit key on `x-forwarded-for`'s first
  address (Vercel sets it); the refusal-row cap and the limits fall back to the
  per-instance counter without Redis, like every limit on the site.
- A screening's watched figure is the furthest point reached per episode, as
  the beat reports it from the viewer's own browser.
- `next build` was not run in this worktree (the rig's `next dev` shares its
  `.next`); the pages and routes were compiled and exercised by `next dev` on
  the rig, page and client bundle included.
