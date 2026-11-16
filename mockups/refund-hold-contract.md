# Refund holds — build agreement (2026-11-16)

Jose, 2026-11-16, on round 3's open decision ("a no-show or cancellation on paid
crew work refunds the poster at once, with no way for the worker to contest"):
**"Yes, hold the money for any disputes, let's see what else we can fix."**

Migration **125** (`supabase/migrations/125_refund_holds.sql`, checked by
`scripts/check-migration-125.mjs`, already in `supabase/check_migrations.sql`)
is written and committed. Do not change it; if you need another column, say so
in your "As built" notes instead.

No new visual design: everything below uses the chips, buttons, boxes and
notices the pages already have (`crew-chip`, `crew-btn`, the app's `Chip`, the
working card's Get paid list, `/admin/crew`'s Secured crew pay table).

---

## A. Crew pay: a refund the poster asks for waits three days

### The rule

Any refund **the poster** starts on **held** secured pay waits
`REFUND_WAIT_DAYS` = 3 days before Stripe is asked, so the crew member can say
the job happened:

| Poster action | `refund_kind` | Goes back (`refund_asked_cents`) |
|---|---|---|
| "Didn't happen" (outcome `no_show`) | `no_show` | the whole charge (`total_charged_cents`) |
| "Cancelled" (outcome `cancelled`) | `cancelled` | the charge less the card fee (`total_charged_cents − fee_cover_cents`) |
| Unbook (before the first day; after it is already refused) | `unbooked` | the charge less the card fee |

The amounts are today's (`settleCrewPay` / `onUnbookCrewPay`), only delayed.
An **admin settling a quiet poster's job** as no-show/cancelled (the
`/api/admin/crew-calls` `outcome` op) also waits the three days — the worker
still gets their say. An admin's explicit **Refund** button
(`adminRefundCrewPay`) and an admin's decision on a contested refund are
immediate (they are the decision).

While the refund waits the row stays `status = 'held'` with `refund_due_at`,
`refund_kind`, `refund_asked_cents`, `refund_asked_by`, `refund_asked_at` set.
Nothing about Studio money changes (a held row is already counted as money
that has to stay).

### During the three days

- **The crew member contests**: "It happened — tell the studio" with a note
  (required, 10–1,000 characters after trimming; run it through
  `lib/wellFormed.js` like other request text). Sets `contested_at` +
  `contest_note`. The refund then waits for a full admin, however long. The
  poster is told, the studio is emailed (`STUDIO_MONEY_NOTIFY_EMAIL` else
  `SITE.contactEmail`, the call, both names, the amount, the note escaped, a
  link to `/admin/crew`). Only the row's `worker_id`; only while the row is
  `held`, a refund is asked and nothing is decided; once only (a second
  contest answers 409). 10 contests a day per account (`checkRateLimit`), and
  the poster/studio notices go once per payment.
- **The poster changes their mind** (no-show/cancelled only): "They worked it
  after all" → outcome `worked`. `setOutcome` allows this one change for a
  poster (not only an admin) while the payment's refund is still waiting and
  undecided — contested or not. It clears the refund fields, records
  `contest_decision = 'release'`, `contest_decided_by = poster`, and goes on
  to `releaseRow` (the release hold still applies). Never the other way.
- **Unbooked, then booked again**: booking the same response again while its
  `unbooked` refund waits withdraws the refund (clear the fields) — the pay is
  held for them again. Funding is not asked again.
- **A chargeback** on the charge meanwhile: `lib/paymentDisputes.js` moves the
  row to `disputed` as today; the daily step skips it; won → back to `held`
  with the refund still waiting, so the next run makes it.

### After three days

