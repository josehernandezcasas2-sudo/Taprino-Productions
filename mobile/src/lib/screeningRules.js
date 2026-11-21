// Private screening links (migration 128): the rules, limits and words the
// website and the app share. Jose, 2026-11-21: a creator makes as many
// private links to a film or a show as they want, each with its own
// password, its own start and end, its own list of who watched (a signed-in
// name or a guest, roughly where, on what device, how much), optionally
// only for signed-in or named people, optionally only in some countries,
// with limits on opens and one screen at a time; an ended link never works
// again and is discarded or run again with a new address and password.
// The canvas: https://claude.ai/artifact/BJ7dCjjTiHJiHayKFDSbVD. These
// replace the production screeners of migration 109 (old ones keep working
// until their date, without a password).
//
// Pure, no imports: mobile/src/lib/screeningRules.js is this file word for
// word (scripts/test-screening-rules.mjs checks). Server code (lib/screenings.js)
// and both clients build every label, number and sentence here.

export const SCREENING = {
  maxDays: 90,           // the longest a window can be
  minMinutes: 15,        // the shortest
  aheadDays: 365,        // how far ahead a window can start
  maxOpens: 500,
  defaultOpens: 25,
  perPersonMax: 20,
  defaultPerPerson: 3,
  labelMax: 80,
  emailMax: 120,
  passwordMin: 8,
  passwordMax: 64,
  maxNamed: 50,          // accounts + emails on one link
  maxCountries: 30,
  maxEpisodes: 200,      // picked episodes on one link
  screenHoldSeconds: 120, // a screen frees up this long after its last beat while playing
  beatSeconds: 20,
  wrongTriesLock: 5,     // wrong passwords from one place in an hour → locked there for an hour
  lockMinutes: 60,
  guessAlert: 20,        // wrong passwords on one link in a day → the owner is told
  sessionHours: 12,      // one open covers a visit this long
  srcSeconds: 1800,      // a signed video address lasts half an hour (play asks again)
  newPerDay: 40,         // new links (and runs again) per account per day
  twoCitiesHours: 6,     // two cities this close together → a heads-up
  keepDaysAfterEnd: 365  // viewer details are deleted this long after a link ends
};

export const SCREENING_WORDS = {
  tab: 'Private screenings',
  intro: 'Links that play {title} for the people you choose. Each one has its own password, its own dates, and its own list of who watched.',
  newLink: '+ New link',
  emptyTitle: 'No links yet',
  emptyLine: 'Make one for a festival, a distributor, the press or your cast and crew. You decide when it works, who can open it and how many times.',
  endedHead: 'Ended',
  endedLine: 'An ended link never works again. Discard it, or run it again with a new address and a new password.',
  showNote: 'A link can play the whole show, one season, or the episodes you pick.',
  copyLink: 'Copy link',
  copyPassword: 'Copy password',
  copyInvite: 'Copy the invite',
  shareInvite: 'Share the invite',
  emailLink: 'Email the link',
  open: 'Open ›',
  copied: 'Copied',
  runAgain: 'Run it again',
  discard: 'Discard…',
  discardAsk: 'Discard “{label}”?',
  discardLine: 'The link and its list of who watched are removed for good. Your title’s numbers don’t change: screenings were never counted there.',
  discardYes: 'Discard it',
  keep: 'Keep it',
  endNow: 'End it now…',
  endAsk: 'End “{label}” now?',
  endLine: 'The link stops at once and for good; whoever’s watching is stopped too. You can run it again with a new address and password.',
  endYes: 'End it now',
  editSettings: 'Edit settings',
  newPassword: 'New password',
  newPasswordLine: 'A new password asks anyone watching to type it. The end can move earlier or later while it’s live.',
  readyHead: 'Your link is ready',
  readyLine: '“Copy the invite” copies a short note: what it is, the link, the dates, and “Please don’t forward it.” Tick the box to put the password in it too.',
  includePassword: 'Put the password in the invite',
  passwordHint: 'We made this one up; type your own if you’d rather (8 characters or more). Send it separately from the link if you can: a text for the password, an email for the link.',
  windowHint: 'Pacific time. Before it starts the page says when it opens; after it ends it never plays again. Up to 90 days.',
  placeHint: 'Read from the connection, so it’s a country, never an address, and a VPN shows the VPN’s country.',
  placeNote: 'From the connection: a city, never an address. A VPN shows the VPN’s city.',
  oneScreenLabel: 'One screen at a time',
  oneScreenLine: 'A second screen is turned away while it plays somewhere. It frees up 2 minutes after it stops.',
  notifyHint: 'You’re always told when it ends, and if someone keeps getting the password wrong.',
  againHead: 'A new link with the same settings',
  againLine: 'The old link’s viewer list stays with the old link until you discard it.',
  makeLink: 'Make the link',
  makeAgain: 'Make the new link',
  changeFirst: 'Change something first',
  save: 'Save',
  cancel: 'Cancel',
  whoWatched: 'Who watched',
  newestFirst: 'Newest first',
  nobodyYet: 'Nobody has opened it yet.',
  turnedAway: 'Turned away',
  turnedAwayLine: 'Tries the link stopped. Nothing played.',
  whereOpened: 'Where it was opened',
  settings: 'Settings',
  whenItWorks: 'When it works',
  timelineKey: 'White dots: opens · red: turned away',
  notYours: 'Only whoever runs this title makes its screening links.',
  needsUpdate: 'Private screenings need a database update (migration 128).',
  distributionLine: 'Screening links are made on the title’s own page now, under Private screenings.',
  distributionGo: 'Private screenings for {title} ›',
  legacy: 'Made on the Distribution page: no password'
};

export const ACCESS = [
  { key: 'anyone', label: 'Anyone with the link and the password', short: 'Anyone with the password', blurb: 'Someone not signed in shows on your list as “Guest”, with their city and device.' },
  { key: 'signed_in', label: 'Only people signed in to Studio Tapa', short: 'Signed-in accounts only', blurb: 'They sign in (or make a free account) first, and you see each person’s name.' },
  { key: 'named', label: 'Only people I name', short: 'Only people I name', blurb: 'Pick accounts, or type emails: they must sign in with that address. Everyone else is turned away.' }
];
export const ACCESS_KEYS = ACCESS.map((a) => a.key);

export const NOTIFY = [
  { key: 'every', label: 'Every open' },
  { key: 'first', label: 'First open by each person' },
  { key: 'daily', label: 'A daily summary' },
  { key: 'never', label: 'Never' }
];
export const NOTIFY_KEYS = NOTIFY.map((n) => n.key);

// What a link plays. A film or a short (or any title of its own) plays
// itself; a show's link plays the whole show (episodes approved later
// included), one season, or the episodes picked (both kept as picked).
export const SCOPES = [
  { key: 'title', label: 'This title' },
  { key: 'show', label: 'Whole show' },
  { key: 'season', label: 'One season' },
  { key: 'episodes', label: 'Pick episodes…' }
];

export const QUICK_WINDOWS = [
  { key: 'tonight', label: 'Tonight only', days: 0 },
  { key: '3d', label: '3 days', days: 3 },
  { key: 'week', label: 'A week', days: 7 },
  { key: '2weeks', label: 'Two weeks', days: 14 },
  { key: 'month', label: 'A month', days: 30 }
];
export const DEFAULT_WINDOW = '2weeks';

export const DEFAULT_LINK = {
  access: 'anyone',
  maxViews: SCREENING.defaultOpens,
  perPerson: SCREENING.defaultPerPerson,
  oneScreen: true,
  countries: [],
  notify: 'first'
};

// Why a try was turned away: the dashboard's words. Nothing played.
export const REFUSALS = {
  password: 'Wrong password',
  locked: 'Locked out after wrong passwords',
  country: 'Outside the countries you set',
  screen: 'A second screen',
  opens: 'No opens left on the link',
  person_opens: 'Their opens used up',
  named: 'Not one of the people you named'
};
export const REFUSAL_KEYS = Object.keys(REFUSALS);

/* ---------- small helpers ---------- */

const PT = 'America/Los_Angeles';
const ms = (v) => {
  if (v == null || v === '') return NaN;
  if (typeof v === 'number') return v;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : NaN;
};
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const fill = (s, vars) => String(s).replace(/\{(\w+)\}/g, (m, k) => (vars && vars[k] != null ? String(vars[k]) : m));
export function screeningText(key, vars) {
  return fill(SCREENING_WORDS[key] || '', vars);
}

