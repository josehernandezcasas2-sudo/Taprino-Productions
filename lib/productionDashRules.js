// Productions from pitches, and the production dashboard (Jose, 2026-11-19,
// on the canvas https://claude.ai/artifact/Kx7ZjgzAsG4xBxYBws2QKN: "any
// approved pitch can become a production and continue getting funding, it
// does not have to have full funding of any kind", "one production per
// pitch, they should be tied with content", and who opens the dashboard:
// "the producer if listed, but the creator is the default"; the agreement
// is part B of mockups/productions-yearly-contract.md).
//
// Pure and client-safe, no imports: the app's
// mobile/src/lib/productionDashRules.js is this file word for word
// (node scripts/test-production-dash.mjs checks it). Every word, number,
// row and rule the website and the app draw for these screens is built
// here; the pages only lay it out:
//
//   who runs it        canManageProduction, canOwnProduction, isProducerRole
//   the dashboard      productionDashboard(facts) — GET /api/productions/<id>/dashboard
//                      answers { facts, … }; facts' shape is documented above
//                      productionDashboard below
//   Your productions   mineGroups, yoursCard, readyPitchCard — GET /api/productions/mine
//   the ☰ menu         runningLine (the menu card itself is lib/siteMenuRules.js)
//   the pitch page     pitchProductionCard, pitchOwnerAction, crewNeededHead
//   Your pitches       pitchBox
//   the start sheet    startSheet, kindFromTag, productionUpdate
//
// Nothing here moves money or decides who may see what on its own; the
// server (lib/productions.js, lib/productionDashboard.js) reads the same
// rules and enforces them.

/* ---------- who runs a production ---------- */

// A crew member whose role names a producer (Producer, Executive producer,
// Line producer, Co-producer…) runs the production with its owner.
export const PRODUCER_ROLE = /producer/i;
export function isProducerRole(role) {
  return typeof role === 'string' && PRODUCER_ROLE.test(role);
}

const memberUser = (m) => (m ? m.userId || m.user_id || null : null);

// Who runs it day to day: the owner (the pitch's creator by default), a
// listed producer (a crew row not taken off, with a producer role), and
// full admins. `members`: [{ userId | user_id, role, hidden }].
export function canManageProduction({ ownerId = null, members = [] } = {}, viewerId, { isAdmin = false } = {}) {
  if (isAdmin) return true;
  if (!viewerId) return false;
  if (ownerId && viewerId === ownerId) return true;
  return (members || []).some((m) => m && !m.hidden && memberUser(m) === viewerId && isProducerRole(m.role));
}

// What only the owner (and full admins) change: who sees it, archive and
// remove, the release link, the pitch link, and who else is a producer.
export function canOwnProduction({ ownerId = null } = {}, viewerId, { isAdmin = false } = {}) {
  if (isAdmin) return true;
  return Boolean(viewerId) && Boolean(ownerId) && viewerId === ownerId;
}

// The accounts that run it: the owner first, then the listed producers.
export function managerIds({ ownerId = null, members = [] } = {}) {
  const out = ownerId ? [ownerId] : [];
  for (const m of members || []) {
    const id = memberUser(m);
    if (m && !m.hidden && id && isProducerRole(m.role) && !out.includes(id)) out.push(id);
  }
  return out;
}

// The lines the server answers with when someone who runs a production
// tries something only its owner does.
export const MANAGE_WORDS = {
  notManager: 'Only the people running this production open its dashboard.',
  ownerOnly: 'Only the owner can change that.',
  ownerVisibility: 'Only the owner changes who sees the production or the project it grew out of.',
  ownerStatus: 'Only the owner archives or reopens the production.',
  ownerRelease: 'Only the owner can link the release.',
  producerOwnerOnly: 'Only the owner adds or removes a producer.',
  notTheOwnerRow: 'The owner’s own place on the crew list stays.',
  manageOnly: 'Only the people running this production can do that.'
};

/* ---------- statuses, kinds, small words ---------- */

export const STATUS_SHORT = { prep: 'Prep', shooting: 'Shooting', post: 'Post', released: 'Released', archived: 'Archived', removed: 'Removed' };
// Running: still being made. Done: out, or put away.
export const RUNNING_STATUSES = ['prep', 'shooting', 'post'];
export const DONE_STATUSES = ['released', 'archived'];
// A listed producer moves it between these; the owner can also archive.
export const MANAGER_STATUSES = ['prep', 'shooting', 'post', 'released'];

export function statusShort(status) {
  return Object.prototype.hasOwnProperty.call(STATUS_SHORT, status) ? STATUS_SHORT[status] : '';
}

// The status pill's choices on the dashboard: every status this viewer may
// set, plus the one it has now (so the select always shows it). A listed
// producer can't move an archived or removed production: only its owner
// reopens it, so the whole pill is `locked` for them.
export function statusOptions({ canOwn = false, current = null } = {}) {
  const allowed = canOwn ? [...MANAGER_STATUSES, 'archived'] : [...MANAGER_STATUSES];
  const list = [...allowed];
  if (current && !list.includes(current) && Object.prototype.hasOwnProperty.call(STATUS_SHORT, current)) list.push(current);
  return list.map((value) => ({ value, label: STATUS_SHORT[value], disabled: !allowed.includes(value) }));
}
export function statusLocked({ canOwn = false, current = null } = {}) {
  return !canOwn && (current === 'archived' || current === 'removed');
}

// The same keys as lib/productionRules.js PRODUCTION_KINDS, in short words.
export const KIND_SHORT = {
  short: 'Short',
  feature: 'Feature',
  series: 'Series',
  documentary: 'Documentary',
  podcast: 'Podcast',
  music_video: 'Music video',
  commercial: 'Commercial',
  vertical: 'Vertical',
  other: 'Other'
};
export function kindShort(kind) {
  return Object.prototype.hasOwnProperty.call(KIND_SHORT, kind) ? KIND_SHORT[kind] : '';
}

