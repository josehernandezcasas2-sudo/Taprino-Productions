// Messages: the words, the small rules and the shapes both the website
// (pages/messages) and the app (mobile/src/app/messages) draw from. Pure,
// no imports: the app's mobile/src/lib/messageRules.js is this file word for
// word (node scripts/test-message-rules.mjs). lib/messages.js (server) takes
// MAX_MESSAGE_CHARS and CONTEXT_KINDS from here.
//
// The simpler Messages (Jose, 2026-11-18, the canvas
// https://claude.ai/artifact/SgXAPeJijp7A1EzSQckyhf: "I like that design …
// let's build"; "keep All and Unread"; "note down what it's from, ie, a
// production, just a chat, or from somewhere else that it can link back
// to … producer and users can contact each other through project … it keeps
// it private to a degree"): every conversation says what it is about and,
// where there is something to go back to, links to it.

export const MAX_MESSAGE_CHARS = 2000;

// What a conversation can be about. A thread keeps the latest one it was
// given. `production`: started from a production's page, between people on
// that production only (lib/messageContext.js checks). None = a direct
// message (started from New message).
export const CONTEXT_KINDS = ['card', 'gear', 'call', 'profile', 'location', 'production'];

// The kicker on the card at the top of a conversation.
export const CONTEXT_LABELS = {
  gear: 'About gear',
  call: 'About a call',
  card: 'From a working card',
  profile: 'From a profile',
  location: 'About a place',
  production: 'About a production'
};

export const MESSAGE_WORDS = {
  title: 'Messages',
  newMessage: 'New message',
  search: 'Search messages',
  all: 'All',
  unread: 'Unread',
  direct: 'Direct message',
  muted: 'Muted',
  you: 'You: ',
  newConversation: 'New conversation',
  emptyTitle: 'No messages yet',
  emptyLine: 'Conversations start from a working card, a piece of gear, a call, a place or a production, so you always know why someone wrote.',
  findPeople: 'Find people on Crew Call',
  writeTo: 'Write to someone you know',
  noMatches: 'Nothing matches that.',
  noUnread: 'You’re all caught up.',
  back: 'Back to messages',
  more: 'More',
  viewProfile: 'View profile',
  mute: 'Mute',
  unmute: 'Unmute',
  muteLine: 'No emails or badge for this conversation',
  block: 'Block',
  unblock: 'Unblock',
  report: 'Report this conversation',
  reportLine: 'The last messages go to Studio Tapa with it.',
  reportPick: 'Pick a reason',
  reportSend: 'Send report',
  cancel: 'Cancel',
  send: 'Send',
  to: 'To:',
  toPlaceholder: 'Name or @handle',
  productions: 'People on your productions',
  following: 'Following',
  searching: 'Looking…',
  nobody: 'Nobody by that name or @handle.',
  typeMore: 'Type at least two letters.',
  pick: 'Pick a conversation.',
  notHere: 'That conversation isn’t here.',
  signIn: 'Sign in to see your messages. Anyone with an account can write to anyone on Crew Call.',
  youBlocked: (name) => `You blocked ${name}.`,
  theyBlocked: 'This person isn’t taking messages right now.',
  sayHello: (first) => `Say hello to ${first}.`,
  placeholder: (first) => `Message ${first}…`,
  blockConfirm: (name) => `Block ${name}? They can’t message you and won’t see your card. You can undo this here.`,
  mutedToast: 'Muted. No emails or badge for this conversation.',
  unmutedToast: 'Unmuted.',
  blockedToast: 'Blocked.',
  unblockedToast: 'Unblocked.',
  reportedToast: 'Reported to Studio Tapa. The last messages went with it.',
  nextAbout: 'Your next message is about',
  dropAbout: 'Not about this'
};

const text = (v) => (typeof v === 'string' ? v.trim() : '');

// The first word of a name, for "Message Dee…" and "Say hello to Dee."
export function firstName(name) {
  const n = text(name);
  return n ? n.split(/\s+/)[0] : 'them';
}

// One line under a conversation in the list: what it is about.
export function contextLine(context) {
  if (!context || !CONTEXT_LABELS[context.kind]) return MESSAGE_WORDS.direct;
  const label = text(context.label);
  return label ? `${CONTEXT_LABELS[context.kind]} · ${label}` : CONTEXT_LABELS[context.kind];
}

const ID = /^[A-Za-z0-9_-]{1,80}$/;

// Where a conversation's subject lives, to go back to it. `other` is the
// person on the other side ({ profilePath }): gear and a working card live
// on their profile. A profile-started conversation needs no link (the
// header already opens the profile); a direct message has nothing to link.
export function contextLink(context, other) {
  if (!context) return null;
  const id = text(context.id);
  const profile = other && typeof other.profilePath === 'string' && other.profilePath.startsWith('/') ? other.profilePath : null;
  switch (context.kind) {
    case 'call': return ID.test(id) ? { href: `/crew/calls/${id}`, label: 'Open the call' } : null;
    case 'location': return ID.test(id) ? { href: `/locations/${id}`, label: 'Open the place' } : null;
    case 'production': return ID.test(id) ? { href: `/productions/${id}`, label: 'Open the production' } : null;
    case 'gear': return profile ? { href: profile, label: 'See their gear' } : null;
    case 'card': return profile ? { href: profile, label: 'See their card' } : null;
    default: return null;
  }
}

