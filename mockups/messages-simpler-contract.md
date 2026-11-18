# Messages, simpler — build agreement (2026-11-18)

Jose signed off the canvas https://claude.ai/artifact/SgXAPeJijp7A1EzSQckyhf
("I like that design and choice, let's build"), with three answers:

1. A conversation is **full screen on a phone** (no site header, no bottom bar).
2. **New message** searches people **by name or @handle**, and suggests people.
3. Filters: **All** and **Unread** only. And every conversation **says what it
   is from** — a production, just a chat, or somewhere else — and **links back**
   to it. "Producer and users can contact each other through project, but users
   can see it through the message. It keeps it private to a degree."

The boards' markup (exact colours and sizes) is in the session scratchpad:
`/tmp/claude-0/-home-user-Taprino-Productions/7fff803f-6183-5d77-9149-e0c8a3c64074/scratchpad/msgmock/project/*.dc.html`
(Inbox, Thread, ThreadMenu, NewMessage, Empty, Laptop; Main is today's page).

## Done already (do not change; report if something must)

- **`lib/messageRules.js`** — pure, no imports; the app's
  `mobile/src/lib/messageRules.js` is the same file word for word
  (`node scripts/test-message-rules.mjs`). Every word, label, filter, time and
  grouping the screens show comes from it: `MESSAGE_WORDS`, `CONTEXT_LABELS`,
  `contextLine(context)`, `contextLink(context, other)` → `{ href, label }` or
  null, `FILTERS`, `filterThreads(threads, { filter, query })`, `filterLabel`,
  `emptyFilterLine`, `unreadCount`, `listTime(iso)`, `dayLabel`, `clockTime`,
  `dayGroups(messages, viewerId)` → `[{ key, label, items: [{ …message, mine,
  time }] }]` (time = '' except under the last message of a run),
  `pendingAbout(context)`, `peopleQuery(raw)`, `personLine(person)`,
  `firstName(name)`, `MAX_MESSAGE_CHARS`.
- **Context kinds**: card, gear, call, profile, location, **production**; none =
  a direct message. A thread keeps the latest subject it was given.
- **`lib/messageContext.js` `resolveContext(me, other, { kind, id|ref, label })`**
  → `{ context }` or `{ refused }`: production, call and location are read by
  id (the real title; a production only when both people are on it — its owner
  or its crew list — else refused). `sendMessage` runs it.
- **API** (all signed in; the app sends its Bearer token):
  - `GET /api/messages` → `{ threads, unread }`; a thread:
    `{ id, other: { userId, displayName, handle, avatarUrl, avatarPosition, avatarZoom, profilePath }, context: { kind, label, id? } | null, lastMessageAt, preview, lastSenderId, unread, muted }`.
  - `GET /api/messages/<id>[?since=iso]` → `{ thread: { id, other, context, muted, iBlocked, blockedMe }, messages: [{ id, senderId, body, createdAt }] }` (only `{ messages }` with since).
  - `POST /api/messages` `{ toUserId, body, context? }` → `{ threadId, message }` (201).
  - `POST /api/messages/<id>` `{ body, context? }` → `{ threadId, message }` — **new: `context`** carries a subject brought from a page onto an existing thread.
  - `PATCH /api/messages/<id>` `{ muted }`; `POST /api/messages/block` `{ userId, blocked }`; `POST /api/messages/report` `{ threadId, reason }` (reasons: `lib/reportReasons.js` `REPORT_REASONS`; the app has its own copy in the thread screen).
  - **New: `GET /api/messages/people`** → `{ productions: [person], following: [person] }`; `?q=` (two letters at least; a leading @ = the handle only) → `{ people: [person] }`; person = `{ userId, displayName, handle, avatarUrl, avatarPosition, avatarZoom, profilePath, why }` (`why` = the production's title for the productions list). 401 signed out, 429 past 60 a minute.
  - A 403 from a send with a production context says `Only people on this production can message each other from it.` — show it like any send error.

## What each side builds

### Addresses (website; the app mirrors with its routes)
- `/messages` — the inbox. `/messages/<threadId>` — a conversation.
- `/messages?to=<userId>[&kind=<kind>&ref=<id>&label=<text>]` — start one.
  getServerSideProps resolves the subject with `resolveContext(viewer, to, { kind, id: ref, label })`
  (refused → the line shown where the composer would be). When a thread with
  that person already exists, redirect to `/messages/<threadId>?kind=&ref=&label=`
  (keep them only when a kind was given); that page resolves the same way and
  the composer shows **`pendingAbout(context)`** above it with an × (**dropAbout**);
  the next send passes `context: { kind, id, label }` and the chip goes away.
  A pending subject is never kept anywhere but the page.

### The inbox (phone and laptop list pane)
- Title row: `<h1>` "Messages" (Fraunces 28 bold) + a round orange **New message**
  button (44px, pencil icon, `aria-label`).
- Search box (`MESSAGE_WORDS.search`; **16px text** — iOS zooms on smaller) and the
  two chips (`filterLabel`, `aria-pressed`), filtering with `filterThreads`.
- Rows (flat list, 1px dividers): the person's photo (focal point + zoom, as
  every avatar), name (bold 700 when unread), `listTime`, the last line (Fraunces,
  "You: " when `lastSenderId` is the viewer, `MESSAGE_WORDS.newConversation` when
  empty; ink when unread, dim otherwise), an unread dot, a bell-off icon when
  muted, and **`contextLine(context)`** under it with a small icon tinted by kind
  (call brass, gear gold, location mint, production sky `#8499dc`, card/profile
  and direct dim).
- No conversations at all → the empty card (`emptyTitle`, `emptyLine`, **Find
  people on Crew Call** → `/crew`, **Write to someone you know** → New message).
  A filter or search that leaves nothing → `emptyFilterLine`.

### A conversation
- **Phone (under 900px wide): full screen** — no site header, no bottom bar, no
  footer. Its own top row: back (`MESSAGE_WORDS.back` → the inbox), the photo +
  name + `@handle` (→ their profile), ⋯ (`MESSAGE_WORDS.more`).
- The **subject card** under the top row when there is a context: the kicker
  `CONTEXT_LABELS[kind]`, the label, and `contextLink` → "Open the call ›" etc.
  (a link only when `contextLink` gives one).
- Messages by `dayGroups`: a day label, bubbles (theirs `surface-2` on the left,
  mine brass with dark text on the right, max ~78% wide), the time under each run.
  The newest stays in view; polling as today (10 s open conversation, 30 s inbox).
- Composer: a rounded multi-line box (grows to about six lines, **16px text**,
  `maxLength` `MAX_MESSAGE_CHARS`, placeholder `MESSAGE_WORDS.placeholder(firstName)`),
  a round send button (brass when there is text, muted when empty). On a
  keyboard-and-mouse screen Enter sends and Shift+Enter is a new line; on a
  touch screen Enter is a new line. A small count shows within 200 of the limit.
  Blocked: `youBlocked(name)` + Unblock, or `theyBlocked`, in place of it.
- **⋯** = a bottom sheet on a phone, a small menu on a laptop: View profile,
  the subject's link (when there is one), Mute/Unmute (with `muteLine`),
  Block/Unblock (`blockConfirm` first), Report (reasons, then Send report).
  Toasts with the words in `MESSAGE_WORDS`.

### New message
- A sheet from the bottom on a phone (most of the screen), a centred dialog on a
  laptop. "New message" + × ; the **To:** box (`toPlaceholder`, 16px); empty →
  `GET /api/messages/people` → two lists, **People on your productions** (`personLine`
  shows @handle · the production) and **Following**; typing two letters or more →
  `?q=` (wait ~250 ms after typing stops; one request at a time; the newest
  answer wins); nothing → `nobody`. A tap opens `/messages?to=<userId>` (no kind:
  a direct message, or the existing conversation). **Find people on Crew Call**
  at the bottom. Escape / × / the dimmed area close it; the page behind never moves.

### Laptop (900px and up)
- The site header stays; under it **two panes fill the window** (the list 380px,
  the conversation the rest), each scrolling on its own, **no footer** on these
  pages. No conversation open → "Pick a conversation." in the right pane.

### Production pages (website `pages/productions/[id]/index.js`, app `mobile/src/app/productions/[id]/index.js`)
- Signed in and on the production: the owner gets **Message** on each crew row
  that isn't them; a crew member gets **Message the producer** (next to "Take me
  off this" on the website). Both open
  `/messages?to=<userId>&kind=production&ref=<productionId>` (app:
  `/messages/new` with those params, or the existing thread — see below).
- The place page's "Ask about a date" adds `&ref=<listing id>` (website
  `pages/locations/[id].js`, app `mobile/src/app/locations/[id].js`).