// A pitch's tag (lib/pitchRules.js PITCH_TAGS) as a production's kind,
// where one fits. Animation has no kind of its own: the sheet asks.
export const TAG_KIND = {
  Documentary: 'documentary',
  'Narrative Film': 'feature',
  'Short Film': 'short',
  Series: 'series',
  Vertical: 'vertical',
  Podcast: 'podcast',
  'Music Video': 'music_video',
  Other: 'other'
};
export function kindFromTag(tag) {
  return typeof tag === 'string' && Object.prototype.hasOwnProperty.call(TAG_KIND, tag) ? TAG_KIND[tag] : null;
}

export const VISIBILITY_SHORT = { public: 'Public', crew: 'Crew only', private: 'Just the people running it' };

function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
};
const str = (v) => (typeof v === 'string' ? v.trim() : '');

// "$3,240" for whole dollars, "$3,078.40" otherwise; no Intl (the app's
// engine and the server agree on these digits).
export function money(cents) {
  const c = Math.round(Number(cents) || 0);
  const neg = c < 0;
  const abs = Math.abs(c);
  const dollars = Math.floor(abs / 100);
  const rest = abs % 100;
  const whole = String(dollars).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${neg ? '−' : ''}$${whole}${rest ? `.${String(rest).padStart(2, '0')}` : ''}`;
}

/* ---------- dates (YYYY-MM-DD, read as calendar days) ---------- */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function parts(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return { y, m: mo, d };
}
const utc = (p) => Date.UTC(p.y, p.m - 1, p.d);

export function isDay(iso) {
  return Boolean(parts(iso));
}
export function dayLabel(iso) {
  const p = parts(iso);
  return p ? `${MONTHS[p.m - 1]} ${p.d}` : '';
}
export function weekdayLabel(iso) {
  const p = parts(iso);
  return p ? `${WEEKDAYS[new Date(utc(p)).getUTCDay()]} ${MONTHS[p.m - 1]} ${p.d}` : '';
}
// "Dec 6 – 9", "Dec 30 – Jan 2", "Dec 6"; '' without a first day.
export function rangeLabel(a, b) {
  const p = parts(a);
  if (!p) return '';
  const q = parts(b);
  if (!q || (q.y === p.y && q.m === p.m && q.d === p.d)) return dayLabel(a);
  if (q.y === p.y && q.m === p.m) return `${MONTHS[p.m - 1]} ${p.d} – ${q.d}`;
  return `${dayLabel(a)} – ${dayLabel(b)}`;
}
// Whole days from a to b (b later = positive); null when either isn't a day.
export function daysBetween(a, b) {
  const p = parts(a);
  const q = parts(b);
  if (!p || !q) return null;
  return Math.round((utc(q) - utc(p)) / 86400000);
}
export function addDays(iso, n) {
  const p = parts(iso);
  if (!p) return null;
  return new Date(utc(p) + Math.round(Number(n) || 0) * 86400000).toISOString().slice(0, 10);
}
// "06:30" → "6:30"; anything that isn't a time → ''.
export function timeLabel(t) {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(t || ''));
  return m ? `${Number(m[1])}:${m[2]}` : '';
}
const inDays = (n) => (n === 0 ? 'today' : n === 1 ? 'tomorrow' : `in ${n} days`);
// The place a person reads first: "Echo Park, Los Angeles" → "Echo Park".
export function placeShort(label) {
  const s = str(label);
  return s ? s.split(',')[0].trim() : '';
}

/* ---------- the dashboard's tabs and words ---------- */

export const DASH_TABS = [
  { id: 'overview', label: 'Overview', short: 'Overview' },
  { id: 'crew', label: 'Crew', short: 'Crew' },
  { id: 'calls', label: 'Calls', short: 'Calls' },
  { id: 'days', label: 'Days & call sheets', short: 'Days' },
  { id: 'money', label: 'Money', short: 'Money' },
  { id: 'release', label: 'Release & distribution', short: 'Release' }
];
export function dashTab(value) {
  return DASH_TABS.some((t) => t.id === value) ? value : 'overview';
}
const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isProductionId(id) {
  return typeof id === 'string' && ID_RE.test(id);
}
export function dashHref(id, tab = 'overview') {
  const t = dashTab(tab);
  return `/productions/${id}/dashboard${t === 'overview' ? '' : `?tab=${t}`}`;
}
export const productionHref = (id) => `/productions/${id}`;
export const MINE_PATH = '/productions/mine';
// How many rows a section shows on Overview before "All N ›" opens its tab.
export const OVERVIEW_ROWS = 4;
// How many people the crew card shows on Overview.
export const OVERVIEW_PEOPLE = 6;
// The crew groups cut to the first `n` people (Overview's short list).
export function groupsUpTo(groups, n) {
  const out = [];
  let left = num(n);
  for (const g of groups || []) {
    if (left <= 0) break;
    const people = (g.people || []).slice(0, left);
    left -= people.length;
    if (people.length) out.push({ ...g, people });
  }
  return out;
}
export const removeQuestion = (name) => `Take ${str(name) || 'them'} off the crew list?`;
// Backers who haven't heard from the creator in this many days need them.
export const QUIET_BACKERS_DAYS = 14;

export const DASH_WORDS = {
  link: 'Dashboard',
  kicker: 'Production dashboard',
  back: 'Your productions',
  status: 'Status',
  grewOut: 'grew out of the pitch',
  tabs: 'Dashboard sections',
  actions: { call: 'Post a call', day: 'Add a day', place: 'Book a place', message: 'Message crew', edit: 'Edit' },
  needs: 'Needs you',
  needsNone: 'Nothing needs you right now.',
  seeAll: 'All',
  funding: 'Funding · from the pitch',
  noPitch: 'Not tied to a pitch',
  noPitchLine: 'This production didn’t grow out of a Pitch Room project, so there’s no backing here.',
  backingOpen: 'Backing open',
  backingClosed: 'Backing not open',
  postUpdate: 'Post an update',
  postUpdateLong: 'Post an update to backers',
  pitchPage: 'The pitch page',
  updateTitle: 'Update title',
  updateBody: 'What’s new?',
  updatePost: 'Post update',
  updatePosting: 'Posting…',
  updatePosted: 'Update posted — your backers and the people following the pitch were told.',
  calls: 'Calls',
  postCall: '+ Post a call',
  noCalls: 'No calls yet. Post one: the people you book join the crew list.',
  crew: 'Crew',
  addSomeone: '+ Add someone',
  noCrew: 'Nobody on it yet. Book people through a call, or add them by name.',
  workedIt: 'Worked it',
  remove: 'Remove',
  message: 'Message',
  days: 'Shoot days',
  addDay: '+ Add a day',
  noDays: 'No shoot days on the sheet yet. Add one, or book a place under this production and its dates land here.',
  callSheet: 'Call sheet',
  places: 'Places',
  noPlaces: 'No places requested for this production yet.',
  bookPlace: 'Book a place',
  crewPay: 'Crew pay',
  crewPayNone: 'No secured pay on this production’s calls.',
  placesMoney: 'Places',
  release: 'Release & distribution',
  distribution: 'Distribution & screeners',
  ownerRunsDistribution: 'The owner runs distribution and screeners.',
  crewView: 'See it as the crew does',
  confirmHint: 'You can confirm who worked after the last shoot day.',
  loading: 'Loading the dashboard…',
  failed: 'Couldn’t load the dashboard. Try again in a moment.',
  saveFailed: 'That didn’t save. Try again.'
};

/* ---------- the dashboard ---------- */

// facts (lib/productionDashboard.js builds it; GET /api/productions/<id>/dashboard):
// {
//   today: 'YYYY-MM-DD' (Pacific), now: ISO,
//   production: { id, title, logline, kind, status, startsOn, endsOn, placeLabel,
//                 visibility, pitch: { id, title } | null, release: { title, href } | null },
//   viewer: { userId, isOwner, isProducer, isAdmin, canOwn, canConfirm },
//   owner: { userId, name },
//   members: [{ id, userId, name, role, department, worked, viaCall, isOwner, isViewer,
//               pay: null | 'pending' | 'held' | 'unfunded' | 'released' | 'disputed' | 'refunded',
//               callId, producer, profilePath, offList }],
//             (offList: booked on a call posted for the pitch, so not on the
//             crew list itself — only their unfunded pay counts here)
//   calls: [{ id, title, role, spots, status, payType, payLabel, payNote, paySecured,
//             payRateCents, startsOn, endsOn, closesOn, waiting, answers, booked, forPitch }],
//   days: [{ id, dayNo, shootOn, callTime, wrapTime, placeLabel, paid }],
//   places: [{ id, title, status, startsOn, endsOn, totalCents, respondsBy, mine }],
//   pay: { heldCents, heldPeople, releasedCents, releasedPeople, pendingCents },
//   pitch: null | { id, title, goalCents, raisedCents, toCreatorCents, cutPercent, backers,
//                   deadline, fundingEnabled, lastUpdateAt, firstBackedAt, latestBackers: [names],
//                   isOwner },
//   release: { released, title, href, checklist: {…} | null, screenersLive }
//   (the distribution page opens to viewer.canOwn: the owner and full admins)
// }

const callHref = (id) => `/crew/calls/${id}`;
const placeHref = (id) => `/locations/requests/${id}`;

// Open roles: each open call's spots not yet booked.
export function openRoles(calls) {
  return (calls || []).filter((c) => c && c.status === 'open').reduce((sum, c) => sum + Math.max(0, num(c.spots || 1) - num(c.booked)), 0);
}

// The next shoot day from today (the call sheet's, else the production's
// first day when that's still ahead).
export function nextShootDay(facts) {
  const today = facts && facts.today;
  const days = ((facts && facts.days) || []).filter((d) => d && isDay(d.shootOn) && (daysBetween(today, d.shootOn) ?? -1) >= 0);
  days.sort((a, b) => (a.shootOn < b.shootOn ? -1 : a.shootOn > b.shootOn ? 1 : num(a.dayNo) - num(b.dayNo)));
  if (days.length) return { shootOn: days[0].shootOn, callTime: days[0].callTime || '', dayNo: days[0].dayNo || null };
  const p = (facts && facts.production) || {};
  if (isDay(p.startsOn) && (daysBetween(today, p.startsOn) ?? -1) >= 0) return { shootOn: p.startsOn, callTime: '', dayNo: null };
  return null;
}

function daysLeft(deadline, today) {
  const n = daysBetween(today, deadline);
  if (n == null || n < 0) return null;
  return Math.max(1, n);
}
const leftLabel = (n) => (n === 1 ? 'Last day' : `${n} days left`);

function headOf(facts) {
  const p = facts.production;
  const v = facts.viewer || {};
  const meta = [rangeLabel(p.startsOn, p.endsOn), str(p.placeLabel), VISIBILITY_SHORT[p.visibility] || ''].filter(Boolean);
  return {
    kicker: [DASH_WORDS.kicker, kindShort(p.kind)].filter(Boolean).join(' · '),
    title: p.title || '',
    back: { href: MINE_PATH, label: DASH_WORDS.back },
    status: { value: p.status, label: statusShort(p.status), tone: p.status || 'prep', options: statusOptions({ canOwn: Boolean(v.canOwn), current: p.status }), locked: statusLocked({ canOwn: Boolean(v.canOwn), current: p.status }) },
    meta,
    grewOut: p.pitch && p.pitch.id ? { lead: DASH_WORDS.grewOut, title: p.pitch.title || '', href: `/pitches/${p.pitch.id}` } : null
  };
}

function actionsOf(facts) {
  const id = facts.production.id;
  return [
    { id: 'call', label: DASH_WORDS.actions.call, href: `/crew/calls/new?production=${id}`, primary: true },
    { id: 'day', label: DASH_WORDS.actions.day, href: `${dashHref(id, 'days')}#add-day`, tab: 'days' },
    { id: 'place', label: DASH_WORDS.actions.place, href: '/locations' },
    { id: 'message', label: DASH_WORDS.actions.message, href: dashHref(id, 'crew'), tab: 'crew' },
    { id: 'edit', label: DASH_WORDS.actions.edit, href: `/productions/${id}/edit`, quiet: true }
  ];
}

