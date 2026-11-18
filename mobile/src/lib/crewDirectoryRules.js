// Crew Call, simpler (Jose, 2026-11-18, the canvas
// https://claude.ai/artifact/NAcrMSstXHTCP2HuysLCjp: "calls should be its
// own tab for now, make it the first page", then "I like both Bs": a person
// row carries one gear line, and Cast is rows with a small headshot).
//
// The words, the small rules and the row shapes both the website
// (pages/crew/index.js) and the app (mobile/src/app/crew/index.js) draw
// from. Pure, no imports: the app's mobile/src/lib/crewDirectoryRules.js is
// this file word for word (node scripts/test-crew-directory.mjs).
//
// Rule for new code: a label, a count line, a row's lines or an API query
// on the Crew Call page is built here, in both copies, never in a page,
// component or screen.

// The four tabs, in order. Crew Call opens on Calls.
export const CREW_TABS = ['calls', 'people', 'cast', 'gear'];
export const TAB_LABELS = { calls: 'Calls', people: 'People', cast: 'Cast', gear: 'Gear' };
export const DEFAULT_TAB = 'calls';

// "I'm free right now" choices, in hours. Equal to AVAILABLE_NOW_CHOICES
// in lib/crewCallRules.js (the test checks it).
export const FREE_HOURS = [4, 8, 12, 24];
export const DEFAULT_WITHIN = 50;
export const WITHIN_STEPS = [10, 25, 50, 100, 0];

export const CREW_WORDS = {
  title: 'Crew Call',
  tabsLabel: 'What to find',
  yourCard: 'Your card',
  setUpCard: 'Set up your card',
  postCall: 'Post a call',
  message: 'Message',
  ask: 'Ask',
  profile: 'Profile',
  filters: 'Filters',
  clearAll: 'Clear all',
  close: 'Close',
  near: 'Near',
  nearPlaceholder: 'City, or use your location',
  useMyLocation: 'Use my location',
  anywhere: 'Anywhere',
  role: 'Role',
  roleAny: 'Any role',
  rolePickAny: 'Role · pick any',
  hasGear: 'Has gear',
  category: 'Category',
  anyGear: 'Any',
  allGear: 'All',
  pay: 'Pay',
  kind: 'Kind of call',
  kinds: { '': 'All', crew: 'Crew', cast: 'Casting' },
  playingAge: 'Playing age',
  ageFrom: 'from',
  ageTo: 'to',
  union: 'Union',
  unionAny: 'Any',
  freeNow: '⚡ Free now',
  freeNowLong: '⚡ Free right now',
  freeNowLine: 'Said they can jump in today',
  openToWork: 'Open to work',
  openToWorkLine: 'Hides people who are booked',
  verified: 'Approved creators only',
  verifiedLine: 'Approved through a creator application',
  matches: 'Matches my card',
  matchesLine: 'Calls for a role on your card, within your travel distance',
  remote: 'Remote',
  remoteLine: 'Only calls you can do from anywhere',
  urgentLine: 'Someone dropped; needed within two days',
  updating: 'Updating…',
  loading: 'Loading…',
  couldNotLoad: 'Crew Call couldn’t load just now. Try again in a moment.',
  free: {
    ask: 'Free right now?',
    askLine: 'Urgent calls nearby reach you first.',
    button: 'I’m free',
    onLine: 'You’re first in line for urgent calls nearby.',
    off: 'Turn off',
    laptopLine: 'Someone always drops out. Say you can jump in and urgent calls nearby reach you first; you go to the top of People too.'
  },
  nudge: {
    title: 'You’re not on the board yet',
    line: 'Add a card and calls that fit you find you.',
    button: 'Set it up',
    signedOutLine: 'Sign in to post a call, answer one or make your card.',
    signIn: 'Sign in'
  }
};

const text = (v) => (typeof v === 'string' ? v.trim() : '');
const num = (v) => (v === null || v === undefined || v === '' ? null : (Number.isFinite(Number(v)) ? Number(v) : null));

// Which tab an address opens on. ?tab= wins; the older links keep landing
// where they meant: ?free=1 (the home page's "free right now") on People,
// ?urgent= and ?production= on Calls.
export function tabFromQuery(query = {}) {
  const raw = text(Array.isArray(query.tab) ? query.tab[0] : query.tab);
  if (CREW_TABS.includes(raw)) return raw;
  if (query.free === '1' || query.free === 'true') return 'people';
  return DEFAULT_TAB;
}