// "Dec 5" / "Dec 5, 2027" when not this year (in Pacific time, or the zone given).
export function dayLabel(v, { timeZone = PT, now = Date.now() } = {}) {
  const t = ms(v);
  if (!Number.isFinite(t)) return '';
  const d = new Date(t);
  const year = d.toLocaleDateString('en-US', { year: 'numeric', timeZone });
  const thisYear = new Date(ms(now)).toLocaleDateString('en-US', { year: 'numeric', timeZone });
  return d.toLocaleDateString('en-US', year === thisYear ? { month: 'short', day: 'numeric', timeZone } : { month: 'short', day: 'numeric', year: 'numeric', timeZone });
}

// "11:59 PM"
export function timeLabel(v, { timeZone = PT } = {}) {
  const t = ms(v);
  if (!Number.isFinite(t)) return '';
  return new Date(t).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone });
}

// "PST" / "PDT" (only for Pacific: the viewer's own zone shows no abbreviation).
function zoneTag(v, timeZone) {
  if (timeZone !== PT) return '';
  const t = ms(v);
  if (!Number.isFinite(t)) return '';
  const offset = pacificOffsetMinutes(t);
  return offset === -420 ? 'PDT' : 'PST';
}

// "Dec 5 · 11:59 PM PST"
export function whenLabel(v, { timeZone = PT, now = Date.now(), zone = true } = {}) {
  const t = ms(v);
  if (!Number.isFinite(t)) return '';
  const tag = zone ? zoneTag(t, timeZone) : '';
  return `${dayLabel(t, { timeZone, now })} · ${timeLabel(t, { timeZone })}${tag ? ` ${tag}` : ''}`;
}

// "Today, 2:14 PM" / "Yesterday, 10:02 AM" / "Nov 19, 4:50 PM" (Pacific).
export function agoLabel(v, now = Date.now(), { timeZone = PT } = {}) {
  const t = ms(v);
  if (!Number.isFinite(t)) return '';
  const day = (x) => new Date(x).toLocaleDateString('en-CA', { timeZone });
  const today = day(ms(now));
  const yesterday = day(ms(now) - 86400000);
  const d = day(t);
  const time = timeLabel(t, { timeZone });
  if (d === today) return `Today, ${time}`;
  if (d === yesterday) return `Yesterday, ${time}`;
  return `${dayLabel(t, { timeZone, now })}, ${time}`;
}

/* ---------- Pacific wall time ---------- */

// The parts of `t` on the Pacific clock: { y, m, d, hh, mm }.
// An engine whose date formatting can't be read this way (a phone's, perhaps)
// falls back to the US Pacific rule itself: daylight time from 2:00 AM on the
// second Sunday of March to 2:00 AM on the first Sunday of November.
export function pacificOffsetByRule(t) {
  const at = ms(t);
  const y = new Date(at).getUTCFullYear();
  const sunday = (month, n) => { const first = new Date(Date.UTC(y, month, 1)).getUTCDay(); return 1 + ((7 - first) % 7) + (n - 1) * 7; };
  const start = Date.UTC(y, 2, sunday(2, 2), 10); // 2:00 AM PST
  const end = Date.UTC(y, 10, sunday(10, 1), 9);  // 2:00 AM PDT
  return at >= start && at < end ? -420 : -480;
}

export function pacificParts(t) {
  const at = ms(t);
  if (!Number.isFinite(at)) return null;
  let s = '';
  try {
    s = new Date(at).toLocaleString('en-US', { timeZone: PT, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  } catch (err) {
    s = '';
  }
  const m = /(\d{2})\/(\d{2})\/(\d{4}),?\s+(\d{1,2}):(\d{2})/.exec(s);
  if (m) return { y: Number(m[3]), m: Number(m[1]), d: Number(m[2]), hh: Number(m[4]) % 24, mm: Number(m[5]) };
  const d = new Date(at + pacificOffsetByRule(at) * 60000);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), hh: d.getUTCHours(), mm: d.getUTCMinutes() };
}

// Minutes the Pacific clock is from UTC at `t` (-480 in winter, -420 in summer).
export function pacificOffsetMinutes(t) {
  const p = pacificParts(t);
  if (!p) return -480;
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm);
  return Math.round((asUtc - Math.floor(ms(t) / 60000) * 60000) / 60000);
}

// The moment a Pacific wall time names (2026-12-05 23:59 → its UTC ms).
export function pacificToMs(y, m, d, hh = 0, mm = 0) {
  let guess = Date.UTC(y, m - 1, d, hh, mm) + 8 * 3600000;
  for (let i = 0; i < 3; i += 1) {
    const p = pacificParts(guess);
    if (!p) break;
    const want = Date.UTC(y, m - 1, d, hh, mm);
    const have = Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm);
    if (want === have) break;
    guess += want - have;
  }
  return guess;
}

// "2026-12-05T23:59" (a datetime-local value on the Pacific clock) ↔ an ISO moment.
export function toPacificInput(v) {
  const p = pacificParts(v);
  if (!p) return '';
  const two = (n) => String(n).padStart(2, '0');
  return `${p.y}-${two(p.m)}-${two(p.d)}T${two(p.hh)}:${two(p.mm)}`;
}
export function fromPacificInput(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})$/.exec(String(s || '').trim());
  if (!m) return null;
  const [y, mo, d, hh, mm] = m.slice(1).map(Number);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || hh > 23 || mm > 59) return null;
  return new Date(pacificToMs(y, mo, d, hh, mm)).toISOString();
}

// A quick pick → { startsAt, endsAt }: from now until 11:59 PM Pacific on
// the last day ("Tonight only" = today, or tomorrow after 11 PM).
export function windowFor(key, now = Date.now()) {
  const q = QUICK_WINDOWS.find((w) => w.key === key) || QUICK_WINDOWS.find((w) => w.key === DEFAULT_WINDOW);
  const start = ms(now);
  const p = pacificParts(start);
  let days = q.days;
  if (days === 0 && p && p.hh >= 23) days = 1;
  const base = Date.UTC(p.y, p.m - 1, p.d) + days * 86400000;
  const e = new Date(base);
  const end = pacificToMs(e.getUTCFullYear(), e.getUTCMonth() + 1, e.getUTCDate(), 23, 59);
  return { startsAt: new Date(start).toISOString(), endsAt: new Date(Math.min(end, start + SCREENING.maxDays * 86400000)).toISOString() };
}

// "2 days, 4 hours" / "3 hours, 12 minutes" / "12 minutes" / "a minute".
export function opensIn(v, now = Date.now()) {
  const left = Math.max(0, ms(v) - ms(now));
  const mins = Math.ceil(left / 60000);
  if (mins <= 1) return 'a minute';
  const days = Math.floor(mins / 1440);
  const hours = Math.floor((mins % 1440) / 60);
  const minutes = mins % 60;
  if (days > 0) return hours ? `${plural(days, 'day', 'days')}, ${plural(hours, 'hour', 'hours')}` : plural(days, 'day', 'days');
  if (hours > 0) return minutes ? `${plural(hours, 'hour', 'hours')}, ${plural(minutes, 'minute', 'minutes')}` : plural(hours, 'hour', 'hours');
  return plural(minutes, 'minute', 'minutes');
}

/* ---------- the password ---------- */