const onList = (facts) => ((facts && facts.members) || []).filter((m) => m && !m.offList);

export function dashTiles(facts) {
  const pitch = facts.pitch;
  const members = onList(facts);
  const roles = openRoles(facts.calls);
  const next = nextShootDay(facts);
  const pay = facts.pay || {};
  const held = num(pay.heldPeople);
  const raised = pitch
    ? { id: 'raised', label: 'Raised', value: money(pitch.raisedCents), sub: pitch.goalCents ? `of ${money(pitch.goalCents)} · ${plural(num(pitch.backers), 'backer', 'backers')}` : plural(num(pitch.backers), 'backer', 'backers') }
    : { id: 'raised', label: 'Raised', value: '—', sub: DASH_WORDS.noPitch };
  let shoot;
  if (next) {
    const n = daysBetween(facts.today, next.shootOn);
    const call = timeLabel(next.callTime);
    shoot = { id: 'next', label: 'Next shoot day', value: weekdayLabel(next.shootOn), sub: [call ? `call ${call}` : null, inDays(n)].filter(Boolean).join(' · ') };
  } else {
    shoot = { id: 'next', label: 'Next shoot day', value: 'Not set', sub: 'Add a day to the call sheet' };
  }
  return [
    raised,
    { id: 'crew', label: 'Crew', value: `${members.length} booked`, sub: roles ? `${plural(roles, 'role', 'roles')} still open` : 'No roles open' },
    shoot,
    {
      id: 'pay',
      label: 'Crew pay held',
      value: money(pay.heldCents),
      sub: held ? `for ${plural(held, 'person', 'people')}` : 'Nothing held',
      subLong: held ? `for ${plural(held, 'person', 'people')} · released when they work it` : 'Secured pay on a call is held here until they work it'
    }
  ];
}

