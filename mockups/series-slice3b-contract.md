# Series revamp, slice 3b — who gets paid

The build contract for three builders working at once: **server** (rules, data writes, routes, every money lane,
the stand-ins and the HTTP suite), **website** (the picker, the invite card, the "Runs it · Paid to" line, the admin
Owner card's Paid to row and hand-over question, the Terms sentence, the browser suite) and **app** (the same
pieces on the phone). Written 2026-11-05 from `mockups/series-revamp-spec.md` (decisions 13, 19–24 and "Going this
way unless Jose says otherwise", which win over the spec's earlier "money never moves" text and decision 4),
`mockups/series-slice3a-contract.md` (its format and its server builder's notes) and the code on branch
`series-app` at e26aa6a.

House rules that apply to every line below (CLAUDE.md, "Connect-side patterns" and the Series revamp bullet): title
ids are text slugs checked with `isTitleId`; a `payee_invites.id` is a uuid and is checked for that shape before any
query (a non-uuid answers 404); writes that carry 118's columns go through `insertCompat` / `updateCompat` and reads
fall back without them; every new lib has its `isMissing…` fallback (before 118 the payee routes answer 503 and every
money lane behaves exactly as today); routes answer errors through `showRouteError` / `sendError` (`plainStatus: 400`,
`internalError` marking — never `err.message`); every write has a per-account limit next to the per-IP one
(`showLimit`); user-chosen keys get own-property checks; every notification type is registered in
`lib/notificationTypes.js` and its app mirror in the change that first sends it; colours are CSS tokens (web) /
theme tokens (app); pages and components import only client-safe modules (`lib/showRules.js`, `lib/showAdminRules.js`,
`lib/siteConfig.js`), never `lib/payees.js`, `lib/showPage.js`, `lib/showAdmin.js`, `lib/purchases.js`; a Stripe or
payout lookup never trusts an address alone; `findUserByEmail` only matches a verified address held by exactly one
account. No site class starts with `cl-`.

Nobody in this slice edits CLAUDE.md, commits or pushes; the orchestrator does that at the end (and sets
`PAYEE_RULE_FROM`, §4).

---

## 1. What 3b builds, and what it does not

**Builds**

1. **The rule goes live.** `PAYEE_RULE_LIVE = true`, with a cut-over instant `PAYEE_RULE_FROM` (§4). From then on every
   money lane pays a title's **paid account** — `payeeOf(episode, series) = episode.paid_to ?? series.paid_to ??
   series.creator_id ?? episode.submitted_by` — read through the title's history in `title_payees`, so a month that
   spans a change is split and money already credited never moves.
2. **The picker** — "Who gets paid", at the show level (a card on the show page) and the title level (a section in the
   episode editor; for a standalone title, from Your work). Used by whoever runs the title and by full admins; pick an
   account by **@handle or the verified email on it**; pick yourself; go back to the default.
3. **Payee invites end to end** — create, list mine, accept, decline ("Not now"), cancel; one pending per title;
   notification + email + a "Get paid for Night Bus?" card in Creator Studio (web and app); nothing moves until
   the person accepts; accepting writes `paid_to` and opens a `title_payees` row from that moment.
4. **`title_payees` history writes** for every change of a title's paid account — an accepted invite, a direct pick,
   a step-down, a hand-over that moves the earnings, a move between shows, an admin's place edit — plus a one-off
   cut-over step and a daily repair (§5.7).
5. **The "Runs it · Paid to" line** on the creator show page (show card), in the episode editor and the show editor,
   and as a **Paid to** row on the admin show page's Owner card; visible to `seesWhoIsPaid` only.
6. **A hand-over decides the earnings** — the Owner card's "Hand it over" asks who gets the show's earnings after it
   (keep them where they are, or the new owner from now on).
7. **The money lanes** (§5.5): title sales (destination, who may price, house, unsellable when the paid account
   can't receive money), ad share (by the day the ad played, one ledger line per payee, idempotent ids), Creator
   Share's watched basis (by `watched_at`) and pool basis (views counted under the payee), the episode page's Tip
   button (the paid account), Your numbers, the Money page (follows by itself), exclusions applied to the payee, the
   payouts / Money gates.
8. **The Terms sentence** (section 5) and the lawyer note (`legal/creator-share-terms-draft.md`).

**Does not build (deferred; named so nobody builds them by accident)**

- **Slice 4 — the public pages**: no "Paid to" on `/series/<id>` or `/episode/<id>` (question 23's "to confirm"
  stays open; viewers never see who is paid, except that a tip names who receives it — §2 row 12), the linked
  Studio / Producer credits on profiles, a linked producer in Artist Support.
- **Slice 5 (rest) — the app's admin deck** (the app's Admin tab gets nothing in 3b; the admin uses the website).
- **Slice 6** — deleting caller-less routes (`/api/creator/{sales,member-support,referrals}` stay).
- Splitting one title's earnings between several accounts (one paid account per title, as decided); co-owners;
  editing or backdating payee history (never — it is a record); reminders for unanswered invites; invites that expire;
  reversing ad share when an advertiser's credit purchase is refunded (unchanged, not built); a payee's own
  dashboard beyond Your numbers and the Money page; Studio money changes (none needed: its lanes read payment ids).

---

## 2. Where the spec, the decisions and the code disagree, and what wins

| # | The spec / the code said | What 3b does | Why |
|---|---|---|---|
| 1 | Spec decision 4 and Principles: "`episodes.submitted_by` stays the payee in every lane"; 3a's Owner note "nothing about earnings changes" | **Superseded.** Every lane reads `payeeOf` through history from `PAYEE_RULE_FROM` (§4). The Owner card's note loses "nothing about earnings changes" (§6.6). | Decisions 13 → 19 (2026-10-31, 11-02), 22–24 (11-04). |
| 2 | Turning `payeeOf` on moves a contributor's episode in someone else's show from the uploader to the show's runner | It does, **from `PAYEE_RULE_FROM` only**, by a fixed rule (§4): before it every lane pays the *legacy* payee (uploader, else the show's owner — what each lane did), from it the rule. The cut-over step (§5.7) writes the moment into `title_payees` for every episode whose payee changes that way and **tells the uploader** once. | "The rule applies to money earned after it ships" (decision 13 as answered); deterministic and testable; nobody's income moves silently. |
| 3 | 3a's hand-over writes the old owner into `series.paid_to` when empty, so whole-series sales keep paying them — but with `payeeOf` live, `series.paid_to` also pays every episode without its own `paid_to`, including the **new** runner's own uploads | `setShowOwner` takes **`earnings: 'keep' \| 'move'`** (required for a hand-over to a new owner). `keep` = 3a's write (nothing changes for anything in the show now **and** new episodes the new owner adds pay the kept account until the new owner picks someone else — the card says exactly that). `move` = `series.paid_to` back to null: from the hand-over on, everything without its own paid account pays the new owner (stamped; the old payee told). Clearing the owner is always `keep`. | Hand-over stays its own admin action (decision 19's "going this way"); the admin chooses, in words, and the new runner can still change it later (they run it). Shows handed over under 3a keep paying the old owner: nothing is migrated; the cut-over step tells any new runner whose uploads pay the kept account. |
| 4 | Who may price a title: the uploader today (`assertCanPrice`: `record.creatorId` = `submitted_by`) | **Whoever runs the title**: `titleRunnerOf(episode, series) = series.creator_id ?? episode.submitted_by` (a show's episode: the show's owner; a standalone title: its uploader) and full admins. Never a payee who doesn't run it. `title_prices.creator_id` = the runner who asked, kept in step on every price action, hand-over and cross-owner move. The show page's row menu gets **Sell…** for the runner (so a contributor's episode can be priced). | Decision 19: a producer attached to a show or title is **paid only** — the runner keeps running it. One person sets the price; the money goes to the paid account. |
| 5 | Decision 13 (10-31) listed "the AI seal's switch" and the early-screening maker among the lanes | **They stay with the maker** (`submitted_by`). | Not money; "paid only" (19) means the payee doesn't control the work's presentation. |
| 6 | `payeeChange` (slice 1): an admin's pick is `direct` | **Replaced by `payeePickKind`**: anyone's pick of *another* account is an **invite** (admins included). Direct only for: back to the default, picking yourself on a title **you run**, a pick that changes nobody's money. An admin picking themselves on a title they don't run is refused. | Question 22's reason — nobody is named on someone else's income or tax forms without knowing — holds whoever picks. |
| 7 | "Attaching a title to someone without the creator role grants it in the same step (one confirm)" (going this way) | An invitee **must have Creator Studio** (role creator, content_scheduler or admin). A creator picking someone without it gets 409 `no-creator-role` ("Ask us to add them"); a **full admin** gets the same 409 with `canGrant: true` and may resend with `grantCreator: true` (role granted through `setUserRole`, audited, security-alerted), then the invite goes. Accepting never grants a role. | A role is security-sensitive (`setUserRole` mails the studio); letting a creator mint creator roles by inviting would be a privilege path. Every surface a payee needs (Creator Studio's card, the show page, Money, Payouts) is already behind the role. The Payouts and Money gates also open to any payee (row 15) in case a role is later removed. |
| 8 | "One open row per title" in `title_payees`, but the table has rows for `'series'` and `'episode'` and an episode's payee depends on its show | **An `'episode'` row holds the episode's resolved payee** (what `payeeOf` gave for it, from → to). A show-level change stamps every affected episode (and extra) of the show. **A `'series'` row holds the show's whole-series-sale payee** (`seriesSalePayee`), for the record and the "since" line; a series sale itself reads the live columns at Checkout. | A moved episode, a hand-over or a show-level pick all change episodes' payees; only resolved rows answer "who did this episode pay on day D" without a membership history no table keeps. |
| 9 | Need a migration for atomic writes? | **No migration (121 is not used).** The close-and-open is **one upsert statement** (atomic, proved on PGlite under the partial unique index), baseline rows are written **before** the column write, the column write is guarded on the value read, the invite claim is guarded on `status = 'pending'`, and a daily repair closes any open row that disagrees with the live columns (§5.2–§5.7). | Every crash point leaves history that agrees with the columns, except one (column written, the upsert lost while an older open row exists), which the daily repair bounds to a day. 118's tables carry everything; adding an RPC would put Jose on one more migration for a window that small. |
| 10 | Ad share: "one line per title per month", id `adShareLineId(episode, period)` | **One line per (title, payee) segment of the month.** A month with one payee keeps the old 2-argument id (so 3a's `creditAdShareBeforeDelete` and any month credited before 3b stay idempotent); a split month uses `adShareLineId(episode, period, payeeId)` for every segment. Before inserting, any existing `ad_share` line for that (episode, period) — by columns, whatever its id — skips the whole episode-month. A day's plays belong to the payee in force at **00:00 UTC of that day**. | "Ad share counts by the day the ad played" (decision 19); never double-credit a month credited under the old id; an acceptance at 15:00 pays the new account from the next full day, never for plays before it. |
| 11 | Decision 13: "Moving an episode between two shows with the same owner changes nothing" | True only when both shows pay the same account. With `series.paid_to` per show, a move between two of the same owner's shows can change the payee; the Move sheet says so ("Future earnings go to …"), and an episode with its own paid account keeps it. | Follows from 19 (paid account per show). |
| 12 | Decision 23: viewers never see who is paid — but tips "by the moment of the tip" go to the paid account, and the Tip button already reads "Tip Pat" (the person it pays) | The episode page's Tip button tips the **paid account**; the sheet names them (a payment must name who receives it). This is the one place a viewer can learn who is paid. **For Jose:** the alternative is keeping the episode's Tip on the maker. Titles paid to the studio (a full admin) show no Tip button. | Decision 19 lists tips among the lanes; a payment's recipient can't be hidden. |
| 13 | "Titles paid to the studio earn no members' share and show no Tip button" (going this way) — but today's watched and pool bases credit a full admin like anyone | **Excluded from now on** in the watched and pool bases (and the Tip button); the share goes to the other creators the member watched, else the pool. Ad share and sales already treat them as house. | Going this way; the task's "excluded creators applied to the payee" in every lane. Paying the studio's own account out of the studio's revenue only created owed balances nobody collects. |
| 14 | Pick "by verified email held by one account like series ownership today" — today only admins look accounts up by email | Creators may pick by email too; a 404 says only that no account has it verified, and a found account is named in the answer. Brakes: 20 picks a day per account, and the person picked always gets the invite (notification + email), so a lookup can't be silent. | The decision names email; handles alone would shut out anyone without one. |
| 15 | The payouts gate (`/api/creator/payouts`), the Money page (`/creator/money`, `/api/creator/money`) open to creators, admins, hosts, crew | They also open to anyone with a **pending invite** or who is a **title payee** (`hasPayeeInterest`). | A payee must be able to set up payouts and see earnings even if their role changes later. |
| 16 | Spec: admins attach a producer "on the admin show page's Owner card … and on the admin episode editor" | The admin uses the same **Who gets paid** card (`PayeeCard`) on the admin show page (placed under the Owner card) and in the admin episode editor; the Owner card shows the **Paid to** row and links to the card. A sub-admin sees the line read-only. | One control, one behaviour; money is full admins' only. |
| 17 | The show page's `money` block (slice 1/2: `runsIt`, `paidTo`, `paidElsewhere`; nobody reads it) | **Replaced by `payee`** (the PayeeBlock, §5.3) — `money` is removed (grep: no client reads it). Rows' `paidTo` becomes the effective payee now, plus `paidToName`, `paidOwn`. | One shape for web, app and admin. |
| 18 | Who can be picked | Any account found by **@handle** (`resolveProfileUserId`) or by the **verified email held by exactly one account** (`findUserByEmail`), that has Creator Studio (row 7). **Yourself**: direct, on a title you run. **The runner**: on a show, picking whoever runs it *is* the default (stored as null, direct); on an episode whose show pays someone else, the runner is invited like anyone (direct when the runner is the one picking). **Whoever the default already pays**: back to the default, direct. A full admin's account (the studio): invited like anyone; once accepted the title is house (sales keep everything, no members' share, no Tip). A user id typed in → refused ("Type their @handle or the email on their account."). | Decisions 19 and 22; ids are never a lookup key from a browser. |
| 19 | A standalone title (no show) | Has its own `episodes.paid_to`, set by **its uploader** (its runner) or a full admin, through the same card — opened from Your work's row menu (web modal, app sheet). Its fallback is the uploader. | `titleRunnerOf` = uploader when there's no show; FIELD_POLICY `paidTo.who = 'runner'`. |
| 20 | A pending invite when the title's world changes | **Hand-over** (any, keep or move): every pending invite of the show and its titles is withdrawn, invitees told. **Removal** (a show's cascade, one episode's confirmed removal): withdrawn, invitees told; `title_payees` rows stay. **A move to another show**: an episode's own pending invite is withdrawn when the target's runner differs from the source's (the new runner didn't send it); kept when the same person runs both. **Withdrawn / removal requested**: kept, but Accept answers 409 `locked` until that's settled. **The title is deleted some other way**: the daily repair withdraws it. A show-level invite is untouched by episodes moving in or out: it applies to whatever is in the show when it's accepted. | An invite is the runner's offer; when the runner or the title goes, the offer goes. |

---

## 3. Data: no migration; what 118 already holds and how 3b uses it

118 (in by 2026-11-04) has `series.paid_to text`, `episodes.paid_to text` (both indexed where not null),
`payee_invites (id uuid pk, title_type 'series'|'episode', title_id text, invitee_id text not null, invited_by text not
null, status pending|accepted|declined|cancelled, created_at, decided_at)` with `payee_invites_one_pending_idx` (one
pending per title) and `payee_invites_invitee_idx`, and `title_payees (id uuid pk default gen_random_uuid(),
title_type, title_id, payee_id text not null, from_at timestamptz not null default now(), to_at timestamptz,
set_by text, check (to_at is null or to_at >= from_at))` with `title_payees_one_open_idx` (one open row per title),
`title_payees_title_idx`, `title_payees_payee_idx`; RLS on, service role only. **3b adds no table and no column.**

- `title_type 'episode'` covers every row of `episodes` (a show's episode, an extra, a standalone film / short).
- `set_by` (text) records why: `invite:<inviteId>` (an acceptance), `user:<userId>` (a direct pick or a step-down),
  `handover:<adminId>`, `move:<userId>`, `edit:<adminId>` (an admin's place edit), `baseline` (what was true before a
  change, written just ahead of it), `cutover` (§5.7), `repair` (§5.7).
- `supabase/check_migrations.sql` is unchanged. `supabase/health_check.sql` gains two read-only rows (server
  builder; proved on PGlite `buildDb(120)`): **"payee rows out of step"** (should read 0: episodes with an open
  `title_payees` row whose `payee_id` ≠ `coalesce(nullif(e.paid_to,''), nullif(s.paid_to,''), s.creator_id,
  e.submitted_by)`) and **"payee invites waiting over 30 days"** (a count, for Jose).

---

## 4. The cut-over: the rule in time

**Constants** (pure, `lib/showRules.js` and its app copy, word for word):

```
export const PAYEE_RULE_LIVE = true;
export const PAYEE_RULE_FROM = '2026-11-09T00:00:00.000Z';
```

**The orchestrator sets `PAYEE_RULE_FROM` at commit time to 00:00 UTC of the day 3b is pushed** (both copies). Any
instant within a day either side of the deploy is safe: a credit made before it is never recomputed, sales and tips
are fixed at Checkout, and the only effect of an instant slightly before the deploy is that ad plays and watches of
those hours (credited later) follow the new rule. Server-side, `PAYEE_RULE_FROM` in the environment overrides it
**outside production only** (`process.env.VERCEL_ENV !== 'production'`; the stand-ins set
`PAYEE_RULE_FROM=2026-10-15T00:00:00.000Z` in `start-dev-3100.sh` so October is a split month); never set in
production.

**Who a title paid at instant `t`** (`payeeAt`, pure), for an episode row `e` in show `s` (or no show), with its
`'episode'` history rows `H`:

1. a row of `H` covers `t` (`from_at ≤ t` and (`to_at` null or `t < to_at`); the latest `from_at` wins) → its `payee_id`;
2. else `t < PAYEE_RULE_FROM` → **legacy** = `legacyPayeeOf(e, s)` = `e.submitted_by ?? s.creator_id` (what the
   lanes paid before 3b);
3. else → `payeeOf(e, s)` on the **current** columns.

Before 118 (no `title_payees`): rule 2 for every `t` (the lanes behave exactly as today).

**The invariant every writer keeps**: from `PAYEE_RULE_FROM` on, a title's history plus its current columns answer
the same as the truth at every past instant. So: no history write ever changes an answer for a past instant (rows
are only ever *closed at now* and *opened at now*; a **baseline** row `[gapStart, now)` written just before a change
records what rule 3 was answering until then); and every write that changes `payeeOf` of a title after
`PAYEE_RULE_FROM` stamps it (§5.2). **Before `PAYEE_RULE_FROM`** nothing stamps: the picker and acceptance answer
409 `not-yet`, moves and hand-overs change only columns (the lanes pay legacy until the cut-over anyway).

**Per lane, the instant used:**

| Lane | Instant | Before `PAYEE_RULE_FROM` |
|---|---|---|
| Title sale (episode) | the Checkout's creation (`now`) | legacy (uploader) |
| Title sale (whole series) | `now` — `seriesSalePayee` on the live columns (unchanged since 3a) | the same (3a already shipped it) |
| Tip on the episode page | page render and Checkout (`now`) | legacy |
| Ad share | **00:00 UTC of the play's day** (`dayStartIso(day)`) | legacy |
| Members' watched share | each `watch_history.watched_at` | legacy |
| Members' pool share | the view's moment: `creator_views` counted under the payee at view time | legacy |

**Worked example (the suite's fixture, `PAYEE_RULE_FROM` = Oct 15 in the stand-ins):** Dee uploaded "Pilot" into
Mara's Night Bus. Oct 1–14 ad plays → Dee (legacy). Oct 15 → the cut-over step writes `[Oct 15, ∞) Mara` and tells
Dee. Oct 15–19 → Mara. Mara invites Pat for "Pilot"; Pat accepts Oct 20 at 15:00 → `[Oct 15, Oct 20 15:00) Mara`
closed, `[Oct 20 15:00, ∞) Pat` open. Oct 20's plays → Mara (the day started under Mara); Oct 21–31 → Pat. October's
ad share: three lines, ids `adShareLineId(pilot, '2026-10', 'user_dee' | 'user_mara' | 'user_pat')`; a re-run
credits nothing.

---

## 5. Server

### 5.1 Pure rules (`lib/showRules.js` + `mobile/src/lib/showRules.js`, word for word below the header; imports nothing; `scripts/test-show-rules.mjs` diffs and runs both)

Change:

- `PAYEE_RULE_LIVE = true`; new `PAYEE_RULE_FROM` (§4).
- **Remove `payeeChange`** and its tests; add `payeePickKind` (below).
- `canMoveTo(…, opts)`: `const payeeRuleLive = (opts.payeeRuleLive ?? payeeRuleLiveAt(opts.now ?? new Date())) === true;`
  everything else as now ("Future earnings go to <name>" when the payee changes; "Its earnings stay with <uploader>."
  only while not live). The server always passes `payeeRuleLive` and `sourceShow` explicitly.

Add (names and contracts exact; `pick`, `text`, `timeOf`, `dayLabel`, `nameLookup`, `uploaderOf`, `runnerOf` are the
file's own helpers):

```
payeeRuleLiveAt(at, from = PAYEE_RULE_FROM) → boolean
  PAYEE_RULE_LIVE && timeOf(at) !== null && timeOf(from) !== null && timeOf(at) >= timeOf(from)

legacyPayeeOf(episode, series) → id | null          // uploaderOf(episode) || runnerOf(series) || null
titleRunnerOf(episode, series) → id | null          // runnerOf(series) || uploaderOf(episode) || null  (who prices and picks)

payeeFallback(scope, episode, series) → id | null   // who "back to the default" pays
  scope 'series'  → runnerOf(series)
  scope 'episode' → (series && (text(paid_to of series) || runnerOf(series))) || uploaderOf(episode)

payeeSourceOf(episode, series) → 'own' | 'show' | 'runner' | 'uploader' | null
  // which part of payeeOf answered: episode.paid_to / series.paid_to / series.creator_id / submitted_by

payeeAt({ history, episode, series, at, from = PAYEE_RULE_FROM }) → id | null      // §4 rules 1–3
  // history: rows { payee_id|payeeId, from_at|fromAt, to_at|toAt }; a bad `at` → null

dayStartIso(day) → 'YYYY-MM-DDT00:00:00.000Z' | null     // day 'YYYY-MM-DD'
utcDayLabel(v) → 'Nov 9'                                 // en-US short month + day, timeZone UTC (the cut-over's words)
dayRangeLabel(fromDay, toDay) → 'Oct 1–14' | 'Oct 20' | 'Oct 30 – Nov 2'   // UTC

payeePickKind({ scope, current, next, fallback, actorId, isRunner }) → { kind, store, code? }
  // current = the title's own paid_to now; next = the account picked (null = back to the default);
  // fallback = payeeFallback(scope, …); actorId = who presses it; isRunner = they run the title
  target = (next === fallback) ? null : next          // picking whoever the default pays = back to the default
  effNow = current || fallback ; effAfter = target || fallback
  target === current                   → { kind: 'none', store: current }
  effAfter === effNow                  → { kind: 'direct', store: target }     // nobody's money changes (a pin or unpin)
  target === null                      → { kind: 'direct', store: null }
  target === actorId && isRunner       → { kind: 'direct', store: target }
  target === actorId                   → { kind: 'refused', store: current, code: 'self-not-runner' }
  otherwise                            → { kind: 'invite', store: target }
  (text() on every id: blanks are no one)

stampPlan({ titles, at, from = PAYEE_RULE_FROM, setBy }) → { live, baseline: rows[], upsert: rows[] }
  // titles: [{ type: 'series'|'episode', id, before, after, rows }]  (rows = that title's history)
  !payeeRuleLiveAt(at, from) → { live: false, baseline: [], upsert: [] }
  for each t: open = the row with to_at null
    skip when (open && open.payee_id === after) || (!open && before === after)
    !open && before: gapStart = max(from, every row's to_at); gapStart < at →
        baseline += { title_type, title_id, payee_id: before, from_at: gapStart, to_at: at, set_by: 'baseline' }
    open:  upsert += { id: open.id, title_type, title_id, payee_id: open.payee_id, from_at: open.from_at, to_at: at, set_by: open.set_by ?? null }
    after: upsert += { id: null, title_type, title_id, payee_id: after, from_at: at, to_at: null, set_by }
  upsert sorted: every close (id set) before every open (id null); ISO strings throughout.
  // the server fills id: crypto.randomUUID() on the opens (PostgREST needs the same keys on every object)

paidLine({ runsIt, paidTo, viewerId, pendingName, house }) → { runsIt, paidTo, text, pending }
  runsIt  = runsIt id === viewerId ? 'You' : (name || 'No one yet')
  paidTo  = house ? 'Studio Tapa' : paidTo id === viewerId ? 'You' : (name || 'No one yet')
  text    = `Runs it: ${runsIt} · Paid to: ${paidTo}`
  pending = pendingName ? `Waiting on ${pendingName} to accept` : null
  // runsIt / paidTo are { id, name }

payeeSourceWords(source, showName) → '(its own)' | `(${showName}’s)` | null      // 'own' / 'show' / else null
seriesSaleNote(showName, seriesPayeeName) → `Whole-series sales of ${showName} still go to ${seriesPayeeName}.`
titleWords({ titleType, titleName, showName, code }) →
  series: showName · episode in a show: `“${titleName}” (${showName} · ${code})` · standalone: `“${titleName}”`
inviteHeadline(args) → `Get paid for ${titleWords(args)}?`
inviteStateWords(status) → 'Waiting for an answer' | 'Accepted' | 'Said no' | 'Withdrawn' | null
  // pending | accepted | declined | cancelled; anything else null (the History and the admin's lists)
```

**Tests** (both copies, added to `scripts/test-show-rules.mjs`): `payeeRuleLiveAt` at, just before and after `from`,
bad dates; `legacyPayeeOf` / `titleRunnerOf` / `payeeFallback` / `payeeSourceOf` (own / show / runner / uploader / a
standalone title / blanks); `payeeAt` — a covering row, the latest `from_at` wins, `to_at` exclusive, before `from`
→ legacy, after → `payeeOf`, no history; `payeePickKind` — none, back to default, picking whoever the default pays,
yourself as runner, yourself not running it (`self-not-runner`), a pin that moves nobody's money, an invite (an
admin's pick of another account included); `stampPlan` — not live, unchanged, first change after `from` (baseline
`[from, at)` + open), a change with an open row (close + open, closes first), a gap after a closed row (baseline from
its `to_at`), `after` null (close only), `before` null (no baseline); `paidLine` (You, house, pending);
`dayRangeLabel`; `titleWords` / `inviteHeadline` (series, episode in a show, standalone); `inviteStateWords`; `canMoveTo` with `payeeRuleLive` true/false and the default from `opts.now`. Existing
`payeeOnDate` stays (unused by the lanes; `payeeAt` is the lanes' rule).

**`lib/adShareRules.js`** (server-only pure; `scripts/test-ad-share.mjs`): `adShareLines({ rows, episodes, percent,
period, createdBy, payeeOn = null }, { excludeCreators })` — rows now carry `day`; `payeeOn(episodeId, day)` (default
`(id) => episodes[id].creatorId`, so every existing test passes unchanged); per episode the rows group by payee into
**segments**; `split` = more than one distinct payee (null and excluded ones count) among the month's rows; a podcast
or unknown title skips whole (as now); per segment: no payee → skipped `'no creator'`, excluded → `'creator
excluded'`, floored cents ≤ 0 → `'under a cent'`; each line `{ creator_id: payee, …as now, units: segment plays,
note }` with `note` = today's note plus, when split, ` (${dayRangeLabel(firstDay, lastDay)})` (`dayRangeLabel`
imported from `./showRules.js`, explicit extension, as `lib/showAdminRules.js` does); the returned line
also carries `split` and `segmentPayee`, which the server strips before inserting. New cases: one payee (unchanged
id basis), a split month (two lines, notes with ranges), a split with one segment excluded, a podcast split (skipped).

**`lib/creatorShareRules.js`** (`scripts/test-creator-share.mjs`): `countWatched(rows, payeeFor, eligible,
memberId)` → `{ [payeeId]: plays }` — `rows` = `[{ episode_id, watched_at }]`, `payeeFor(row)` → id | null, a row
counts when its payee is not null, not the member and `eligible(payee)`. Cases: two payees from one title across a
change, the member themself, an ineligible (house) payee dropped.

### 5.2 `lib/payees.js` (new, server-only)

Everything payee-related the routes, the show libs and the lanes share. Throws `ShowError(line, status, extra)` (from
`lib/showPage.js`) for anything the person caused, `internalError(err, '<context>')` for database / Clerk / Stripe
failures. `viewer` = the `showViewer` shape (`userId`, `email`, `isAdmin` (full), `canAccessAdmin`, `team`,
`isCreator`).

```
MIGRATION_118_PAYEE_LINE = 'Choosing who gets paid needs a database update (migration 118).'
payeeRuleFrom() → ISO                       // env PAYEE_RULE_FROM outside production, else PAYEE_RULE_FROM
payeeRuleLiveNow(now = new Date()) → bool   // payeeRuleLiveAt(now, payeeRuleFrom())
payeesAvailable() → Promise<bool>           // a one-row read of title_payees, memo 60 s; false on a missing table
```

**Reading context** (used by every lane; paged, chunks of 100 ids, `select('*')` so a pre-118 row reads fine):

```
readPayeeContext(episodeIds, { series = null } = {}) → { available, from, episodes: Map, series: Map, history: Map }
  episodes: id → row (id, title, series_id, submitted_by, paid_to, content_type, season, series_order, status,
            moderation_hold, deletion_requested, withdrawn_at)
  series:   id → row (id, name, creator_id, paid_to, kind, status, …) for every series_id met (or the one passed)
  history:  'episode:<id>' → rows sorted by from_at (title_payees where title_type = 'episode' and title_id in ids)
  available = payeesAvailable(); when false history is empty and `from` is +∞ (legacy everywhere)
payeeAtFor(ctx, episodeId, at) → id | null      // payeeAt with ctx's rows and ctx.from; legacy when !available
payeeNowForEpisode(episodeIdOrRow) → { payeeId, runnerId, uploaderId, seriesId, source, history }   // sales, tips, views
```

**Stamping** — the one way any writer changes a title's paid account after `PAYEE_RULE_FROM`:

```
withPayeeStamps({ scope, patch, write, setBy, at = new Date() }) → { changed: [{ type, id, before, after }], live }
  scope = { seriesId?, episodeIds? } → titles = the series row (seriesId) + every episodes row with series_id =
          seriesId (episodes and extras) + episodeIds
  patch = { series?: { paid_to?, creator_id? }, episodes?: { [id]: { paid_to?, series_id? } } }  (predicted columns)
  1. read rows + series + every title's history; before = payeeAt(…, at) per episode, seriesSalePayee per series
  2. predicted after = payeeOf / seriesSalePayee on the rows with `patch` applied (a moved episode reads its new show)
  3. plan = stampPlan(…); not live → run write() only, return { live: false }
  4. insert plan.baseline (one insert)                         ← before the column write
  5. await write()  (the caller's guarded column writes / RPC; throws ShowError on a guard miss — then stop: the
     baseline rows recorded what was true up to `at`, nothing else changed)
  6. re-read the titles' columns; actual after = payeeOf on them (a race wins over the prediction)
  7. upsert the closes and opens for every title whose open row ≠ actual after, as ONE request:
     from('title_payees').upsert(rows, { onConflict: 'id' }) — every object with the same keys (id, title_type,
     title_id, payee_id, from_at, to_at, set_by), closes first, opens with crypto.randomUUID()
  8. on 23505 (another writer opened a row): re-read those titles' history, re-plan with before = their open row,
     retry up to 3 times, then internalError('payee stamps') — the daily repair puts it right
```

**Picker and invites** (all check `payeesAvailable()` first → 503 `{ code: 'migration-118', error:
MIGRATION_118_PAYEE_LINE }`):

```
getPayeeBlock(type, id, viewer) → PayeeBlock | null     // null = the viewer may not see who is paid
pickPayee(type, id, { action, to, grantCreator }, viewer) → { ok, kind, words, payee: PayeeBlock, invite? }
answerInvite(inviteId, action, viewer) → { ok, words, payoutsReady?, payee? }    // accept | decline | cancel
listMine(viewer) → (§5.3 GET /api/payees/mine)
cancelPendingInvites({ titles, reason, actor }) → n       // reason: 'handover' | 'removed' | 'moved' | 'runner'
hasPayeeInterest(userId) → bool    // a pending invite to them, or series/episodes paid_to = them, or an open row
houseIds(ids) → Set               // full admins among ids (getUserRole === 'admin'), memo 10 min per id
houseAccountIds() → Set            // every full admin (listCreatorsAndAdmins, role 'admin'), memo 10 min (pool + watched)
payeeAccountIds() → Set            // payee_id of every open title_payees row, memo 10 min
paidForUser(userId) → titles       // series / episodes whose own paid_to = userId (for mine + Your numbers)
```

**Who may do what** (title = a series, or an episode row; runner = `titleRunnerOf`; `team` = full admins for every
write here — a sub-admin reads only):

| Action | Who | Refusal (403) |
|---|---|---|
| see the block | `seesWhoIsPaid` (runner, paid accounts, uploaders in the show, the team incl. sub-admins), and the title's own paid account | `null` (the route answers 404 "That title isn’t there.") |
| `pick` someone, `default` | the runner, a full admin | `{ code: 'who', error: 'Only <runner name> (who runs it) or the team can change who gets paid.' }` |
| `self` | the runner (a full admin only on a title they run) | `who`, or 409 `self-not-runner` "Pick yourself only on titles you run." |
| `step_down` | the account in that level's own `paid_to` | `{ code: 'who', error: 'Only the account it pays can stop getting its earnings.' }` |
| accept / decline | the invitee | `{ code: 'who', error: 'That invite is for someone else.' }` |
| cancel | the inviter, the title's runner, a full admin | `{ code: 'who', error: 'Only the person who sent it, the show’s owner or the team can withdraw it.' }` |

**`pickPayee` steps** (`action` ∈ `pick | self | default | step_down`):

1. Load the title (series by id; episode `select('*')`; a bad id → 400 "Which title?"; missing → 404 "That title
   isn’t there."), its show for an episode, the viewer's right (table above).
2. Locks, first match (409 `{ code: 'locked', error }`): withdrawn → "Withdrawn and kept for its buyers."; removal
   requested (not the team) → "Its removal is requested — cancel that to change who gets paid."; pulled (not the
   team) → "Pulled while an admin looks at it."; `!payeeRuleLiveNow()` → `{ code: 'not-yet', error: 'Choosing who
   gets paid opens on <utcDayLabel(from)>.' }`.
3. A pending invite for the title → 409 `{ code: 'pending', error: '<name> hasn’t answered yet — withdraw that invite
   first.', pending }` (for `pick`, `self`, `default`; `step_down` cancels it first).
4. `pick`: `to` (string ≤ 320, trimmed) → a handle (`@x` or `x` matching `/^@?[a-z0-9_.]{2,30}$/i`) through
   `resolveProfileUserId` (lib/userProfiles.js), or an email (contains `@` and a dot after it) through
   `findUserByEmail`; anything else → 400 "Type their @handle or the email on their account."; empty → 400 "Pick
   someone: their @handle or the email on their account."; not found → 404 `{ code: 'no-account', error: handle ?
   'No one on Studio Tapa has the handle @<h>.' : 'No account has that email verified — they need to sign up first.' }`.
5. `payeePickKind` (for `pick`, `self`, `default`; `self` passes `next = actor`, `default` passes `next = null`).
   `none` → 409 `{ code: 'none', error: '<name> already gets its earnings.' }`; `refused` → the `self-not-runner`
   line. `step_down` skips it: it is always direct, storing null on the level whose own `paid_to` is the actor.
6. `invite`: the invitee needs Creator Studio (`getUserRole` ∈ creator, content_scheduler, admin) else 409 `{ code:
   'no-creator-role', error: '<what they typed> doesn’t have Creator Studio yet. Ask us to add them, then pick them
   again.', canGrant: viewer.isAdmin }` — with `grantCreator: true` from a full admin: `setUserRole(id, 'creator')`,
   audit `creator_role_granted` (target `user`), then go on. The invitee's open invites (any title) ≥ 20 → 409
   `{ code: 'busy', error: 'They have a lot of invites waiting — try again later.' }`. Limit
   `checkRateLimit('payee-picks:<actor>', 20, 86400)` → 429 "That’s a lot of invites for one day — try again
   tomorrow.". Insert `payee_invites { title_type, title_id, invitee_id, invited_by: actor }` (a 23505 on the pending
   index → the `pending` 409). Notify the invitee (`payee_invite`, href `/creator#get-paid`): "<inviter name> wants
   the earnings of <titleWords> to go to you. Accept or say no in Creator Studio." Email the invitee's primary
   verified address once (`sendEmail`, names escaped): subject `Get paid for <titleWords>?`, body the same line + the
   card's body (§6.4) + `https://www.studiotapatv.site/creator#get-paid`. Audit `payee_invite_sent`. Answer `{ ok,
   kind: 'invite', words: 'We asked <name>. Until they accept, its earnings keep going to <current payee name>.',
   invite: { id, name } , payee }`.
7. `direct` (`self`, `default`, a pin, `step_down`): `withPayeeStamps({ scope, patch: { [level]: { paid_to: store } },
   write: guarded update (`.eq('paid_to', current)` / `.is('paid_to', null)`; 0 rows → 409 `{ code: 'changed', error:
   'That changed a moment ago — have another look.' }`), setBy: 'user:<actor>' })`. Notify `payee_changed` to the
   previous effective payee (if not the actor): "From now on, the earnings of <titleWords> go to <new name>. What it
   earned before stays yours." and to the new one (if not the actor): "The earnings of <titleWords> come to you
   again from now on." `step_down` notifies the runner: "<name> stopped getting the earnings of <titleWords>. They
   go to <new name> from now on." Audit `payee_set` / `payee_stepped_down`. Security alert (below). Words:
   self "Its earnings go to you from now on." · default "Its earnings go to <name> again from now on.<' <old> was
   told.'>" · step_down "<titleWords>’s earnings go back to <name> from now on."
8. Scope of a level's change: `series` → the series row + every episode / extra with `series_id` = it and no own
   `paid_to`; `episode` → that row.

**`answerInvite`** (`inviteId` uuid-shaped else 404 "That invite isn’t there any more."; limit 60/h):

- **decline**: guarded `update … set status = 'declined', decided_at = now where id and status = 'pending'` (0 rows
  → 409 `{ code: 'answered', error: 'That invite was already answered.' }` or `{ code: 'cancelled', error: 'That
  invite was withdrawn.' }` by the row's status). Notify the inviter (`payee_invite_declined`): "<name> said no to
  getting the earnings of <titleWords>. Nothing changed." Audit `payee_invite_declined`. Words "<inviter name> was
  told."
- **cancel**: same guard → `cancelled`; notify the invitee (`payee_invite_cancelled`): "<actor name> withdrew the
  invite to get the earnings of <titleWords>." Audit `payee_invite_cancelled`. If the title's column already equals
  the invitee (an acceptance that stopped part-way, below), mark it `accepted` instead and answer 409 `{ code:
  'answered', error: 'They already accepted.' }`.
- **accept**: invitee only; the title still there (else the invite → `cancelled`, 404 "That title isn’t there any
  more."); locks as `pickPayee` step 2 (withdrawn / removal requested / not-yet — the team-only exceptions don't
  apply to an invitee); the invitee still has Creator Studio (else 409 `no-creator-role` "You need Creator Studio to
  be paid for a title — ask us to add you."). Then `withPayeeStamps({ scope, patch: paid_to = invitee, write, setBy:
  'invite:<id>' })` where `write` = (a) the guarded column write (0 rows → 409 `changed`), (b) the claim `pending →
  accepted` (0 rows → put the column back, guarded on it being the invitee, and answer 409 `cancelled`). Notify the
  inviter, the runner (if different) and the previous effective payee (if different from both) with
  `payee_invite_accepted`: "<name> accepted: the earnings of <titleWords> go to them from now on." Audit
  `payee_invite_accepted`. Security alert. Answer `{ ok, words: 'Done — <titleWords>’s earnings come to you from now
  on.', payoutsReady }`. An `accepted` invite whose title's column isn't the invitee (a crash between (a) and (b)
  with (a) lost) is re-applied when the invitee presses Accept again (the card shows it while `listMine` sees it).