export const PASSWORD_WORDS = [
  'amber', 'anchor', 'apple', 'arrow', 'aspen', 'atlas', 'autumn', 'badge', 'banjo', 'basil', 'beacon', 'bison', 'blossom', 'bramble', 'breeze', 'bridge',
  'brook', 'cabin', 'cactus', 'camera', 'candle', 'canyon', 'cedar', 'cello', 'chalk', 'cherry', 'cinder', 'circus', 'citrus', 'clover', 'cobalt', 'comet',
  'copper', 'coral', 'cosmos', 'cotton', 'cove', 'crane', 'crater', 'creek', 'cricket', 'crystal', 'cypress', 'dahlia', 'delta', 'desert', 'dune', 'eagle',
  'echo', 'ember', 'falcon', 'fern', 'fiddle', 'fjord', 'flint', 'forest', 'fossil', 'fox', 'frost', 'galaxy', 'garnet', 'geyser', 'ginger', 'glacier',
  'granite', 'grove', 'harbor', 'hazel', 'heron', 'hollow', 'honey', 'horizon', 'iris', 'island', 'ivory', 'jade', 'jasper', 'jungle', 'juniper', 'kelp',
  'kettle', 'kite', 'lagoon', 'lantern', 'laurel', 'lemon', 'lilac', 'linen', 'lotus', 'lunar', 'maple', 'marble', 'marsh', 'meadow', 'melon', 'mesa',
  'meteor', 'mint', 'mirror', 'mist', 'monsoon', 'moss', 'nectar', 'needle', 'nova', 'oasis', 'ocean', 'olive', 'onyx', 'opal', 'orbit', 'orchard',
  'otter', 'paddle', 'palm', 'paper', 'pebble', 'pepper', 'piano', 'pine', 'planet', 'plum', 'pollen', 'poppy', 'prairie', 'prism', 'quartz', 'quill',
  'rain', 'raven', 'reed', 'reef', 'ribbon', 'ridge', 'river', 'robin', 'rocket', 'rose', 'saffron', 'sage', 'salt', 'satin', 'scarlet', 'shadow',
  'shell', 'sierra', 'silver', 'sky', 'slate', 'snow', 'sonnet', 'sparrow', 'spruce', 'star', 'stone', 'storm', 'summit', 'sunset', 'swan', 'tango',
  'thistle', 'thunder', 'tide', 'timber', 'topaz', 'tulip', 'tundra', 'valley', 'velvet', 'violet', 'walnut', 'willow', 'winter', 'wren', 'yarrow', 'zephyr'
];

// A suggestion like "tide-lantern-42". `pick(n)` answers a whole number in
// [0, n): crypto.randomInt on the server.
export function suggestPassword(pick) {
  const n = PASSWORD_WORDS.length;
  const a = PASSWORD_WORDS[pick(n)];
  let b = PASSWORD_WORDS[pick(n)];
  if (b === a) b = PASSWORD_WORDS[(PASSWORD_WORDS.indexOf(a) + 1 + pick(n - 1)) % n];
  return `${a}-${b}-${10 + pick(90)}`;
}

// The password the way it's checked: trimmed, and never longer than the limit.
export function cleanPassword(v) {
  return String(v == null ? '' : v).trim().slice(0, SCREENING.passwordMax);
}

/* ---------- countries ---------- */

export const COUNTRIES = [
  ['US', 'United States'], ['CA', 'Canada'], ['MX', 'Mexico'], ['GB', 'United Kingdom'], ['IE', 'Ireland'], ['FR', 'France'], ['DE', 'Germany'], ['ES', 'Spain'],
  ['IT', 'Italy'], ['PT', 'Portugal'], ['NL', 'Netherlands'], ['BE', 'Belgium'], ['LU', 'Luxembourg'], ['CH', 'Switzerland'], ['AT', 'Austria'], ['DK', 'Denmark'],
  ['SE', 'Sweden'], ['NO', 'Norway'], ['FI', 'Finland'], ['IS', 'Iceland'], ['PL', 'Poland'], ['CZ', 'Czechia'], ['SK', 'Slovakia'], ['HU', 'Hungary'],
  ['RO', 'Romania'], ['BG', 'Bulgaria'], ['GR', 'Greece'], ['HR', 'Croatia'], ['SI', 'Slovenia'], ['RS', 'Serbia'], ['BA', 'Bosnia and Herzegovina'], ['ME', 'Montenegro'],
  ['MK', 'North Macedonia'], ['AL', 'Albania'], ['EE', 'Estonia'], ['LV', 'Latvia'], ['LT', 'Lithuania'], ['UA', 'Ukraine'], ['MD', 'Moldova'], ['BY', 'Belarus'],
  ['RU', 'Russia'], ['GE', 'Georgia'], ['AM', 'Armenia'], ['AZ', 'Azerbaijan'], ['TR', 'Türkiye'], ['CY', 'Cyprus'], ['MT', 'Malta'], ['MC', 'Monaco'],
  ['AD', 'Andorra'], ['SM', 'San Marino'], ['LI', 'Liechtenstein'], ['IL', 'Israel'], ['PS', 'Palestine'], ['JO', 'Jordan'], ['LB', 'Lebanon'], ['SY', 'Syria'],
  ['IQ', 'Iraq'], ['IR', 'Iran'], ['SA', 'Saudi Arabia'], ['AE', 'United Arab Emirates'], ['QA', 'Qatar'], ['BH', 'Bahrain'], ['KW', 'Kuwait'], ['OM', 'Oman'],
  ['YE', 'Yemen'], ['EG', 'Egypt'], ['LY', 'Libya'], ['TN', 'Tunisia'], ['DZ', 'Algeria'], ['MA', 'Morocco'], ['SD', 'Sudan'], ['ET', 'Ethiopia'],
  ['KE', 'Kenya'], ['UG', 'Uganda'], ['TZ', 'Tanzania'], ['RW', 'Rwanda'], ['NG', 'Nigeria'], ['GH', 'Ghana'], ['CI', 'Côte d’Ivoire'], ['SN', 'Senegal'],
  ['CM', 'Cameroon'], ['ZA', 'South Africa'], ['ZW', 'Zimbabwe'], ['ZM', 'Zambia'], ['BW', 'Botswana'], ['NA', 'Namibia'], ['MZ', 'Mozambique'], ['AO', 'Angola'],
  ['MG', 'Madagascar'], ['MU', 'Mauritius'], ['CD', 'DR Congo'], ['CG', 'Congo'], ['ML', 'Mali'], ['BF', 'Burkina Faso'], ['NE', 'Niger'], ['TD', 'Chad'],
  ['SO', 'Somalia'], ['ER', 'Eritrea'], ['DJ', 'Djibouti'], ['IN', 'India'], ['PK', 'Pakistan'], ['BD', 'Bangladesh'], ['LK', 'Sri Lanka'], ['NP', 'Nepal'],
  ['BT', 'Bhutan'], ['MV', 'Maldives'], ['AF', 'Afghanistan'], ['KZ', 'Kazakhstan'], ['UZ', 'Uzbekistan'], ['KG', 'Kyrgyzstan'], ['TJ', 'Tajikistan'], ['TM', 'Turkmenistan'],
  ['MN', 'Mongolia'], ['CN', 'China'], ['HK', 'Hong Kong'], ['MO', 'Macao'], ['TW', 'Taiwan'], ['JP', 'Japan'], ['KR', 'South Korea'], ['KP', 'North Korea'],
  ['VN', 'Vietnam'], ['TH', 'Thailand'], ['LA', 'Laos'], ['KH', 'Cambodia'], ['MM', 'Myanmar'], ['MY', 'Malaysia'], ['SG', 'Singapore'], ['ID', 'Indonesia'],
  ['PH', 'Philippines'], ['BN', 'Brunei'], ['TL', 'Timor-Leste'], ['AU', 'Australia'], ['NZ', 'New Zealand'], ['PG', 'Papua New Guinea'], ['FJ', 'Fiji'], ['WS', 'Samoa'],
  ['TO', 'Tonga'], ['VU', 'Vanuatu'], ['SB', 'Solomon Islands'], ['GU', 'Guam'], ['PR', 'Puerto Rico'], ['VI', 'U.S. Virgin Islands'], ['CU', 'Cuba'], ['DO', 'Dominican Republic'],
  ['HT', 'Haiti'], ['JM', 'Jamaica'], ['TT', 'Trinidad and Tobago'], ['BS', 'Bahamas'], ['BB', 'Barbados'], ['GT', 'Guatemala'], ['BZ', 'Belize'], ['HN', 'Honduras'],
  ['SV', 'El Salvador'], ['NI', 'Nicaragua'], ['CR', 'Costa Rica'], ['PA', 'Panama'], ['CO', 'Colombia'], ['VE', 'Venezuela'], ['EC', 'Ecuador'], ['PE', 'Peru'],
  ['BO', 'Bolivia'], ['BR', 'Brazil'], ['PY', 'Paraguay'], ['UY', 'Uruguay'], ['AR', 'Argentina'], ['CL', 'Chile'], ['GY', 'Guyana'], ['SR', 'Suriname'],
  ['GL', 'Greenland'], ['BM', 'Bermuda'], ['KY', 'Cayman Islands'], ['AW', 'Aruba'], ['CW', 'Curaçao']
];
const COUNTRY_NAMES = COUNTRIES.reduce((acc, [c, n]) => { acc[c] = n; return acc; }, {});