// "Day 2", "Days 2 and 3", "Days 2, 3 and 5".
function dayList(nos) {
  const list = nos.map((n) => String(n));
  if (list.length === 1) return `Day ${list[0]}`;
  return `Days ${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
}
const possessive = (name) => `${name}’s`;

// What needs the viewer, each with its one link. `short` is the few words a
// list card shows when it is the only thing.
export function needsYou(facts) {
  const out = [];
  const id = facts.production && facts.production.id;
  const today = facts.today;
  const viewer = facts.viewer || {};
  // Answers waiting on a call.
  for (const c of facts.calls || []) {
    if (!c || c.status !== 'open' || !num(c.waiting)) continue;
    const n = num(c.waiting);
    out.push({ id: `answers-${c.id}`, text: `${plural(n, 'answer', 'answers')} waiting on `, strong: c.role || c.title || 'a call', link: { href: callHref(c.id), label: 'Review', short: 'Review' }, short: `${plural(n, 'answer', 'answers')} waiting` });
  }
  // Shoot days still ahead with no place.
  const bare = (facts.days || []).filter((d) => d && !str(d.placeLabel) && !d.paid && (daysBetween(today, d.shootOn) ?? -1) >= 0).map((d) => d.dayNo).filter((n) => n != null);
  if (bare.length) {
    out.push({ id: 'days-no-place', text: `${dayList(bare)} ${bare.length === 1 ? 'has' : 'have'} no place`, link: { href: '/locations', label: 'Book a place', short: 'Book' }, short: bare.length === 1 ? 'A day with no place' : 'Days with no place' });
  }
  // Booked on a secured call, not funded yet.
  for (const m of facts.members || []) {
    if (!m || m.pay !== 'unfunded' || !m.callId) continue;
    out.push({ id: `fund-${m.id}`, text: `${possessive(m.name || 'Someone')} secured pay isn’t funded`, link: { href: callHref(m.callId), label: 'Fund', short: 'Fund' }, short: 'Pay to fund' });
  }
  // Backers who haven't heard in a while (the pitch's owner posts updates).
  const pitch = facts.pitch;
  if (pitch && pitch.isOwner && num(pitch.backers)) {
    const since = str(pitch.lastUpdateAt) || str(pitch.firstBackedAt);
    const quiet = since ? daysBetween(since.slice(0, 10), today) : null;
    if (quiet != null && quiet >= QUIET_BACKERS_DAYS) {
      out.push({ id: 'backers-quiet', text: `Your backers haven’t heard from you in ${quiet} days`, link: { href: `${dashHref(id, 'money')}#update`, label: DASH_WORDS.postUpdate, short: 'Post' }, short: 'Backers to update' });
    }
  }
  // After the last day: who worked it.
  const p = facts.production || {};
  const last = p.endsOn || p.startsOn;
  if (viewer.canConfirm && isDay(last) && (daysBetween(last, today) ?? 0) > 0) {
    const toConfirm = onList(facts).filter((m) => !m.worked && !m.isViewer && !m.isOwner);
    if (toConfirm.length) {
      out.push({ id: 'confirm-worked', text: `Confirm who worked it · ${plural(toConfirm.length, 'person', 'people')}`, link: { href: dashHref(id, 'crew'), label: 'Confirm', short: 'Confirm' }, short: 'Confirm who worked it' });
    }
  }
  // A place request waiting on the viewer: a counter to answer, a yes to pay.
  for (const r of facts.places || []) {
    if (!r || !r.mine) continue;
    if (r.status === 'countered') out.push({ id: `place-${r.id}`, text: `${r.title || 'The host'} countered your request`, link: { href: placeHref(r.id), label: 'Answer', short: 'Answer' }, short: 'A counter to answer' });
    else if (r.status === 'accepted') out.push({ id: `place-${r.id}`, text: `${r.title || 'The host'} said yes — pay to confirm`, link: { href: placeHref(r.id), label: 'Pay', short: 'Pay' }, short: 'A place to pay for' });
  }
  return out;
}

// "4 need you", "1 needs you"; the one thing itself when there is only one.
export function needsLabel(count, firstShort = null) {
  const n = num(count);
  if (!n) return null;
  if (n === 1 && str(firstShort)) return str(firstShort);
  return `${n} ${n === 1 ? 'needs' : 'need'} you`;
}