**Security alerts**: every accepted invite and every direct change that moves earnings away from an account other
than the actor → `securityAlert('Earnings moved: <titleWords>', ['From <old> to <new>', 'By <actor email>'], {
throttleKey: 'payee:<type>:<id>' })`.

### 5.3 Routes

All: `startShowRoute`, `showViewer` (401 "Sign in first.", 403 "Creator access required."), `showLimit`,
`showRouteError(res, err, '<route>')`, `Cache-Control: private, no-store`, CORS through `applyCors`.

| Method · path | Body / query | Limit (per account / hour) | 200 answer |
|---|---|---|---|
| `GET /api/payees` | `?type=series\|episode&id=<titleId>` | 600 | `{ payee: PayeeBlock }` |
| `POST /api/payees` | `{ action: 'pick'\|'self'\|'default'\|'step_down', type, id, to?, grantCreator? }` | 30 (+ 20 picks a day) | `{ ok, kind: 'invite'\|'direct', words, payee, invite? }` |
| `GET /api/payees/mine` | — | 600 | below |
| `POST /api/payees/invites/[id]` | `{ action: 'accept'\|'decline'\|'cancel' }` | 60 | `{ ok, words, payoutsReady?, payee? }` |

Error shapes: 400 `{ error }` ("Which title?", "Unknown action.", the `to` lines); 403 `{ error, code: 'who' }`;
404 `{ error, code? }`; 409 `{ error, code }` with `code` ∈ `none | pending | no-creator-role (+ canGrant) | busy |
self-not-runner | locked | not-yet | changed | answered | cancelled`; 429 the limit lines; 503 `{ error, code:
'migration-118' }` before 118 from every payee route **except** `GET /api/payees/mine`, which answers 200 with
`available: false` and empty lists so the hub never breaks.