// The address for a tab (Calls is the bare page).
export function tabHref(tab) {
  return tab === DEFAULT_TAB || !CREW_TABS.includes(tab) ? '/crew' : `/crew?tab=${tab}`;
}

// The search box's placeholder, with how many there are when known.
const NOUNS = {
  calls: ['open call', 'open calls'],
  people: ['person', 'people'],
  cast: ['performer', 'performers'],
  gear: ['piece of gear', 'pieces of gear']
};
export function searchPlaceholder(tab, total) {
  const [one, many] = NOUNS[tab] || NOUNS.people;
  const n = num(total);
  if (n === null || n <= 0) return `Search ${many}…`;
  return `Search ${n} ${n === 1 ? one : many}…`;
}

// The place a long geocoder label starts with ("Los Angeles, California,
// United States" → "Los Angeles").
export function shortPlace(label) {
  const t = text(label);
  return t ? t.split(',')[0].trim() : '';
}

// The place chip: where the list is looking, which also says how it is
// sorted (nearest first with a place, newest without).
export function placeChip(near, within) {
  if (!near || !text(near.label)) return { label: `${CREW_WORDS.anywhere} · newest`, on: false };
  const w = num(within) || 0;
  return { label: `${shortPlace(near.label)} · ${w ? `${w} mi` : 'any distance'}`, on: true };
}
export const withinLabel = (n) => (num(n) ? `${num(n)} mi` : CREW_WORDS.anywhere);

// The filter state every tab shares; each tab reads its own keys.
export function emptyFilters(near = null) {
  return {
    q: '',
    near: near || null,
    within: near ? DEFAULT_WITHIN : 0,
    roles: [],
    gear: '',
    open: false,
    free: false,
    verified: false,
    callRole: '',
    pay: [],
    remote: false,
    matches: false,
    urgent: false,
    kind: '',
    production: '',
    ageMin: '',
    ageMax: '',
    union: ''
  };
}

// Filters on a tab that the Filters chip counts (search and place are on
// screen already).
export function filterCount(tab, given) {
  if (!given) return 0;
  const f = { ...emptyFilters(), ...given };
  if (tab === 'calls') return (f.callRole ? 1 : 0) + (f.pay.length ? 1 : 0) + (f.remote ? 1 : 0) + (f.matches ? 1 : 0) + (f.urgent ? 1 : 0) + (f.kind ? 1 : 0) + (f.production ? 1 : 0);
  if (tab === 'people') return (f.roles.length ? 1 : 0) + (f.gear ? 1 : 0) + (f.open ? 1 : 0) + (f.free ? 1 : 0) + (f.verified ? 1 : 0);
  if (tab === 'cast') return (f.ageMin || f.ageMax ? 1 : 0) + (f.union ? 1 : 0) + (f.open ? 1 : 0) + (f.free ? 1 : 0) + (f.verified ? 1 : 0);
  return f.gear ? 1 : 0;
}
export function filtersLabel(tab, f) {
  const n = filterCount(tab, f);
  return n ? `${CREW_WORDS.filters} · ${n}` : CREW_WORDS.filters;
}

// Filters belong to each tab; only the place (near + within) is shared,
// so "Camera" on Gear never filters People. withPlace carries the place
// from one tab's filters into another's.
export function withPlace(f, near, within) {
  return { ...emptyFilters(), ...(f || {}), near: near || null, within: near ? (num(within) === null ? DEFAULT_WITHIN : num(within)) : 0 };
}

// The Calls badge counts urgent calls near the viewer's place, whatever
// the Calls tab's search and filters are: one quiet read of this path.
export function urgentBadgePath(near, within) {
  return apiPathFor('calls', { near, within });
}

// The Filters sheet's button on a phone: "Show 7 people".
export function showButton(tab, total) {
  const [one, many] = NOUNS[tab] || NOUNS.people;
  const n = num(total);
  if (n === null) return 'Show results';
  return `Show ${n} ${n === 1 ? one : many}`;
}

// The small words on chips and in the sheet.
export function urgentChip(count) {
  const n = num(count) || 0;
  return n ? `⚡ Urgent · ${n}` : '⚡ Urgent';
}
export function productionChip(title) {
  const t = text(title);
  return t ? `For ${t}` : 'For one production';
}
export const REMOVE_FILTER_HINT = 'Removes this filter';
export const moreLabel = (n) => `+ ${n} more`;
export const hoursLabel = (h) => `${h} h`;
export const menuChip = (label) => `${label} ▾`;