function fundingOf(facts) {
  const pitch = facts.pitch;
  if (!pitch) return { none: true, title: DASH_WORDS.noPitch, line: DASH_WORDS.noPitchLine };
  const left = pitch.fundingEnabled ? daysLeft(pitch.deadline, facts.today) : null;
  const percent = num(pitch.goalCents) ? Math.min(100, Math.round((num(pitch.raisedCents) / num(pitch.goalCents)) * 100)) : null;
  const who = facts.viewer && facts.viewer.isOwner ? 'you' : (str(facts.owner && facts.owner.name).split(' ')[0] || 'the creator');
  const cut = Number(pitch.cutPercent);
  const line = [
    num(pitch.goalCents) ? `${money(pitch.raisedCents)} of ${money(pitch.goalCents)}` : `${money(pitch.raisedCents)} raised`,
    left ? leftLabel(left) : null,
    num(pitch.raisedCents) ? `${money(pitch.toCreatorCents)} to ${who}${Number.isFinite(cut) && cut > 0 ? ` after the ${cut}% cut` : ''}` : null
  ].filter(Boolean).join(' · ');
  const names = (pitch.latestBackers || []).filter((n) => str(n)).slice(0, 2);
  const more = Math.max(0, num(pitch.backers) - names.length);
  const latest = names.length ? `Latest backers: ${names.join(', ')}${more ? ` and ${more} more` : ''}` : null;
  return {
    none: false,
    title: DASH_WORDS.funding,
    state: pitch.fundingEnabled ? [DASH_WORDS.backingOpen, left ? leftLabel(left) : null].filter(Boolean).join(' · ') : DASH_WORDS.backingClosed,
    open: Boolean(pitch.fundingEnabled),
    percent,
    line,
    latest,
    canPost: Boolean(pitch.isOwner),
    post: { id: 'update', label: DASH_WORDS.postUpdate, long: DASH_WORDS.postUpdateLong },
    pitchLink: { href: `/pitches/${pitch.id}`, label: DASH_WORDS.pitchPage }
  };
}

function callPay(c) {
  if (c.paySecured && num(c.payRateCents)) return `${c.payLabel || 'Paid'} ${money(c.payRateCents)} · secured`;
  return [c.payLabel || '', str(c.payNote)].filter(Boolean).join(' · ');
}

function callsOf(facts) {
  const calls = (facts.calls || []).filter(Boolean);
  const order = { open: 0, closed: 1 };
  const sorted = [...calls].sort((a, b) => (order[a.status] ?? 2) - (order[b.status] ?? 2) || num(b.waiting) - num(a.waiting));
  const open = calls.filter((c) => c.status === 'open').length;
  return {
    title: `${DASH_WORDS.calls} · ${open} open`,
    add: { href: `/crew/calls/new?production=${facts.production.id}`, label: DASH_WORDS.postCall },
    empty: calls.length ? null : DASH_WORDS.noCalls,
    rows: sorted.map((c) => ({
      id: c.id,
      href: callHref(c.id),
      strong: c.role || c.title,
      line: [rangeLabel(c.startsOn, c.endsOn), callPay(c)].filter(Boolean).join(' · '),
      answers: num(c.waiting) ? { text: `${num(c.waiting)} waiting`, tone: 'accent' } : { text: plural(num(c.answers), 'answer', 'answers'), tone: 'dim' },
      closes: c.status === 'open' ? (isDay(c.closesOn) ? `closes ${dayLabel(c.closesOn)}` : 'open') : 'closed',
      forPitch: Boolean(c.forPitch)
    }))
  };
}

// A crew member's state on the list.
export function memberState(m) {
  if (m.worked) return { text: 'worked it', tone: 'ok' };
  switch (m.pay) {
    case 'held': return { text: 'pay held', tone: 'ok' };
    case 'released': return { text: 'paid out', tone: 'ok' };
    case 'unfunded': return { text: 'pay not funded', tone: 'warn' };
    case 'disputed': return { text: 'pay disputed', tone: 'warn' };
    case 'pending': return { text: 'payment started', tone: 'dim' };
    case 'refunded': return { text: 'pay refunded', tone: 'dim' };
    default: return m.viaCall ? { text: 'booked', tone: 'dim' } : { text: 'on the list', tone: 'dim' };
  }
}

function crewOf(facts) {
  const members = onList(facts);
  const v = facts.viewer || {};
  const id = facts.production.id;
  const groups = [];
  for (const m of members) {
    const dept = m.department || 'Crew';
    let g = groups.find((x) => x.name === dept);
    if (!g) { g = { name: dept, people: [] }; groups.push(g); }
    const ownerRow = Boolean(m.isOwner);
    const canRemove = !ownerRow && (!m.producer || Boolean(v.canOwn));
    g.people.push({
      id: m.id,
      userId: m.userId,
      name: m.name,
      role: m.role,
      label: `${m.name} (${m.role})`,
      profilePath: m.profilePath || null,
      state: memberState(m),
      actions: {
        worked: Boolean(v.canConfirm) && !m.worked && !m.isViewer && !ownerRow,
        remove: canRemove,
        message: m.userId && !m.isViewer ? `/messages?to=${encodeURIComponent(m.userId)}&kind=production&ref=${encodeURIComponent(id)}` : null
      }
    });
  }
  return {
    title: `${DASH_WORDS.crew} · ${members.length}`,
    add: { label: DASH_WORDS.addSomeone },
    empty: members.length ? null : DASH_WORDS.noCrew,
    groups,
    hint: v.canConfirm ? null : DASH_WORDS.confirmHint
  };
}

function daysOf(facts) {
  const id = facts.production.id;
  const days = (facts.days || []).filter(Boolean).sort((a, b) => num(a.dayNo) - num(b.dayNo));
  return {
    title: `${DASH_WORDS.days} · ${days.length}`,
    add: { label: DASH_WORDS.addDay },
    empty: days.length ? null : DASH_WORDS.noDays,
    rows: days.map((d) => {
      const place = str(d.placeLabel);
      const time = timeLabel(d.callTime);
      return {
        id: d.id,
        label: `Day ${d.dayNo}`,
        when: [weekdayLabel(d.shootOn), time].filter(Boolean).join(' · '),
        place: place ? { text: d.paid ? `${place} · paid` : place, tone: d.paid ? 'ok' : 'dim' } : { text: 'No place yet', tone: 'warn' },
        href: `/productions/${id}/day/${d.dayNo}`,
        past: (daysBetween(facts.today, d.shootOn) ?? 0) < 0
      };
    })
  };
}