### The app
- `mobile/src/app/messages/index.js` (inbox) and `[id].js` (conversation; `new`
  starts one) rebuilt to the same design from the same rules; the conversation
  screen is full screen (no TopNav, and the bottom bar hidden on
  `/messages/<anything>` — `BottomNav` already hides itself on two paths, add this
  one); New message as a `Modal` sheet (`supportedOrientations`); ⋯ as a sheet.
- `/messages/new?to=&kind=&ref=&label=`: if the inbox already has a thread with
  `to`, open `/messages/<threadId>` with `kind/ref/label` as the pending subject;
  otherwise compose. The pending chip and the send's `context` work as on the
  website.
- `hrefToRoute` already maps `/messages` and `/messages/<id>`.

## Rules that bite
- `useAuth` only from `mobile/src/lib/stableAuth.js`.
- Text fields on a phone are 16px or more.
- A panel that can outgrow the screen scrolls inside itself (`lib/menuScroll.js`
  `keepScrollInside` on the website).
- Every avatar honours `avatarPosition` + `avatarZoom` (website `AvatarPhoto`
  / `CrewBits` `Avatar` with `position`/`zoom`; app `PositionedImage` / `Avatar`).
- Pages import only client-safe modules (`lib/messageRules.js` is one;
  `lib/messages.js`, `lib/messageContext.js` and `lib/messagePeople.js` are
  server-only and go in getServerSideProps only).