// Clear All on a tab: that tab's filters and its search; the place stays.
export function clearedFilters(tab, given) {
  const base = emptyFilters();
  const f = { ...base, ...(given || {}) };
  const keep = { ...f, q: '' };
  if (tab === 'calls') return { ...keep, callRole: '', pay: [], remote: false, matches: false, urgent: false, kind: '', production: '' };
  if (tab === 'people') return { ...keep, roles: [], gear: '', open: false, free: false, verified: false };
  if (tab === 'cast') return { ...keep, ageMin: '', ageMax: '', union: '', open: false, free: false, verified: false };
  return { ...keep, gear: base.gear };
}

// The API a tab reads, with its query, for the website and the app alike.
export function apiPathFor(tab, f) {
  const p = [];
  const add = (k, v) => p.push(`${k}=${encodeURIComponent(v)}`);
  // A partial object is fine ({ near, within } for the Calls badge).
  const s = { ...emptyFilters(), ...(f || {}) };
  if (text(s.q)) add('q', text(s.q));
  if (s.near && Number.isFinite(Number(s.near.lat)) && Number.isFinite(Number(s.near.lng))) {
    add('lat', s.near.lat); add('lng', s.near.lng); add('within', num(s.within) || 0);
  }
  if (tab === 'calls') {
    if (s.callRole) add('role', s.callRole);
    if (s.pay.length) add('pay', s.pay.join(','));
    if (s.remote) add('remote', '1');
    if (s.matches) add('matches', '1');
    if (s.urgent) add('urgent', '1');
    if (s.kind) add('kind', s.kind);
    if (s.production) add('production', s.production);
    return `/api/crew/calls${p.length ? `?${p.join('&')}` : ''}`;
  }
  if (tab === 'gear') {
    p.unshift('view=gear');
    if (s.gear) add('gear', s.gear);
    return `/api/crew/people?${p.join('&')}`;
  }
  if (tab === 'cast') {
    p.unshift('cast=1');
    if (num(s.ageMin) !== null) add('ageMin', num(s.ageMin));
    if (num(s.ageMax) !== null) add('ageMax', num(s.ageMax));
    if (s.union) add('union', s.union);
  } else {
    if (s.roles.length) add('roles', s.roles.join(','));
    if (s.gear) add('gear', s.gear);
  }
  if (s.open) add('open', '1');
  if (s.free) add('free', '1');
  if (s.verified) add('verified', '1');
  return `/api/crew/people${p.length ? `?${p.join('&')}` : ''}`;
}

// The filters an older link asks for (?free=1, ?urgent=1, ?production=,
// ?kind=), on top of the empty ones.
export function filtersFromQuery(query = {}, near = null) {
  const f = emptyFilters(near);
  const one = (k) => text(Array.isArray(query[k]) ? query[k][0] : query[k]);
  if (one('free') === '1') f.free = true;
  if (one('urgent') === '1') f.urgent = true;
  if (one('kind') === 'crew' || one('kind') === 'cast') f.kind = one('kind');
  if (/^[0-9a-f-]{36}$/i.test(one('production'))) f.production = one('production');
  return f;
}

/* ---------------- times ---------------- */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function clockTime(iso) {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return '';
  const h = d.getHours();
  const m = d.getMinutes();
  return `${h % 12 || 12}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h < 12 ? 'AM' : 'PM'}`;
}