const PLACE_STATE = {
  requested: 'asked',
  countered: 'host countered — your answer',
  accepted: 'accepted · pay to confirm',
  declined: 'declined',
  expired: 'expired',
  cancelled: 'cancelled',
  refunded: 'refunded',
  done: 'done'
};
function placeState(r, now) {
  if (r.status === 'paid' || r.status === 'done') return { text: `paid ${money(r.totalCents)}`, tone: 'ok' };
  if (r.status === 'requested') {
    const by = Date.parse(r.respondsBy || '');
    const at = Date.parse(now || '');
    const hours = Number.isFinite(by) && Number.isFinite(at) ? Math.max(1, Math.ceil((by - at) / 3600000)) : null;
    return { text: hours ? `asked, host has ${hours} h to answer` : 'asked, waiting on the host', tone: 'warn' };
  }
  if (r.status === 'countered') return { text: r.mine ? PLACE_STATE.countered : 'host countered', tone: 'warn' };
  if (r.status === 'accepted') return { text: PLACE_STATE.accepted, tone: 'warn' };
  return { text: PLACE_STATE[r.status] || r.status || '', tone: 'dim' };
}
const PLACE_ORDER = { countered: 0, accepted: 1, requested: 2, paid: 3, done: 4 };

function placesOf(facts) {
  const list = (facts.places || []).filter(Boolean).sort((a, b) => (PLACE_ORDER[a.status] ?? 9) - (PLACE_ORDER[b.status] ?? 9));
  return {
    title: DASH_WORDS.places,
    add: { href: '/locations', label: DASH_WORDS.bookPlace },
    empty: list.length ? null : DASH_WORDS.noPlaces,
    rows: list.map((r) => ({ id: r.id, href: placeHref(r.id), title: r.title || 'A place', when: rangeLabel(r.startsOn, r.endsOn), state: placeState(r, facts.now) }))
  };
}

function moneyOf(facts) {
  const pay = facts.pay || {};
  const lines = [];
  if (num(pay.heldCents)) lines.push({ id: 'held', text: `Held · ${money(pay.heldCents)} for ${plural(num(pay.heldPeople), 'person', 'people')}`, tone: 'ok' });
  if (num(pay.releasedCents)) lines.push({ id: 'released', text: `Paid out · ${money(pay.releasedCents)} to ${plural(num(pay.releasedPeople), 'person', 'people')}`, tone: 'ok' });
  if (num(pay.pendingCents)) lines.push({ id: 'pending', text: `Payment started · ${money(pay.pendingCents)}`, tone: 'dim' });
  const unfunded = (facts.members || []).filter((m) => m && m.pay === 'unfunded');
  if (unfunded.length) lines.push({ id: 'unfunded', text: `Not funded · ${unfunded.map((m) => m.name).join(', ')}`, tone: 'warn' });
  const paidPlaces = (facts.places || []).filter((r) => r && (r.status === 'paid' || r.status === 'done'));
  const placesCents = paidPlaces.reduce((s, r) => s + num(r.totalCents), 0);
  return {
    funding: fundingOf(facts),
    crewPay: { title: DASH_WORDS.crewPay, lines, empty: lines.length ? null : DASH_WORDS.crewPayNone },
    places: { title: DASH_WORDS.placesMoney, line: paidPlaces.length ? `${money(placesCents)} paid for ${plural(paidPlaces.length, 'booking', 'bookings')}` : 'Nothing paid for places yet' }
  };
}

// The distribution page's checklist (lib/distribution.js
// distributionChecklist): how many of its eight are done.
export const CHECKLIST_KEYS = ['released', 'buyToOwn', 'earlyScreening', 'festivalsSubmitted', 'trailer', 'pressKit', 'shotHere', 'screenersLive'];
export function checklistCount(checklist) {
  const c = checklist && typeof checklist === 'object' ? checklist : {};
  return { done: CHECKLIST_KEYS.filter((k) => Boolean(c[k])).length, total: CHECKLIST_KEYS.length };
}

function releaseOf(facts) {
  const r = facts.release || {};
  const id = facts.production.id;
  const canOpen = Boolean(facts.viewer && facts.viewer.canOwn);
  const count = checklistCount(r.checklist);
  const screeners = num(r.screenersLive);
  const line = [
    r.released && str(r.title) ? `Released as ${r.title}` : 'Not released yet',
    r.checklist ? `checklist ${count.done} of ${count.total}` : null,
    screeners ? `${plural(screeners, 'screener', 'screeners')} live` : 'no screeners'
  ].filter(Boolean).join(' · ');
  return {
    title: DASH_WORDS.release,
    line,
    releaseLink: r.released && r.href ? { href: r.href, label: r.title } : null,
    button: canOpen ? { href: `/productions/${id}/distribution`, label: DASH_WORDS.distribution } : null,
    note: canOpen ? null : DASH_WORDS.ownerRunsDistribution
  };
}

// The whole dashboard from the route's facts.
export function productionDashboard(facts) {
  if (!facts || !facts.production) return null;
  const needs = needsYou(facts);
  return {
    head: headOf(facts),
    actions: actionsOf(facts),
    tabs: DASH_TABS,
    tiles: dashTiles(facts),
    needs: { title: `${DASH_WORDS.needs} · ${needs.length}`, items: needs, empty: needs.length ? null : DASH_WORDS.needsNone },
    funding: fundingOf(facts),
    calls: callsOf(facts),
    crew: crewOf(facts),
    days: daysOf(facts),
    places: placesOf(facts),
    money: moneyOf(facts),
    release: releaseOf(facts),
    crewView: { href: productionHref(facts.production.id), label: DASH_WORDS.crewView }
  };
}

/* ---------- Your productions (/productions/mine) and the ☰ menu ---------- */

