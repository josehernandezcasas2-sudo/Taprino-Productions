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