- Never name a CSS class `cl-…` (Clerk's prefix). New website classes: `.dm2-*`.

## As built
(each builder adds its notes here: what changed, anything that differs, what
was verified and what wasn't)

### As built — website (2026-11-18)

**Files.** `pages/messages/[[...id]].js` rewritten (inbox, conversation,
New message, ⋯, empty states, the subject chip); a `.dm2-*` block in
`styles/globals.css` just before "No zoom when a field is tapped" (the old
`.dm-*` rules stay: `/admin/messages` uses some); `pages/productions/[id]/index.js`
(the owner's **Message** on each crew row that isn't them, inside the
existing row actions; a crew member's **Message the producer**, now in one
`.crew-actions` row with "Take me off this"); `pages/locations/[id].js`
("Ask about a date" carries `&ref=<listing id>`); the check
`dev/test-rig/checks/messages-simpler.mjs` (`SHOTS=<dir>` keeps a screenshot
of each screen).

**How it hangs together.** getServerSideProps resolves `?kind=&ref=&label=`
with `resolveContext` (a new conversation → the subject card, or the refused
line in place of the composer; an existing one → `pending` for the chip, or
the refused line above a composer that still works — the conversation itself
is allowed). A subject the thread is already about shows no chip. A send with
the chip passes `context`, then the address goes back to `/messages/<id>`
(shallow). The header and the tab bar sit in `display: contents` wrappers
(sticky still works, checked) that hide under 900px while a conversation is
open; the conversation is then `position: fixed` over the visual viewport
(`--dm2-vvh` / `--dm2-vvt`, so a phone's keyboard comes off it). From 900px
the page is a 380px + rest grid, `100dvh − --header-h` tall (minus the
floating tab bar's 90px from 900 to 1180), so nothing scrolls but the panes.
No footer for a signed-in visitor at any width; the signed-out card keeps it.

**Differs from the agreement.** Block's confirm is a step inside the ⋯
sheet/menu (no `window.confirm`); Mute and Report show only on a conversation
that exists (not while composing); ⋯'s first row is `MESSAGE_WORDS.viewProfile`
(the board said "View Dee's profile"); the laptop's top row also has the
board's View profile pill; "That conversation isn't here." is a note above the
inbox, not a full-screen page; "Say hello" is hidden while there's no
composer; times and day labels are drawn once the page is in the browser (the
viewer's clock, no hydration mismatch); the search and To boxes are 16px on a
laptop too (the board had 14).

**Words not in the rules** (typed in the page): the signed-out button "Sign in
or create an account" (kept from the old page), the × aria-label "Close",
the fallbacks "Could not send that." / "Could not send that report." (only when
the server sends no line), "Messages couldn't load just now." (server); on the
production page "Message" and "Message the producer".

**Verified** on the rig: `messages-simpler.mjs` 128 ok, 0 FAIL (API, inbox at
390/1280, full-screen conversation at 390 and 320, two panes at 1280 and the
tab bar at 1000, Enter / Shift+Enter / touch Enter, growth and the count, ⋯
sheet and menu with mute on/off and the block confirm against the database,
the production page's links → redirect → chip → saved context → subject card,
the chip's ×, refused page + API, New message suggestions / name / @handle /
nobody / new and existing conversations / Escape / dimmed area / the page not
moving, the empty inbox, signed out, no sideways scroll at 320/390/1280, no
page errors); `check:refs`, `lint`, `test-message-rules.mjs`,
`test-sign-in-here.mjs`, `menu-rows.mjs` (24). **Not verified**: a real
phone's keyboard against the visual-viewport sizing, iOS Safari, Clerk's real
sign-in box (the rig doesn't load it), `next build`.

### As built — app (2026-11-18)

**Files.** `mobile/src/app/messages/index.js` (the inbox), `mobile/src/app/messages/[id].js`
(a conversation, and `new`), `mobile/src/components/messages/` — `MessageBits.js` (the
row, chips, search, New message button, empty card, person row, subject card, the
messages by day, the pending chip, the composer, the toast, `openHref` and
`startConversation`), `MessageIcons.js` (the boards' glyphs; `contextTint` = call brass,
gear gold, place mint, production sky, card/profile/direct dim), `MessageSheet.js` (the
bottom-sheet Modal: every orientation, its own inset provider, the keyboard padding the
window, a centred 560pt column from 600pt wide), `NewMessageSheet.js`,
`ThreadMenuSheet.js` (with the app's copy of `REPORT_REASONS`). `BottomNav.js` returns
null on `/^\/messages\/[^/]+/`. The production screen has **Message** on each crew row
for the owner (not their own) and **Message the producer** beside "Take me off this" for
crew; both go through `startConversation` → `/messages/new` with `kind=production`,
`ref`, `label` = the title. The place screen's Ask about a date sends `ref: l.id`.
`lib/messageRules.js` untouched; every word, label, time and grouping comes from it.

**Differs from the agreement, or adds to it.**
- `/messages/new` looks for the conversation itself (one `GET /api/messages`) and
  `router.replace`s to `/messages/<threadId>` with kind/ref/label, so every caller
  (production, place, card, gear, profile) gets the same path; New message in the inbox
  uses the inbox's own list and opens the conversation directly.
- No pending chip when the conversation is already about that subject (same kind and
  id, or same label without an id) — "Message the producer" on a production the thread
  is already about shows no "Your next message is about Night Bus".
- The app has no server-side resolve before the first send: a refused production
  subject shows its 403 line under the messages (the chip and the draft stay).
- After a send carrying a subject the conversation is read again so the subject card
  shows the server's title.
- ⋯ reads "Block Dee" / "Unblock Dee" (the board's), built from `MESSAGE_WORDS.block` +
  `firstName`; the confirm and the report reasons are steps inside the same sheet.
- The subject card's link reads `contextLink().label + ' ›'` ("Open the call ›"), under
  the label on a phone under 370pt wide.
- Back is `router.dismissTo('/messages')` (the inbox, as its label says); Android's back
  button still returns to wherever the conversation was opened from.
- **The keyboard**: `KeyboardAvoidingView behavior="padding"` on Android too (it was
  iOS only). Expo's SDK 58 keyboard guide: an Expo app is edge-to-edge on Android, the
  window no longer resizes, and a view without a behavior stays under the keyboard.
- Words not in the rules: the sign-in button ("Sign in or create an account" / "Sign
  in", as before), "Try again" after a failed first read, the production screen's
  "Message" / "Message the producer".

**Verified.** `check:refs`, `lint`, `test-message-rules.mjs`, `expo export` for iOS and
Android; a react-native-web harness of the real screen files against fixtures in the
routes' shapes (scratchpad `msg-harness/check.mjs`, 77 checks at 390, 320 and 844×390:
the rows and their words, tints and zoomed photo, All / Unread and the search, the bar
shown on the inbox and hidden on a conversation, the top row, subject card and its link,
days and run times, brass bubbles, the 16pt composer, the count, a send, Mute / Block
(confirm) / Unblock / Report (no reason, then spam), the 10 s poll, back to the inbox,
New message's lists, one-letter hint, debounce with one request at a time and the newest
answer winning, the @handle search, nobody, Escape, an existing person → their
conversation, a new person → compose → first send → replace, Crew Call; `/messages/new`
with a subject on an existing conversation → the chip, the send carrying
`{ kind, label, id }`, the card updating, × dropping it, a refused production subject;
the production screen as owner and as crew; signed out; empty; sideways sheet widths).
**Only a phone can show**: the keyboard on both platforms (Android's padding inside the
edge-to-edge Modal too), the multi-line box growing to six lines, the sheet slide over
the native stack, VoiceOver/TalkBack on the sheets, a Modal turning with the phone, and
the photo's focal point on a real image.