// The menu's "Running now" line and the start of a card's: "Prep ·
// shooting Dec 6", "Shooting · until Dec 9", "Post".
export function runningLine({ status, startsOn = null, endsOn = null, nextShootOn = null } = {}, today) {
  const s = statusShort(status);
  if (status === 'prep') {
    const next = isDay(nextShootOn) ? nextShootOn : isDay(startsOn) && (daysBetween(today, startsOn) ?? -1) >= 0 ? startsOn : null;
    return next ? `${s} · shooting ${dayLabel(next)}` : s;
  }
  if (status === 'shooting') return isDay(endsOn) && (daysBetween(today, endsOn) ?? -1) >= 0 ? `${s} · until ${dayLabel(endsOn)}` : s;
  return s;
}

export const MINE_WORDS = {
  title: 'Your productions',
  start: 'Start a production',
  startHref: '/productions/new',
  tabs: { running: 'Running', crew: 'On the crew', done: 'Done' },
  empty: {
    running: 'Nothing running. Start one from a pitch, or from scratch.',
    crew: 'You’re not on anyone’s crew list yet. Answer a call on Crew Call and get booked.',
    done: 'Nothing released or archived yet.'
  },
  openDashboard: 'Open the dashboard',
  openProduction: 'Open the production',
  gotPitch: 'Got a pitch?',
  fromPitch: 'Start from the pitch',
  signIn: 'Sign in to see the productions you run and the ones you’re crew on.',
  signInButton: 'Sign in',
  failed: 'Couldn’t load your productions. Try again in a moment.'
};

// Running (you run it, still being made) · On the crew · Done.
// items: what GET /api/productions/mine answers in `items`:
// [{ id, title, kind, status, startsOn, endsOn, placeLabel, fromPitch, crewCount,
//    openRoles, raisedCents, needsYou, needsShort, manage, myRoles, nextShootOn }]
export function mineGroups(items) {
  const list = (items || []).filter((x) => x && x.id);
  const groups = {
    running: list.filter((x) => x.manage && RUNNING_STATUSES.includes(x.status)),
    crew: list.filter((x) => !x.manage && x.status !== 'removed'),
    done: list.filter((x) => x.manage && DONE_STATUSES.includes(x.status))
  };
  return {
    tabs: ['running', 'crew', 'done'].map((id) => ({ id, label: `${MINE_WORDS.tabs[id]} · ${groups[id].length}`, count: groups[id].length })),
    groups
  };
}
export function mineTab(value) {
  return ['running', 'crew', 'done'].includes(value) ? value : 'running';
}

export function yoursCard(item, today) {
  const ended = isDay(item.endsOn || item.startsOn) && (daysBetween(today, item.endsOn || item.startsOn) ?? 0) < 0;
  const range = rangeLabel(item.startsOn, item.endsOn);
  const line = [kindShort(item.kind), range ? `${ended ? 'shot ' : ''}${range}` : null, placeShort(item.placeLabel), item.fromPitch ? 'from the pitch' : null].filter(Boolean).join(' · ');
  const crew = num(item.crewCount);
  const open = num(item.openRoles);
  const stats = [];
  if (item.manage) {
    stats.push(open ? `${crew} crew · ${open} open` : `${crew} crew`);
    if (num(item.raisedCents)) stats.push(`${money(item.raisedCents)} raised`);
  } else if (item.myRoles && item.myRoles.length) {
    stats.push(`You: ${item.myRoles.join(', ')}`);
  }
  const needs = item.manage ? needsLabel(item.needsYou, item.needsShort) : null;
  return {
    id: item.id,
    title: item.title,
    status: { text: statusShort(item.status), tone: item.status },
    line,
    stats,
    needs,
    button: item.manage
      ? { href: dashHref(item.id), label: MINE_WORDS.openDashboard, primary: Boolean(needs) }
      : { href: productionHref(item.id), label: MINE_WORDS.openProduction, primary: false }
  };
}

// "Got a pitch?": an approved pitch of the viewer's with no production yet.
// pitch: { id, title, raisedCents }
export function readyPitchCard(pitch) {
  const raised = num(pitch && pitch.raisedCents);
  return {
    id: pitch.id,
    title: MINE_WORDS.gotPitch,
    line: raised
      ? `${pitch.title} has ${money(raised)} backed. Start its production and gather crew while it keeps raising.`
      : `${pitch.title} is approved. Start its production and gather crew while it keeps raising.`,
    link: { label: MINE_WORDS.fromPitch }
  };
}

/* ---------- the pitch page and Your pitches ---------- */

export const PITCH_WORDS = {
  pill: 'In production',
  link: 'The production',
  start: 'Start the production',
  open: 'Open its dashboard',
  readyTitle: 'Ready to shoot it?',
  readyLine: 'Turn this pitch into a production: post crew calls, book places and plan shoot days. The pitch keeps taking backing while you do.',
  crewNeeded: 'Crew needed',
  allCalls: 'All calls',
  fromBoth: 'From the production’s calls, and any posted for the pitch.',
  noCalls: 'No open calls yet.',
  fundingCard: 'Funding',
  backIt: 'Back it',
  onThePitch: 'On the pitch page'
};

// The pitch page's card for its production. production: { id, title, status,
// startsOn, endsOn, placeLabel, crewCount, openRoles }.
export function pitchProductionCard(production, today) {
  if (!production || !production.id) return null;
  const p = production;
  const place = placeShort(p.placeLabel);
  const range = rangeLabel(p.startsOn, p.endsOn);
  let title;
  if (p.status === 'post') title = 'In post';
  else if (p.status === 'released') title = 'Released';
  else if (range) {
    const done = isDay(p.endsOn || p.startsOn) && (daysBetween(today, p.endsOn || p.startsOn) ?? 0) < 0;
    title = `${done ? 'Shot' : 'Shooting'} ${range}${place ? ` in ${place}` : ''}`;
  } else {
    title = place ? `In production in ${place}` : 'In production';
  }
  const crew = num(p.crewCount);
  const open = num(p.openRoles);
  const line = [statusShort(p.status), `${crew} crew on it`, open ? `${plural(open, 'role', 'roles')} open` : null].filter(Boolean).join(' · ');
  return { pill: PITCH_WORDS.pill, title, line, link: { href: productionHref(p.id), label: PITCH_WORDS.link } };
}