**PayeeBlock** (also inside `GET /api/show/[id]` as `view.payee` for the show, `GET /api/show/episode/[id]` as
`payee` for that title — null when the viewer may not see who is paid):

```
{
  available: bool,                       // false before 118 → only `locked` is set
  ruleLive: bool, ruleFrom: ISO,
  titleType: 'series'|'episode', titleId, titleName, showId|null, showName|null, code|null,  // code 'S1 E3'
  runsIt: { userId, name } | null,
  paidTo: { userId, name, source: 'own'|'show'|'runner'|'uploader', since: ISO|null, sinceLabel: 'Nov 14'|null, house: bool } | null,
  line: paidLine(…)                      // { runsIt, paidTo, text, pending } for this viewer
  sourceWords: '(its own)' | '(Night Bus’s)' | null,
  notes: [string],                       // show: 'S1 E3 is paid to Dee Park' (one per episode with its own, up to 3,
                                         //   then '2 more episodes have their own paid account'); episode with its own
                                         //   paid account: seriesSaleNote(…); before PAYEE_RULE_FROM for a title whose
                                         //   legacy payee differs: 'Until <utcDayLabel(from)>, <legacy> is paid (the old rule).'
  notReady: string | null,               // payee not house and payouts not ready: '<name> hasn’t set up payouts yet, so
                                         //   buying and tipping it are off until they do. Its earnings wait for them.'
                                         //   (viewer is the payee: 'You haven’t set up payouts yet, so … Set them up under Money.')
  houseNote: string | null,              // 'It pays the studio, so its earnings stay with Studio Tapa.'
  pending: { inviteId, name, sentAt, sentLabel, canCancel } | null,
  lastAnswer: { name, at, atLabel } | null,     // the latest declined invite of the last 30 days
  history: [{ name, fromLabel, toLabel|null }], // newest first, up to 5; runner, team and the payee only, else []
  can: { pick, self, default, stepDown, grantCreator },
  defaultChoice: { label, name } | null,  // series 'Whoever runs it' + runner; episode in a show 'The show’s paid account'
                                          // + its payee; standalone 'Whoever uploaded it' + uploader — only when the
                                          // title has its own paid_to
  locked: string | null                   // §5.2 step 2's lines, MIGRATION_118_PAYEE_LINE, or the who-line for a reader
}
```

The show-level block also carries `paidElsewhere: [{ id, code, name }]` (episodes with their own paid account).

