# Private screening links — build contract (2026-11-21)

Jose, 2026-11-21: "I honestly like all those ideas. Let's build it. And for the
locations … restrict it to like a country … Probably not a city, but more like a
country. And apart from that, continue as recommended." The canvas with every
board and the 14 decisions: https://claude.ai/artifact/BJ7dCjjTiHJiHayKFDSbVD.
Decisions as built: all 14 as recommended; **location = a country limit only**
(no city limit), the city is still *shown* on the dashboard; **an ended link
stays ended** (while live: end early or move the end later; once ended: Discard
or Run it again with a new address and password).

Already written and checked (don't change without saying so in your notes):

- `lib/screeningRules.js` — pure, no imports; `mobile/src/lib/screeningRules.js`
  is the file word for word (`node scripts/test-screening-rules.mjs`, 14 checks).
  **Every label, number, line and list on these pages is built there.** Need a
  new word? Add it to `SCREENING_WORDS` / `VIEWER_WORDS` in both copies and say so.
- `supabase/migrations/128_private_screenings.sql` (`node scripts/check-migration-128.mjs`, 11).
- `TITLE_TABS` / `SHOW_TABS` in `lib/titleDashRules.js` (+ the app's copy) have
  `{ key: 'screenings', label: 'Private screenings' }` (not on a vertical title).

## The data (migration 128)

`screeners` (one row per link): `id`, `token` (18 random bytes base64url — the
link), `label`, `recipient_email`, `owner_id` (who made it), `target_type`
(`episode` | `series`), `target_id`, `scope` (`title` | `show` | `season` |
`episodes`), `season`, `episode_ids` (season / picked, kept as picked; null for
title / whole show), `starts_at`, `expires_at` (= the end), `revoked_at` (=
ended by its owner), `max_views`, `views`, `per_person_max` (null = no limit
each), `one_screen`, `countries` (ISO-2; empty = anywhere), `access` (`anyone` |
`signed_in` | `named`), `named_user_ids`, `named_emails`, `notify` (`every` |
`first` | `daily` | `never`), `password_hash` (scrypt), `password_enc`
(AES-256-GCM), `password_set_at`, `ended_notified_at`, `summary_sent_on`,
`guess_alerted_at`, `run_from`, `production_id` (109's rows only), `episode_id`
(109's rows only; = target_id), `last_viewed_at`, `created_by`, `created_at`,
`updated_at`.
A row with `password_hash` null is **legacy** (a 109 screener): no password,
anyone, no per-person limit, any screens, anywhere, every open told — it keeps
working until its date exactly like that.

`screener_views` (one row per open = per visit): `screener_id`, `viewed_at`
(= openedAt), `user_id` | `device_key` (sha256 of the guest cookie, 24 hex),
`session_key` (sha256 of the visit key), `ip_hash`, `user_agent`, `device`,
`city`, `region`, `country`, `episode_id` (playing now), `position`,
`watched` jsonb `{ "<episodeId>": [maxSeconds, durationSeconds] }`,
`watched_seconds`, `last_beat_at`, `last_play_at`.

`screener_refusals`: `screener_id`, `reason` (`password` | `locked` | `country`
| `screen` | `opens` | `person_opens` | `named`), `user_id`, `device_key`,
`ip_hash`, `device`, `city`, `region`, `country`, `at`.

## The JSON both clients read (the server answers exactly this)

**Link**
```
{ id, token, path: '/screener/<token>', url: '<origin>/screener/<token>', code: '<last 6 of token, upper>',
  label, recipientEmail, target: { type, id }, scope, season, episodeIds,
  startsAt, endsAt, endedAt, access, named: { userIds, emails },
  maxViews, views, perPerson, oneScreen, countries, notify,
  legacy, password /* the owner's readable copy; null on legacy or unreadable */,
  productionId, runFrom, createdAt, updatedAt, lastViewedAt,
  stats: { people, refused, watchingNow, watchedPercent, twoCities } }
```
`url` is built from `requestOrigin(req)` (lib/stripe.js). Every key always present (null when empty).

**Target**
```
{ type: 'episode'|'series', id, title, contentType, poster, publicHref /* null when not public */, ownerName,
  seasons: [{ number, label, count }],                 // series only, else []
  episodes: [{ id, title, code: 'S1 E2'|null, season, number, status }] } // series: what a link can play now; else []
```

**View row** (in `views`, newest first) — the shape `peopleFrom` reads:
`{ id, userId, name, handle, avatar /* {url,position,zoom}|null */, deviceKey, city, region, country, device, openedAt, lastPlayAt, lastBeatAt, episodeId, position, watched }`
(name/handle/avatar from public profiles; never an email; deviceKey is the stored hash).

**Refusal row**: `{ id, reason, userId, name, deviceKey, city, region, country, device, at }`.

## Routes (creator side, signed in; `private, no-store`; CORS as every route)

| Route | Answers |
|---|---|
| `GET /api/screenings?target=episode:<id>` or `series:<id>` | `{ target, links: [Link], suggestion: '<password>' }` |
| `POST /api/screenings` `{ target: { type, id }, label, recipientEmail, scope, season, episodeIds, startsAt, endsAt, password, access, named: { userIds, emails }, maxViews, perPerson, oneScreen, countries, notify }` | 201 `{ link }` |
| `GET /api/screenings/password` | `{ password }` (a fresh suggestion) |
| `GET /api/screenings/<id>` | `{ link, target, views: [ViewRow], refusals: [RefusalRow] }` |
| `PATCH /api/screenings/<id>` `{ action: 'update', …settings }` | `{ link }` (validated with `validateLink(…, { existing })`) |
| `PATCH /api/screenings/<id>` `{ action: 'password', password? }` | `{ link }` (none sent → a suggestion is set) |
| `PATCH /api/screenings/<id>` `{ action: 'end' }` | `{ link }` |
| `DELETE /api/screenings/<id>` | `{ ok: true }` (ended links only) |
| `POST /api/screenings/<id>/again` `{ …optional overrides }` | 201 `{ link }` (ended links only; window = `againWindow` unless sent; a new token and password) |

Errors: 400 `{ error, field }` (validateLink's), 401 signed out, 403 `{ code: 'not-yours', error: SCREENING_WORDS.notYours }`,
404 unknown, 409 `{ code: 'ended' | 'not-ended' | 'unavailable', error }`, 429, 503 `{ code: 'migration-128', error: SCREENING_WORDS.needsUpdate }`.

**Who may**: a full admin; whoever runs the target — a show: `series.creator_id`;
an episode: `titleRunnerOf(episode, itsShow)` (lib/showRules.js; an extra's show
through `bonus_parent_*`); for a link: the same for its target, or (legacy rows
with a `production_id`) its `owner_id`. Never someone who only uploaded one
episode of another person's show. New links (and runs again): 40 a day per account.

**What a link can play**: an episode approved or in review whose
`screenerTitleProblem` (lib/titleSecurityRules.js) is null; a show not held,
withdrawn, declined or on its way out. `show` scope = the show's episodes
(not extras) that pass, now; `season` = the picked season's ids at creation;
`episodes` = the picked ids. A title that can't be screened answers 409
`unavailable` at creation and the viewer's `unavailable` later.

## The viewer (website only; `/screener/<token>`; no sign-in needed; `noindex`)

`getServerSideProps` reads the link without counting anything →
`page: { state, title, ownerName, label, code, poster, still, kind ('film'|'show'),
startsAt, endsAt, endedAt, countries, access, legacy, oneScreen, perPerson,
episodesCount, viewer: { signedIn, name } }` where `state` is
`gone` | `unavailable` | `not_yet` | `ended` | `stopped` | `country` | `signin` |
`named` | `named_other` | `password` (show the form; a legacy link shows Watch with no field).
Words: `viewerLine(state, vars)`, `passwordNote`, `VIEWER_WORDS`.

- `POST /api/screener/<token>/open` `{ password }` → 200
  `{ session, viewer: { signedIn, name }, watermark, link: { label, code, endsAt, oneScreen, opensLeft, perPerson, yourOpens },
     episodes: [{ id, title, code, poster, thumbnail, contentType }], current: { id, src, signed, expiresAt } }`
  or 4xx `{ error, reason, retryAt?, triesLeft? }` (reason = a `VIEWER_WORDS` key). Counts one open
  (guarded on `views`), writes the view row, sets the guest cookie `tapa_scr` (httpOnly, SameSite=Lax,
  Secure in production, a year), tells the owner per `notify`.
- `POST /api/screener/<token>/play` `{ session, episodeId }` → `{ current }` — a fresh 30-minute address
  (also the player's `refreshSrc`); no open counted.
- `POST /api/screener/<token>/beat` `{ session, episodeId, position, duration, playing }` every 20 s
  → `{ ok: true }` or `{ stop: true, reason, error }` (`ended`, `stopped`, `screen`, `session`,
  `password_changed`). Records `watched`, `position`, `last_beat_at`, and `last_play_at` while playing.

Order of checks on open: rate limit → link found → title playable → window → country → sign-in /
named → the wrong-password lock (5 `password` refusals from this `ip_hash` in the hour) →
password → link opens left → this person's opens left → one screen (another session with
`last_play_at` inside `screenHoldSeconds`) → count. Every refusal past the sign-in step writes a
`screener_refusals` row (at most 200 a link a day). 20 wrong passwords on a link in a day → the owner
is told once that day (`screening_guessing`). Each session lasts `sessionHours`; a password change
(`password_set_at` after the session's open) ends it at the next play or beat. A suspended
account's own session is refused (`suspendedPlaybackRefusal`). Screening plays never touch watch
history, view counts, Continue Watching, ad share or the creator's numbers, and play no ads.

Place: from `x-vercel-ip-country` / `x-vercel-ip-country-region` / `x-vercel-ip-city`
(decodeURIComponent), trusted only when `process.env.VERCEL === '1'` or outside production (the rig sends
them itself). A link with countries refuses an unknown country.

## Notifications (both copies of lib/notificationTypes.js)

`screening_opened`, `screening_ended`, `screening_guessing`, `screening_summary` — words from
`notifyLines`, href `screeningHref(id)` (ended: `targetTabHref(target)`). The daily step (from
`/api/cron/expire-content`): tell owners of links that ended (`ended_notified_at`; End it now marks it
at once, no notice), daily summaries for `notify: 'daily'` (`summary_sent_on`), and delete view and
refusal rows of links ended more than `keepDaysAfterEnd` days ago.

## Pages

**Website** (`.scn-*` styles; the canvas's Main, NewLink, LinkDashboard, Ended boards):
- the title dashboard's **Private screenings** tab (`/creator/title/<id>?tab=screenings`) and the show
  page's third tab (`/creator/show/<id>?tab=screenings`) — one component, `target` = episode or series:
  `screeningsList` (filters, cards with Copy link / Copy password / Open ›, ended cards with Run it again /
  Discard…), the empty state, + New link.
- the **New link** dialog (also Edit settings, and Run it again's "Change something first"): who it's
  for, what it plays (a show: Whole show / a season / Pick episodes), when it works (QUICK_WINDOWS chips +
  Starts / Ends `datetime-local` on the Pacific clock via `toPacificInput` / `fromPacificInput`), the
  password (suggestion + New one), who can open it (three options; named = accounts from
  `/api/messages/people?q=` and typed emails), limits (opens, each person, one screen, countries as a
  multi-select of `COUNTRIES` with "Anywhere"), tell me; then the **ready** card (link, password, Copy the
  invite with the "put the password in" box, Email the link as a mailto, Done).
- a link's own page **`/creator/screenings/<linkId>`**: back pill to `targetTabHref`, `linkDashboard`
  (state + watching pills, title, sub, Copy link / Copy password / Copy the invite, the timeline as an SVG,
  the four tiles, Who watched, Turned away, Settings with Edit settings / New password / Move the end,
  Where it was opened, End it now…; ended: Run it again / Discard…).
- `/screener/<token>` rebuilt: every state above, the password form, the player (VideoPlayer,
  `adsEnabled={false}`, `advisory={false}`, `refreshSrc` → play), the moving watermark
  (`watermarkText`), a show's episode list (moving between them doesn't use another open), the beat,
  the stop messages, sessionStorage `tapa_scr:<token>` so a reload resumes without a new open.
- the production **Distribution** page: its Screeners card becomes **Private screenings**: the release
  title's links (and the production's old screeners) read-only with their state, Open › for those you
  run, and "Private screenings for <title> ›" (`distributionGo`) to the tab. `getDistribution` answers
  `screenings: { links: [Link], href: targetTabHref|null, canManage }` in place of `screeners`;
  `POST /api/productions/<id>/screeners` answers 410 `{ error: SCREENING_WORDS.distributionLine }`;
  its DELETE ends a link through the new code.

**App** (`mobile/src`; creator side only — a screening opens on the website):
- `creator/title/[id].js` and `creator/show/[id]/index.js` get the tab (the same list), `creator/screenings/[id].js`
  is the link's own screen (registered in `_layout.js`, `headerShown: false`), the New link sheet
  (`messages/MessageSheet.js`), copy with `expo-clipboard`, Share the invite with `Share.share`, the
  distribution screen as the website's, `hrefToRoute` (`PushListener.js`) for `/creator/screenings/<id>`
  and `?tab=screenings`. Dates: the quick picks + a custom start / end typed as `YYYY-MM-DD` and `HH:MM`
  (Pacific) through `fromPacificInput`.

## Privacy and Terms

Privacy: what a creator sees about someone who opens a private screening (that it was opened, the city
/ region / country from the connection, the kind of device, how much was watched, their name if
signed in), that we keep a hash of the address for the wrong-password lock, and that it's deleted when
the creator discards the link and a year after it ends at the latest. Terms (section 6): never
record, copy or re-show a private screening, or pass its link or password on. `TEXT_UPDATED` 2026-11-21.

## Builders

- **A — server + viewer**: `lib/screenings.js` (+ a small `lib/screeningCrypto.js`), the routes above,
  `pages/screener/[token].js` + `pages/api/screener/[token]/{open,play,beat}.js` (the old
  `pages/api/screener/[token].js` goes), `lib/distribution.js` + its two routes, the daily step,
  notification types (both copies), Privacy + Terms, `dev/test-rig/checks/private-screenings.mjs`
  (the API end to end, the viewer page's states, the rig's geo headers).
- **B — website creator side**: the tab component, the dialog, `/creator/screenings/[id]`, the title and
  show pages' tab wiring, the Distribution page's card, styles.
- **C — the app**: everything under "App".

Each builder ends with an **As built** section below (what you made, any word you added to the rules,
anything you couldn't do).

## As built