// The production page's small Funding card, for everyone who can see the
// production (GET /api/productions/<id> answers `funding`: { pitchId,
// title, raisedCents, goalCents, percent, backers, open, href } or null).
export function productionFundingCard(funding) {
  if (!funding || !funding.pitchId) return null;
  const raised = num(funding.raisedCents);
  const goal = num(funding.goalCents);
  const backers = num(funding.backers);
  return {
    kicker: `${PITCH_WORDS.fundingCard} · ${str(funding.title)}`,
    line: [goal ? `${money(raised)} of ${money(goal)}` : `${money(raised)} raised`, backers ? plural(backers, 'backer', 'backers') : null].filter(Boolean).join(' · '),
    percent: goal ? Math.min(100, Math.round((raised / goal) * 100)) : null,
    button: funding.open
      ? { href: `${funding.href}#fund`, label: PITCH_WORDS.backIt, primary: true }
      : { href: funding.href, label: PITCH_WORDS.onThePitch, primary: false }
  };
}

// What the person running it sees on their own pitch page: Start, or Open
// its dashboard. Nothing for anyone else.
export function pitchOwnerAction({ isPitchOwner = false, production = null, canManage = false } = {}) {
  if (production && production.id) return canManage ? { kind: 'dashboard', label: PITCH_WORDS.open, href: dashHref(production.id) } : null;
  return isPitchOwner ? { kind: 'start', label: PITCH_WORDS.start } : null;
}

export function crewNeededHead(count, production) {
  return {
    title: `${PITCH_WORDS.crewNeeded}${num(count) ? ` · ${num(count)}` : ''}`,
    all: production && production.id ? { href: `/crew?production=${production.id}`, label: PITCH_WORDS.allCalls } : null,
    note: production && production.id ? PITCH_WORDS.fromBoth : null
  };
}

// Your pitches (the creator Dashboard's Pitches tab): the box on an approved
// pitch. production as on the pitch page, or null.
export function pitchBox({ pitch, production = null, today } = {}) {
  if (!pitch || pitch.status !== 'approved') return null;
  if (!production || !production.id) {
    return { kind: 'start', title: PITCH_WORDS.readyTitle, line: PITCH_WORDS.readyLine, button: { label: PITCH_WORDS.start } };
  }
  const range = rangeLabel(production.startsOn, production.endsOn);
  const ahead = isDay(production.startsOn) && (daysBetween(today, production.startsOn) ?? -1) >= 0;
  const crew = num(production.crewCount);
  const open = num(production.openRoles);
  const line = [
    range ? (ahead ? `Shooting from ${dayLabel(production.startsOn)}` : range) : statusShort(production.status),
    `${crew} crew booked`,
    open ? `${plural(open, 'role', 'roles')} open` : null
  ].filter(Boolean).join(' · ');
  return { kind: 'running', pill: PITCH_WORDS.pill, line, button: { label: PITCH_WORDS.open, href: dashHref(production.id) } };
}

/* ---------- the start sheet ---------- */

export const START_WORDS = {
  title: 'Start the production',
  sub: 'Filled in from your pitch. Change anything.',
  labels: { title: 'Title', logline: 'One line', kind: 'Kind', startsOn: 'First shoot day', endsOn: 'Last shoot day', place: 'Based in' },
  pickKind: 'Pick one',
  placePlaceholder: 'City (pick from the suggestions)',
  keepTitle: 'Keeps taking backing',
  keepLine: 'The pitch page stays open, with “In production” on it.',
  visibility: 'Who sees it: Public, like the pitch. You can make it crew-only later.',
  submit: 'Start the production',
  busy: 'Starting…',
  close: 'Close',
  exists: 'This pitch already has a production.',
  open: 'Open its dashboard'
};
export const START_MAX_TITLE = 90;
export const START_MAX_LOGLINE = 300;

// pitch: { id, title, logline, tag }, backers: how many backed it.
export function startSheet(pitch, backers = 0) {
  const n = num(backers);
  const title = str(pitch && pitch.title).slice(0, START_MAX_TITLE);
  return {
    kicker: `From the pitch · ${title}`,
    title: START_WORDS.title,
    sub: START_WORDS.sub,
    labels: START_WORDS.labels,
    kinds: Object.keys(KIND_SHORT).map((value) => ({ value, label: KIND_SHORT[value] })),
    defaults: {
      title,
      logline: str(pitch && pitch.logline).replace(/\s+/g, ' ').slice(0, START_MAX_LOGLINE),
      kind: kindFromTag(pitch && pitch.tag),
      startsOn: '',
      endsOn: '',
      place: null,
      tellBackers: true
    },
    keep: { title: START_WORDS.keepTitle, line: START_WORDS.keepLine },
    tell: {
      title: n ? `Tell my ${plural(n, 'backer', 'backers')}` : 'Tell the people following it',
      line: `Posts “${title} is now in production” as an update.`
    },
    visibility: START_WORDS.visibility,
    submit: START_WORDS.submit,
    busy: START_WORDS.busy
  };
}

// The line the dashboard shows once, after the sheet: ?started=1&told=…
// (yes: the update went out; later: the pitch had its three updates today;
// failed: it didn't post; off: the switch was off).
export const TOLD_STATES = ['yes', 'later', 'failed', 'off'];
export function startedFlash(told) {
  const base = 'The production is started. Post a call, add shoot days and book places from here.';
  if (told === 'yes') return `${base} Your backers and the people following the pitch were told.`;
  if (told === 'later') return `${base} The pitch already had three updates today, so tell your backers tomorrow.`;
  if (told === 'failed') return `${base} The update to your backers didn’t post — post it from Money.`;
  return base;
}

// The update "Tell my backers" posts on the pitch.
export function productionUpdate({ title, startsOn = null, endsOn = null, placeLabel = null } = {}) {
  const t = str(title);
  const range = rangeLabel(startsOn, endsOn);
  const place = placeShort(placeLabel);
  const when = range ? ` Shooting ${range}${place ? ` in ${place}` : ''}.` : place ? ` Based in ${place}.` : '';
  return {
    title: `${t} is now in production`.slice(0, 140),
    body: `We’re starting the production.${when} Backing stays open while we shoot, and crew calls for it are on Crew Call.`
  };
}
