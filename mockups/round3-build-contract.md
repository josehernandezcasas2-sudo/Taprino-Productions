# Round 3 decisions — build agreement (2026-11-15)

Jose, 2026-11-15, on the open decisions of security round 3:

> "withdrawn titles can come back whenever possible but need to have a certain
> requirement, we only hold the data up to a month if there is no purchase. If it
> goes to just streaming, or just the tv, then yes, it can be withdrawn
> completely, unless otherwise mentioned that we can store the data for later
> use."
>
> "lets see if we can get that 3-d secured in there."
>
> "make sure any caption change or anything to change the series/live titles
> needs review."
>
> "a booking policy / cancellation must be given notification and cannot account
> to a live booking after payment, they continue with what they signed not with
> the new policy. lets write that down."

Migration **124** (`supabase/migrations/124_removal_hold_review_policy.sql`,
checked by `scripts/check-migration-124.mjs`) carries the columns. Before it has
run, every piece below behaves as the site did before (removals delete at once,
nothing comes back, a booking's refund reads the listing) and the new actions
answer 503 `{ code: 'migration-124', error: '… needs a database update (migration 124).' }`.

No visual design is new: every control below is an existing pattern (a pill, a
next step, a menu row, a checkbox in an existing box, a review-queue card, a
"waiting for approval" banner, a notification).

---

## A. Removals held a month; titles brought back

### The rules (`lib/removalRules.js`, pure, no imports; the app's copy word for word; `scripts/test-removal.mjs`)

- `HOLD_DAYS = 30`.
- **A confirmed removal** (the team, `manage_deletions`, through
  `/api/admin/resolve-deletion` or Admin → Shows):
  - **Bought** (anything a buyer still owns, `hasBuyersIncludingSeries`):
    withdrawn as today, kept for its buyers for good (`purge_after` null).
  - **Not bought** ("just streaming, or just the TV"): taken off the site at
    once (`withdrawn_at` = now), price off, invites withdrawn, caches cleared,
    and `purge_after` = now + 30 days — **unless** the owner asked to keep the
    files for later (`keep_after_removal`), then `purge_after` stays null and
    nothing is ever deleted by the clean-up.
  - **Delete now** (a full admin only, a reason required, never on anything
    bought): today's immediate delete, for abuse or a legal reason.
  - A show: anything bought in it is kept for its buyers for good; everything
    else in it is held 30 days with the show (or kept for later), instead of
    deleted (`lib/showDelete.js`).
- **The owner's request** gets one checkbox, off by default: **"Keep the files
  so I can bring it back later"** → `keep_after_removal`. The request box says
  what happens: "It comes off the site once we confirm. We keep the files for
  30 days so you can change your mind, then delete them — unless you tick the
  box." A title with buyers says instead that its buyers keep it.
- **The clean-up** (the daily `expire-content` cron, `purgeHeldTitles({ now,
  limit: 50 })`): a row with `purge_after <= now` is deleted for good through
  the same path an immediate deletion takes today (ad share credited first, the
  extras re-filed, the files to Orphaned media, the row deleted; one function
  shared with the route, e.g. `lib/titleRemoval.js`), audited `purge_<type>`,
  the owner told once ("…was deleted for good, 30 days after it was removed").
  A row with a request to bring it back waiting is skipped until that is
  decided. A row someone bought in the meantime (it can't happen — it's off
  the site — but read it again) is kept for its buyers instead.
- **Bringing it back** — the requirement:
  1. it is still on file (withdrawn, not yet deleted);
  2. **the owner asks** ("Ask to bring it back", an optional note ≤ 1,000
     characters → `restore_requested_at`, `restore_reason`) — the same people
     who may ask for its removal; a title the **team** removed (the removal
     wasn't the owner's request: `deletion_reason` starting "Removed by an
     admin: ", or a takedown) can only be brought back by a full admin;
  3. **someone on the team approves it** in the review queue — a new kind
     `restore` (title or show), for `review_submissions` holders and full
     admins, never the owner's own (the own-work rule, `episodeOwnerIds`);
     Deny takes a note.
  - Approved: `withdrawn_at`, `purge_after`, `deletion_requested`,
    `deletion_reason`, `deletion_requested_at`, `restore_*` cleared,
    `keep_after_removal` false; it is public again in the state it was in
    (an approved title is live, a show's held episodes come back with it);
    **selling stays off** (the owner prices it again, which is reviewed);
    audited `restore_<type>`; the owner told.
  - Titles kept for their buyers can come back the same way.
- `WITHDRAWN_LINE` and the existing refusals stay for "cancel the removal" and
  "ask again"; the new action is `restore`.

### Where it shows

- **Your work** (`lib/workListRules.js`, both copies): a removed title's pill —
  "Removed · kept for buyers", "Removed · deleted on Dec 15", "Removed · kept
  for later", "Waiting on us to bring it back" — and its one next step **Ask to
  bring it back** (or nothing while waiting); the ⋯ menu the same. A title's
  dashboard and a show's status card the same. The app's Your work sheet and
  show screen the same.
- **The admin's deletion queue**: Confirm reads "Remove · keep 30 days" (or
  "Remove · kept for buyers" / "…kept for later"), and a full admin also sees
  **Delete now…** (reason).
- **The review queue** (web, and the app's deck): a `restore` card — the title,
  its owner, the reason, when it was removed and when its files go, Approve /
  Deny….
- **Terms** (the section on removing your work) and **Privacy** (how long we
  keep things): one sentence each — the 30-day hold, "kept for later", buyers
  keep what they bought. `TEXT_UPDATED` moves.

---

## B. Every change to a live title is reviewed

`FIELD_POLICY` in `lib/showRules.js` (both copies) — on a live title these move
from `direct` to `staged`:

- **episode**: `captions`, `genre`, `mainGenre`, `artist`, `releaseYear`,
  `runtime`, `fundingUrl`, `adBreakSeconds`, `extraKind`, `credits`;
  `adsEnabled` turning **on** (turning ads off still applies at once — it only
  takes something away; a helper like `flashingLightsChange`).
- **show**: `releaseYear`, `fundingUrl`, `seasons` (the season labels),
  `credits`, `kind`.

Stay direct (they organise or take away; nothing new is said about the title):
the place (`season`, `seriesOrder`, `bonusParent`, `seriesId` — moves already
have their own guards), `hasPage`, `channelOptIn`, `newestSeasonHero`, a show's
`defaults` (only future episodes, which are reviewed), the creator's downloads
switch, the flashing-lights warning turned on, `paidTo` (an invite).

- **Where it waits**: `pending_fields` (124) — `{ field: value }`; the live
  value stays until approved. A waiting value never reaches a public page or
  payload; the owner's editor shows it (Live now → Proposed, Cancel) and the
  team's lists show it (`lib/stagedChanges.js`: the admin show page's "Waiting
  for approval" and the Library queue, Approve / Deny with a note, each with its
  `seen` fingerprint so a change replaced since the reviewer looked answers 409
  `changed`).
- **Captions**: on a live title `add-captions` stores the new private track and
  puts its reference in `pending_fields.captions` (an empty string = removing
  the captions waits); approved → `captions_url` is the new track,
  `captions_stale_at` cleared, the old private track removed; denied → the new
  private track removed. A title in review takes captions at once as today.
- **Who**: a full admin's save applies at once; anyone else's change to a live
  title they own (uploaded, or run the show of) waits, sub-admins included (the
  own-work rule); a team member with `review_submissions` changing someone
  else's live title applies at once as today.
- Every route that writes these on a live title goes through the policy: the
  show routes (`/api/show/**`), `request-episode-edit`, `edit-submission` (a
  title in review: at once), `/api/admin/edit-episode`, `add-captions`, the
  app's editors and Your work sheet (they follow the server's `policy`).
- Before 124 such a change answers 503 `migration-124`.

---

## C. A booking keeps the policy it was paid under; 3-D Secure

- `location_requests.cancellation_policy` is written when the booking's
  Checkout is created (the policy the producer is shown when they pay) and
  confirmed when it's paid; every refund (the producer's or host's cancel, the
  previews, the team's refunds) reads the **booking's** policy, and only falls
  back to the listing's for a row without one (before 124).
- **When a host changes a listing's cancellation policy** (`updateListing`):
  - every producer with an **open request** (requested / countered /
    accepted) is told: "The host of <place> changed its cancellation policy to
    <Strict>. It applies if you pay from now on.";
  - every producer with an **upcoming paid booking** is told: "The host of
    <place> changed its cancellation policy to <Strict>. Your booking keeps the
    <Moderate> policy you paid under.";
  - a notification (a new type in both copies of `lib/notificationTypes.js`,
    linking the request) — push and web push through `lib/notify.js` as every
    notification;
  - the host's form says under the policy: "Bookings already paid keep the
    policy they were paid under. People with an open request are told."
- The request page (web + app) shows the policy that applies: "Cancellation:
  Moderate — the policy you paid under" on a paid booking, the listing's
  otherwise.
- **Terms**, "Booking a place" (`#locations`): "A booking keeps the
  cancellation policy it was paid under. If the host changes the listing's
  policy later, the change applies only to bookings paid after it, and anyone
  with an open request or a paid booking is told." `TEXT_UPDATED` moves.
- **3-D Secure** on every one-off card payment: tips, backings, bookings and
  title sales get `payment_method_options: { card: { request_three_d_secure:
  'any' } }` on their Checkout, as secured crew pay has had since 2026-10-28
  (memberships are subscriptions and stay with Stripe's own rules). The fake
  Stripe on the rig accepts it.

---

## As built

(Filled in after the build.)

### A — removals held a month, titles brought back (builder A)

Built as agreed, website and app, no new migration. **The rules** are
`lib/removalRules.js` (pure, no imports; `mobile/src/lib/removalRules.js` word
for word; `scripts/test-removal.mjs`, 18 checks): `HOLD_DAYS`, `has124` (read off
a `select('*')` row, or a route row's `removalReady`), `confirmOutcome` /
`CONFIRM_LABEL`, `removedState` (held / later / buyers / asked, with the pill
words), `askBackFor` / `restoreRefusal` (owner or full admin; team-removed →
full admin only; an episode that came off with its show → ask for the show),
`purgeDue`, `deleteNowRefusal`, `teamStartedRemoval` / `cancelRemovalRefusal`,
the owner's messages and the queue line. **The server** is `lib/titleRemoval.js`:
`deleteEpisodeNow` (the one deletion path for an episode — ad share first,
invites, extras re-filed, files orphaned, private captions removed, guarded
delete — used by a pre-124 confirm, "Delete now" and the clean-up),
`holdEpisodeRemoval`, `purgeHeldTitles` (shows first, then titles; 50 a run; a
title whose show is itself held or asked back is left to the show; a title
someone owns is kept for them instead), `requestRestore`, `restoreQueueItems` /
`decideRestore`. `lib/showDelete.js` `deleteShowCascade` gained `mode`
(`now` as before, `hold`, `purge`) and `force` ("Delete now" on a held show),
plus `showHasBuyers`; `lib/showAdmin.js` `removeShow` takes `now` and holds by
default after 124, `getAdminShow`'s `removal` carries `holdReady`, `outcome`,
`confirmLabel`, `removed`, `canDeleteNow`. Routes: `/api/admin/resolve-deletion`
(rewritten: `confirm` / `deny` / `delete_now`, buyers read strictly through
`strictEpisodeBuyers`), new `POST /api/show/episode/[id]/restore` and
`POST /api/show/[id]/restore` (`request` with an optional note, or `cancel`),
`keep` on the three removal routes, `/api/admin/pending-deletions` (labels,
`canDeleteNow`, a "held" list), `/api/admin/show/[id]` `remove` with `now`, the
cron's purge step in `/api/cron/expire-content`, the review queue's kind
`restore` (`lib/reviewQueue.js`; id `episode:<id>` / `series:<id>`). Fields:
`/api/creator/my-submissions` (`removalReady`, `purgeAfter`, `keepAfterRemoval`,
`restoreRequestedAt`, `restoreReason`, `teamRemoved`, `showWithdrawn`, `bought`),
the show payload's `show.removal`, the room's rows and the episode editor,
`listShowSummaries`' `removed`. UI: `components/DeleteRequestModal.js` (the
checkbox and the words), new `components/RestoreRequestModal.js`, Your work's
rules and rows, the title dashboard, `ShowStatusCard` / `RemoveShowCard` /
`RemoveEpisodeSheet` / `SeasonSection` / the Extras shelf / both episode
editors, the admin `RemovalCard` (the outcome label, "Delete now instead",
Delete now on a held show), `LibraryPanel`'s deletion queue (Confirm's label,
Delete now…, "Off the site, files kept"), `components/admin/ReviewQueue.js`
("Bring back" chip and cards). App: `mobile/src/components/removal/RemovalBits.js`
(`KeepFilesField`, `RestoreSheet`), `WorkActions` (`restore`, `cancel_restore`,
the checkbox), the show screen, `ShowCards`, `RowSheets`, `SeasonSection`, the
episode editor, the title screen, the review deck (`reviewDeckRules.js`
`approveLabel` / `rejectLabel` / `RESTORE_WORDS`). Terms section 5 (`#removal-hold`)
and Privacy "How long we keep it", `TEXT_UPDATED` 2026-11-15. Notification types
`title_purged`, `title_restored`, `restore_denied` (both copies, at the end).
History reads the new audit actions (`lib/showAdminRules.js` `JSON_DETAIL_ACTIONS`).
Rig check `dev/test-rig/checks/removal-hold.mjs` (not run here).

**Added from the lead's note**: an owner's cancel of a removal the team started
(`deletion_reason` "Removed by an admin: …", e.g. one that stopped part-way) —
and a repeat request, which would overwrite that reason on the non-strict route —
is refused 403 `team-removal` in `setShowRemoval` and `setEpisodeRemoval` (a full
admin may; the team denies it from the admin side); every Cancel button for
such a removal is hidden (web and app).

**Differs from the agreement, and why**: (1) a full admin may ask for any
removed title back through the owner's routes (that is how a team-removed one
comes back: a full admin asks, a full admin approves) — there is no separate
"bring back now" button; (2) an approval of a show brings back what was
withdrawn at the same moment as the show (`withdrawn_at` equal), and a title
that had its own removal request before keeps that request (it goes back to the
deletion queue) instead of going live; (3) the hold also keeps a show's drafts
(deleted with the show at the clean-up); (4) "Delete now" is refused on a show
with anything bought in it at all (the agreement's "never on anything bought"
read strictly), and on a title kept for its buyers; (5) a restore approval of a
title taken down by moderation clears the withdrawal but not the take-down (that
stays moderation's Restore); (6) `scripts/test-sec-titles.mjs`'s source check and
`dev/test-rig/checks/money-fixes.mjs` (which needs a real deletion; it uses
"Delete now" after 124) were updated to the new route; (7) the show page reads
124's columns for its withdrawn rows in a small extra read
(`mergeRemovalColumns` in `lib/showPage.js`) rather than in `selectEpisodes`'
column tiers, so builder B's 124 tier there doesn't collide.

**C — the booking's policy and 3-D Secure (builder C, 2026-11-15).** The
rules are `lib/bookingPolicyRules.js` (pure, no imports; the app's
`mobile/src/lib/bookingPolicyRules.js` is the file word for word below its
header; `node scripts/test-booking-policy.mjs`, 15 checks, also reading the
source of the paths below): `policyInForce` (a paid booking — `paid_at`, or
status paid/done — follows its stamped policy; anything else, and a booking
paid before 124, the listing's now), `policyAtPayment` (the Checkout's
metadata, else the row's stamp, else the listing's), `checkoutStillFits`,
`policyLine` ("Moderate — the policy you paid under"; the host and the team
read "it was paid under"), `refundConfirmLine`, `HOST_FORM_NOTE`, and
`policyChangeNotices` with the agreement's two sentences. **Server**
(`lib/locationRequests.js`): `createBookingCheckout` reads the listing's
policy, puts it in the session's and the payment intent's metadata
(`cancellation_policy`) and on the row, refuses to hand out again an open
Checkout made under another policy (closes it and makes a new one), and adds
`payment_method_options.card.request_three_d_secure: 'any'`;
`completeBookingFromSession` confirms the policy on the row in the same
guarded update that marks it paid; the refund previews (`getRequest`,
`listMyRequests`) and `cancelRequest` read the booking's policy (the listing
is read only for a row without one) and the refund reason names it; the
request payload carries `cancellationPolicy` + `policyPaidUnder`. A write
naming the column is made again without it before 124 (PGRST204 / 42703 /
a column message naming it), so paying works on an older database. The
team's refunds (`refundBooking`, the admin cancel) are full refunds and read
no policy; Admin → Locations' booking row names the policy ("Moderate
cancellation, as paid"). **The notices** are `lib/bookingPolicy.js`
`tellPolicyChange`, called from `updateListing` after the save when the
policy really changed (never in the way of the save; imports neither
`lib/locations.js` nor `lib/locationRequests.js`): open requests (requested /
countered inside the answer window, accepted with a first day not passed)
and upcoming paid bookings (status paid, stamped, first day after today),
one notice each of the new type `location_policy_changed` ("Cancellation
policy changed", added at the end of both `lib/notificationTypes.js`),
through `notifyCreator` (bell, push, web push). **Differs from the
agreement**: (1) the rate limit is "never the same news twice, at most three
a day per request" (read back from `notifications`; `firstInWindow` per
request and policy if that read fails) rather than a flat once a day, so a
host correcting a mistake within the day isn't left announced wrongly; (2) a
paid booking without a stamp (before 124) isn't told it keeps a policy, since
its refund still follows the listing; (3) the host's change also closes an
accepted request's open Checkout made under the old policy, so "it applies
if you pay from now on" holds (a payment racing the close keeps the policy
its Checkout showed). **Pages**: the request page (web + app) shows
`policyLine` + the policy's terms, the cancel confirmation names the policy
paid under, the host's form (web `pages/locations/new.js`, app
`mobile/src/app/locations/new.js`) has `HOST_FORM_NOTE` under the radios,
Terms `#locations` has the sentence plus "your bank may ask you to confirm
the payment", `TEXT_UPDATED` 2026-11-15. **3-D Secure** on tips
(`lib/tips.js`), backings (`lib/pitchDonations.js`, both tax splits),
bookings and title sales (`lib/purchases.js`); memberships untouched. The
fake Stripe keeps `payment_method_options` on the session and its payment
intent and refuses a value Stripe doesn't take. Rig check
`dev/test-rig/checks/booking-policy.mjs` (both halves of 124) — written, not
run here.