// The two filters, and the search box over names, @handles, the last line
// and what it is about.
export const FILTERS = ['all', 'unread'];
export function filterThreads(threads, { filter = 'all', query = '' } = {}) {
  const list = Array.isArray(threads) ? threads : [];
  const q = text(query).toLowerCase().replace(/^@/, '');
  return list.filter((t) => {
    if (filter === 'unread' && !t.unread) return false;
    if (!q) return true;
    const other = t.other || {};
    const hay = [other.displayName, other.handle, t.preview, t.context && t.context.label].map((v) => text(v).toLowerCase()).join('\n');
    return hay.includes(q);
  });
}

export function unreadCount(threads) {
  return (Array.isArray(threads) ? threads : []).filter((t) => t && t.unread).length;
}

export function filterLabel(filter, threads) {
  if (filter === 'unread') {
    const n = unreadCount(threads);
    return n ? `${MESSAGE_WORDS.unread} · ${n}` : MESSAGE_WORDS.unread;
  }
  return MESSAGE_WORDS.all;
}

// The empty line under the list when the search or filter leaves nothing.
export function emptyFilterLine(filter, query) {
  if (text(query)) return MESSAGE_WORDS.noMatches;
  return filter === 'unread' ? MESSAGE_WORDS.noUnread : MESSAGE_WORDS.emptyTitle;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

export function clockTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h % 12 || 12}:${m} ${h < 12 ? 'AM' : 'PM'}`;
}

// The time on a row of the list: the clock today, the weekday this week,
// else the date.
export function listTime(iso, now = Date.now()) {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return '';
  const today = startOfDay(new Date(now));
  const day = startOfDay(d);
  if (day === today) return clockTime(iso);
  if (today - day < 6 * 86400000 && day < today) return DAYS[d.getDay()];
  return d.getFullYear() === new Date(now).getFullYear() ? `${MONTHS[d.getMonth()]} ${d.getDate()}` : `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

// The label over a day of messages.
export function dayLabel(iso, now = Date.now()) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const today = startOfDay(new Date(now));
  const day = startOfDay(d);
  if (day === today) return 'Today';
  if (day === today - 86400000) return 'Yesterday';
  if (today - day < 6 * 86400000 && day < today) return `${DAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`;
  return d.getFullYear() === new Date(now).getFullYear() ? `${MONTHS[d.getMonth()]} ${d.getDate()}` : `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

const RUN_GAP_MS = 5 * 60 * 1000;

// A conversation's messages by day, oldest first. Each message carries
// `mine` and `time`: the clock under the last message of a run (the same
// sender, under five minutes apart), '' elsewhere.
export function dayGroups(messages, viewerId, now = Date.now()) {
  const list = (Array.isArray(messages) ? messages : []).filter((m) => m && m.createdAt);
  const groups = [];
  list.forEach((m, i) => {
    const label = dayLabel(m.createdAt, now);
    let group = groups[groups.length - 1];
    if (!group || group.label !== label) {
      group = { key: `${label}-${m.id || i}`, label, items: [] };
      groups.push(group);
    }
    const next = list[i + 1];
    const endsRun = !next || next.senderId !== m.senderId || dayLabel(next.createdAt, now) !== label || Date.parse(next.createdAt) - Date.parse(m.createdAt) > RUN_GAP_MS;
    group.items.push({ ...m, mine: Boolean(viewerId) && m.senderId === viewerId, time: endsRun ? clockTime(m.createdAt) : '' });
  });
  return groups;
}

// A conversation opened from somewhere with a new subject (a production's
// page, a place) on a thread that already exists: the composer says the
// next message is about it, and it goes with that message.
export function pendingAbout(context) {
  if (!context || !CONTEXT_LABELS[context.kind]) return null;
  const label = text(context.label);
  return label ? `${MESSAGE_WORDS.nextAbout} ${label}` : null;
}

// The people search on New message: two letters at least; a leading @ is
// the handle.
export function peopleQuery(raw) {
  const q = text(raw).slice(0, 60);
  const bare = q.replace(/^@+/, '');
  return { q: bare, handle: q.startsWith('@'), ready: bare.length >= 2 };
}

// A person's second line on New message.
export function personLine(person) {
  if (!person) return '';
  const bits = [];
  if (text(person.handle)) bits.push(`@${text(person.handle)}`);
  if (text(person.why)) bits.push(text(person.why));
  return bits.join(' · ');
}