The daily `/api/cron/creator-reminders` gets a step `refundDueCrewPay()` (its
own try/catch, like each step there): every `held` row with
`refund_due_at <= now`, `contested_at is null`, `contest_decision is null` →
`refundRow` with `refund_asked_cents` and the reason words for its kind
("the job didn't happen" / "the booking was cancelled" / "they were taken off
the job"). At most 200 a run; the audit line counts them.

### A full admin decides a contested (or any waiting) refund

`/admin/crew` → Secured crew pay: a waiting row reads "Refund asked by the
poster · <kind words> · goes back <Nov 19>"; a contested one adds "Contested"
and the crew member's note, with two buttons:

- **Refund the poster** → `refundRow` now with `refund_asked_cents`;
  `contest_decision = 'refund'`.
- **Pay the crew member** → the response's outcome becomes `worked`
  (`outcome_by` the admin), refund fields cleared,
  `contest_decision = 'release'`, then `releaseRow` (the release hold
  applies).

New op on `/api/admin/crew-calls`: `{ op: 'decide_refund', paymentId,
decision: 'refund' | 'release', note }` — **full admins only** (a sub-admin
never moves crew money, as today), audited `crew_pay_refund_decided`, both
sides told (`crew_pay_refund_decided`). A decision on a row that is no longer
waiting answers 409 with a plain line.

### Guards

- `releaseRow` skips a row whose refund is waiting and undecided
  (`{ skipped: 'refund asked' }`) — `releaseDueCrewPay`,
  `releasePendingCrewPay` and `adminReleaseCrewPay` can't pay out money the
  poster asked back.
- Every write that moves a waiting refund is guarded on the row's state
  (`status = 'held'`, the refund fields as read) so the cron, a contest, the
  poster's change of mind and an admin decision can't both win; use plain
  filters (PostgREST answers an `or()` on an update with "column … does not
  exist").
- The note is shown only to the crew member who wrote it and to full admins
  (`/admin/crew`); the poster sees "Contested" and never the note.
  `paymentsForCall` / `toPayment` must not carry `contestNote` to the poster.

### Before migration 125

A poster's no-show / cancelled / unbook on held pay **moves no money**: the
row stays held, the studio is emailed to settle it on `/admin/crew` (the
existing Refund / Release buttons), and the poster reads "The secured pay
stays held until the studio settles it." The contest button and the decide op
answer 503 `{ code: 'migration-125' }`. Detect the missing columns by the
error naming one of them (like `mentions114`).

### Words (both sides, web and app identical)

Put them in `lib/crewPayRules.js` (client-safe) and the app's copy of what it
needs. The app has no copy of `crewPayRules.js` today; create
`mobile/src/lib/crewPayRules.js` holding only what the app uses, word for word,
and make `scripts/test-crew-pay.mjs` check the shared parts are identical.

- `REFUND_WAIT_DAYS = 3`, `refundDueFrom(from)`, `refundKindWords(kind)`
  ("Didn't happen" / "Cancelled" / "Taken off the job"),
  `refundState(payment, now)` → `none | waiting | contested | due`,
  `contestRefusal(...)` (the plain lines for each refusal).
- Worker notice (`crew_pay_refund_asked`): "<Poster> says <the job didn't
  happen | the job was cancelled | you're off the job> on <title>. The <$X>
  secured for you goes back to them on <Nov 19> unless you tell us
  otherwise."
- Worker's box on the call (web + app): "<Poster first name> says the job
  didn't happen. The <$X> goes back to them on <Nov 19> unless you tell us
  otherwise." + textarea "What happened? The studio reads this." + **It
  happened — tell the studio**. After: "You told the studio on <Nov 16>. The
  <$X> stays held until someone there decides; they may write to you both."
- Poster's response row: chip "Refund <Nov 19>" (waiting) or "Contested"; the
  line "The <$X> goes back to your card on <Nov 19> unless <first name> says
  otherwise." / "<First name> says the job happened. The <$X> stays held until
  the studio decides." + **They worked it after all** (no-show/cancelled).
- Poster notice (`crew_pay_contested`): "<Worker> says the job on <title>
  happened. The <$X> stays held until the studio decides — we may write to
  you both."
- Decision notices (`crew_pay_refund_decided`): worker "The studio looked at
  <title>: the <$X> is yours." / "…: the <$X> goes back to the poster."; poster
  the mirror. (The release and refund notices that follow are the existing
  ones.)
- Working card's Get paid list (web `pages/crew/card.js`, app's crew card
  screen): a waiting row reads "<$X> · <title> · refund asked, goes back <Nov
  19>" linking to the call; a contested one "· you contested it".

Add the three types to both `lib/notificationTypes.js` and
`mobile/src/lib/notificationTypes.js` (same `kind(label, 'card', 'call')`
shape as the other `crew_pay_*`). `scripts/test-notification-types.mjs` must
still pass.

### Terms

`pages/terms.js` section 14's `#secured-pay` paragraph: when the poster says a
funded job didn't happen, cancels it or takes someone off it, the money waits
three days before it goes back, and the crew member can tell us the job
happened; then it stays held until we decide, and we may ask both for
details; a poster can change "didn't happen" or "cancelled" to "worked it"
while the money waits. Move `TEXT_UPDATED` to 2026-11-16. Add the same as a
question for the lawyer at the end of `legal/creator-share-terms-draft.md`.

### Files you will touch (at least)

`lib/crewPay.js`, `lib/crewPayRules.js`, `lib/crewCalls.js` (`setOutcome`,
`setBooking`), `pages/api/crew/calls/[id]/…` (a new `contest-pay.js` route:
POST `{ responseId, note }`, signed in, `applyCors`, `sendError` with
`plainStatus: 400`), `pages/api/admin/crew-calls.js`,
`pages/api/cron/creator-reminders.js`, `pages/crew/calls/[[...id]].js`,
`pages/crew/card.js`, `pages/admin/crew.js`, `mobile/src/app/crew/calls/[id].js`,
the app's crew card screen, both `notificationTypes.js`, `pages/terms.js`,
`legal/creator-share-terms-draft.md`.

### Checks

- `scripts/test-crew-pay.mjs`: the new rules (the three kinds' amounts, the
  due date, `refundState` at each moment, the refusals, the app copy word for
  word).
- A rig check `dev/test-rig/checks/crew-pay-hold.mjs` (seeds and removes its
  own rows; fake Stripe): after 125 — no-show → held + waiting + the worker's
  notice, no Stripe refund yet; the cron step before the due date does nothing;
  move `refund_due_at` into the past → the cron step refunds the whole charge;
  cancelled → less the card fee; unbook before the first day → waits, booking
  again withdraws it; contest → poster notified, studio emailed (or at least
  the email attempted), cron skips it, a second contest 409, the poster can't
  read the note, a stranger and the poster can't contest; "worked it after
  all" → released (or held by the release hold) and the refund gone; admin
  decides refund / release, a sub-admin refused, a decided row 409; a
  chargeback meanwhile → cron skips; the release paths refuse a waiting row.
  Before 125 (`RIG_MIGRATE_TO=124`): no-show moves no money and says so; contest
  and decide answer 503 `migration-125`.
- `npm run check:refs`, `npm run lint`, every `scripts/test-*.mjs`,
  `next build` (see CLAUDE.md for the rig's env), both app exports
  (`cd mobile && npx expo export --platform ios --clear` and android).

---

## B. Clear-cut fixes from round 3's open list

1. **A self refund can't race a download** (`purchases.refund_started_at`,
   125). `refundPurchase({ kind: 'self' })`: first claim
   `refund_started_at = now()` with a guarded update (`status = 'completed'`,
   `refund_started_at is null`; nothing claimed → 409 "A refund for this is
   already on its way."), **then** read the downloads — counting rows whose
   date isn't set yet (a download being started) as downloaded — then the
   rest of today's checks; any refusal or a Stripe failure clears the claim.
   `lib/downloads.js` `startDownload` for a copy whose basis is `owned`: after
   it writes its row (today's order), read strictly whether any purchase that
   covers the title has `refund_started_at` set or is no longer `completed`;
   if so, delete its own undated row and refuse 409 "This title is being
   refunded, so it can't be downloaded." A claim older than 10 minutes is
   stale (a refund that died) and may be taken over. Before 125: today's
   behaviour, unchanged. Admin, takedown and Stripe-mirrored refunds don't
   claim.
2. **The location GET routes stop running the site-wide expiry on every
   read** (`expireStale` in `lib/locationRequests.js`, called from three
   readers). Run it at most once a minute (`firstInWindow`, plus a
   per-instance timestamp so a Redis outage doesn't make every read run it)
   and from the daily cron too. Make sure every action that depends on a
   deadline (accept, counter, pay) checks the deadline itself, so a status
   that hasn't been expired yet can never be acted on late; add that check
   wherever it's missing.
3. **`/api/apply/artwork` stops storing in the public artwork bucket**: an
   applicant's poster/still go to private storage (`uploadPrivateImage`,
   `private:` reference) until Accept; the applicant's own status card and the
   review queue / `/admin/applications` get a one-hour signed preview; Accept
   copies what it uses to the public `episode-art` bucket as today's episode
   art; Decline removes the private copies. Artwork already stored publicly
   keeps working.

Checks: the unit tests you add or touch, a rig check
`dev/test-rig/checks/round-nov16.mjs` covering the three (the refund/download
order both ways by driving the routes; expiry still happens and a late accept
is refused; the artwork path private → accepted public), the existing
downloads, money, creator-path-related and locations checks still passing,
check:refs, lint, `next build`.

---

## As built

(Each builder writes what they built, what differs from the above and why,
and what they could not verify.)

### A — refund holds on secured crew pay (branch `refund-a`)

**Built, website, app and admin, as above:**

- **The rules** in `lib/crewPayRules.js`. The part the app needs sits
  between a `// shared:start` and a `// shared:end` line, and
  `mobile/src/lib/crewPayRules.js` is a short header plus that block word
  for word (`scripts/test-crew-pay.mjs` compares the two and loads both):
  `payDollars` (moved into the block, same output), `payDay` (new: "Nov 19"
  on the Pacific calendar, so a server notice and a page name the same
  day), `REFUND_WAIT_DAYS`, `REFUND_KINDS`, `CONTEST_NOTE_MIN/MAX`,
  `refundDueFrom`, `refundKindWords`, `refundSaysWords`, `refundState`
  (takes a database row or a payment as the pages get it),
  `canChangeToWorked`, the worker's box (`workerRefundBox`), the poster's
  chip and line (`posterRefundChip`, `posterRefundLine`), the working card's
  words (`cardRefundWords`) and the three button/placeholder strings. The
  website only: `refundAskedCents`, `refundReasonWords`, `contestRefusal`
  (`{ status, code, error }`: not-yours 403, not-held / decided / no-refund
  / contested / due 409, note-short / note-long 400), the three notices,
  `adminRefundLine` and the before-125 lines.
- **`lib/crewPay.js`**: `askRefund` (the poster's no-show, cancellation or
  unbook, and an admin's outcome on a quiet poster's job: held, the refund
  fields set three days on, the crew member told `crew_pay_refund_asked`),
  `holdForStudio` (before 125: nothing moves, the studio emailed once a
  week per payment and answer), `withdrawRefundForRelease`,
  `takeBackRefundForWorked`, `withdrawUnbookRefund`,
  `contestCrewPayRefund`, `paymentForDecision`, `refundDecided` /
  `releaseDecided` (`crew_pay_refund_decided` to both), and
  `refundDueCrewPay` (the daily step, 200 a run, oldest due first).
  `releaseRow` answers `{ skipped: 'refund asked' }` while a refund waits
  undecided, and its claim also requires no refund asked; the daily
  step's and a decision's claims require the same undecided refund as
  read. `toPayment` carries `refundDueAt`, `refundKind`, `refundKindWords`,
  `refundAskedCents`, `refundAskedAt`, `contestedAt`, `contestDecision`,
  `contestDecidedAt`, `refundState` — never the note; `paymentsForCall(id,
  { noteFor })` adds `contestNote` only to the writer's own payment, and
  the admin list adds it for the route to take off for sub-admins.
- **`lib/crewCalls.js`**: `setOutcome` lets the poster change "didn't
  happen" or "cancelled" to "worked" while that refund waits (contested or
  not): the refund is withdrawn first (guarded), then the outcome is
  written, then the release (with the release hold); every other change
  is refused as before. `setBooking`: unbook asks the refund (`unbooked`);
  book or promote withdraws a waiting `unbooked` refund. Both return
  `payNote` before 125. `decideCrewPayRefund(adminId, paymentId,
  decision)`: refund → back now; release → the refund withdrawn, the
  outcome `worked` by the admin (and the production crew list), then the
  release. `funded` on the poster's view no longer counts money asked back.
- **Routes**: `POST /api/crew/calls/<id>/contest-pay` (signed in, cookie
  or token; answers the crew member's view of the call plus
  `studioEmail`); `/api/admin/crew-calls` op `decide_refund` (full admins,
  audited `crew_pay_refund_decided`), the GET takes `contestNote` off for
  sub-admins; `/api/cron/creator-reminders` runs `refundDueCrewPay` after
  the releases, answers `crewPayRefunds` and writes an audit line
  `crew_pay_refunds_due` when anything was due; `/api/crew/card` GET
  answers `myPay` too (the app's Get paid list).
- **Pages**: the call page (web `pages/crew/calls/[[...id]].js`, app
  `mobile/src/app/crew/calls/[id].js`): the crew member's chip, box, note
  box and **It happened — tell the studio**, then "You told the studio on…"
  with their own note; the poster's chip (Refund Nov 19 / Contested), line
  and **They worked it after all**; the poster's "Didn't happen refunds you
  in full" sentence now says three days later. The working card's list
  (web, and new in the app: it had no list). `/admin/crew`: the line, the
  note (full admins), **Refund the poster** / **Pay the crew member**, and
  a paragraph on how it works. Terms section 14 (`TEXT_UPDATED`
  2026-11-16) and a new section 7 at the end of
  `legal/creator-share-terms-draft.md` with the paragraph and the question.
  Three notification types in both registries: Refund asked, Refund
  contested, Refund decided.

**Different from the agreement, and why:**

1. A contest is refused once the three days are up even if the daily step
   hasn't run yet (409 `due`) — the agreement says "during the three
   days". The crew member's box then shows its line without the form.
2. `claimRow`'s `or(claim is null, claimed_at < stale)` on an update is two
   plain tries now (a free claim, then a stale one), as the PostgREST note
   asks. The `or()` did work on the rig's PostgREST 12.2 when I tried it,
   so this is caution, not a fix of a live failure.
3. On a row whose refund waits, `/admin/crew` shows the two decision
   buttons instead of Release again / Refund. **Refund the poster** sends
   back `refund_asked_cents` (the charge less the card fee for a
   cancellation or an unbook), as the agreement says; the old whole-charge
   Refund stays on every other held row.
4. "Worked" reaching a waiting refund any way (the poster's change of mind,
   an admin's outcome op) records `contest_decision = 'release'` with who
   did it, as the decide op does.
5. Asked again while a refund waits (an admin changing a no-show to a
   cancellation): only the kind and the amount change; the date and any
   contest stay. A fresh ask clears an older decision and contest.
6. Booking again withdraws the unbook refund and clears the contest too
   (`contested_at`, `contest_note`); no decision is recorded.
7. A contest and the withdrawals need no claim in flight (`claim is null`),
   so a release or refund mid-way through Stripe makes them 409 ("being
   settled right now"). A claim left by a crash blocks them until a
   release or refund takes it over (after ten minutes) — rare.
8. Amounts in the words: the crew member's lines name the rate
   (`amount_cents`); the poster's line, the contested notice and the
   poster's "goes back to you" decision name what goes back
   (`refund_asked_cents`).
9. The contest route answers `studioEmail` ('sent' | 'skipped' | 'failed')
   so the rig can see the email was tried without Resend.
10. `/api/admin/crew-calls`' catch now keeps a refusal's `code` and sends
    everything else through `sendError` (it used to echo any error that
    carried a status, which an `internalError` would have leaked).

**Checks run:** `scripts/test-crew-pay.mjs` (10, six new) and every
`scripts/test-*.mjs` (62 files pass), `npm run check:refs`, `npm run lint`,
the rig check `dev/test-rig/checks/crew-pay-hold.mjs` — 70 after 125 (49
through the routes against real fake-Stripe charges, 21 in Chromium at 1280
and 390: the crew member's box and button, the poster's row with no note on
the page, the working card, `/admin/crew`, no sideways scroll, no page
errors) and 7 at `RIG_MIGRATE_TO=124` — `sec-money` (101) and `app-return`
(36) after 125, the smoke pass (no 5xx, no page errors), `next build`, and
`expo export` for iOS and Android.

**Not verified:** anything against real Stripe (the fake only), the
studio's email itself (the rig has no Resend), races by timing (the guards
are read and reasoned, not raced), and nothing in the app on a device.

**Left alone (outside A):** `lib/paymentDisputes.js`'s won notice tells the
crew member the pay is "held for you again and is sent once the poster
confirms the work" even when a refund still waits; a crew member whose job
the poster marked "didn't happen" still sees "You're booked" (the response
keeps status booked); the Terms' "a disagreement about the work is settled
between them, with us only holding or releasing the money" now sits next to
"until we decide" — raised in the counsel question; `CLAUDE.md` not updated.

### B. As built (2026-11-16)

Commits on `refund-b`: 164c15f (refund vs download), 35bd2f4 (location
expiry), b2453da (applicant artwork), 78113d2 (the checks). No migration
beyond 125; no app code changed (the app shows the server's lines).

**1. A self refund can't race a download.**
- Pure rules in `lib/purchaseRules.js`: `REFUND_CLAIM_STALE_MS` (10 min),
  `refundClaimLive(startedAt, now)`, `countsAsDownloaded(row)` (a dated row
  whatever its status, or an undated `active` one — a revoked row that never
  had a date never had a link), `refundBlocksDownload(covering, now)` (no
  completed covering purchase left, or any completed one with a live claim),
  `DOWNLOAD_REFUNDING_LINE`, `REFUND_BLOCKS.inFlight` ("A refund for this is
  already on its way.", reason "a refund is on its way"), and
  `refundEligibility(…, { refunding })` for the Purchases card.
- `lib/purchases.js` `refundPurchase({ kind: 'self' })`: checks the buyer,
  then claims with a guarded update (`status = 'completed'`,
  `refund_started_at is null`; a stale claim is taken over on the exact
  stamp it left, so two takers can't both have it; a claim let go between
  the two steps is retried once; refunded meanwhile → `alreadyRefunded`),
  then reads the downloads (`downloadedTitles(…, { starting: true })`: a
  second plain read for undated `active` rows), then today's checks. Any
  refusal or a Stripe error lets the claim go (only its own stamp). A refund
  Stripe made keeps the claim until the row reads refunded. 409 answers
  `{ code: 'refunding' }` (the route now passes a `PurchaseError`'s code).
  Before 125 (the row has no such key, or the update names the column): no
  claim and the old downloads read.
- `lib/downloads.js` `startDownload`, basis `owned`: once its row is in, two
  plain reads of the buyer's purchases of the episode and of its show
  (`id, status, refund_started_at`); a refusal deletes its own new undated
  row (falls back to marking it undone) and answers 409 `refunding`; a read
  that fails answers 503 `unavailable`; before 125 (the error names the
  column) nothing is asked. **Changed from the contract's wording**: "no
  longer completed" is read as "no completed purchase covers it any more"
  (an old refunded purchase next to a new completed one doesn't refuse).
  **Also**: the phone is now put on record only after that check (it used
  to be recorded as soon as the row went in; a refused ask never records a
  phone, as the file's own comment already promised). An existing row (the
  phone already held or was waiting for the title) is never deleted by the
  check, only refused.
- The Purchases card counts a download being started and says "a refund is
  on its way" once 125 is in (read from the purchase rows' keys).
- `dev/test-rig/checks/sec-money.mjs` expected an undated row to leave the
  title refundable; after 125 it now expects "downloaded to watch offline"
  (before 125 the old expectation).

**2. Location requests: the sweep no longer runs on every read.**
- Pure rules in the new `lib/requestExpiryRules.js` (no imports):
  `EXPIRY_EVERY_MS`, `outOfTime(row, now)` (requested/countered past
  `responds_by`), `shownStatus(row, now)`, `expiryDue(lastAt, now)`.
- `lib/locationRequests.js`: the three readers call `expireStaleSometimes()`
  (a per-instance timestamp first, then `firstInWindow('location-requests:
  expiry', 60)`); the daily `/api/cron/expire-content` runs
  `expireStaleRequests()` (100 a round, ten rounds; the audit line and the
  answer's `requests` count them). The sweep's update is now guarded (still
  waiting, still past its time) and only the rows it really expired are told
  or counted toward a host's pause.
- **Added beyond the contract**: `toRequest` shows a request past its time as
  `expired` (status and label) whether or not the sweep has reached it — with
  the sweep throttled, a page would otherwise show a dead request as waiting
  for up to a minute (every read used to sweep first).
- Deadlines: accept, counter, decline and take-the-counter already refused a
  late answer up front; their writes now land only while `responds_by >=
  now` at the moment of the write (`whileInTime`, plain filters), and counter
  and decline also only from the status they were read in (both were
  unguarded `.eq('id')` writes that could overwrite an expired or changed
  request). Pay has no `responds_by` (an accepted request doesn't expire);
  its deadline is the first day, already checked when the Checkout is made —
  **added**: the booking Checkout now expires after an hour
  (`checkoutExpiresAt()`, as title sales and tips), so a payment can't land
  up to a day after that check.

**3. Applicants' artwork private until Accept.**
- `/api/apply/artwork` stores with `uploadPrivateImage` (uncapped, as episode
  art is) → `private:apply-<id>-poster|thumbnail-<random>.<ext>`; a picture
  it replaces is removed; a failed row write removes the new ones.
- `lib/creatorApplications.js`: `applicationArtworkPreview(ref)` (one-hour
  `signPrivate`; a public address passes through), `withArtworkPreviews(row)`,
  `applicantView(row)` (used by `getOwnApplication`, `/api/apply` POST,
  `/api/apply/video`, `/api/apply/artwork`); the review queue's application
  card; `/api/admin/applications` signs its list and every decision's answer
  (the page merges those into its rows). `toApplicantView` is unchanged and
  no route answers with it directly any more.
- Accept: `artworkFor` copies a private picture's bytes to the public
  `episode-art` bucket under `<episodeId>-poster|thumbnail-…` (a copy that
  fails falls back to cutting from the film), the application row then names
  the public copies and the private ones are removed. A link-only accept (no
  master, no title) leaves the private pictures as they are.
- Decline removes the private pictures and clears the row's two columns; a
  public address from before is left.
- The pages (website and app) use `poster`/`thumbnail` only as "artwork
  received", so they need no change; a link that can't be signed reads as
  none.

**Follow-ups the same day** (the coordinator, on what I had found and left
alone): fbe6510 — `cancelRequest` and `refundBooking` write only on the
status they read (`writeOnStatusRead`, plain filters; the outcomes in the
pure `lib/bookingWriteRules.js` `missedWrite`): a cancel of an accepted
request paid meanwhile loses with 409 "This booking was just paid, so it
wasn’t cancelled…" (the producer then cancels the paid booking under its
policy); a refund whose own `charge.refunded` mirror (`refunded_by =
'stripe'`) wrote first is recorded over it; anything else answers 409 (saying
the refund went through when it did). A first payment landing on a request
already cancelled was refunded in full by `completeBookingFromSession` before
this (a request no longer `accepted` → `refundStrayPayment`); unchanged.
e7d59fa — `/api/purchases/refund`: 10 an hour per account, 60 per address,
429 with Retry-After; a purchase id that isn't a uuid answers 400 (was 500).
6e02078 — `/admin/applications` names an applicant's private pictures by
`/api/admin/application-artwork?id=&kind=` (`lib/applicationArtworkRules.js`
`withArtworkRoutes`), which checks `manage_applications` and 302s to a link
signed now for ten minutes; the applicant's card and the review queue keep
their one-hour links (they re-read on load, and the app's review deck can't
send a cookie with an image). The unit test has 14 tests now; the rig check
adds the refund limit, a payment landing on a just-cancelled request, four
cancel-vs-payment races, an admin refund, and the artwork route (admin 302,
applicant and creator 403, bad kind 400, unknown 404).

**Checks.** `node scripts/test-round-nov16.mjs` (14 since the follow-ups; 10 at first, incl. every order of the
refund's and the download's two steps); all 63 `scripts/test-*.mjs` pass;
`npm run check:refs`, `npm run lint`, `next build` (with the rig's env) pass.
`dev/test-rig/checks/round-nov16.mjs` is written but **not run** (the rig was
in use by part A's builder): after the merge run it after 125 and with
`RIG_MIGRATE_TO=124`, plus downloads, sec-money, money, money-fixes,
booking-policy, sales-tax and app-return.

**Not verified**: anything against the rig (the routes, PostgREST's answers to
the guarded updates and the `.is(…, null)` filters, the fake storage's signed
links, Next dev's module instances for the once-a-minute sweep), real Stripe,
real Supabase Storage, a phone.
