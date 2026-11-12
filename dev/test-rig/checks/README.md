# The rig's checks

Re-runnable checks against the running rig (`dev/test-rig/start.sh`), one
file per area. Each prints `ok` / `FAIL` lines, a tally at the end, and exits
non-zero when anything failed. Each seeds what it needs with ids of its own
(a `ck-…` slug or a `user_rigck…` account with a per-run suffix), through
psql and the fakes' hooks, and removes it again when it finishes, so the
seed the smoke check reads is left as it was.

```bash
node dev/test-rig/checks/films-landing.mjs
node dev/test-rig/checks/extra-kinds.mjs
node dev/test-rig/checks/captions-podcast-preview.mjs
node dev/test-rig/checks/moderation-cleanup.mjs
node dev/test-rig/checks/money.mjs
node dev/test-rig/checks/payee-invites.mjs
node dev/test-rig/checks/push-audio-crawlers.mjs
for f in dev/test-rig/checks/*.mjs; do [ "$(basename $f)" = lib.mjs ] || node "$f" || echo "FAILED: $f"; done
```

| File | What it checks |
| --- | --- |
| `films-landing.mjs` | Films and shorts on the own-page landing (`pages/episode/[id].js`): who sees the landing and who the player (`?autoplay=1`, `?trailer=1`, a film with its page off, a show's episode with and without its page, the viewing-terms card), "Continue" for a member with progress, the lock panel on Play for a premium title without a plan, the owner's `?preview=1` of a film in review (strangers 404); in Chromium at 390 and 1280: the strip, the Trailer tag and its round button, one `h1.ep-title`, the Play/Save pills, "Notes from Mara" or the description, the credits, Watch next in the 400px right column, no overflow, no page errors. Notes: Your work's "Edit title, description & notes" (notes at once, the title waits in `pending_title`), the Library modal (`/admin/library?edit=`) storing `page_notes`, the 4,000-character limit, another creator refused. |
| `extra-kinds.mjs` | Kinds of extras (migration 121). Runs the half that matches the database: **after 121** — what is stored (presets matched however typed, custom words cleaned and cut at 40, Other/empty/null/"Extra" → none), who may set it (the uploader and the team; the show's owner who didn't upload it 403), every payload and page that prints it (series hub and page, the extra's page, an episode's Extras row, the show room's shelf, Your work, the review queue, the editor's policy), the kind through `submit-episode` and a sent draft (`toSubmitBody` + `draftId`), the editor's chips in a browser, 40 full-width characters on the series page cards at 390 and 1280; **before 121** (`RIG_MIGRATE_TO=120 RIG_REBUILD=1 dev/test-rig/start.sh`) — every page and route 200, extras read "Extra", the field greyed with the migration line in the editor and on the submit page, a PATCH answers `notSaved`, a submit with a kind saves without it. |
| `captions-podcast-preview.mjs` | Called the way the app calls (Bearer token, no Origin): `/api/captions/<id>` for an entitled viewer and a refused one (plan, viewing terms, missing track, `?preview=1` no way round the plan), `/api/episode-page` naming the track only for those who may watch; `/api/podcast-show?id=&preview=1` for a private podcast show — its owner, an uploader (someone else's row locked, no audio or video), the team, a sub-admin, a stranger and signed out (404), a public show (ordinary answer), the show pulled (only the team plays). |
| `moderation-cleanup.mjs` | `/admin/content`'s "Gone" rows and "The item is gone — close its reports" (reports upheld, flags resolved, one audit line, nobody told, refused while the item exists and for a sub-admin without `handle_flags`), the flags badge (`/api/admin/queue-counts`: an item with a flag and reports once, tip notes and gone items not at all, an account reported from Messages without a profile row still counted), Restore's words to the owner (back up / nothing needs to change / cleared), the review queue's Approve with `seen` (stale → 409 `changed`, current → approved, none → as before, a file replaced since the card loaded → 409). |
| `money.mjs` | Through the fake Stripe and Clerk: a lineup picking the studio's own account and a creator (the studio's line kept — not owed on `/admin/money`, "Kept by the studio" on `/admin/creator-money` and the admin's own `/creator/money`); `invoice.paid` before `checkout.session.completed` (5xx while young, recorded once the member is known, a day-old one skipped, a Clerk id on the customer names the member); a studio-owned title's Checkout while Clerk can't answer for its owner (503, then a normal house sale); a referral through Checkout (`via`, a typed handle, the `tapa_via` cookie, the bonus line on the first invoice); a leaver's balance moved to the pool without the studio. |
| `push-audio-crawlers.mjs` | The round of 2026-11-12. **AI crawlers**: GPTBot's user agent gets 403 (plain text naming the policy, the no-AI header, never stored) on pages, the API, the feed, the audio route and the sitemap, and 200 on robots.txt, `/.well-known/`, `/ai-policy`, `/terms`; Googlebot and the app are never refused; PerplexityBot follows `site_settings.block_ai_search` (flipped in SQL, about 70 s of waiting for the middleware's 30-second copy; `RIG_CHECK_SKIP_SWITCH=1` leaves it out). **Podcast audio** (`/api/podcasts/audio/<id>`): a feed-listed episode for anyone (302 to a signed link that plays), the bare id and HEAD, unknown extension / missing id / POST, premium refused signed out and without a plan and opened by the team's session, `/api/podcast-show`'s keyed addresses (play with no session, another episode's or a tampered key is no key, a held one stays shut), held and in-review refused, the team's `?preview=1`, external audio a 302 to itself, the RSS enclosure on the www host with the byte length, the show page's HTML and `/api/episode-page` without the stored address; "Lock podcast audio" from a public bucket (refused for a viewer, the public address stops, plays carry on, a second press says already private, the audit lines, Admin → AI security's "of 5 run"). **Web push**: the key route, subscribe refused signed out and for a non-push endpoint, a message's notification arriving at the fake Clerk's sink decrypted (title, the bell's words, the href and its tag, aes128gcm, TTL 86400, a VAPID token for that origin signed with the site's key), a 410 retiring that browser with its reason and leaving the other live, re-binding to whoever subscribes next, unsubscribing with the endpoint alone, the Preferences row; before 122 it checks the 503 `migration-122` instead. Uses fresh accounts and removes them, their threads and rows. |
| `payee-invites.mjs` | Payee invites accepted with nothing moved, through the daily `/api/cron/creator-reminders`: finished, withdrawn (no Creator Studio, stale), left alone (went through, still under way), a second run changes nothing, and `supabase/health_check.sql`'s row before and after. The cron also runs its other daily steps (idempotent repairs of the seed). |

`lib.mjs` holds the shared helpers: the app's address (`http://localhost:3100`,
`RIG_BASE` to change it), sessions (every one carries the viewing-terms
cookie; `SIGNED_OUT_NO_TERMS` doesn't), `call()` the way the website (cookie)
or the app (`bearer: true`) calls, psql, the fakes, fresh accounts
(`newUser`), and Chromium with every non-rig request aborted (a page error
from Clerk's frontend failing to load is the rig's, not the page's, and is
left out).

The fake Clerk's `POST /__fail?user=<id>&on=1|0` (added for `money.mjs`)
makes one account's reads answer 500, so a money path that has to know who
the studio is can be seen failing closed.

Leave the rig at the latest migration when you finish: after a run before
121, `dev/test-rig/stop.sh` then `RIG_REBUILD=1 dev/test-rig/start.sh`.