**`GET /api/payees/mine`** → `{ available, ruleLive, ruleFrom, invites: [{ id, titleType, titleId, headline, title,
inviterName, sentAt, sentLabel, body: [string], payoutsReady }], paidFor: [{ titleType, titleId, title, showId, code,
since, sinceLabel, href, scopeWords, canStepDown }] }` — `invites` = pending to the viewer (plus an `accepted` one
whose column isn't the viewer yet, shown as pending), newest first, up to 20; `body` = the card's lines (§6.4);
`paidFor` = `paidForUser(viewer)`; `href` = `/creator/show/<showId>` when the viewer can open it, else null;
`scopeWords` 'the whole show' for a series.

**Changed routes**

- `GET /api/show/[id]` (`getShowPage`): `money` removed; `view.payee` = the series PayeeBlock; rows' `paidTo` = the
  effective payee now (`payeeAtFor`), plus `paidToName`, `paidOwn` (the row has its own `paid_to`); the page opens
  read-only to a viewer who is a **paid account** of the show or one of its titles (`isPayee` beside
  `isContributor`, same view as a contributor). `viewer.isPayee`.
- `GET /api/show/episode/[id]` (`getEpisodeEditor`): `payee` = the episode PayeeBlock. `PATCH` on either route never
  writes `paidTo` (ignored, as today).
- `POST /api/admin/show/[id] { action: 'owner', email, earnings }` — `earnings` ∈ `keep | move` (§5.4);
  `pages/api/admin/series-ownership.js` passes `earnings: 'keep'`.
- `GET /api/creator/my-submissions`: each row adds `canPrice` (`titleRunnerOf === viewer` or a full admin).
- `GET /api/creator/pricing`: adds `blocked: { '<type>:<id>': line }` for the viewer's priced titles whose paid
  account can't receive money: "<name> hasn’t set up payouts yet, so it can’t be bought until they do."; POST refuses
  a non-runner with 403 `{ code: 'not-pricer', error: 'Prices are set by whoever runs the title — for a show’s
  episode, the show’s owner.' }`.

### 5.4 The show libs

- **`lib/showPage.js`**: `getShowPage` and `getEpisodeEditor` build the PayeeBlock through `getPayeeBlock`;
  `episodeView` rows as above. **Moves** (`moveForViewer`, the cross-show path; drafts are not titles): wrap the
  move in `withPayeeStamps({ scope: { episodeIds: [moved + extras that move with it] }, patch: series_id → target,
  write: the move RPC / fallback, setBy: 'move:<actor>' })`; pass `payeeRuleLive: payeeRuleLiveNow()` and
  `sourceShow` to `canMoveTo` (moveTargets too); when the target's runner differs from the source's, cancel the moved
  titles' pending invites (`reason: 'runner'`, invitee told "…: it moved to another show.") and set their
  `title_prices.creator_id` to the target's runner (best effort).
- **`lib/showAdmin.js` `setShowOwner(showId, { email, earnings }, rc)`**: a new owner with `earnings` missing → 400
  `{ code: 'earnings-choice', error: 'Say who gets the show’s earnings after the hand-over.' }` (only when
  `payeesAvailable()`; before 118 it behaves as 3a). Clearing the owner = `keep`.
  - `keep`: 3a's patch (`paid_to = paid_to || old creator_id`) + `creator_id`; wrapped in `withPayeeStamps` so the
    series row's "since" is recorded if it moved (it doesn't, normally).
  - `move`: refused before `PAYEE_RULE_FROM` (409 `not-yet`); patch `{ creator_id: next, paid_to: null }` under
    `withPayeeStamps({ scope: { seriesId }, setBy: 'handover:<admin>' })`; the previous show payee (if not the new
    owner) gets `payee_changed`: "An admin handed “<name>” to another account, and its earnings go to them from now on.
    What it earned before stays yours."
  - Both: cancel every pending invite of the show and its titles (`reason: 'handover'`, invitee told "The invite to
    get the earnings of <titleWords> was withdrawn: the show has a new owner."); `title_prices.creator_id` of the
    series and its episodes → the new owner (best effort); the audit words gain " · earnings kept with <name>" /
    " · earnings moved to the new owner"; the answer adds `earnings`, `paidTo: { name }`.
- **`lib/showDelete.js` `deleteShowCascade`**: cancel (not delete) the pending invites of the show and every deleted
  or kept title (`reason: 'removed'`, invitee told "…: the show was removed."); `creditAdShareBeforeDelete(rows, {
  series: show })` (the split needs the show and the history, read before the rows go). `title_payees` rows stay
  (a record).
- **`pages/api/admin/resolve-deletion.js`** (one episode): the same two calls for that title.
- **Place edits** that change `series_id` on an existing episode — `pages/api/admin/edit-episode.js` (`seriesId`),
  `pages/api/creator/edit-submission.js` if it still writes `series_id` — wrap the write in `withPayeeStamps` (`setBy:
  'edit:<actor>'`) and cancel pending invites when the runner changes. The builder greps for any other writer of
  `episodes.series_id` on an existing row or `series.creator_id` and does the same; anything missed is caught by the
  daily repair.

### 5.5 The money lanes, file by file

**Title sales — `lib/purchases.js`**

- `getTitleRecord('episode', id)` adds `uploaderId` (= `submitted_by`; `creatorId` keeps meaning the uploader for
  other callers), `runnerId` (`titleRunnerOf`) and `payeeId` (`payeeNowForEpisode`); the series record adds
  `runnerId = creator_id` (`payeeId` = `seriesSalePayee` as in 3a).
- `assertCanPrice(record, userId, isAdmin)`: `isAdmin || record.runnerId === userId`, else 403 `not-pricer` (§5.3).
- `requestPrice`: `creator_id = record.runnerId || existing.creator_id || userId`; `stopSelling` / `startSelling` /
  `setSale` / `endSale`: `updatePrice` patch adds `creator_id: record.runnerId` when there is one.
- `getOffer` / `getOffers`: when the price is on sale, the paid account must be able to receive money — house (a
  full admin, or no payee) passes; otherwise `isPayoutReady` (batched through `getPayoutAccounts` in `getOffers`) or
  the offer answers `forSale: false, blocked: 'payee-not-ready'` (no Buy card anywhere; the lock panel's "Two ways to
  watch" falls back to the membership way).
- `createPurchaseCheckout`: `payee = record.payeeId`; own title when the buyer is the payee, the runner or the
  uploader ("That’s your own title."); `house = isHouseCreator(payee)`; not ready → 409 "This title can’t be sold
  right now."; `purchases.creator_id = payee` (the destination account's owner). Refunds and disputes keep reading the
  row's `creator_id` (money already paid stays where it went).
- Before 118: `payeeNowForEpisode` answers legacy (the uploader) — today's behaviour.

**Ad share — `lib/adShare.js` (+ `lib/adShareRules.js`, §5.1)**

- `adShareLineId(episodeId, period, payeeId = null)`: with `payeeId` → sha1 of `ad_share:${episodeId}:${period}:${payeeId}`
  laid out as today; without → today's id.
- `impressionRows(period)` selects `episode_id, day, impressions, credit_cents`.
- `creditAdShare({ period, createdBy, now })`: unchanged "period not over" rule; `ctx = readPayeeContext(ids)`;
  `payeeOn = (id, day) => payeeAtFor(ctx, id, dayStartIso(day))`; `excluded = excludedCreators(every segment
  payee)` (full admins, leavers — today's function, now on payees); lines from `adShareLines`; id = `split ?
  adShareLineId(e, p, segmentPayee) : adShareLineId(e, p)`; **guard**: read `creator_ledger` where `kind =
  'ad_share' and period = p and episode_id in (…)` — any hit skips every line of that episode-month (counted in
  `alreadyCredited`); then the id check for the rest (a race between two runs loses on the primary key); insert;
  strip `split` / `segmentPayee` before inserting. The answer adds `split: <episode-months split>`.
- `creditAdShareBeforeDelete(rows, { series = null, ownerId = null, createdBy })`: the same segmentation with a
  context built from the given rows, `series` and their history (read before the delete); `ownerId` stays the
  legacy fallback for a pre-118 database.

**Creator Share — `lib/creatorShare.js` (+ `countWatched`, §5.1)**

- `recordMembershipInvoice` reads `houseAccountIds()`, `payeeAccountIds()`, `getLeavingIds()` beside today's reads;
  `eligible(id) = !leaving.has(id) && !house.has(id) && (supportableIds.has(id) || payees.has(id))`.
- `watchedCreators(memberId, eligible)`: today's `watch_history` read (last 30 days, ≤ 500 rows) and approved,
  not-held episodes; `ctx = readPayeeContext(ids)`; `countWatched(rows, (r) => payeeAtFor(ctx, r.episode_id,
  r.watched_at), eligible, memberId)`.
- `poolCreators(supportable, memberId, { house, payees, leaving })`: eligible = supportable ∪ payees (by id) minus
  house, minus the member, minus leavers; weights from `getCreatorViewTotals` as today (equal when nobody has views).
- The lineup (member picks) is unchanged: members pick people.

**Views for the pool — `lib/episodePage.js`** (`lib/redis.js` unchanged): `const payee = await
payeeNowForEpisode(episode)`; `creditCreator = account.userId && account.userId !== payee.payeeId && !locked ?
payee.payeeId : null` → `recordDailyView(episode.id, creditCreator)` (counted under the payee at view time).

**Tips — `lib/episodePage.js` + `lib/tips.js`**: `tipping = getTipping(payee.payeeId, { viewerId, forTitle: true })`,
plus `tipping.isMaker = payee.payeeId === episode.submittedBy`. `getTipping(creatorId, { …, forTitle = false })`: with
`forTitle`, a full admin (house) answers `{ enabled: false, reason: 'house' }` (after the payout check, before the
role check's 'not a creator'); `reason` is hidden from viewers as today (`internal` keeps it). The profile's Tip
button is unchanged (the profile's person). `/api/tips/checkout` is unchanged (it tips the `creatorId` sent; the
episode page sends the payee).

**Your numbers — `pages/api/creator/analytics.js`, `pages/api/creator/episode-detail-analytics.js`**: the set a
viewer sees = their uploads ∪ every episode in a show they run (unchanged) ∪ **titles explicitly paid to them**
(`episodes.paid_to = me`, and episodes with no own `paid_to` in a show whose `paid_to = me`). The detail route's
`owns` adds the same. The runner keeps seeing everything in their shows; an uploader whose episode now pays someone
else keeps seeing it (numbers are views, not money). Gate unchanged (`isCreator`).

**The Money page — `lib/creatorMoney.js`**: no change — it reads `creator_ledger`, `purchases` and `creator_tips` by
`creator_id`, which is now the payee. **The payout batch** (`lib/creatorShareBatch.js`): no change — it pays ledger
lines by `creator_id`; a payee without a ready account is "held: no payout account" and their credits wait as owed.

**Gates**: `pages/api/creator/payouts.js`, `pages/api/creator/money.js` and `pages/creator/money.js`
(getServerSideProps) open also when `hasPayeeInterest(userId)`.

**What each lane does when the paid account can't receive money** (no ready Express account):

| Lane | Behaviour |
|---|---|
| Ad share, members' share, referral | credited as owed to the payee; the batch holds them ("no payout account"), as for any creator |
| Title sales | not for sale (`blocked: 'payee-not-ready'`): no Buy card; the runner sees the line in the Sell modal and the PayeeBlock |
| Tips | no Tip button on the title (`getTipping` 'payouts not ready', as today) |
| Pool views | still counted under the payee |
| House payee (a full admin) | sales keep everything (no transfer); ad share, members' share and tips: nothing credited, no button |

### 5.6 Notification types (register in `lib/notificationTypes.js` and `mobile/src/lib/notificationTypes.js`, word for word)

```
// Who gets paid (lib/payees.js, slice 3b).
payee_invite: kind('Get paid for a title', 'card', 'creator'),
payee_invite_accepted: kind('Invite accepted', 'card', 'show'),
payee_invite_declined: kind('Invite declined', 'card', 'show'),
payee_invite_cancelled: kind('Invite withdrawn', 'card', 'creator'),
payee_changed: kind('Earnings moved', 'card', 'money'),
```

Hrefs: `payee_invite` / `payee_invite_cancelled` → `/creator#get-paid`; `payee_invite_accepted` /
`payee_invite_declined` → the show page (`/creator/show/<id>`, an episode `…#ep-<eid>`), a standalone title
`/creator/my-work`; `payee_changed` → `/creator/money` (to an uploader told by the cut-over: the show page).

### 5.7 Cron steps (`pages/api/cron/creator-reminders.js`, daily 9:30 UTC, after the collect reminders and `releaseDueCrewPay`)

- **`payeeCutoverStep({ now })`** — once, the first run at or after `payeeRuleFrom()` (Redis
  `firstInWindow('payee-cutover-done', 400 days)` set only after a pass completes; without Redis it simply runs
  again and finds nothing): pages every episode with a `series_id` (and its series); for each whose
  `legacyPayeeOf ≠ payeeOf` and that has **no** `title_payees` rows: insert an open row `[from, ∞) payee =
  payeeOf`, `set_by 'cutover'`; notify the legacy payee once (`payee_changed`, href the show page): "From
  <utcDayLabel(from)>, the earnings of <titleWords> go to <name>, <who runs “Night Bus” | Night Bus’s paid account>.
  What it earned before stays yours." One audit line per show `payee_cutover` ("Night Bus: 2 episodes now pay Mara
  Reyes"). Its counts go into the cron's audit line.
- **`repairTitlePayees({ at })`** — every open `title_payees` row whose payee ≠ `payeeOf` on the live columns (or
  `seriesSalePayee` for a series row): close at `at`, open the right one, `set_by 'repair'`, `console.error('payees:
  repaired <type> <id>')`. Also cancels pending invites whose title is gone. Counts in the cron's audit line.

### 5.8 Audit actions written in 3b

`payee_invite_sent`, `payee_invite_cancelled`, `payee_invite_accepted`, `payee_invite_declined`, `payee_set`,
`payee_stepped_down`, `payee_cutover`, `payee_repaired` (target `series` / `episode`, `details` through
`auditWords(actor, words, extra)` with actor `owner` (the runner), `admin`, or `payee` (the invitee / a stepping-down
payee) — `historyEntry` in `lib/showAdminRules.js` shows the name for `payee`); `creator_role_granted` when an admin's
pick grants it; `show_owner_changed` words extended (§5.4). The show's History card lists them (they target the show
or its episodes).

### 5.9 Before 118 (and the stand-ins' `/__shows118?mode=pre`)

Every payee route but `mine` answers 503 `migration-118`; `mine` answers `available: false`; PayeeBlocks are
`{ available: false, locked: MIGRATION_118_PAYEE_LINE }`; `setShowOwner` behaves as 3a; `withPayeeStamps` runs only
`write()`; every lane reads legacy (`readPayeeContext.available` false). The stand-in's pre mode must make
`payee_invites` / `title_payees` answer PGRST205 and strip the `paid_to` columns (server builder checks and adds).

---

## 6. Website

### 6.1 Files

New `components/show/PayeeCard.js`. Changed: `components/show/ShowControlRoom.js`, `ShowCards.js` (ShowCard line),
`SeasonSection.js` (row "Sell…"), `EpisodeEditor.js`, `ShowEditor.js`, `components/show/admin/OwnerCard.js`,
`pages/creator.js`, `pages/creator/my-work.js`, `components/creator/SellTitleModal.js`, `pages/terms.js`,
`legal/creator-share-terms-draft.md`, `styles/globals.css`. Reuse existing classes (`show-side-card`, `show-side-k`,
`show-side-btn`, `apl-btn`, `apl-btn-secondary`, `apl-link`, `show-ed-label`, `show-ed-input`, `cs-pile`,
`cs-pile-head`, `cs-row`, `cs-row-main`, `cs-row-title`, `cs-row-meta`, `cs-row-acts`, `cs-count`, `admin-error`,
`tone-warn`); new classes only for layout (`.show-payee*`, `.cs-invite*`), colours from tokens. No new visual
language.

### 6.2 `PayeeCard` (`{ payee, mode: 'card'|'section'|'modal', onChanged(next, words), titleWord }`)

Renders nothing when `payee` is null. Calls `POST /api/payees` and `POST /api/payees/invites/<id>` through the room's
`callApi`; after any success calls `onChanged(answer.payee, answer.words)` (the room toasts `words` and reloads).

- Heading (`show-side-k`, `id="show-payee-k"`): **Who gets paid**. Card mode: `<section id="show-payee"
  className="show-side-card show-payee">`; section mode: a `show-ed` section heading in the editor; modal mode: the
  dialog title "Who gets paid for “<title>”".
- The line (`.show-payee-line`): **Runs it** <runsIt> · **Paid to** <paidTo> <sourceWords> — the two keys styled as
  the show card's meta keys; under it `since <sinceLabel>` when set.
- `notes` as small lines; `houseNote`; `notReady` (`tone-warn`); `locked` (when set, nothing below shows but the
  line).
- Pending (`.show-payee-pending`): "Waiting for <name> to accept · sent <sentLabel>" + **Withdraw invite** (`apl-link`;
  confirm "Withdraw the invite to <name>? Nothing about its earnings has changed."). Then "Until they accept, its
  earnings keep going to <paidTo>."
- `lastAnswer`: "<name> said no on <atLabel>."
- History (runner / team / payee, when there are 2+ rows): "Before: Mara Reyes until Nov 14".
- **Change who gets paid** (`apl-btn-secondary show-side-btn`, when `can.pick`) opens the form inline (card,
  section) or in place (modal):
  - `role="radiogroup"`, legend "Who should get its earnings?"; options in this order, only those that apply:
    **You** (`can.self`) · **<defaultChoice.label> (<defaultChoice.name>)** (`can.default`) · **Someone else**.
  - Someone else: label "Their @handle or the email on their account", input `show-ed-input` (placeholder "@handle or
    name@example.com", `autoComplete="off"`, max 320), help "They get an invite and decide. Until they accept, its
    earnings keep going to <paidTo>." For an episode in a show: the series-sale note "Whole-series sales of <show>
    still go to <name>." (from the server's `notes` when present, else `seriesSaleNote` with the show's payee).
  - On a 409 `no-creator-role` with `canGrant`: a tick **Give them Creator Studio too** appears; sending again adds
    `grantCreator: true`.
  - Buttons: **Send the invite** (someone else) / **Save** (you, default), **Cancel**. Confirm before a direct change
    that moves money away from someone else: "Its earnings go to <new> from now on, and <old> is told. What it earned
    before stays with <old>."
- **Stop getting its earnings** (`apl-link`, when `can.stepDown`): confirm "Stop getting the earnings of <titleWord>?
  They go back to <default name> from now on; what’s already credited to you stays yours."
- Footer help (card mode only, small): "Its share of ad money and members’ support, its sales and its tips go to this
  account. What it already earned stays where it went."
- Errors: the server's line under the form (`admin-error`), focus moves to it; every control disabled while busy; a
  503 shows the migration line in place of the form.

### 6.3 Where it sits

- **Creator show page** (`ShowControlRoom mode="creator"`): the ShowCard shows `view.payee.line` under its meta line
  when `view.payee` is set (`.show-card-paid`: the two keys and names, plus `line.pending` on its own line). The
  **Who gets paid** card sits after the Sell card (or where it would be) and before the channels switch — in the
  laptop's 360px side column and in the phone's single column alike. A row's kebab gains **Sell…** / **Price and
  sales** for the runner on live rows (opens `SellTitleModal` for that episode; hidden in admin mode). Rows with
  `paidOwn` show "Paid to <paidToName>" in their meta line (seesWhoIsPaid viewers).
- **Admin show page** (`mode="admin"`): the Who gets paid card right after the Owner card (full admins can pick;
  sub-admins see it read-only — `can.pick` false).
- **Episode editor** (panel and page, both modes): the line under the editor's status line; the **Who gets paid**
  section (`mode="section"`) at the end of the **More info** tab.
- **Show editor**: the line at the top of Details + "Change it under Who gets paid →" (`/creator/show/<id>#show-payee`;
  admin: `/admin/shows/<id>#show-payee`).
- **Your work** (`pages/creator/my-work.js`): the row menu gains **Who gets paid** — a show's episode links to its
  editor (`/creator/show/<sid>/episode/<eid>`), a standalone title opens `PayeeCard mode="modal"` (loads `GET
  /api/payees?type=episode&id=`); **Sell** is hidden when `row.canPrice === false`.
- **Sell modal** (`SellTitleModal`): `blocked[key]` shows as a `tone-warn` line above the price ("…can’t be bought
  until they do.").

### 6.4 Creator Studio (`pages/creator.js`)

Loads `GET /api/payees/mine` with the piles (a failure hides both pieces).

- **Get paid** (`<section id="get-paid" className="cs-pile cs-invites">`, head "Get paid" + count), right under the
  page head (before the Submit block), only when there are invites. One `.cs-row.cs-invite` per invite:
  - title `invite.headline` ("Get paid for Night Bus?" / "Get paid for “Pilot” (Night Bus · S1 E1)?" / "Get paid for
    “The Long Road”?"); meta "<inviterName> asked on <sentLabel>";
  - body lines (`invite.body`): "Its share of ad money and members’ support, its sales and its tips come to you from
    the moment you accept. What it earned before stays where it went." · for an episode in a show: "Whole-series sales
    still go to <name>." · when `!payoutsReady`: "To receive it, set up payouts under Money." (Money → `/creator/money#payouts`);
  - actions: **Accept** (`apl-btn`) and **Not now** (`apl-btn-secondary`); under them "Not now tells <inviterName> you
    said no. They can ask again."
  - Laptop: text left, buttons right (the `cs-row` layout). Phone (< 640px): buttons below the text, full width.
  - Done: the row leaves; a `cs-flash` shows `words` ("Done — Night Bus’s earnings come to you from now on." / "Mara
    Reyes was told."); an error shows inline in the row (`admin-error`).
- **Paid to you** (a `Pile` after Live, before the links nav, only when `paidFor` is non-empty): rows "<title>" with
  meta "the whole show · since <sinceLabel>" / "Night Bus · S1 E3 · since <sinceLabel>", a link to `href` when set,
  and **Stop getting it…** (`apl-link`, the step-down confirm of §6.2).

### 6.5 Words for the Move sheet

No component change: the server's `lines` now read "Future earnings go to <name>" when a move changes the payee
(rule live), else "Its earnings stay with <uploader>." before `PAYEE_RULE_FROM`.

### 6.6 The admin Owner card (`components/show/admin/OwnerCard.js`, gets `payee` = `view.payee`)

- Under the owner: **Paid to** <name> (· since <sinceLabel>) — or "Paid to Studio Tapa" for a house payee — and the
  pending line; link **Who gets paid ↓** (`#show-payee`).
- The hand-over form: once the email field is valid, a fieldset "Who gets the show’s earnings after the hand-over?"
  with two radios, `keep` pre-selected:
  - **Keep them with <payee name>** — "Every episode without its own paid account keeps paying <payee name>,
    including new ones the new owner adds, until the new owner picks someone else."
  - **<typed email> gets them from now on** — "From the hand-over on. What the show earned before stays where it
    went. <payee name> is told." (disabled before `PAYEE_RULE_FROM` with "Opens on <utcDayLabel>.", from
    `payee.ruleLive` / `ruleFrom`).
  - Under both: "Episodes with their own paid account keep it either way. Invites waiting on this show are withdrawn."
  - Sends `{ action: 'owner', email, earnings }`.
- The note becomes "They get its page in Creator Studio. Episodes keep the person who uploaded them."
- Clear the owner's confirm: "Nobody will run <show> until you pick someone. Its earnings stay with <payee name>.
  Clear it?"
- Toast: "<name> runs <show> now." + "Both of you were told." + "Its earnings stay with <name>." / "Its earnings go to
  <name> from now on."

### 6.7 Terms and the lawyer note

`pages/terms.js` section 5, a paragraph after **Ad share** and before **Getting paid and taxes**:

> **Which account a title pays.** What a title earns — its member share and ad share above, its sales (section 15)
> and the tips on its page (section 16) — goes to the account the title is attached to on {SITE.name}: whoever runs
> it, or another account they choose, which has to accept first; a change applies only to what the title earns
> after it, and credits and payments already made stay where they were made.

`TEXT_UPDATED` → the build date. `legal/creator-share-terms-draft.md`: add the paragraph as "Terms of Service ·
section 5 · add (2026-11)" and question 8 under "Questions for counsel": "**Paid accounts.** A title's earnings
(member share, ad share, sales, tips) go to the account it is attached to — by default whoever runs it, or an account
they pick that accepts first (a producer can be paid for someone else's upload). Who is the payee for tax reporting
in that case, and does section 5's licence need the uploader's agreement that another account may be paid for their
work?"

---

## 7. App

Same routes, same PayeeBlock, same words. Files: new `mobile/src/components/show/PayeeCard.js`; changed
`mobile/src/app/creator/show/[id]/index.js`, `mobile/src/components/show/ShowCards.js`, `RowSheets.js`,
`EpisodeEditor.js`, `ShowEditor.js`, `mobile/src/app/creator/index.js`, `mobile/src/app/account/my-work.js`,
`mobile/src/components/SellTitleSheet.js`, `mobile/src/components/PushListener.js`. Calls through `showCall`
(`mobile/src/lib/showApi.js`: a 409's `code` / `canGrant` / `pending` reach the screen; a 503 `migration-118` greys
the control with the server's line).

- **PayeeCard (app)**: a card in the show screen's style (`ShowBits` / `cp` styles, theme tokens; `okTint` /
  `oliveTint` as the web's tones) — heading "WHO GETS PAID", the line, notes, pending + **Withdraw invite**, last
  answer, **Change who gets paid** → a bottom-sheet `Modal` (the MoveSheet pattern) with tappable rows (a check mark
  on the chosen one) for You / the default / Someone else; Someone else shows a `TextInput` (`autoCapitalize="none"`,
  `autoCorrect={false}`, `keyboardType="email-address"`, placeholder "@handle or name@example.com"), the help line and
  the series-sale note; **Send the invite** / **Save** (`PrimaryButton`), **Cancel** (`SecondaryButton`); the
  `canGrant` tick as a switch row "Give them Creator Studio too". Confirms with `Alert.alert` in §6.2's words. The
  sheet lives inside its own `KeyboardAvoidingView`. **Stop getting its earnings** as a quiet text button.
- **Show screen**: the line in `ShowCard` (under the meta); the PayeeCard after the Sell card, before the channels
  switch; the row sheet gains **Sell…** for the runner on live rows (opens `SellTitleSheet` for the episode). Rows
  with `paidOwn` read "Paid to <name>" in their meta.
- **Episode editor screen**: the line under the status; the Who gets paid section at the end of More info.
- **Show editor screen**: the line + "Change it on the show page" (`router.dismissTo('/creator/show/<id>')`).
- **Creator Studio** (`creator/index.js`): `GET /api/payees/mine` with the piles; **Get paid** card(s) at the top
  (before Submit a title) with Accept (`PrimaryButton`) / Not now (`SecondaryButton`) and the foot line; **Paid to
  you** rows after Live with Stop getting it (Alert confirm). Reload on focus (as today).
- **Your work** (`account/my-work.js`): the row sheet gains **Who gets paid** (a show's episode →
  `router.push('/creator/show/<sid>/episode/<eid>')`; a standalone title → a `Modal` with the PayeeCard); Sell hidden
  when `canPrice === false`.
- **SellTitleSheet**: `blocked[key]` as a warning line.
- **PushListener**: `/creator#get-paid` → `/creator` (check the hash is dropped before the route match; add a test
  line in its route table comment).
- The app gets nothing on its Admin tab; the episode screen's Tip label already reads the tipped person's first name
  (no change).

---

## 8. Verification

**Server builder**

- `node scripts/test-show-rules.mjs` (new cases, both copies), `scripts/test-ad-share.mjs`,
  `scripts/test-creator-share.mjs`, `scripts/test-notification-types.mjs`, every other `scripts/test-*.mjs`,
  `npm run -s check:refs`, `npm run -s lint`.
- **PGlite** (scratchpad `s3b/check-payee-writes-pg.mjs`, `buildDb(120)` from `scripts/pg-chain.mjs`), each write as
  the code sends it:
  1. a `payee_invites` insert; a second pending for the same title → 23505 on `payee_invites_one_pending_idx`; after
     `declined` a new pending inserts; the guarded claim (`… where id = $1 and status = 'pending'`) returns 1 row then 0.
  2. `title_payees`: a baseline row (closed) inserts; `to_at < from_at` is refused by `title_payees_period`; a null
     `payee_id` is refused.
  3. **The close-and-open as ONE statement** — `insert … on conflict (id) do update set to_at = excluded.to_at, …`
     with `[close X, open Y]` for the same title → succeeds, exactly one open row; `[open Y, close X]` (opens first)
     → record what Postgres answers (expected 23505; the plan always sorts closes first); two separate inserts of an
     open row → 23505 on `title_payees_one_open_idx`. If the one-statement form is refused, the builder switches to
     two requests (close, then open) and says so in the notes.
  4. the guarded column writes: `update series set paid_to = $new where id = $id and paid_to is not distinct from
     $old` → 1 then 0; the same for `episodes`.
  5. ad share: two `ad_share` lines for the same (episode, period) with different ids insert; the guard query by
     (`kind`, `period`, `episode_id`) finds them; the same id twice → 23505.
  6. `supabase/health_check.sql`'s two new rows run and read 0 / a count.
- **Stand-ins** (scratchpad): `start-dev-3100.sh` gains `PAYEE_RULE_FROM=2026-10-15T00:00:00.000Z` (restart only
  when no suite runs); `fake-supabase-harvest.js` pre mode hides the payee tables and `paid_to` (if it doesn't
  already) and supports `upsert` with `on_conflict=id`; `fake-clerk.js` roles via `/__roles` (a creator invitee
  `user_dee`, a non-creator `user_fan2`, `user_pat` added as a creator if missing); `fake-stripe-tips.js` Express
  accounts ready / not ready per user.
- **`pw/payees-http.js`** (minted sessions for Mara (runner), Dee (uploader / invitee), Pat (invitee), Fan2
  (non-creator), Zed (stranger), Admin, a sub-admin), before 118 / after 118 through `/__shows118`:
  1. 401 signed out; 404 for Zed; the PayeeBlock shapes for the runner, an uploader, a payee, a sub-admin (read-only),
     an admin.
  2. Pick by @handle and by email: the invite row, `payee_invite` notification + email (the stub's mail log), audit;
     a second pick → 409 `pending`; Fan2 → 409 `no-creator-role` (no `canGrant` for Mara, `canGrant` for the admin;
     the admin's `grantCreator` → role set, invite sent); unknown handle / email → 404 lines; `none`; `self-not-runner`
     (the admin on Mara's show); the 20-a-day limit (429); `busy`.
  3. Decline → `declined`, inviter told, nothing moved; Mara invites again → accept → `series.paid_to` = Pat,
     `title_payees`: a baseline row `[from, at)` for each affected episode + the series, one open row each, `set_by
     invite:<id>`; notifications to Mara (and the previous payee); a second accept → 409 `answered`; cancel by
     Zed → 403; cancel by Mara of a fresh invite → `cancelled`, invitee told; accept of a cancelled one → 409
     `cancelled`.
  4. Direct: Mara picks herself on an episode paid to Pat (Pat told), back to default, Pat steps down (Mara told);
     every change closes one row and opens one; no title ever has two open rows.
  5. Hand-over: without `earnings` → 400 `earnings-choice`; `keep` → nothing restamped, pending invites cancelled;
     `move` → the series and its episodes without their own paid account restamped to the new owner, the old payee
     told; `title_prices.creator_id` follows.
  6. A cross-owner move by the admin: "Future earnings go to …" in the sheet's lines, the moved episode restamped,
     its pending invite cancelled; a move between two of Mara's shows that pay different accounts → restamped.
  7. Removal: pending invites cancelled, `title_payees` kept, ad share credited before delete with the split.
  8. **Sales**: an episode sale pays the payee's account (`transfer_data.destination` = Pat's account, `purchases.
     creator_id` = Pat); a whole-series sale pays `seriesSalePayee`; Pat not ready → no offer (`blocked`), Checkout
     409; Mara can price the contributor's episode, Dee can't (403 `not-pricer`); a house payee keeps everything.
  9. **Ad share**: seeded `ad_impression_days` across October (Oct 1–14 legacy Dee, cut-over Oct 15, acceptance
     Oct 20 15:00 by seeded history rows) → three lines with the 3-argument ids and day-range notes; a re-run credits
     nothing; a month credited earlier under the old id (seed a line) → skipped whole; an excluded (admin) segment →
     skipped, the rest credited.
  10. **Watched basis**: a member's `watch_history` before and after a change → the invoice's watched lines split
      between the two payees; a house payee dropped; the member themself dropped.
  11. **Tip button**: `/api/episode-page` `tipping.creatorId` = the payee, `isMaker` false; a house payee → no
      button; the profile's Tip unchanged.
  12. **Views**: an episode view records `creator_views` under the payee (Redis stub or the per-instance fallback,
      whichever the stand-ins use; if Redis is off, assert the call through a log line).
  13. **Gates**: a creator with a pending invite, and Pat once accepted, whose role is then removed through
      `/__roles`, still reach `/api/creator/payouts` and `/api/creator/money` (and `/creator/money` renders); Zed
      (no invite, no title) gets 403 / the redirect.
  14. Your numbers: Pat sees the title paid to them; Dee still sees her upload; Mara her show.
  15. The cut-over step: run `/api/cron/creator-reminders` with the cron secret → open rows `set_by cutover` for the
      contributor's episodes, Dee told once; a second run writes nothing; the repair step closes a hand-made stale
      open row.
  16. Before 118: every payee route 503 `migration-118` (`mine` 200 `available: false`), the show page and the
      editor carry `{ available: false }`, a sale pays the uploader, ad share credits the uploader, hand-over without
      `earnings` works as in 3a.
- Update for the new behaviour (server builder): `pw/show-admin-http.js` case 9 (the admin's cross-owner move now
  reads "Future earnings go to …") and case 13 (hand-over sends `earnings`); `pw/show-3a-fixes-http.js` if it hands
  over; `pw/money-http.js` / `pw/title-ids-http.js` if a case uses a contributor's episode (a case that fails only
  because the rule moved its money is updated, and the notes say which). Add `payees-http` and `payees-browser` to
  `final/run.sh`.

**Website builder**

- **`pw/payees.js`** at 1280 and 390 (Mara, Pat, the admin, a sub-admin): the show card's line; the Who gets paid card
  in the side column (1280) and in the single column (390) with its states — default, pending + Withdraw, declined
  line, not-ready line, house note, locked lines; the form (You / default / Someone else, the series-sale note on an
  episode, the Creator Studio tick for the admin); the episode editor's section in the panel (1280) and on the page
  (390); Your work's Who gets paid modal for a standalone title and the hidden Sell; the Creator Studio Get paid card
  (Accept, Not now) and the Paid to you pile with Stop getting it; the admin Owner card's Paid to row and the
  hand-over radios; the Sell modal's blocked line; keyboard (Tab reaches every control, Escape closes the modal);
  no horizontal overflow, no page errors; screenshots in `shots-slice3b/`.
- `next build`.

**App builder**: `cd mobile && EXPO_OFFLINE=1 CI=1 npx expo export --platform ios --output-dir <scratchpad>/expo-3b-ios`
and `--platform android … expo-3b-android`; the screens' calls with a Bearer token (Mara's and Pat's) in
`pw/payees-app-http.js` (its own file: cases 1–4 of the server suite as the app sends them — `Authorization: Bearer`,
no Origin, the 409 `code`s and the 503 line reaching `showCall`); not device-tested.

**Must stay green** (`PORT=3100 SUFFIX=-3b bash …/final/run.sh <names>`): `api-pre`, `api-post`, `api-off`, `editors`,
`lists`, `page`, `show-data`, `followups`, `slot`, `slot-race`, `resume-http`, `title-ids`, `money`, `make-public`,
`library-modal`, `creator-path`, `queue`, `walk390`, `walk1280`, `end-card`, `episode-after`, `trailer`, `sweep-out`,
`sweep-mara`, `sweep-admin`, `show-admin-http` (updated), `show-3a-fixes`, `show-admin` (updated by the website
builder for the Owner card), and the new `payees-http`, `payees-browser`.

---

## 9. Who owns which file (no file has two owners)

| Server builder | Website builder | App builder |
|---|---|---|
| `lib/showRules.js`, `mobile/src/lib/showRules.js`, `scripts/test-show-rules.mjs` | `components/show/PayeeCard.js` (new) | `mobile/src/components/show/PayeeCard.js` (new) |
| `lib/notificationTypes.js`, `mobile/src/lib/notificationTypes.js` (+ its test if it lists types) | `components/show/ShowControlRoom.js`, `ShowCards.js`, `SeasonSection.js`, `EpisodeEditor.js`, `ShowEditor.js` | `mobile/src/app/creator/show/[id]/index.js` |
| `lib/payees.js` (new) | `components/show/admin/OwnerCard.js` | `mobile/src/components/show/ShowCards.js`, `RowSheets.js`, `EpisodeEditor.js`, `ShowEditor.js` |
| `pages/api/payees/index.js`, `pages/api/payees/mine.js`, `pages/api/payees/invites/[id].js` (new) | `pages/creator.js` | `mobile/src/app/creator/index.js` |
| `lib/showPage.js`, `lib/showAdmin.js`, `lib/showDelete.js`, `lib/showAdminRules.js` (only if `historyEntry` needs `payee`) | `pages/creator/my-work.js` | `mobile/src/app/account/my-work.js` |
| `pages/api/admin/show/[id].js`, `pages/api/admin/series-ownership.js`, `pages/api/admin/resolve-deletion.js`, `pages/api/admin/edit-episode.js`, `pages/api/creator/edit-submission.js` | `components/creator/SellTitleModal.js` | `mobile/src/components/SellTitleSheet.js` |
| `lib/purchases.js`, `pages/api/creator/pricing.js`, `pages/api/creator/my-submissions.js` | `pages/terms.js`, `legal/creator-share-terms-draft.md` | `mobile/src/components/PushListener.js` |
| `lib/adShare.js`, `lib/adShareRules.js`, `scripts/test-ad-share.mjs` | `styles/globals.css` | Scratchpad: `expo-3b-ios/`, `expo-3b-android/` |
| `lib/creatorShare.js`, `lib/creatorShareRules.js`, `scripts/test-creator-share.mjs` | Scratchpad: `pw/payees.js` (new), `pw/show-admin.js` (Owner card update), `shots-slice3b/` | |
| `lib/episodePage.js`, `lib/tips.js` | | |
| `pages/api/creator/analytics.js`, `pages/api/creator/episode-detail-analytics.js` | | |
| `pages/api/creator/payouts.js`, `pages/api/creator/money.js`, `pages/creator/money.js` (the gate only) | | |
| `pages/api/cron/creator-reminders.js`, `supabase/health_check.sql` | | |
| Scratchpad: `start-dev-3100.sh`, `fake-supabase-harvest.js`, `fake-clerk.js`, `fake-stripe-tips.js`, `s3b/check-payee-writes-pg.mjs`, `pw/payees-http.js` (new; the app builder adds its `APP=1` pass through a separate file `pw/payees-app-http.js` it owns), `pw/show-admin-http.js`, `pw/show-3a-fixes-http.js`, `pw/money-http.js`, `pw/title-ids-http.js`, `final/run.sh` | | Scratchpad: `pw/payees-app-http.js` |

**Order.** The server builder lands `lib/showRules.js` (+ mirror), the notification types and the route shapes
(§5.3, PayeeBlock) first; the website and app builders build against this contract and the stand-ins meanwhile and
read only the shapes in §5.3. Only one dev server runs on the worktree (`start-dev-3100.sh`); the server builder
adds the `PAYEE_RULE_FROM` line and restarts it once, early, while no suite runs, and says so; builders never
restart it while another suite runs.

**For the orchestrator, at commit time**: set `PAYEE_RULE_FROM` (both copies of `lib/showRules.js`) to 00:00 UTC of
the push day; check `TEXT_UPDATED` in `pages/terms.js`; CLAUDE.md gets the Series revamp bullet's slice 3b paragraph
(the rule in time, the routes, the lanes, no migration) and Jose's open points: row 12 (Tip on the episode page names
the paid account; keep it on the maker instead?), row 13 (studio titles no longer earn members' share), question 23's
"public too?", and the lawyer's question 8.

---

## Server builder's notes (2026-11-05)

What the server half did where the contract and the code met. **Web and app builders: read 1–3 first.**

1. **Shapes as built.** `GET /api/show/[id]` carries the show's PayeeBlock at the top level as **`payee`** (next to `show`, `seasons` …; `money` is gone, and `viewer.isPayee` is new). `GET /api/show/episode/[id]` carries **`payee`** at the top level. A PayeeBlock is exactly §5.3's, plus: `paidTo.name` reads `Studio Tapa` (`SITE.studio`) for a house payee; `history[].name` reads `You` for the viewer; when `locked` is set every `can.*` is false (step-down too); `can.self` is false when the viewer already is the paid account; `can.grantCreator` only goes with `can.pick`. **Before the cut-over** a block's `paidTo` is who the rule will pay (`payeeOf`) and `notes` carries "Until Nov 9, Dee Marsh is paid (the old rule)." for an episode whose old payee differs; `locked` is the `not-yet` line. Before 118 the block is `{ available: false, …, locked: 'Choosing who gets paid needs a database update (migration 118).' }` with every other field null / empty.
2. **The Terms paragraph and the lawyer's question 8 are done** (by the server builder, as its task asked): `pages/terms.js` section 5 ("Which account a title pays.", after Ad share, before Getting paid and taxes; `TEXT_UPDATED` 2026-11-05) and `legal/creator-share-terms-draft.md` (a "3b" section with the paragraph, question 8). The website builder must not add them again.
3. **Other answers the UI reads:** `GET /api/creator/my-submissions` rows carry `canPrice`; `GET /api/creator/pricing` carries `blocked: { 'episode:<id>': 'Pat Lee hasn’t set up payouts yet, so it can’t be bought until they do.' }` (the name falls back to "Its paid account"); `POST /api/creator/pricing` answers 403 `{ code: 'not-pricer', error }`; an offer (`/api/purchases/offer`, `/api/episode-page`'s `purchase` / `bundle`, `/api/series-hub`'s offers) whose paid account can't take a sale has `forSale: false, blocked: 'payee-not-ready'`; `/api/episode-page`'s `tipping` carries `isMaker` and its `creatorId` / `creatorName` are the paid account's; `POST /api/admin/show/[id] { action: 'owner', email, earnings: 'keep' | 'move' }` answers `{ …, earnings, paidTo: { name } }`, 400 `earnings-choice` without the choice (once 118's tables are there), 409 `not-yet` ("Moving the earnings opens on <date>.") for move before the cut-over. A pick that hits the 20-a-day ceiling answers 429 `{ code: 'limit' }`.
4. **`GET /api/payees/mine` lists pending invites only.** The contract's "an `accepted` invite whose column isn't the viewer, shown as pending, re-applied on Accept" is not built: an accepted invite whose column later differs is almost always a legitimate later change (the runner picked someone else, the payee stepped down), and re-applying it would take the earnings back. The one real half-done case — the column written, the claim lost, the invite still `pending` — is finished by Accept (the guarded write is a no-op, the claim succeeds), and Cancel on it marks it `accepted` and answers 409 `answered`, as §5.2 says.
5. **The cut-over step has no Redis "done" mark.** It runs on every daily cron and is idempotent: it only stamps episodes **created before the cut-over** that have no `title_payees` row yet and whose old payee differs from the rule's, so after the first pass it finds nothing; a pass that stopped part-way finishes the next day; titles made after the cut-over (never paid by the old rule) are never stamped or announced. (A Redis mark set at the start would also have skipped the step for good on every later stand-in run of the same dev server.) Its words: "From Oct 15, the earnings of “Pilot” (Night Bus · S1 E1) go to Mara Reyes, who runs “Night Bus”. What it earned before stays yours." (or ", Night Bus’s paid account."). The creator-reminders cron's JSON answer carries `payeeCutover` and `payeeRepair`, and a log line when either did something; that cron has no audit line of its own, so the counts aren't in one (the cut-over writes `payee_cutover` per show, the repair `payee_repaired` per row).
6. **One upsert statement is safe (PGlite).** `[close, open]` for one title in one `upsert(…, { onConflict: 'id' })` succeeds with one open row; `[open, close]` is refused with 23505 and changes nothing; a stale close plus an open fails whole, so a past `to_at` is never rewritten. No migration 121. Proof: scratchpad `s3b/check-payee-writes-pg.mjs` (25 checks on `buildDb(120)`, health_check.sql's two new rows included). `stampPlan` also clamps a close to the open row's own `from_at` when a writer's clock is behind (never a period that ends before it starts; tested).
7. **The invite insert sends `status: 'pending'`** explicitly (the stand-ins apply no column defaults; harmless on Postgres).
8. **Who may price:** `title_prices.creator_id` = the runner on every price action (`runnerPatch`), on a cross-owner move (`moveForViewer`, `edit-episode`) and on a hand-over (the series and every title filed in it). `listPendingPrices`' `payoutReady` now reads the paid account's payout state.
9. **`withPayeeStamps` wraps:** the picker's direct writes and every acceptance, `setShowOwner` (keep and move), a cross-show move in `moveForViewer` (the whole move, RPC or fallback), `pages/api/admin/edit-episode.js` when `series_id` changes, and `pages/api/creator/edit-submission.js` when a pending submission's show changes. A grep found no other writer of `episodes.series_id` on an existing row or of `series.creator_id`.
10. **Removal:** invites are withdrawn (cancelled, never deleted — the cascade used to delete the show's pending ones) only after the ad share before delete has succeeded, so a 503 there leaves them waiting. Reasons in the invitee's notice: "the show has a new owner" / "the show was removed" / "it was removed" (one episode) / "it moved to another show" / "the title is gone" (repair).
11. **Hand-over notices:** a `move` adds "Its earnings come to you from now on." to the new owner's "You run …"; with `keep`, the old owner's notice adds "Its earnings stay with you." when they remain the show's paid account; the old show payee of a `move` gets `payee_changed` as §5.4 says.
12. **Creator Share:** the share runs whenever the month has a share (it used to need at least one supportable creator, which would have stranded a paid account who isn't on the supportable list). `poolCreators(supportable, member, opts)` keeps its old behaviour without `opts` (the leavers' forfeit in `lib/creatorShareBatch.js`, not changed in 3b).
13. **Views for the pool** are counted under the paid account; the stand-ins run without Redis, so no suite asserts it (no log line was added for it).
14. **`edit-episode`'s answer no longer carries `earningsStayWith`** (nothing read it; from the cut-over it would be wrong).
15. **Stand-ins** (scratchpad): `start-dev-3100.sh` sets `PAYEE_RULE_FROM=2026-10-15T00:00:00.000Z` — the dev server was not running when this run began, so it was started once with that line; `fake-supabase-harvest.js`'s `/__shows118?mode=off` now drops 118's three tables again (a `post` run used to leave them behind, and 3b reads `title_payees` to know whether 118 is in); `fake-clerk.js` knows `user_pat` (Pat Lee, creator). The stand-ins send no email, so the suites check the notification rows, not the mail. `pw/slot/stub-roles.mjs` gained `lib/roles.js`'s other exports (the routes' import graph reaches `lib/payees.js`).
16. **Suites:** `pw/payees-http.js` (97 checks; in `final/run.sh` as `payees-http`, and `payees-browser` → `pw/payees.js` for the website builder) runs the ad share month and the members' watched basis in plain Node through `s3b/loader/` (a resolve hook for the site's extension-less imports), since the payout batch only credits "yesterday's month". Updated for the new behaviour: `pw/show-admin-http.js` 9.2 (an admin's cross-owner move now reads "Future earnings go to …") and 13.x (the hand-over sends `earnings: 'keep'`; the old owner's notice adds "Its earnings stay with you."), `pw/show-data-http.js` (reads `payee` instead of `money`). `money`, `title-ids` and `show-3a-fixes` pass unchanged.

---

## After the two reviews (2026-11-05)

Two independent reviewers read slice 3b; 21 findings, two of them reported twice (the unowned hand-over, the sub-admin
grant). Every one was checked against the code (and the stand-ins or the pure rules where cheap). Nineteen were real
and are fixed; one is fixed the documented way rather than the bigger one; none was rejected outright.

**Money that could go to the wrong account**

1. **A failed read of the payee tables paid the old rule** (`lib/payees.js`). `readPayeeContext` and `withPayeeStamps`
   no longer swallow `payeesAvailable()`'s error: only a database *without* 118's tables (PGRST205 / 42P01) reads as
   the old rule; a timeout or a 5xx throws. So: `creditAdShare` fails for the month (the batch records the error,
   "Run now" retries; the (episode, period) guard never sees a wrong line), `watchedCreators` and
   `payeeAccountIds` throw and `recordMembershipInvoice` fails before writing anything (the webhook already deletes
   the event row and answers 500, so Stripe retries), `getTitleRecord` marks the title `payeeUnknown` (not for sale;
   Checkout answers 503 "This title can’t be sold right now. Try again in a minute."), every stamped writer (picks,
   acceptances, hand-overs, moves, place edits) refuses rather than writing columns without history, and the episode
   page shows no Tip button and credits no pool view. Proved against the stand-ins with a new switch
   (`fake-supabase-harvest.js` `/__fail?table=title_payees&on=1`).
2. **"Keep" on a show nobody ran moved every uploader's earnings to the new owner** (`lib/showAdmin.js
   setShowOwner`). `keep` now pins each episode without a paid account of its own to the account it paid — its
   uploader — in `episodes.paid_to`, inside the same `withPayeeStamps`, before the series row changes; nobody's money
   moves, and the new owner's own episodes pay them. `move` tells every account an episode stopped paying
   (`noticeEarningsMoved`, new in `lib/payees.js`: once per account, plus the studio's security alert). The answer
   carries `keptEach`; the audit reads "each episode's earnings kept with whoever uploaded it (N pinned)". The Owner
   card asks the earnings question for such a show too ("Keep them where they are — Each episode keeps paying whoever
   uploaded it. Episodes the new owner adds pay the new owner."), its toast says so, and its note is now "They get its
   page in Creator Studio. Who uploaded each episode stays the same." The Creators roster's `keep` is now true as
   sent.
3. **The ad-share self-dealing guard checked the uploader only** (`pages/api/house-ads/impression.js`). A signed-in
   viewer who is the title's paid account (`payeeOf` on its columns), whoever runs it or whoever uploaded it earns no
   ad share from their own plays; the advertiser's impression still counts.
4. **Moves and place edits moved money without the full-admin rule or a word to anyone.** A cross-show move whose
   payee changes is refused for a sub-admin ("That moves its earnings to another account. A full admin does this.",
   403) unless they run both shows; `pages/api/admin/edit-episode.js` refuses the same before anything is written. A
   move or edit that does go through tells the account that stopped being paid and mails the security alert, as a
   pick does.
5. **A sub-admin picked as a payee could be demoted** (`pickPayee`). A sub-admin is never granted Creator Studio: a
   full admin gets 409 `team-account` ("… is on the team as a sub-admin, and a sub-admin can’t be paid for titles."),
   a creator gets the ordinary no-Creator-Studio line. The grant now happens only after the busy check, the daily
   limit and a successful insert, and a grant that fails withdraws the invite it was for.
6. **Accepting wrote the column before claiming the invite.** The claim (pending → accepted, guarded) comes first;
   the column write follows, guarded on what was read; when it misses, the claim is put back (accepted → pending).
   A put-back that fails leaves an accepted invite and nothing moved — never money on a withdrawn invite.

**Who learns what**

7. **The picker could tell whether an email has an account.** A creator gets one 404 for an email no account has
   verified and for an account without Creator Studio ("We can’t invite that address: no Creator Studio account has
   it verified."); full admins still get the two apart. Every lookup counts against a new 60-a-day limit per account
   (`payee-lookups`), before the address is resolved; the 20 invites a day stay. Handles keep their own lines (a
   handle is public).
8. **Viewer answers named the paid account.** `/api/episode-page` and the page's props carry `{ enabled: false,
   reason }` when there is no Tip button — no account id, and `isMaker` is gone everywhere (nothing read it). A public
   offer says only `forSale: false`; `blocked: 'payee-not-ready'` is kept for the Checkout's own line
   (`getOffer({ internal: true })`), and the runner still reads why through `/api/creator/pricing`'s `blocked`.
9. **Payout state, who was asked and who said no went to every contributor.** In a PayeeBlock, `notReady`,
   `pending` (and `line.pending`) and `lastAnswer` now go only to the runner, the team and the paid account itself —
   the same viewers as `history`.

**Smaller ones**

10. **Prices a contributor set before 3b** kept naming them. The daily cron (`/api/cron/creator-reminders`) now runs
    `realignPriceOwners()` (every `title_prices` row pointed at its title's runner, guarded on the value read;
    `priceOwners` in its answer), and the show page reads prices by title: `GET /api/creator/pricing?show=<id>` adds
    every price of that show and its titles for whoever runs it or a full admin (web room and app screen).
11. **The Sell modal said "You receive"** for a title that pays someone else. The web modal and the app sheet read
    the title's PayeeBlock and say "Pat Lee receives, per sale" / "Studio Tapa keeps it, per sale" (the house split,
    no studio-cut row), with the line under it to match; "You" when the viewer is paid, or with no answer.
12. **Ad-share notes for a payee paid twice in one month** spanned the other account's days. The range is now one
    label per run of days in a row ("Oct 15–19, Oct 26–31"); `scripts/test-ad-share.mjs` has the case.
13. **The app's Creator Studio switch stayed on** after the address changed. It resets on any edit, and Send is off
    while the switch is offered but not on (as on the web).
14. **The app kept stale state after a refusal.** The app's PayeeCard closes the sheet and reads the screen again on
    a 409 `pending | changed | answered | cancelled | locked | not-yet` (and on a failed Withdraw or Stop), hides
    Withdraw while the block is locked, and the three screens read `onChanged(null, null)` as "read again, no toast";
    Creator Studio in the app reads its cards again on any 409 or 404.
15. **"Stop getting it…" showed where the server refuses it.** `listMine` uses the server's own `lockLine` and sends
    `lockedLine`; web and app show that line in place of the link.
16. **A failed payee read took down the show page.** `getShowPage` catches `getPayeeBlock` like the editor does: the
    page opens, the Who gets paid card is hidden.

**Done the documented way**

17. **Extras stored with no `series_id`** (the submit flow files an extra under its show only through
    `bonus_parent_*`) are titles of their own for who gets paid: they pay, and are priced and picked for by, their
    uploader — as before 3b. The show's block now says so ("Its N extras are paid on their own: each pays whoever
    uploaded it, unless they choose someone else.") and an extra's own block says "It’s an extra, so it’s paid on its
    own, not by its show’s paid account." Making them follow the show would touch every lookup (`readPayeeContext`,
    the stamps' scopes, `loadTitle`, `getTitleRecord`, the cut-over, the repair, Your numbers) and the moves of their
    parent episodes; it is left for a decision.

**Suites changed for the new behaviour** (`pw/payees-http.js`): case 2's unknown email reads the one creator line;
case 8's public offer has no `blocked`; case 11 has no `isMaker` and no account on a house title; case 16 gives Dee
a ready payout account so the old-rule Tip button can show at all. New case 17 (17 checks): keep and move on a show
nobody ran, a sub-admin's move and Library edit refused, the sub-admin never granted, the one email answer, the
contributor's block, `lockedLine`, `?show=` and the cron's price realignment, and the four fail-closed paths with
`/__fail` (a new switch in the scratchpad's `fake-supabase-harvest.js`). `pw/payees.js` reads the Owner card's new
note and the one email line under the form. Re-run after the fixes: `payees-http` 114, `money` 24, `title-ids` 20,
`show-admin-http` 194, `api-post` 186, `editors` 98, `page` 104, `creator-path` 62, `walk1280` 35, `payees` 266,
`show-admin` 192 (all 3 parts), `payees-app-http` 43 — no failures; every `scripts/test-*.mjs`, check-refs and lint
clean; both app exports build.

**Still open:** an invite left `accepted` with nothing moved (a crash between the claim and the column write, or a
failed put-back) is not shown or re-offered anywhere; the extras question above; a pool view is still counted only
when the payee can be read (a failed read skips the credit, not the view).

---

## Jose's changes (2026-11-06)

Jose answered the slice 3b decisions on 2026-11-06. Two of them change code that was built and passing; this section
supersedes §1 item 7's "the episode page's Tip button (the paid account)", §2 row 12, §5.5 "Tips", the tip words of
§6.2 / §6.4 / §6.7, and "After the two reviews" item 17 (and the extras half of its "Still open").

### A. Tips go to the maker

**What changed.** The episode page's Tip button (website: the round Tip action in `pages/episode/[id].js` and the
full-screen player's Tip in `VideoPlayer`'s top row; app: `mobile/src/app/episode/[id].js` and its full-screen Tip
pill) tips the title's **maker** — `episodes.submitted_by`, whoever uploaded it — whatever account its other earnings
go to. It never reads who the title pays: `lib/episodePage.js` builds `tipping` from
`getTipping(episode.submittedBy, { viewerId })`, exactly as before 3b, so the button follows the maker's own tipping
state (payout account ready, a creator or admin role, not yourself, not suspended or blocked). `lib/tips.js` is back to
its pre-3b text (the `forTitle` option and the `'house'` reason are gone). Kept from the 3b reviews: with no Tip button
the answer is `{ enabled: false, reason }` with no account id (on `/api/episode-page` and the page props alike), and
`isMaker` appears nowhere. Unchanged: the pool-view credit on the episode page still goes to the **paid account**
(`payeeNowForEpisode`); the profile's Tip button is the profile's person; `/api/tips/checkout` tips the `creatorId`
the page sends, which is now the maker again. Consequences worth knowing: a title paid to the studio but made by a
creator shows that creator's Tip button; a title the studio's own (full admin) account uploaded shows a Tip button for
that account when it has a ready payout account (as before 3b); a failed read of the payee tables no longer hides the
Tip button (tips don't read them).

**Words.** Every sentence that said tips follow the paid account now leaves tips out or says where they go:
- `lib/payees.js` — the PayeeBlock's `notReady`: "… hasn’t set up payouts yet, so it can’t be bought until they do.
  Its earnings wait for them." (and "You haven’t set up payouts yet, so it can’t be bought until you do. …"); the
  invite body (Creator Studio's Get paid card and the email, web and app): "Its share of ad money and members’ support
  and its sales come to you from the moment you accept. What it earned before stays where it went. Tips on its page
  still go to whoever made it."
- `components/show/PayeeCard.js` and `mobile/src/components/show/PayeeCard.js` — the card's foot: "Its share of ad
  money and members’ support and its sales go to this account. What it already earned stays where it went. Tips on
  its page go to whoever made it."
- `pages/terms.js` section 5, **Which account a title pays.**: "What a title earns — its member share and ad share
  above and its sales (section 15) — goes to the account the title is attached to …; an extra filed under a show is
  attached the way the show’s episodes are. A change applies only to what the title earns after it, and credits and
  payments already made stay where they were made. Tips on a title’s page (section 16) go to whoever made the
  title." `TEXT_UPDATED` 2026-11-06.
- `legal/creator-share-terms-draft.md` — the 3b section carries the revised paragraph (dated), and question 8 reads
  "member share, ad share, sales — not tips, which always go to whoever made the title" and names the extras case.
- Checked and needing no change: Creator Studio's invite card (`pages/creator.js`, `mobile/src/app/creator/index.js`
  — they draw the server's `body`), the admin Owner card and its hand-over words, `SellTitleModal` /
  `SellTitleSheet`, the notification texts (none mentions tips).

### B. Extras follow their show

**The rule.** An extra (`content_type 'bonus'`) stored with `series_id` null and filed under a show only through
`bonus_parent_type` / `bonus_parent_id` now follows that show for who gets paid, from the cut-over on (before it,
`legacyPayeeOf` = the uploader, unchanged). The show its money follows = `series_id ??` (`bonus_parent_type ===
'series'` ? `bonus_parent_id` : the parent episode's `series_id`). Then `payeeOf(extra, show)` (its own `paid_to`,
else the show's `paid_to`, else the show's owner, else its uploader) and the runner `titleRunnerOf(extra, show)` = the
show's owner, who prices it and picks for it. **An extra of a standalone title** (no show anywhere up the chain — say
the extra of a film) is a title of its own and keeps paying its uploader, who runs it.

**One place for the resolution.**
- Pure, `lib/showRules.js` + `mobile/src/lib/showRules.js` (word for word): `extraParentOf(episode)` →
  `{ type: 'series' | 'episode', id } | null` (only a bonus row with no `series_id` and a parent) and
  `payeeShowIdOf(episode, parent = null)` → the show id or null (the parent must be the row the extra names).
  `scripts/test-show-rules.mjs` tests both on both copies (131 checks).
- Server, `lib/payees.js`: `payeeShowIds(rows, { known })` → `Map id → showId` (parent episodes read in bulk, rows
  already read reused); `anchoredExtras({ seriesIds, episodeIds })` (extras filed only through `bonus_parent_*` under
  those shows / episodes); `showTitleRows(seriesId)` (a show's episodes and every extra of it); `payeeShowOf(ctx, id)`
  (the show row from a payee context); `showExtraIds(seriesIds)` (Your numbers).

**Where it is used** (every payee path that took a show from `e.series_id`):
- `lib/payees.js` — `readPayeeContext` (carries `showOf`), `payeeAtFor`, `payeeNowForEpisode` (its `seriesId` is the
  show the money follows); `loadTitle` (an extra's show, and `episodes` = every title of the show, so the extra's
  uploader still reads its block); `getPayeeBlock` (the picker on an extra is the show runner's; the show's block no
  longer says "Its N extras are paid on their own…", an extra's no longer says "It’s an extra, so it’s paid on its
  own…"; the show's "paid elsewhere" notes now include an extra with a paid account of its own, "N more titles have
  their own paid account"); `withPayeeStamps` (a show scope takes every title of the show; an episode scope takes the
  extras filed under it; each title's before / predicted / actual payee is read through the show its money follows,
  patched parents included — so a show-level pick, acceptance, step-down and hand-over keep/move stamp the extras, and
  a parent episode's move stamps its extras); `paidForUser` / `paidEpisodeIds` (a show paid to you covers its extras);
  `payeeCutoverStep` (extras made before the cut-over whose payee moves from the uploader to the show's runner get
  their `[from, ∞)` row and one notice, like episodes; an extra of a standalone title is never stamped);
  `repairTitlePayees`, `realignPriceOwners` (an extra's price belongs to the show's owner).
- `lib/showAdmin.js setShowOwner` — `keep` on a show nobody ran pins the extras to their uploaders like the episodes;
  the hand-over withdraws the pending invites of every title of the show and moves every title's price to the new
  owner (extras included).
- `lib/showPage.js` — `getShowPage` reads the extras' payees through the context (the shelf's `paidTo` is the show's
  account), lets an extra's own paid account open the page read-only, and counts the extras for `seesWhoIsPaid`;
  `moveForViewer` — moving a parent episode to another show moves its extras' payee (stamped by `withPayeeStamps`,
  the losers told through `noticeEarningsMoved`), the sub-admin refusal ("That moves its earnings to another account.
  A full admin does this.") counts the extras once the rule is live, and when the runner changes the extras' pending invites are withdrawn
  and their prices follow.
- `pages/api/admin/edit-episode.js` — a change of `series_id`, `bonus_parent_*` or `content_type` that changes the
  show a title's money follows is stamped (`withPayeeStamps` with all four columns in the patch; the extras filed
  under a moved parent come along), counted in the sub-admin refusal, the losers told, and on a change of runner the
  title's and its extras' invites withdrawn and prices moved. (The creator's episode editor can only re-place an extra
  inside its own show, so its PATCH changes no payee.)
- `lib/purchases.js` — `getTitleRecord` (an extra's sale pays the show's account; its runner prices it; the fallback
  when the payee read fails resolves the show too); `getPricesForShow` (`?show=` lists the extras' prices).
- `lib/adShare.js` — `creditAdShare` and `creditAdShareBeforeDelete` through the context (`episodesOf` uses the
  resolved show); `lib/creatorShare.js` follows through `readPayeeContext` unchanged.
- `pages/api/house-ads/impression.js` — the self-dealing guard resolves an extra's show with the pure helpers.
- Your numbers — `pages/api/creator/analytics.js` (the show's runner sees its extras: `showExtraIds`; a show paid to
  you covers its extras through `paidEpisodeIds`), `pages/api/creator/episode-detail-analytics.js` (owns = the show
  the money follows); `pages/api/creator/my-submissions.js` (`canPrice` on an extra = its show's runner).
- `supabase/health_check.sql` — "Payee rows out of step" resolves an extra's show the same way (a left join on the
  parent episode), so extras don't all read as out of step. Proved on PGlite: the scratchpad's
  `s3b/check-payee-writes-pg.mjs`, 28 checks (3 new: extras under a show and after an episode in step, out of step
  when the show's account changes, the standalone film's extra).
- **The show page's Extras shelf gets "Sell…" / "Price and sales"** for whoever runs the show on a live extra
  (`components/show/ShowCards.js` `ExtrasShelf`, the app's extra sheet in `mobile/src/app/creator/show/[id]/index.js`
  through `withSell`). Not asked for in so many words, but without it a contributor's extra could only be priced by a
  full admin: its uploader no longer runs it, and Your work lists only your own uploads.

### Tests

`pw/payees-http.js` (146): case 11 — the Tip button on Ad Night (Dee's upload, paid to Pat) tips **Dee** and its
Checkout's destination is `acct_dee`; a title paid to the studio but made by Pat shows Pat's Tip button; the studio's
own upload with no payout account shows none and names no one. Case 17 (title_payees failing) — the Tip button
doesn't read the payee tables (a maker with payouts keeps it). Case 16 — the maker before 118 as after. New case 18 —
an extra under the show and one after its episode (series_id null, uploaded before the cut-over by a contributor): the
cut-over stamps both to the show's runner and tells the uploader once; October's ad share splits Oct 3 → uploader,
Oct 20 → the show's account; the extra's block is the runner's to pick, the uploader reads it and is refused; the
show page's shelf pays the show's account; a show-level acceptance stamps the extras; the runner prices the extra (the
uploader can't), `?show=` lists it, its sale pays the show's account (`acct_pat`); moving the parent episode moves the
extra's payee (stamped `move:`, the old payee told); a sub-admin's move and Library edit that would move only an
extra's earnings are refused; a full admin's Library re-file of an extra under another show is stamped `edit:`; an
extra of a standalone film keeps its uploader; the health check's rule and the daily repair agree; Your numbers for
the runner and the show's paid account; the impression guard. `pw/payees.js` and `pw/payees-app-http.js` read the new
sentences.

### Decided by the builder, and still open

- **The Extras shelf's "Sell…"** (web and app) is new UI, added so a contributor's extra can still be priced by the
  show's runner (above). Say if it should go.
- **Notes**: the show block's count line now reads "N more titles have their own paid account" (extras with a paid
  account of their own are listed with the episodes).
- ~~**Still open — a parent episode removed on its own**~~ — closed by the reviews (below): the extras are filed
  under the show before their parent goes. (The note was also wrong: the change was retroactive for every extra
  without a history row, and the repair never saw it.)
- **Still open — the Move sheet's line** ("Future earnings go to …") names only the moved episode's own new payee;
  when its extras' payee changes too (they follow the show) the sheet doesn't say so, though the move stamps them and
  tells the account that stops being paid.
- Before 118 nothing here changes (every lane reads the old rule; extras pay their uploader as they always did).

### After the reviews (2026-11-06)

Two reviewers read the change above; seven findings, all checked against the code and the stand-ins.

1. **A parent episode deleted on its own** (`pages/api/admin/resolve-deletion.js`) — real. The extras filed after it
   resolved to no show once it was gone and paid their uploaders, back to the cut-over for every instant without a
   history row (an extra made after the cut-over has none), with no record and no notice. **Fixed:** before the
   delete, `refileExtrasUnderShow([row])` (new, `lib/payees.js`) files those extras (`series_id` null,
   `bonus_parent_type 'episode'`, this parent) under the show itself (`bonus_parent_type 'series'`,
   `bonus_parent_id` = the old `series_id`), so who they pay, who runs them and their prices don't move and nothing
   needs stamping; a failed move answers 503 `extras` and deletes nothing; the audit line says "N extras filed after
   it are now filed under its show"; the answer carries `extrasRefiled`. A parent with no show (a film) leaves its
   extras alone: they paid their uploader before and after. (This is the "moved under the show" answer to the
   question the builder left open; say if they should go with their parent instead.)
2. **A show removed while only an extra kept for its buyers** (`lib/showRules.js cascadePlan`, `lib/showDelete.js`) —
   real. `keptInShow` counted only rows with the show's `series_id`, so a kept extra filed through
   `bonus_parent_*` let the show row be deleted and the extra fell back to its uploader. **Fixed:** a kept extra
   filed under the show or after one of its episodes keeps the show (withdrawn) like a kept episode (both copies of
   the rules, word for word; `scripts/test-show-rules.mjs`: the old "the show itself can go" case now keeps it, plus
   the database shape and an extra of another show that never holds it); and `deleteShowCascade` files a kept
   extra whose parent episode is deleted under the show first (`refileExtrasUnderShow`).
3. **A Library edit that changes the extras' show while the title's own doesn't** (`pages/api/admin/edit-episode.js`)
   — real (re-filing a show's episode as an extra of the same show left the extras after it no show, unstamped, past
   the sub-admin refusal). **Fixed:** the extras after a non-bonus episode are compared on their own — their show
   before is the episode's `series_id`, after it the patched one — so any change of it reads them, goes through
   `withPayeeStamps` (which already predicted them through the patched parent), counts in the sub-admin refusal,
   tells whoever stops being paid, and moves their invites and prices by their own runner before and after. (The
   rule itself is unchanged: an extra follows its parent's `series_id`; re-filed that way they now pay their
   uploaders from the edit on, recorded.)
4. **The creator's old edit route** (`pages/api/creator/edit-submission.js`) — real: moving a pending episode out of
   another person's show carried the extras after it (others' approved, earning titles) into the mover's show.
   **Fixed:** as on the show page (`canMoveTo`), a creator carries along only extras they run
   (`titleRunnerOf(extra, the source show) === them`), else 403 `extras` "Extras filed after it would move with it,
   and they aren’t yours to move. Ask an admin."; a full admin's move takes them, tells whoever stops being paid
   (the extras' own changes only) and moves their invites and prices to a new runner.
5. **The tips sentence on a show's card and a show's invite** — real: "Tips on its page…" read as the show's tips,
   and a show has no Tip button. **Fixed:** `payeeTipsLine(titleType)` (new, both copies of `lib/showRules.js`,
   tested): a show → "Tips on its episodes’ pages go to whoever made each one."; a title → "Tips on its page go to
   whoever made it." Used by `components/show/PayeeCard.js`, `mobile/src/components/show/PayeeCard.js` and
   `lib/payees.js inviteBody` (Creator Studio's Get paid card and the email). The invite line lost its "still".
6. **The app's extra sheet put Sell… after the red Remove…** (`mobile/src/app/creator/show/[id]/index.js`) — real.
   **Fixed:** Remove… sits after a divider (only when it's there), so `withSell` puts Sell… before it, as on the
   episode rows.
7. **Tests** — real gaps. **Added:** case 11 checks `tipping.creatorName` ("Dee Marsh", never Pat's; "Pat Lee" on
   the studio-paid title); a new case 19 in `pw/payees-http.js` (Rae's shows, UP's extras made after the cut-over,
   who-was-paid read on Oct 20 and 25 through a small loader, `s3b/loader/run-payeeon.mjs`): a parent deleted on its
   own (the extra re-filed, still Rae on both days, no history row, the audit line), the same-show re-file as an
   extra (a sub-admin refused; a full admin's stamped Rae → UP `edit:`, Rae told, both days still Rae), the old
   creator route refused with `extras`, and a show removed while only an extra after a deleted episode is bought
   (show withdrawn and kept, the extra filed under it, still Rae). `pw/payees.js`: the show card's and the series
   invite's new tips line, an extra on the fixture show (a contributor's, filed under the show) whose shelf menu
   offers the runner Sell… and opens the Sell modal, and a new part 8 — the episode page's round Tip action reads
   "Tip Dee" (title "Tip Dee Marsh") on Dee's episode paid to Mara's show, at 1280 and 390.
   `pw/payees-app-http.js`: the card source and the app rules' `payeeTipsLine`, the episode invite's line, and 5b —
   a Bearer read of `/api/episode-page` names the maker (Uri, by id and name), not the show's account.

Files: `lib/showRules.js`, `mobile/src/lib/showRules.js`, `scripts/test-show-rules.mjs`, `lib/payees.js`,
`lib/showDelete.js`, `pages/api/admin/resolve-deletion.js`, `pages/api/admin/edit-episode.js`,
`pages/api/creator/edit-submission.js`, `components/show/PayeeCard.js`, `mobile/src/components/show/PayeeCard.js`,
`mobile/src/app/creator/show/[id]/index.js`; scratchpad `pw/payees-http.js`, `pw/payees.js`,
`pw/payees-app-http.js`, `s3b/loader/run-payeeon.mjs`.

**Verified** (2026-11-06): check:refs, lint, all 26 `scripts/test-*.mjs` (show rules 131 on both copies), the
PGlite proof (`s3b/check-payee-writes-pg.mjs`, 28 — `health_check.sql` is unchanged by the reviews), both app
exports, and through the runner (`final/summary-3bf-fix.log`): payees-http 157, payees-app-http 46, money 24,
title-ids 20, show-admin-http 194, api-post 186, show-data 177, creator-path 62, end-card 53, episode-after 26 — all
0 failed; the browser suite (`final/summary-3bf-fix-payees.log`) 283 ok, 0 failed after two test-only fixes (part 8
gives Dee fake Clerk's creator role, and reads the 390 label case-blind); its first run also had one Google Fonts
CORS console line on Quinn's Your work that did not come back.

**Still open.** The Move sheet's "Future earnings go to …" names only the moved episode's payee, not its extras'
(the move stamps them and tells whoever stops being paid). `/admin/test-content` deleting a single episode still
leaves the extras after it with no show — as before, that tool settles nothing (no ad share, no invites either);
it is for placeholders. A creator's re-filed extra (item 1 and the cascade) isn't told its place moved from "after
E3" to the show's own shelf — nothing it earns changes.