function day(ymd) {
  const d = new Date(`${String(ymd).slice(0, 10)}T12:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

// A call's dates: "Sat, Dec 6", "Dec 12–14", "Nov 30–Dec 2".
export function callDates(startsOn, endsOn) {
  const a = startsOn ? day(startsOn) : null;
  if (!a) return 'Dates to confirm';
  const b = endsOn ? day(endsOn) : null;
  if (!b || b.getTime() === a.getTime()) return `${DAYS[a.getDay()]}, ${MONTHS[a.getMonth()]} ${a.getDate()}`;
  if (a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear()) return `${MONTHS[a.getMonth()]} ${a.getDate()}–${b.getDate()}`;
  return `${MONTHS[a.getMonth()]} ${a.getDate()}–${MONTHS[b.getMonth()]} ${b.getDate()}`;
}

/* ---------------- a person ---------------- */

// Where someone stands: free right now, open to work, or booked.
export function personStatus(p) {
  if (!p) return null;
  if (p.freeNow) {
    const t = clockTime(p.availableNowUntil);
    return { tone: 'free', text: t ? `⚡ Free until ${t}` : '⚡ Free right now' };
  }
  if (p.availability === 'open') return { tone: 'open', text: 'Open to work' };
  if (p.availability === 'booked') {
    const d = p.bookedUntil ? day(p.bookedUntil) : null;
    return { tone: 'booked', text: d ? `Booked until ${MONTHS[d.getMonth()]} ${d.getDate()}` : 'Booked' };
  }
  return null;
}

// A day rate as the row shows it (only to signed-in viewers: a hidden rate
// is left out of the row).
export function rateText(p) {
  if (!p || p.ratesHidden) return null;
  const lo = num(p.rateMin);
  const hi = num(p.rateMax);
  if (lo === null && hi === null) return 'Rate on request';
  if (lo !== null && hi !== null && lo !== hi) return `$${lo}–${hi}/day`;
  return `$${hi === null ? lo : hi}/day`;
}

function where(p) {
  if (p.miles !== null && p.miles !== undefined && Number.isFinite(Number(p.miles))) return `${Number(p.miles)} mi`;
  if (text(p.place)) return shortPlace(p.place);
  if (p.remoteOk) return 'Remote OK';
  return null;
}

// The gear line under a person (People B): the verb says what they do with
// it when all of it is the same, else "Has"; two names, then +N.
const GEAR_VERBS = { brings: ['Brings', 'brings'], lends: ['Lends', 'lends'], ask: ['Ask about', 'ask'] };
export function gearLine(gear) {
  const list = (Array.isArray(gear) ? gear : []).filter((g) => g && text(g.name));
  if (!list.length) return null;
  const flags = [...new Set(list.map((g) => (GEAR_VERBS[g.flag] ? g.flag : 'brings')))];
  const [verb, tone] = flags.length === 1 ? GEAR_VERBS[flags[0]] : ['Has', 'brings'];
  const names = list.slice(0, 2).map((g) => text(g.name)).join(' · ');
  const rest = list.length - 2;
  return { verb, tone, text: rest > 0 ? `${names} +${rest}` : names };
}

// One person on People: the photo's mark, the lines, and what the message
// is about.
export function personRow(p) {
  const status = personStatus(p);
  const roles = (Array.isArray(p.roles) ? p.roles : []).filter(Boolean);
  const meta = [where(p), rateText(p)].filter(Boolean);
  return {
    name: text(p.displayName) || 'Someone',
    mark: p.freeNow ? 'free' : p.availability === 'open' ? 'open' : null,
    verified: Boolean(p.verified),
    roles: roles.length > 3 ? `${roles.slice(0, 3).join(' · ')} +${roles.length - 3}` : roles.join(' · '),
    status,
    meta: meta.join(' · '),
    gear: gearLine(p.gear),
    bio: text(p.bio),
    messageLabel: `${text(p.displayName) || 'Someone'}’s card`
  };
}

// "Plays 25–35", "Plays 18+", "Plays up to 12".
export function playingAgeText(min, max) {
  const lo = num(min);
  const hi = num(max);
  if (lo !== null && hi !== null) return lo === hi ? `Plays ${lo}` : `Plays ${lo}–${hi}`;
  if (lo !== null) return `Plays ${lo}+`;
  if (hi !== null) return `Plays up to ${hi}`;
  return null;
}

// One performer on Cast (Cast B): a small headshot, then the lines.
export function castRow(p) {
  const status = personStatus(p);
  const roles = (Array.isArray(p.roles) ? p.roles : []).filter(Boolean);
  const shown = roles.slice(0, 2);
  const playing = [playingAgeText(p.playingAgeMin, p.playingAgeMax), text(p.unionLabel)].filter(Boolean).join(' · ');
  const shot = Array.isArray(p.headshots) && p.headshots[0] && text(p.headshots[0].url) ? text(p.headshots[0].url) : null;
  return {
    name: text(p.displayName) || 'Someone',
    mark: p.freeNow ? 'free' : p.availability === 'open' ? 'open' : null,
    verified: Boolean(p.verified),
    headshot: shot,
    playing: playing || shown.join(' · '),
    status,
    meta: [playing ? shown.join(' · ') : null, where(p)].filter(Boolean).join(' · '),
    messageLabel: `${text(p.displayName) || 'Someone'}’s card`
  };
}

/* ---------------- a call ---------------- */

const PAY_TONES = { paid: 'paid', union: 'union', deferred: 'deferred', unpaid: 'muted', other: 'muted' };

export function payText(c) {
  if (c.paySecured && num(c.payRateCents)) return { tone: 'paid', text: `Pay secured · $${Math.round(num(c.payRateCents) / 100).toLocaleString('en-US')}` };
  const label = text(c.payLabel) || 'Pay to confirm';
  const note = text(c.payNote);
  return { tone: PAY_TONES[c.payType] || 'muted', text: note ? `${label} · ${note.length > 40 ? `${note.slice(0, 39)}…` : note}` : label };
}

// One call: the tags over the title, the lines under it.
export function callRow(c) {
  const tags = [];
  if (c.urgent) tags.push({ tone: 'urgent', text: c.neededLabel ? `⚡ Urgent · ${c.neededLabel}` : '⚡ Urgent' });
  if (c.kind === 'cast') tags.push({ tone: 'cast', text: text(c.characterName) ? `Casting · ${text(c.characterName)}` : 'Casting' });
  if (c.matches) tags.push({ tone: 'ok', text: 'Matches your card' });
  if (c.mine) tags.push({ tone: 'mine', text: 'Yours' });
  if (text(c.productionTitle)) tags.push({ tone: 'muted', text: `For ${text(c.productionTitle)}` });
  const placeText = c.remote ? 'Remote' : shortPlace(c.place) || 'Place to confirm';
  const miles = !c.remote && c.miles !== null && c.miles !== undefined && Number.isFinite(Number(c.miles)) ? ` · ${Number(c.miles)} mi` : '';
  const n = num(c.responsesCount) || 0;
  return {
    tags,
    title: text(c.title) || text(c.role) || 'A call',
    meta: `${text(c.role)}${num(c.spots) > 1 ? ` · ${num(c.spots)} spots` : ''} · ${callDates(c.startsOn, c.endsOn)} · ${placeText}${miles}`,
    pay: payText(c),
    poster: c.poster && text(c.poster.displayName) ? text(c.poster.displayName) : '',
    answered: n ? `${n} answered` : 'No answers yet',
    urgent: Boolean(c.urgent)
  };
}

/* ---------------- a piece of gear ---------------- */

const FLAG_TEXT = { brings: 'Brings it to set', lends: 'Open to lending', ask: 'Ask' };
const FLAG_TONES = { brings: 'brings', lends: 'lends', ask: 'muted' };
export function gearRow(g) {
  const flag = FLAG_TEXT[g.flag] ? g.flag : 'brings';
  const o = g.owner || {};
  const at = o.miles !== null && o.miles !== undefined && Number.isFinite(Number(o.miles)) ? `${Number(o.miles)} mi` : shortPlace(o.place);
  return {
    name: text(g.name) || 'Gear',
    category: text(g.category),
    flag: { tone: FLAG_TONES[flag], text: text(g.flagLabel) || FLAG_TEXT[flag] },
    owner: [text(o.displayName) || 'Someone', at].filter(Boolean).join(' · ')
  };
}

/* ---------------- empty lists ---------------- */

export function emptyLine(tab, { filtered = false, signedIn = false, hasCard = false } = {}) {
  if (tab === 'calls') {
    if (filtered) return { title: 'No calls match', line: 'Clear a filter or widen the distance.' };
    return { title: 'No open calls yet', line: signedIn ? 'Post the first one with the + button.' : 'Sign in to post the first one.' };
  }
  if (tab === 'cast') {
    if (filtered) return { title: 'Nobody matches yet', line: 'Widen the age range or clear a filter.' };
    return { title: 'No performers listed yet', line: signedIn ? 'Turn on Performer on your card and you’ll be first.' : 'Sign in and turn on Performer on your card.' };
  }
  if (tab === 'gear') {
    if (filtered) return { title: 'No gear matches', line: 'Try another category or widen the distance.' };
    return { title: 'No gear listed yet', line: 'Add yours on your working card.' };
  }
  if (filtered) return { title: 'Nobody matches yet', line: 'Widen the distance or clear a filter.' };
  return { title: 'No one’s on the board yet', line: signedIn && !hasCard ? 'Set up your card and you’ll be the first.' : 'The first cards land here, nearest first. Work gets posted on Calls.' };
}

// The words on the "Free right now?" strip for someone with a card.
export function freeStrip(untilIso, now = Date.now()) {
  const on = Boolean(untilIso) && Date.parse(untilIso) > now;
  if (on) return { on: true, title: `⚡ Free until ${clockTime(untilIso)}`, line: CREW_WORDS.free.onLine, button: CREW_WORDS.free.off };
  return { on: false, title: CREW_WORDS.free.ask, line: CREW_WORDS.free.askLine, button: CREW_WORDS.free.button };
}