export function countryName(code) {
  const c = String(code || '').toUpperCase();
  return COUNTRY_NAMES[c] || c || '';
}

// A list of codes, cleaned: known two-letter codes only, no repeats, at most maxCountries.
export function normalizeCountries(list) {
  const out = [];
  for (const raw of Array.isArray(list) ? list : []) {
    const c = String(raw || '').trim().toUpperCase();
    if (COUNTRY_NAMES[c] && !out.includes(c)) out.push(c);
    if (out.length >= SCREENING.maxCountries) break;
  }
  return out;
}

// "Anywhere" / "Only in the United States" / "Only in Canada and Mexico" / "Only in 4 countries".
export function countriesLine(codes) {
  const list = normalizeCountries(codes);
  if (!list.length) return 'Anywhere';
  const names = list.map((c) => (c === 'US' ? 'the United States' : c === 'GB' ? 'the United Kingdom' : countryName(c)));
  if (names.length === 1) return `Only in ${names[0]}`;
  if (names.length === 2) return `Only in ${names[0]} and ${names[1]}`;
  if (names.length === 3) return `Only in ${names[0]}, ${names[1]} and ${names[2]}`;
  return `Only in ${names.length} countries`;
}

/* ---------- the viewer's place and device ---------- */

// "Los Angeles, CA" (United States) / "Toronto, ON, Canada" / "Canada" / "Place unknown".
export function placeLabel(p) {
  const city = String((p && p.city) || '').trim();
  const region = String((p && p.region) || '').trim();
  const country = String((p && p.country) || '').trim().toUpperCase();
  if (!city && !country) return 'Place unknown';
  if (!city) return countryName(country);
  if (country === 'US') return region ? `${city}, ${region}` : city;
  return [city, region, countryName(country)].filter(Boolean).join(', ');
}

// "iPhone · Safari" from a browser's user agent.
export function deviceLabel(ua) {
  const s = String(ua || '');
  if (!s) return 'A device we couldn’t tell';
  let device = 'Computer';
  if (/iPhone/.test(s)) device = 'iPhone';
  else if (/iPad/.test(s)) device = 'iPad';
  else if (/Android/.test(s)) device = /Mobile/.test(s) ? 'Android phone' : 'Android tablet';
  else if (/SmartTV|SMART-TV|Tizen|Web0S|AppleTV|CrKey|BRAVIA/i.test(s)) device = 'TV';
  else if (/CrOS/.test(s)) device = 'Chromebook';
  else if (/Windows/.test(s)) device = 'Windows';
  else if (/Macintosh|Mac OS X/.test(s)) device = 'Mac';
  else if (/Linux/.test(s)) device = 'Linux';
  let browser = '';
  if (/Edg\//.test(s) || /EdgiOS|EdgA/.test(s)) browser = 'Edge';
  else if (/OPR\/|Opera/.test(s)) browser = 'Opera';
  else if (/SamsungBrowser/.test(s)) browser = 'Samsung Internet';
  else if (/Firefox|FxiOS/.test(s)) browser = 'Firefox';
  else if (/Chrome|CriOS/.test(s)) browser = 'Chrome';
  else if (/Safari/.test(s)) browser = 'Safari';
  return browser ? `${device} · ${browser}` : device;
}

/* ---------- a link's state ---------- */

// → { key: 'scheduled' | 'live' | 'full' | 'ended', reason?: 'stopped' | 'over', label, tone }
// `you` = how the owner is named ("you" on the creator's pages, their name for a viewer).
export function linkState(link, now = Date.now(), { you = 'you' } = {}) {
  const t = ms(now);
  if (!link) return { key: 'ended', reason: 'over', label: 'Ended', tone: 'dim' };
  if (link.endedAt) return { key: 'ended', reason: 'stopped', label: `Stopped by ${you} ${dayLabel(link.endedAt, { now })}`, tone: 'danger' };
  if (ms(link.endsAt) <= t) return { key: 'ended', reason: 'over', label: `Ended ${dayLabel(link.endsAt, { now })}`, tone: 'dim' };
  if (ms(link.startsAt) > t) return { key: 'scheduled', label: 'Opens later', tone: 'sky' };
  if ((link.views || 0) >= (link.maxViews || 0)) return { key: 'full', label: 'No opens left', tone: 'warn' };
  return { key: 'live', label: 'Live', tone: 'ok' };
}
export const isEnded = (link, now) => linkState(link, now).key === 'ended';

// "Ends Dec 5 · 11:59 PM PST" / "Ends in 3 days · Nov 24" / "Opens Nov 24 · 7:00 PM PST" / "Ended Nov 18" / "Stopped by you Nov 10"
export function windowLine(link, now = Date.now()) {
  const st = linkState(link, now);
  if (st.key === 'ended') return st.label;
  if (st.key === 'scheduled') return `Opens ${whenLabel(link.startsAt, { now })}`;
  const left = ms(link.endsAt) - ms(now);
  if (left < 4 * 86400000 && left > 86400000) return `Ends in ${plural(Math.floor(left / 86400000), 'day', 'days')} · ${dayLabel(link.endsAt, { now })}`;
  if (left <= 86400000) return `Ends ${agoLabel(link.endsAt, now).replace(/^Today, /, 'today, ').replace(/^Yesterday, /, 'yesterday, ')}`;
  return `Ends ${whenLabel(link.endsAt, { now })}`;
}
export function endsSoon(link, now = Date.now()) {
  const st = linkState(link, now);
  return (st.key === 'live' || st.key === 'full') && ms(link.endsAt) - ms(now) < 4 * 86400000;
}

// 0–1: how far through its window a link is.
export function windowProgress(link, now = Date.now()) {
  const a = ms(link.startsAt);
  const b = ms(link.endsAt);
  if (!(b > a)) return 0;
  return Math.max(0, Math.min(1, (ms(now) - a) / (b - a)));
}

// What can still be done to a link.
export function linkActions(link, now = Date.now()) {
  const st = linkState(link, now);
  const ended = st.key === 'ended';
  return {
    copy: !ended,
    edit: !ended,
    editStart: st.key === 'scheduled',
    newPassword: !ended && !link.legacy,
    end: !ended,
    discard: ended,
    runAgain: ended
  };
}

// The window a link run again gets: from now, as long as the old one (at most 90 days).
export function againWindow(link, now = Date.now()) {
  const len = Math.max(SCREENING.minMinutes * 60000, ms(link.endsAt) - ms(link.startsAt));
  const start = ms(now);
  return { startsAt: new Date(start).toISOString(), endsAt: new Date(start + Math.min(len, SCREENING.maxDays * 86400000)).toISOString() };
}

/* ---------- checking what a creator sends ---------- */

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const USER_ID = /^[A-Za-z0-9_-]{3,64}$/;
const TITLE_ID = /^[A-Za-z0-9_-]{1,120}$/;

function cleanLine(v, max) {
  return String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

// A link's settings, checked. `input` is what a form sends; `target` is
// { type: 'episode' | 'series', seasons: [numbers], episodeIds: [ids the show can screen] };
// `existing` is the link being edited (null for a new one).
// → { ok: true, value } | { ok: false, error, field }
export function validateLink(input, { now = Date.now(), target = { type: 'episode' }, existing = null } = {}) {
  const src = input && typeof input === 'object' ? input : {};
  const bad = (field, error) => ({ ok: false, field, error });
  const t = ms(now);
  const value = {};

  const label = cleanLine(src.label != null ? src.label : existing && existing.label, SCREENING.labelMax);
  if (label.length < 2) return bad('label', 'Say who the link is for.');
  value.label = label;

  const email = cleanLine(src.recipientEmail != null ? src.recipientEmail : existing ? existing.recipientEmail : '', SCREENING.emailMax).toLowerCase();
  if (email && !EMAIL.test(email)) return bad('recipientEmail', 'That email doesn’t look right.');
  value.recipientEmail = email || null;

  if (!existing) {
    if (target.type === 'series') {
      const scope = ['show', 'season', 'episodes'].includes(src.scope) ? src.scope : 'show';
      value.scope = scope;
      if (scope === 'season') {
        const season = Math.round(Number(src.season));
        if (!Array.isArray(target.seasons) || !target.seasons.includes(season)) return bad('season', 'Pick one of the show’s seasons.');
        value.season = season;
      }
      if (scope === 'episodes') {
        const allowed = new Set(Array.isArray(target.episodeIds) ? target.episodeIds : []);
        const ids = [];
        for (const id of Array.isArray(src.episodeIds) ? src.episodeIds : []) {
          const s = String(id || '');
          if (TITLE_ID.test(s) && allowed.has(s) && !ids.includes(s)) ids.push(s);
        }
        if (!ids.length) return bad('episodeIds', 'Pick at least one episode.');
        if (ids.length > SCREENING.maxEpisodes) return bad('episodeIds', `Up to ${SCREENING.maxEpisodes} episodes on one link.`);
        value.episodeIds = ids;
      }
    } else {
      value.scope = 'title';
    }
  }

  // The window.
  const startsInput = src.startsAt != null ? src.startsAt : existing ? existing.startsAt : null;
  let starts = ms(startsInput);
  const endsInput = src.endsAt != null ? src.endsAt : existing ? existing.endsAt : null;
  const ends = ms(endsInput);
  const started = existing && ms(existing.startsAt) <= t;
  if (started) starts = ms(existing.startsAt);
  else if (!Number.isFinite(starts) || starts < t) starts = t;
  if (!started && starts > t + SCREENING.aheadDays * 86400000) return bad('startsAt', 'A link can start up to a year from now.');
  if (!Number.isFinite(ends)) return bad('endsAt', 'Pick when the link stops working.');
  if (ends <= t) return bad('endsAt', 'The end has to be later than now.');
  if (ends - starts < SCREENING.minMinutes * 60000) return bad('endsAt', 'A link works for at least 15 minutes.');
  if (ends - starts > SCREENING.maxDays * 86400000 + 60000) return bad('endsAt', 'A link works for 90 days at most.');
  if (!started || !existing) value.startsAt = new Date(starts).toISOString();
  value.endsAt = new Date(ends).toISOString();

  // The password (new links, and links without one, need it; an edit that sends none keeps the old one).
  const legacy = Boolean(existing && existing.legacy);
  if (src.password != null || !existing) {
    const pw = cleanPassword(src.password);
    if (!legacy || pw) {
      if (pw.length < SCREENING.passwordMin) return bad('password', 'The password needs 8 characters or more.');
      if (/\s/.test(pw)) return bad('password', 'Leave spaces out of the password.');
      value.password = pw;
    }
  }

  const access = src.access != null ? src.access : existing ? existing.access : DEFAULT_LINK.access;
  if (!ACCESS_KEYS.includes(access)) return bad('access', 'Pick who can open it.');
  value.access = access;
  const named = src.named != null ? src.named : existing ? existing.named : { userIds: [], emails: [] };
  const userIds = [];
  const emails = [];
  for (const id of Array.isArray(named && named.userIds) ? named.userIds : []) {
    const s = String(id || '').trim();
    if (USER_ID.test(s) && !userIds.includes(s)) userIds.push(s);
  }
  for (const e of Array.isArray(named && named.emails) ? named.emails : []) {
    const s = cleanLine(e, SCREENING.emailMax).toLowerCase();
    if (!s) continue;
    if (!EMAIL.test(s)) return bad('named', `“${s}” doesn’t look like an email.`);
    if (!emails.includes(s)) emails.push(s);
  }
  if (userIds.length + emails.length > SCREENING.maxNamed) return bad('named', `Up to ${SCREENING.maxNamed} people on one link.`);
  if (access === 'named' && !userIds.length && !emails.length) return bad('named', 'Name at least one person, by account or email.');
  value.named = { userIds: access === 'named' ? userIds : [], emails: access === 'named' ? emails : [] };

  const maxViews = Math.round(Number(src.maxViews != null ? src.maxViews : existing ? existing.maxViews : DEFAULT_LINK.maxViews));
  if (!(maxViews >= 1 && maxViews <= SCREENING.maxOpens)) return bad('maxViews', `Opens in total: 1 to ${SCREENING.maxOpens}.`);
  if (existing && maxViews < (existing.views || 0)) return bad('maxViews', `It’s been opened ${existing.views} times already, so the total can’t go under that.`);
  value.maxViews = maxViews;

  const perRaw = src.perPerson !== undefined ? src.perPerson : existing ? existing.perPerson : DEFAULT_LINK.perPerson;
  if (perRaw === null || perRaw === '' || perRaw === 0 || perRaw === '0') value.perPerson = null;
  else {
    const per = Math.round(Number(perRaw));
    if (!(per >= 1 && per <= SCREENING.perPersonMax)) return bad('perPerson', `Each person: 1 to ${SCREENING.perPersonMax} times, or no limit.`);
    value.perPerson = per;
  }

  const one = src.oneScreen !== undefined ? src.oneScreen : existing ? existing.oneScreen : DEFAULT_LINK.oneScreen;
  value.oneScreen = one === true;

  value.countries = normalizeCountries(src.countries !== undefined ? src.countries : existing ? existing.countries : DEFAULT_LINK.countries);
  if (Array.isArray(src.countries) && src.countries.length && !value.countries.length) return bad('countries', 'Pick countries from the list.');

  const notify = src.notify != null ? src.notify : existing ? existing.notify : DEFAULT_LINK.notify;
  if (!NOTIFY_KEYS.includes(notify)) return bad('notify', 'Pick when you’re told.');
  value.notify = notify;

  return { ok: true, value };
}

/* ---------- people, places and numbers (from the server's rows) ---------- */

// The server's view rows: { id, userId, name, handle, avatar, deviceKey, city, region,
// country, device, openedAt, lastPlayAt, lastBeatAt, episodeId, position,
// watched: { [episodeId]: [seconds, duration] } }.
// Refusal rows: { id, reason, userId, name, deviceKey, city, region, country, device, at }.

export function personKey(row) {
  if (row && row.userId) return `u:${row.userId}`;
  if (row && row.deviceKey) return `d:${row.deviceKey}`;
  return `v:${row && row.id}`;
}

export function holdsScreen(row, now = Date.now()) {
  return Boolean(row && row.lastPlayAt && ms(now) - ms(row.lastPlayAt) < SCREENING.screenHoldSeconds * 1000);
}

function watchedOf(rows) {
  const best = {};
  for (const r of rows) {
    const w = r && r.watched && typeof r.watched === 'object' ? r.watched : {};
    for (const [ep, pair] of Object.entries(w)) {
      const sec = Math.max(0, Number(Array.isArray(pair) ? pair[0] : pair) || 0);
      const dur = Math.max(0, Number(Array.isArray(pair) ? pair[1] : 0) || 0);
      const prev = best[ep] || [0, 0];
      best[ep] = [Math.max(prev[0], dur ? Math.min(sec, dur) : sec), Math.max(prev[1], dur)];
    }
  }
  let seconds = 0;
  let duration = 0;
  for (const [sec, dur] of Object.values(best)) { seconds += sec; duration += dur; }
  return { seconds: Math.round(seconds), duration: Math.round(duration), episodes: Object.keys(best).length };
}

// "1:32:10" / "58 min" / "24 min" / "under a minute".
export function watchedLabel(seconds, duration) {
  const s = Math.max(0, Math.round(seconds || 0));
  const d = Math.max(0, Math.round(duration || 0));
  if (s < 60) return s > 0 ? 'under a minute' : 'not started';
  if (d && s >= d - 30) return 'all of it';
  if (s >= 3600) {
    const h = Math.floor(s / 3600);
    const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
    const r = String(s % 60).padStart(2, '0');
    return `${h}:${m}:${r}`;
  }
  return `${Math.floor(s / 60)} min`;
}

// "1:12:40" for a position.
export function positionLabel(seconds) {
  const s = Math.max(0, Math.round(seconds || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`;
}

// One entry per person, newest first.
export function peopleFrom(views, link, now = Date.now()) {
  const groups = new Map();
  for (const v of Array.isArray(views) ? views : []) {
    const k = personKey(v);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(v);
  }
  const per = link && link.perPerson ? link.perPerson : null;
  const people = [];
  for (const [key, rows] of groups) {
    rows.sort((a, b) => ms(b.openedAt) - ms(a.openedAt));
    const latest = rows[0];
    const named = rows.find((r) => r.userId) || null;
    const w = watchedOf(rows);
    const percent = w.duration ? Math.min(100, Math.round((w.seconds / w.duration) * 100)) : 0;
    const playing = rows.find((r) => holdsScreen(r, now)) || null;
    const places = [];
    for (const r of [...rows].reverse()) {
      const p = placeLabel(r);
      if (!places.includes(p)) places.push(p);
    }
    let twoCities = false;
    const chron = [...rows].sort((a, b) => ms(a.openedAt) - ms(b.openedAt));
    for (let i = 1; i < chron.length; i += 1) {
      const a = chron[i - 1];
      const b = chron[i];
      if (a.city && b.city && (a.city !== b.city || a.country !== b.country) && ms(b.openedAt) - ms(a.openedAt) < SCREENING.twoCitiesHours * 3600000) twoCities = true;
    }
    let gapHours = null;
    if (twoCities) {
      for (let i = 1; i < chron.length; i += 1) {
        const a = chron[i - 1];
        const b = chron[i];
        if (a.city && b.city && (a.city !== b.city || a.country !== b.country)) { gapHours = Math.max(1, Math.round((ms(b.openedAt) - ms(a.openedAt)) / 3600000)); break; }
      }
    }
    people.push({
      key,
      userId: named ? named.userId : null,
      guest: !named,
      name: named ? (named.name || 'A Studio Tapa member') : 'Guest',
      handle: named ? named.handle || null : null,
      avatar: named ? named.avatar || null : null,
      initials: named ? initialsOf(named.name) : 'G',
      opens: rows.length,
      opensLeft: per ? Math.max(0, per - rows.length) : null,
      maxedOut: per ? rows.length >= per : false,
      firstAt: chron[0].openedAt,
      lastAt: latest.openedAt,
      places,
      placeLine: places.join(' → '),
      device: latest.device || '',
      watchedSeconds: w.seconds,
      durationSeconds: w.duration,
      episodesWatched: w.episodes,
      percent,
      watchedLine: w.seconds ? `${watchedLabel(w.seconds, w.duration)}${w.duration && percent < 100 && w.seconds < w.duration - 30 ? ` · ${percent}%` : ''}` : 'Opened, not played yet',
      watchingNow: Boolean(playing),
      position: playing ? Number(playing.position) || 0 : null,
      twoCities,
      twoCitiesLine: twoCities ? `two cities ${gapHours} ${gapHours === 1 ? 'hour' : 'hours'} apart` : ''
    });
  }
  people.sort((a, b) => ms(b.lastAt) - ms(a.lastAt));
  return people;
}

function initialsOf(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

export function placesFrom(views, refusals) {
  const map = new Map();
  const add = (row, kind) => {
    const p = placeLabel(row);
    if (!map.has(p)) map.set(p, { place: p, opens: 0, refused: 0 });
    map.get(p)[kind] += 1;
  };
  for (const v of Array.isArray(views) ? views : []) add(v, 'opens');
  for (const r of Array.isArray(refusals) ? refusals : []) add(r, 'refused');
  return [...map.values()].sort((a, b) => b.opens - a.opens || b.refused - a.refused).map((p) => ({
    ...p,
    line: p.opens ? plural(p.opens, 'open', 'opens') : plural(p.refused, 'try', 'tries'),
    turnedAway: !p.opens
  }));
}

// The turned-away rows, newest first, one line each (repeats from one place and
// reason within an hour are folded together).
export function refusalRows(refusals, now = Date.now()) {
  const sorted = [...(Array.isArray(refusals) ? refusals : [])].sort((a, b) => ms(b.at) - ms(a.at));
  const out = [];
  for (const r of sorted) {
    const k = `${r.reason}|${r.userId || r.deviceKey || ''}|${placeLabel(r)}`;
    const last = out.find((o) => o.key === k && ms(o.firstAt) - ms(r.at) < 3600000);
    if (last) { last.count += 1; last.firstAt = r.at; continue; }
    out.push({ key: k, reason: r.reason, count: 1, at: r.at, firstAt: r.at, who: r.userId ? r.name || 'A Studio Tapa member' : 'Guest', place: placeLabel(r), device: r.device || '' });
  }
  return out.map((o) => {
    const base = REFUSALS[o.reason] || 'Turned away';
    const what = o.reason === 'password' && o.count > 1 ? `Wrong password, ${o.count} times` : o.count > 1 ? `${base}, ${o.count} times` : base;
    const outcome = o.reason === 'locked' || (o.reason === 'password' && o.count >= SCREENING.wrongTriesLock)
      ? `Locked out there for an hour`
      : o.reason === 'screen' ? 'It was playing on another screen' : o.reason === 'country' ? 'Outside the countries you set' : '';
    return { ...o, what, when: agoLabel(o.at, now), outcome };
  });
}

export function linkNumbers(link, views, refusals, now = Date.now()) {
  const people = peopleFrom(views, link, now);
  const opens = link ? link.views || 0 : 0;
  const maxViews = link ? link.maxViews || 0 : 0;
  const signedIn = people.filter((p) => !p.guest).length;
  const guests = people.length - signedIn;
  const watchedPercent = people.length ? Math.round(people.reduce((s, p) => s + p.percent, 0) / people.length) : 0;
  const cities = new Set();
  const countries = new Set();
  for (const v of Array.isArray(views) ? views : []) {
    if (v.city) cities.add(`${v.city}|${v.country || ''}`);
    if (v.country) countries.add(String(v.country).toUpperCase());
  }
  return {
    opens,
    maxViews,
    opensLeft: Math.max(0, maxViews - opens),
    people: people.length,
    signedIn,
    guests,
    watchedPercent,
    cities: cities.size,
    countries: countries.size,
    countryLine: countries.size === 1 ? `all in ${[...countries][0] === 'US' ? 'the United States' : countryName([...countries][0])}` : countries.size ? `in ${plural(countries.size, 'country', 'countries')}` : '',
    watchingNow: people.filter((p) => p.watchingNow).length,
    refused: (Array.isArray(refusals) ? refusals : []).length
  };
}

// What the server puts on each link in a list: computed from its rows.
export function linkStats(link, views, refusals, now = Date.now()) {
  const n = linkNumbers(link, views, refusals, now);
  return { people: n.people, refused: n.refused, watchingNow: n.watchingNow, watchedPercent: n.watchedPercent, twoCities: peopleFrom(views, link, now).filter((p) => p.twoCities).length };
}

/* ---------- what the pages draw ---------- */

function accessShort(key) {
  const a = ACCESS.find((x) => x.key === key);
  return a ? a.short : ACCESS[0].short;
}

// One card in the list. `link` carries `stats` from the server.
export function linkCard(link, now = Date.now()) {
  const st = linkState(link, now);
  const s = link.stats || {};
  const parts = [];
  if (st.key !== 'ended') {
    parts.push({ text: `${link.views || 0} of ${link.maxViews} opens`, strong: String(link.views || 0) });
    if (s.people) parts.push({ text: plural(s.people, 'person', 'people'), strong: String(s.people) });
    else if (st.key !== 'scheduled') parts.push({ text: 'Not opened yet', dim: true });
    if (s.refused) parts.push({ text: `${s.refused} stopped`, strong: String(s.refused), tone: 'warn' });
  }
  const endedLine = [
    plural(link.views || 0, 'open', 'opens'),
    s.people ? plural(s.people, 'person', 'people') : null,
    s.people && s.watchedPercent ? `watched ${s.watchedPercent}% on average` : null,
    s.twoCities ? `${s.twoCities} opened in two cities` : null
  ].filter(Boolean).join(' · ');
  return {
    id: link.id,
    label: link.label,
    state: st,
    access: link.legacy ? SCREENING_WORDS.legacy : accessShort(link.access),
    windowLine: windowLine(link, now),
    soon: endsSoon(link, now),
    startLabel: dayLabel(link.startsAt, { now }),
    progress: windowProgress(link, now),
    parts,
    endedLine,
    watching: s.watchingNow || 0,
    watchingLine: s.watchingNow ? `${s.watchingNow} watching` : '',
    actions: linkActions(link, now)
  };
}

export const LIST_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'live', label: 'Live' },
  { key: 'later', label: 'Opens later' },
  { key: 'ended', label: 'Ended' }
];

// The tab: filter chips with counts, the cards that aren't ended (live first,
// then the soonest to open), and the ended ones (latest first).
export function screeningsList(links, now = Date.now(), filter = 'all') {
  const cards = (Array.isArray(links) ? links : []).map((l) => ({ link: l, card: linkCard(l, now) }));
  const live = cards.filter((c) => c.card.state.key === 'live' || c.card.state.key === 'full');
  const later = cards.filter((c) => c.card.state.key === 'scheduled');
  const ended = cards.filter((c) => c.card.state.key === 'ended');
  live.sort((a, b) => ms(a.link.endsAt) - ms(b.link.endsAt));
  later.sort((a, b) => ms(a.link.startsAt) - ms(b.link.startsAt));
  ended.sort((a, b) => ms(b.link.endedAt || b.link.endsAt) - ms(a.link.endedAt || a.link.endsAt));
  const counts = { all: cards.length, live: live.length, later: later.length, ended: ended.length };
  const f = LIST_FILTERS.some((x) => x.key === filter) ? filter : 'all';
  const open = f === 'all' ? [...live, ...later] : f === 'live' ? live : f === 'later' ? later : [];
  return {
    filters: LIST_FILTERS.map((x) => ({ ...x, count: counts[x.key], text: `${x.label} · ${counts[x.key]}`, on: x.key === f })),
    open: open.map((c) => c.card),
    ended: f === 'all' || f === 'ended' ? ended.map((c) => c.card) : [],
    empty: cards.length === 0,
    liveCount: live.length,
    tabBadge: live.length ? `${live.length} live` : ''
  };
}

// A link's own page.
export function linkDashboard({ link, target, views, refusals, now = Date.now() }) {
  const st = linkState(link, now);
  const numbers = linkNumbers(link, views, refusals, now);
  const people = peopleFrom(views, link, now);
  const span = Math.max(1, ms(link.endsAt) - ms(link.startsAt));
  const at = (v) => Math.max(0, Math.min(1, (ms(v) - ms(link.startsAt)) / span));
  const access = ACCESS.find((a) => a.key === link.access) || ACCESS[0];
  const named = link.named || { userIds: [], emails: [] };
  const what = target && target.type === 'series'
    ? link.scope === 'season' ? `${target.title} · Season ${link.season}` : link.scope === 'episodes' ? `${target.title} · ${plural((link.episodeIds || []).length, 'episode', 'episodes')}` : `${target.title} · the whole show`
    : (target && target.title) || '';
  const left = ms(link.endsAt) - ms(now);
  return {
    state: st,
    label: link.label,
    sub: `Plays ${what} · ${link.legacy ? SCREENING_WORDS.legacy.toLowerCase() : access.short.toLowerCase()} · code ${link.code}`,
    watchingLine: numbers.watchingNow ? `${numbers.watchingNow} watching now` : '',
    timeline: {
      progress: windowProgress(link, now),
      opens: (Array.isArray(views) ? views : []).map((v) => at(v.openedAt)),
      refused: (Array.isArray(refusals) ? refusals : []).map((r) => at(r.at)),
      startLabel: whenLabel(link.startsAt, { now }),
      endLabel: whenLabel(link.endsAt, { now }),
      leftLabel: st.key === 'ended' ? st.label : st.key === 'scheduled' ? `Opens in ${opensIn(link.startsAt, now)}` : left > 86400000 ? `Ends in ${plural(Math.floor(left / 86400000), 'day', 'days')}` : `Ends in ${opensIn(link.endsAt, now)}`
    },
    tiles: [
      { key: 'opens', label: 'Opens', value: `${numbers.opens}`, of: `of ${numbers.maxViews}`, sub: st.key === 'ended' ? '' : `${numbers.opensLeft} left` },
      { key: 'people', label: 'People', value: `${numbers.people}`, sub: numbers.people ? `${numbers.signedIn} signed in · ${plural(numbers.guests, 'guest', 'guests')}` : 'nobody yet' },
      { key: 'watched', label: 'Watched through', value: numbers.people ? `${numbers.watchedPercent}%` : '—', sub: numbers.people ? 'on average, across everyone' : '' },
      { key: 'where', label: 'Where', value: numbers.cities ? plural(numbers.cities, 'city', 'cities') : '—', sub: numbers.countryLine }
    ],
    people,
    refusals: refusalRows(refusals, now),
    places: placesFrom(views, refusals),
    settings: [
      { key: 'plays', label: 'Plays', value: what },
      { key: 'window', label: 'Window', value: `${whenLabel(link.startsAt, { now, zone: false })} → ${whenLabel(link.endsAt, { now })}` },
      { key: 'password', label: 'Password', value: link.legacy ? 'None (an older screener)' : link.password || 'Set — make a new one to see it', mono: !link.legacy && Boolean(link.password) },
      { key: 'who', label: 'Who', value: link.access === 'named' ? `${access.short}: ${plural((named.userIds || []).length + (named.emails || []).length, 'person', 'people')}` : access.label },
      { key: 'limits', label: 'Limits', value: [`${link.maxViews} opens`, link.perPerson ? `${link.perPerson} each` : 'no limit each', link.oneScreen ? 'one screen at a time' : 'any number of screens'].join(', ') },
      { key: 'where', label: 'Where', value: countriesLine(link.countries) },
      { key: 'notify', label: 'Tell me', value: (NOTIFY.find((n) => n.key === link.notify) || NOTIFY[1]).label }
    ],
    actions: linkActions(link, now),
    numbers
  };
}

/* ---------- the invite ---------- */

export function inviteText({ title, ownerName, url, startsAt, endsAt, password, includePassword = false, now = Date.now() }) {
  const lines = [`Here’s a private screening of ${title}${ownerName ? ` from ${ownerName}` : ''}.`, '', url];
  if (includePassword && password) lines.push(`Password: ${password}`);
  const from = ms(startsAt) > ms(now) ? `from ${whenLabel(startsAt, { now })} ` : '';
  lines.push('', `It works ${from}until ${whenLabel(endsAt, { now })}. Please don’t forward it: the picture is marked with who it’s for.`);
  return lines.join('\n');
}

/* ---------- the viewer's page ---------- */

export const VIEWER_WORDS = {
  kicker: 'Private screening',
  gone: { title: 'Not available', line: 'That screening link isn’t right.' },
  unavailable: { title: 'Not available', line: 'This screening isn’t available any more.' },
  not_yet: { title: 'Opens in {opensIn}', line: 'Come back then. Your password works from that moment, not before.' },
  ended: { title: 'This screening has ended', line: 'It worked until {endsAt}. Ask {owner} for a new link if you still need it.' },
  stopped: { title: 'This screening has ended', line: '{owner} ended it on {endedAt}. Ask {owner} for a new link if you still need it.' },
  country: { title: 'Not available where you are', line: '{owner} set this screening to work {countries}.' },
  screen: { title: 'It’s playing on another screen', line: 'One screen at a time. Stop it there, or try again a couple of minutes after it stops.' },
  locked: { title: 'Too many tries', line: 'The password was wrong too many times from here. Try again at {retryAt}.' },
  password: { title: 'That password isn’t right', line: '{triesLeft} more tries from here before a one-hour wait.' },
  opens: { title: 'No opens left', line: 'This link has been opened as many times as it allows. Ask {owner} for a new one.' },
  person_opens: { title: 'No opens left', line: 'You’ve opened it {perPerson} times, as many as this link allows each person.' },
  signin: { title: 'Sign in to watch', line: '{owner} made this screening for people signed in to Studio Tapa. Sign in, or make a free account, to see it.' },
  named: { title: 'Only for named people', line: 'This screening is for the people {owner} named. Sign in with the address it was sent to.' },
  named_other: { title: 'Only for named people', line: 'This screening is for the people {owner} named, and the account you’re signed in with isn’t one of them.' },
  session: { title: 'Open it again', line: 'This visit has run out. Type the password again to keep watching.' },
  password_changed: { title: 'The password changed', line: '{owner} set a new password. Type it to keep watching.' },
  suspended: { title: 'Not available', line: 'This account can’t play anything right now.' },
  watch: 'Watch',
  password_label: 'Password',
  noPasswordLine: 'This older screener has no password.',
  dontShare: 'Please don’t record it or pass it on. The picture is marked with who it’s for.',
  oneScreen: 'Playing on this screen only',
  oneScreenLine: 'Opening it somewhere else is turned away while it plays here.',
  notCounted: 'No ads, no download, and it doesn’t go in your watch history.',
  oneVisit: 'One open covers the whole visit: moving between the episodes doesn’t use another.',
  yourOpens: 'Your opens',
  worksUntil: 'Works until',
  stopped_here: 'Stopped here'
};

// A viewer's refusal: { title, line } with the numbers filled in.
export function viewerLine(reason, vars = {}) {
  const w = VIEWER_WORDS[reason] || VIEWER_WORDS.gone;
  return { title: fill(w.title, vars), line: fill(w.line, vars) };
}

// What the password page says the owner will see.
export function passwordNote({ owner, signedIn = false, viewerName = '', access = 'anyone' } = {}) {
  const o = owner || 'The filmmaker';
  let s = `${o} will see that it was opened, roughly where (your city), on what kind of device and how much was watched.`;
  if (signedIn) s += ` You’re signed in${viewerName ? ` as ${viewerName}` : ''}, so ${o} sees your name.`;
  else if (access === 'anyone') s += ` Sign in and ${o} sees your name instead of “Guest”.`;
  return s;
}

// The watermark: who it's for and the link's code.
export function watermarkText({ viewerName = '', label = '', code = '', email = '' } = {}) {
  return [viewerName || 'Guest', label, email, code].filter(Boolean).join(' · ');
}

// Your opens: "1 of 3" / "2" when there's no limit each.
export function yourOpensLine(opens, perPerson) {
  return perPerson ? `${opens} of ${perPerson}` : `${opens}`;
}

/* ---------- where the pages are ---------- */

export const screeningHref = (id) => `/creator/screenings/${encodeURIComponent(String(id || ''))}`;
export function targetTabHref(target) {
  if (!target) return '/creator/my-work';
  return target.type === 'series' ? `/creator/show/${encodeURIComponent(target.id)}?tab=screenings` : `/creator/title/${encodeURIComponent(target.id)}?tab=screenings`;
}
export const viewerPath = (token) => `/screener/${encodeURIComponent(String(token || ''))}`;

/* ---------- the notifications the server sends ---------- */

export function notifyLines({ kind, label, title, who, place, opens, people, tries, day } = {}) {
  if (kind === 'opened') return `“${label}” for ${title} was opened by ${who || 'a guest'}${place && place !== 'Place unknown' ? ` in ${place}` : ''}.`;
  if (kind === 'ended') return `Your screening link “${label}” for ${title} has ended: ${plural(opens || 0, 'open', 'opens')} by ${plural(people || 0, 'person', 'people')}.`;
  if (kind === 'guessing') return `Someone keeps getting the password wrong on “${label}” for ${title} (${plural(tries || 0, 'try', 'tries')} today).`;
  if (kind === 'summary') return `${day || 'Yesterday'}, “${label}” for ${title} was opened ${plural(opens || 0, 'time', 'times')} by ${plural(people || 0, 'person', 'people')}.`;
  return '';
}

/* ---------- the website's creator pages ---------- */

// Words the website's creator pages draw (the tab, the New link box, a
// link's own page, the Distribution card) that the lists above don't carry
// (2026-11-21). At the end of the file so the app's copy stays this file
// word for word. `{x}` is filled the way screeningText fills SCREENING_WORDS.
export const SCREENING_WORDS_WEB = {
  newLinkTitle: 'New link',
  moveEnd: 'Move the end',
  forHead: 'Who it’s for',
  labelLabel: 'A name you’ll recognise',
  labelNote: 'goes on the watermark',
  labelPlaceholder: 'Sundance programmers',
  emailLabel: 'Their email',
  emailNote: 'optional · “Email the link” writes to it',
  emailPlaceholder: 'programming@festival.org',
  playsHead: 'What it plays',
  playsTitle: 'It plays {title}.',
  nothingToPlay: 'Nothing in this show can play on a link yet: an episode has to be approved or in review first.',
  inReview: 'in review',
  picked: '{n} picked',
  custom: 'Custom',
  starts: 'Starts',
  ends: 'Ends',
  startLocked: 'It has started, so the start stays where it is.',
  passwordHead: 'Password',
  newOne: 'New one',
  whoHead: 'Who can open it',
  namedFind: 'Find an account by name or @handle',
  namedEmail: 'Or an email they’ll sign in with',
  add: 'Add',
  namedNobody: 'Nobody named yet.',
  namedAccount: 'A named account',
  namedSearching: 'Searching…',
  namedNoMatch: 'No account matches that.',
  namedTypeMore: 'Type two letters or more.',
  namedCount: '{n} of {max} people',
  remove: 'Remove {name}',
  limitsHead: 'Limits',
  opensTotal: 'Opens in total',
  perPersonLabel: 'Each person, up to',
  noLimitEach: 'No limit',
  oneTime: '1 time',
  nTimes: '{n} times',
  whereLabel: 'Where it can be opened',
  anywhere: 'Anywhere',
  onlyIn: 'Only in…',
  countryFind: 'Find a country',
  countryNone: 'No country by that name.',
  countryMax: 'Up to {max} countries.',
  notifyHead: 'Tell me',
  readyLink: 'Link',
  readyPassword: 'Password',
  copy: 'Copy',
  done: 'Done',
  close: 'Close',
  emailSubject: 'A private screening of {title}',
  againFor: 'For',
  againWindow: 'Window',
  againPassword: 'Password',
  againAddress: 'Address',
  againRest: 'Who, limits',
  againNow: 'Now → {end}',
  againNew: 'A new one',
  againAddressLine: 'A new one · the old one never works again',
  againRestLine: 'As before · change any of it',
  colPerson: 'Person',
  colWhere: 'Where · device',
  colOpened: 'Opened',
  colWatched: 'Watched',
  signedIn: 'signed in',
  notSignedIn: 'not signed in',
  opensOf: '{opens} of {per} opens',
  openOne: '1 open',
  openMany: '{n} opens',
  noneLeft: 'no opens left',
  watching: 'Watching',
  turnedAwayHere: 'turned away',
  nowMark: 'Now',
  setPassword: 'Use this password',
  linkMissing: 'That screening link isn’t there. It may have been discarded.',
  failed: 'Couldn’t load the screening links.',
  tryAgain: 'Try again',
  loading: 'Loading…',
  offline: 'You seem to be offline. Try again.',
  couldNot: 'Couldn’t do that just now. Try again.',
  copyFailed: 'Couldn’t copy it. Select it and copy it yourself.',
  refreshNote: 'This page reads the list again every 30 seconds while it’s open.',
  distributionNoRelease: 'Link the released title on the production page, and its screening links show here.',
  distributionNone: 'No links to {title} yet.'
};

/* ---------- the app's own words ---------- */

// Words the app's screens need that the lists above don't have (builder C,
// 2026-11-21): the New link sheet's headings and fields (the website's
// dialog may use them too), the custom window typed as text on a phone,
// the named people, and a few states. Added at the end so both copies stay
// word for word.
export const SCREENING_WORDS_APP = {
  newLinkTitle: 'New link',
  forHead: 'Who it’s for',
  labelField: 'A name you’ll recognise · goes on the watermark',
  emailField: 'Their email (optional)',
  playsHead: 'What it plays',
  seasonChip: 'Season {n}',
  custom: 'Custom',
  starts: 'Starts',
  ends: 'Ends',
  now: 'Now',
  datePlaceholder: 'YYYY-MM-DD',
  timePlaceholder: 'HH:MM',
  customHint: 'Type the date as YYYY-MM-DD and the time as HH:MM (24-hour), on the Pacific clock. Leave the start empty to start now.',
  badStart: 'Type the start as YYYY-MM-DD and HH:MM, or leave it empty to start now.',
  badEnd: 'Type the end as YYYY-MM-DD and HH:MM.',
  startFixed: 'It has started, so the start stays as it is. The end can move.',
  newOne: 'New one',
  whoHead: 'Who can open it',
  emailPlaceholder: 'Or type their email',
  add: 'Add',
  removeName: 'Remove {name}',
  someAccount: 'A Studio Tapa account',
  limitsHead: 'Limits',
  opensTotal: 'Opens in total',
  eachPerson: 'Each person, up to',
  noLimit: 'No limit',
  whereHead: 'Where it can be opened',
  onlyIn: 'Only in…',
  searchCountries: 'Search countries',
  tellHead: 'Tell me',
  linkLabel: 'Link',
  done: 'Done',
  watchingNow: 'Watching now',
  nothingHere: 'No links here right now.',
  notFound: 'That link isn’t there any more.',
  tryAgain: 'Try again',
  offline: 'Couldn’t reach Studio Tapa. Check the connection and try again.'
};
