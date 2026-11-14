// The creator's Dashboard (/creator/dashboard on the website, the app's
// creator/dashboard screen; mockup https://claude.ai/artifact/Sbam9nFHvuM18YhjUFgZtp,
// signed off by Jose on 2026-11-14). Pure and client-safe: it turns what
// the creator routes already answer into what the page draws, so the
// website and the app read the same numbers and the same words.
//
//   submissions  GET /api/creator/my-submissions  → { submissions }
//   shows        GET /api/show?mine=1             → { shows }
//   drafts       GET /api/creator/drafts          → { drafts }
//   payees       GET /api/payees/mine             → { invites, paidFor }
//   money        GET /api/creator/money?period=   (with its `dashboard` block)
//   numbers      GET /api/creator/analytics?days=30&compare=1
//
// Any of them may be null (still loading, refused, or failed): every
// builder answers with what it has. Nothing here moves money or decides
// who may see what; the routes do.
//
// The app's mobile/src/lib/creatorDashboardRules.js is this file word for
// word (scripts/test-creator-dashboard.mjs checks it).
import { needsYou } from './showRules.js';

export const DASHBOARD_PATH = '/creator/dashboard';
export const VIEW_DAYS = 30;
export const NEEDS_LIMIT = 5;
export const TITLES_LIMIT = 8;
export const LATEST_LIMIT = 6;

export const DASH_WORDS = {
  kicker: 'Creator dashboard',
  heading: 'Your work and what it earns.',
  lede: 'Titles, views and money on one page. Only you can see it.',
  submit: 'Submit a title',
  newShow: 'New show',
  titles: 'Your titles',
  seeAll: 'See all in Your work',
  needs: 'Needs you',
  needsNone: 'Nothing needs you right now.',
  money: 'Money this month',
  openMoney: 'Open Money: every line, CSV, Stripe',
  views: 'Views a day · last 30 days',
  openNumbers: 'Open Numbers',
  months: 'Earned · last six months',
  latest: 'Latest',
  latestNone: 'Nothing yet. Tips, sales and titles going live show up here.',
  pitch: 'Pitch Room',
  link: 'Your link',
  noTitles: 'Nothing here yet. Your first title starts with Submit a title.',
  noTracking: 'View counting isn’t switched on for the site yet, so views read zero.',
  earnedNote: 'Earned per title is its title sales plus its ad share. Member support, tips and backing are paid to you as a creator, not to one title: they are in the money card.',
  adShareNote: 'Ad share for a month’s plays is credited on the 1st of the next month.',
  teamOnly: 'This account is on the team but isn’t a creator account, so it has no titles of its own. A full admin can give it Creator Studio.',
  start: 'Start something',
  startHelp: 'Three steps: the file (it uploads while you type), a few words about it, artwork. Saved as a draft as you go.',
  getPaid: 'Get paid',
  accept: 'Accept',
  accepting: 'Accepting…',
  notNow: 'Not now',
  declining: 'Telling them…',
  payoutsLine: 'To receive it, set up payouts under Money.',
  paidToYou: 'Paid to you',
  stop: 'Stop getting it…',
  stopping: 'Stopping…',
  supporters: 'Supporters',
  openSupporters: 'Who supports you',
  discard: 'Discard',
  discarding: 'Discarding…',
  discardAsk: 'Discard this draft? Its uploaded file is deleted too.',
  discardFailed: 'Could not discard it.',
  tryAgain: 'Something went wrong. Try again.',
  offline: 'Couldn’t reach the site. Check the connection and try again.',
  makePublicAsk: (name) => `Make ${name} public?\n\nIts approved episodes go on the site now, and the ones approved later go live as they’re approved. This is one-way: a public show only comes down if you remove it.`
};

// --- who sees it --------------------------------------------------------------

// Jose, 2026-11-14: "all creators and teams see the tab".
export function seesDashboard(role) {
  return Boolean(role && (role.isCreator || role.isAdmin || role.canAccessAdmin));
}

// Adding titles needs Creator Studio itself (a sub-admin has none).
export function canAddTitles(role) {
  return Boolean(role && (role.isCreator || role.isAdmin));
}

// The row of tabs across the creator pages. (Creator Studio's hub had a
// tab here until the Dashboard took its place, 2026-11-14.)
export function dashboardTabs(role) {
  const out = [{ key: 'overview', label: 'Overview', href: DASHBOARD_PATH }];
  if (!seesDashboard(role)) return out;
  // The other pages are a creator's (an admin is one): each sends anyone
  // else away, so a sub-admin who is not a creator gets Overview alone,
  // and a row of one tab is no row.
  if (!canAddTitles(role)) return out;
  out.push({ key: 'work', label: 'Your work', href: '/creator/my-work' });
  out.push({ key: 'numbers', label: 'Numbers', href: '/creator/analytics' });
  out.push({ key: 'money', label: 'Money', href: '/creator/money' });
  out.push({ key: 'pitches', label: 'Pitches', href: '/creator/pitch/dashboard' });
  return out;
}

// Where a person lands after signing in from the sign-in card or the beta
// door (Jose, 2026-11-14: "a creator should be sent there, this is where
// they can add content and review what they have added"). A page they
// were on their way to (`next`) wins; null = the caller's own default.
export function signInLanding(role, next = null) {
  const asked = typeof next === 'string' && /^\/[^/\\]/.test(next) && next !== '/account' ? next : null;
  if (asked) return asked;
  return seesDashboard(role) ? DASHBOARD_PATH : null;
}

// --- words for numbers and days ----------------------------------------------

const n = (v) => Number(v) || 0;
const text = (v) => (typeof v === 'string' ? v.trim() : '');
const grouped = (whole) => String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function dollars(cents) {
  const v = Math.round(n(cents));
  const abs = Math.abs(v);
  return `${v < 0 ? '−' : ''}$${grouped(Math.floor(abs / 100))}.${String(abs % 100).padStart(2, '0')}`;
}

export function count(value) {
  return grouped(Math.max(0, Math.round(n(value))));
}

const isPeriod = (key) => typeof key === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(key);

export function monthName(period) {
  return isPeriod(period) ? MONTHS[Number(period.slice(5)) - 1] : '';
}

export function monthShort(period) {
  return monthName(period).slice(0, 3);
}

export function monthLabel(period) {
  return isPeriod(period) ? `${monthName(period)} ${period.slice(0, 4)}` : '';
}

export function currentPeriod(now = Date.now()) {
  const d = new Date(now);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

// "Nov 10" (UTC, like the money page's days).
export function dayLabel(iso) {
  const t = Date.parse(iso || '');
  if (!Number.isFinite(t)) return '';
  const d = new Date(t);
  return `${MONTHS[d.getUTCMonth()].slice(0, 3)} ${d.getUTCDate()}`;
}

// "Just now", "3 h ago", "Yesterday", then the day.
export function whenLabel(iso, now = Date.now()) {
  const t = Date.parse(iso || '');
  if (!Number.isFinite(t)) return '';
  const hours = (now - t) / 3600000;
  if (hours < 1) return 'Just now';
  if (hours < 24) return `${Math.floor(hours)} h ago`;
  if (hours < 48) return 'Yesterday';
  return dayLabel(iso);
}

// '1:20:00' → '1 h 20', '12:30' → '13 min', '25 min' stays.
export function runtimeLabel(runtime) {
  const raw = text(String(runtime == null ? '' : runtime));
  if (!raw) return '';
  const m = /^(\d+):(\d{2})(?::(\d{2}))?$/.exec(raw);
  if (!m) return raw;
  const seconds = m[3] == null ? Number(m[1]) * 60 + Number(m[2]) : Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes} min`;
  const rest = minutes % 60;
  return rest ? `${Math.floor(minutes / 60)} h ${String(rest).padStart(2, '0')}` : `${Math.floor(minutes / 60)} h`;
}

const plural = (k, one, many) => `${k} ${k === 1 ? one : many}`;

// --- the four numbers at the top ----------------------------------------------

export function dashboardTiles({ money = null, numbers = null, period = null, now = Date.now() } = {}) {
  const tiles = [];
  const thisMonth = !isPeriod(period) || period === currentPeriod(now);

  // Earned: the money page's own "this month · all lanes" (every lane
  // added up; the money card under it shows the lanes).
  if (money && money.top) {
    const cents = n(money.top.monthCents);
    const prev = money.dashboard && money.dashboard.previous ? money.dashboard.previous : null;
    let sub = '';
    if (prev) {
      const diff = cents - n(prev.cents);
      const name = monthName(prev.period);
      if (diff > 0) sub = `${dollars(diff)} more than ${name}`;
      else if (diff < 0) sub = `${dollars(-diff)} less than ${name}`;
      else sub = cents === 0 ? 'Nothing in yet' : `The same as ${name}`;
    }
    tiles.push({ key: 'earned', label: thisMonth ? 'Earned this month' : `Earned in ${monthName(period)}`, value: dollars(cents), sub, tone: '' });
  } else {
    tiles.push({ key: 'earned', label: 'Earned this month', value: null, sub: '', tone: '' });
  }

  // Owed: unpaid member support and ad share, and when it moves.
  if (money && money.top) {
    const top = money.top;
    const next = top.nextPayout || null;
    const owed = n(top.owedCents);
    let sub = 'Nothing waiting';
    if (top.studioKept) sub = 'Kept by the studio';
    else if (next && next.willPay) sub = `Next transfer ${dayLabel(next.on)}`;
    else if (next && next.reason === 'set up payouts') sub = owed > 0 ? 'Set up payouts to receive it' : 'Set up payouts to be paid';
    else if (next && next.reason === 'on hold') sub = 'On hold';
    else if (next && next.reason && /minimum/.test(next.reason)) sub = top.minimumCents ? `Under the ${dollars(top.minimumCents)} minimum · carries over` : 'Under the minimum · carries over';
    tiles.push({ key: 'owed', label: 'Owed to you', value: dollars(owed), sub, tone: 'accent' });
  } else {
    tiles.push({ key: 'owed', label: 'Owed to you', value: null, sub: '', tone: 'accent' });
  }

  // Views: always the last 30 days, whatever month the money shows.
  if (numbers && numbers.totals) {
    const pct = numbers.totals.changePct;
    let sub = 'No earlier views to compare';
    if (numbers.tracking === false) sub = 'View counting isn’t switched on yet';
    else if (typeof pct === 'number' && pct > 0) sub = `${pct}% more than the 30 days before`;
    else if (typeof pct === 'number' && pct < 0) sub = `${-pct}% fewer than the 30 days before`;
    else if (pct === 0) sub = 'The same as the 30 days before';
    tiles.push({ key: 'views', label: 'Views · last 30 days', value: count(numbers.totals.windowViews), sub, tone: '' });
  } else {
    tiles.push({ key: 'views', label: 'Views · last 30 days', value: null, sub: '', tone: '' });
  }

  // Supporters: members who have this creator in their picks, and members
  // whose share came by watching this month.
  if (money && money.supporters) {
    const picked = n(money.supporters.picked);
    const watching = n(money.supporters.watching);
    tiles.push({ key: 'supporters', label: 'Supporters', value: count(picked + watching), sub: `${count(picked)} picked you · ${count(watching)} by watching`, tone: '' });
  } else {
    tiles.push({ key: 'supporters', label: 'Supporters', value: null, sub: '', tone: '' });
  }
  return tiles;
}

// --- titles --------------------------------------------------------------------

const TYPE_WORD = { movie: 'Film', short: 'Short', series: 'Episode', podcast: 'Podcast episode', vertical: 'Snippet', bonus: 'Extra' };
const STATE_LABEL = { live: 'Live', review: 'In review', ready: 'Ready to go public', private: 'Not public yet', draft: 'Draft', declined: 'Not this time', pulled: 'Pulled', removal: 'Removal requested' };
const STATE_ORDER = { live: 0, review: 1, ready: 2, private: 3, draft: 4, declined: 5, pulled: 6, removal: 7 };
const SHOW_STATE = { live: 'live', ready: 'ready', review: 'private', drafts: 'private', empty: 'private', pulled: 'pulled', removal: 'removal', declined: 'declined' };

export function displayTitle(s) {
  const own = text(s && s.title);
  if (own) return own;
  return s && s.seriesOrder ? `Episode ${s.seriesOrder}` : 'Untitled';
}

// "S2 E5", or '' for a title with no number.
export function episodeCodeOf(s) {
  if (!s || !s.seriesOrder) return '';
  return `S${n(s.season) || 1} E${s.seriesOrder}`;
}

// The show a title row belongs to: its own (an episode), or the one an
// extra is filed under — directly, or through the episode it follows.
export function showIdOf(s, byId) {
  if (!s) return null;
  if (s.seriesId) return s.seriesId;
  if (s.contentType !== 'bonus' || !s.bonusParentId) return null;
  if (s.bonusParentType === 'series') return s.bonusParentId;
  const parent = s.bonusParentType === 'episode' && byId ? byId.get(s.bonusParentId) : null;
  return parent && parent.seriesId ? parent.seriesId : null;
}

function showHref(id, anchor) {
  return `/creator/show/${encodeURIComponent(id)}${anchor ? `#${anchor}` : ''}`;
}

function draftFileLine(d) {
  if (d && d.video) {
    return d.video.state === 'uploading' ? 'The upload stopped' : d.video.state === 'processing' ? 'The file is processing' : d.video.state === 'ready' ? 'Ready to send' : 'The file failed to process';
  }
  if (d && d.form && d.form.audioUrl) return 'Ready to send';
  return 'No file yet';
}

// Views, how much of it people watch, and earnings for a set of titles.
function statsFor(ids, per, earned, extraKeys = []) {
  let views = 0;
  let weighted = 0;
  let weight = 0;
  let spark = null;
  let sales = 0;
  let ads = 0;
  let known = false;
  for (const id of ids) {
    const e = per.get(id);
    if (e) {
      known = true;
      views += n(e.windowViews);
      if (e.watchThroughPct != null) {
        const w = Math.max(1, n(e.views));
        weighted += n(e.watchThroughPct) * w;
        weight += w;
      }
      if (Array.isArray(e.spark) && e.spark.length) spark = spark ? spark.map((x, i) => x + n(e.spark[i])) : e.spark.map(n);
    }
    const m = earned[`episode:${id}`];
    if (m) {
      sales += n(m.salesCents);
      ads += n(m.adsCents);
    }
  }
  for (const key of extraKeys) {
    const m = earned[key];
    if (m) {
      sales += n(m.salesCents);
      ads += n(m.adsCents);
    }
  }
  return { known, views, watchedPct: weight ? Math.round(weighted / weight) : null, spark, salesCents: sales, adsCents: ads };
}

// "sales 36.80 · ads 21.40", only the parts that are not zero.
export function earnedDetail(salesCents, adsCents) {
  const bare = (c) => dollars(c).replace('$', '');
  const parts = [];
  if (n(salesCents) !== 0) parts.push(`sales ${bare(salesCents)}`);
  if (n(adsCents) !== 0) parts.push(`ads ${bare(adsCents)}`);
  return parts.join(' · ');
}

function numbersOf(st, haveNumbers, haveMoney) {
  return {
    views: haveNumbers ? st.views : null,
    spark: haveNumbers && st.spark && st.spark.some((x) => x > 0) ? st.spark : null,
    watchedPct: haveNumbers ? st.watchedPct : null,
    earnedCents: haveMoney ? st.salesCents + st.adsCents : null,
    earnedDetail: haveMoney ? earnedDetail(st.salesCents, st.adsCents) : ''
  };
}

const NO_NUMBERS = { views: null, spark: null, watchedPct: null, earnedCents: null, earnedDetail: '' };

// Every film and show with where it stands, its views and what it earned:
// one row per show (its live episodes inside it), one per title that is in
// no show, one per episode still in review or turned down, one per draft
// (a show's drafts share a row).
export function dashboardTitles({ submissions = null, shows = null, drafts = null, numbers = null, money = null, now = Date.now() } = {}) {
  const subs = Array.isArray(submissions) ? submissions.filter(Boolean) : [];
  const showList = Array.isArray(shows) ? shows.filter((sh) => sh && sh.id && sh.kind !== 'vertical') : [];
  const draftList = Array.isArray(drafts) ? drafts.filter(Boolean) : [];
  const byId = new Map(subs.map((s) => [s.id, s]));
  const showById = new Map(showList.map((sh) => [sh.id, sh]));
  const per = new Map((numbers && Array.isArray(numbers.perEpisode) ? numbers.perEpisode : []).map((e) => [e.id, e]));
  const earned = (money && money.dashboard && money.dashboard.byTitle) || {};
  const haveNumbers = Boolean(numbers && numbers.totals);
  const haveMoney = Boolean(money && money.dashboard);

  const idsByShow = new Map();
  const put = (sid, id) => {
    if (!sid || !id) return;
    if (!idsByShow.has(sid)) idsByShow.set(sid, new Set());
    idsByShow.get(sid).add(id);
  };
  for (const s of subs) put(showIdOf(s, byId), s.id);
  for (const e of per.values()) put(e.seriesId, e.id);

  const rows = [];

  for (const sh of showList) {
    const state = SHOW_STATE[sh.state] || 'private';
    const st = statsFor(idsByShow.get(sh.id) || [], per, earned, [`series:${sh.id}`]);
    const canPublish = state === 'ready' && Boolean(sh.makePublic && sh.makePublic.ok);
    rows.push({
      key: `show:${sh.id}`,
      kind: 'show',
      id: sh.id,
      title: text(sh.name) || 'Untitled show',
      meta: [sh.kind === 'podcast' ? 'Podcast' : 'Series', text(sh.countLine), sh.staged && sh.staged.any ? 'a change is waiting for approval' : ''].filter(Boolean).join(' · '),
      state,
      stateLabel: text(sh.statusLabel) || STATE_LABEL[state],
      href: sh.href || showHref(sh.id),
      poster: sh.poster || sh.thumbnail || null,
      ...(state === 'live' ? numbersOf(st, haveNumbers, haveMoney) : NO_NUMBERS),
      note: state === 'live' ? '' : state === 'ready' ? 'Private until you say so.' : text(sh.headline),
      action: canPublish ? { kind: 'publish', label: 'Make it public', showId: sh.id, name: text(sh.name) || 'this show' } : null,
      needs: state === 'ready' || state === 'declined' || state === 'pulled',
      sortAt: sh.createdAt || ''
    });
  }

  for (const s of subs) {
    const sid = showIdOf(s, byId);
    const inListedShow = Boolean(sid && showById.has(sid));
    // A listed show's live episodes are inside its row.
    if (inListedShow && s.status !== 'pending' && s.status !== 'rejected') continue;
    const why = needsYou(s);
    let state = 'review';
    if (s.deletionRequested) state = 'removal';
    else if (s.status === 'rejected') state = 'declined';
    else if (s.status === 'pending') state = 'review';
    else if (s.status === 'approved' && (s.held || s.seriesHeld)) state = 'pulled';
    else if (s.status === 'approved' && sid && s.seriesStatus === 'pending') state = 'ready';
    else if (s.status === 'approved') state = 'live';

    const own = displayTitle(s);
    const code = s.contentType === 'bonus' ? 'extra' : episodeCodeOf(s);
    const showName = sid ? text(s.seriesName) || (showById.get(sid) && text(showById.get(sid).name)) || 'A show' : '';
    const numbered = /^Episode \d+$/.test(own);
    const title = sid ? [showName, code, numbered ? '' : own].filter(Boolean).join(' · ') : own;
    const sent = dayLabel(s.createdAt);
    let note = '';
    if (state === 'review') note = `${sent ? `Sent ${sent}. ` : ''}${sid && s.seriesStatus === 'pending' ? 'With the team now.' : 'With the team now; it goes live when approved.'}`;
    else if (state === 'removal') note = 'Removal requested.';
    else if (state === 'ready') note = 'Approved. It goes on the site when its show goes public.';
    else if (state !== 'live') note = why || '';

    const st = statsFor([s.id], per, earned);
    rows.push({
      key: `title:${s.id}`,
      kind: sid ? 'episode' : 'title',
      id: s.id,
      title,
      meta: [TYPE_WORD[s.contentType] || 'Title', runtimeLabel(s.runtime)].filter(Boolean).join(' · '),
      state,
      stateLabel: STATE_LABEL[state],
      href: sid ? showHref(sid, `ep-${s.id}`) : '/creator/my-work',
      poster: s.poster || s.thumbnail || null,
      ...(state === 'live' ? numbersOf(st, haveNumbers, haveMoney) : NO_NUMBERS),
      note,
      action: null,
      needs: Boolean(why),
      needsWhy: state === 'live' ? why || '' : '',
      sortAt: s.createdAt || ''
    });
  }

  const showDrafts = new Map();
  for (const d of draftList) {
    const sid = d.form && d.form.seriesId ? String(d.form.seriesId) : null;
    if (sid) {
      if (!showDrafts.has(sid)) showDrafts.set(sid, []);
      showDrafts.get(sid).push(d);
      continue;
    }
    const href = `/creator/submit?draft=${encodeURIComponent(d.id)}`;
    const saved = whenLabel(d.updatedAt, now);
    rows.push({
      key: `draft:${d.id}`,
      kind: 'draft',
      id: d.id,
      title: text(d.form && d.form.title) || (d.video && text(d.video.name)) || 'Untitled draft',
      meta: saved ? `Saved ${saved === 'Just now' ? 'just now' : saved}` : '',
      state: 'draft',
      stateLabel: STATE_LABEL.draft,
      href,
      poster: null,
      ...NO_NUMBERS,
      note: `${draftFileLine(d)}.`,
      action: { kind: 'link', label: 'Continue', href },
      secondary: { kind: 'discard', label: DASH_WORDS.discard, draftId: d.id },
      needs: false,
      sortAt: d.updatedAt || d.createdAt || ''
    });
  }
  for (const [sid, list] of showDrafts) {
    const sh = showById.get(sid);
    const href = (sh && sh.href) || showHref(sid);
    rows.push({
      key: `drafts:${sid}`,
      kind: 'drafts',
      id: sid,
      title: `${(sh && text(sh.name)) || 'A show'} · ${plural(list.length, 'draft', 'drafts')}`,
      meta: '',
      state: 'draft',
      stateLabel: STATE_LABEL.draft,
      href,
      poster: (sh && (sh.poster || sh.thumbnail)) || null,
      ...NO_NUMBERS,
      note: 'Not sent for review yet.',
      action: { kind: 'link', label: 'Open the show', href },
      // One draft can go from here; several are sorted out on the show page.
      secondary: list.length === 1 && list[0].id ? { kind: 'discard', label: DASH_WORDS.discard, draftId: list[0].id } : null,
      needs: false,
      sortAt: list.map((d) => d.updatedAt || d.createdAt || '').sort().pop() || ''
    });
  }

  rows.sort((a, b) => {
    const by = STATE_ORDER[a.state] - STATE_ORDER[b.state];
    if (by) return by;
    if (a.state === 'live') return n(b.views) - n(a.views) || n(b.earnedCents) - n(a.earnedCents) || a.title.localeCompare(b.title);
    return String(b.sortAt).localeCompare(String(a.sortAt)) || a.title.localeCompare(b.title);
  });

  const counts = { all: rows.length, live: 0, review: 0, drafts: 0, needs: 0 };
  for (const r of rows) {
    if (r.state === 'live') counts.live += 1;
    if (r.state === 'review') counts.review += 1;
    if (r.state === 'draft') counts.drafts += 1;
    if (r.needs) counts.needs += 1;
  }
  return { rows, counts };
}

export const TITLE_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'live', label: 'Live' },
  { key: 'review', label: 'In review' },
  { key: 'drafts', label: 'Drafts' },
  { key: 'needs', label: 'Needs you' }
];

export function filterTitles(rows, filter) {
  const list = Array.isArray(rows) ? rows : [];
  if (filter === 'live') return list.filter((r) => r.state === 'live');
  if (filter === 'review') return list.filter((r) => r.state === 'review');
  if (filter === 'drafts') return list.filter((r) => r.state === 'draft');
  if (filter === 'needs') return list.filter((r) => r.needs);
  return list;
}

// --- needs you -------------------------------------------------------------------

const NUMBERING = { gap: 'Add it or renumber', duplicate: 'Pick one', parked: 'Give it its own number', unnumbered: 'Give each one a number' };

function fixLabel(why) {
  if (/caption/i.test(why)) return 'Add captions';
  if (/poster|still/i.test(why)) return 'Add art';
  if (/^Not this time/.test(why)) return 'See why';
  if (/failed|never finished/i.test(why)) return 'Replace the file';
  return 'Open';
}

// What is waiting on the creator, most pressing first: a show ready to go
// public, each title's own reason, a show's numbering, then payouts not
// set up while money waits. (An invite to be paid has its own card with
// its two buttons: dashboardInvites.)
export function dashboardNeeds({ submissions = null, shows = null, money = null, limit = NEEDS_LIMIT } = {}) {
  const subs = Array.isArray(submissions) ? submissions.filter(Boolean) : [];
  const showList = Array.isArray(shows) ? shows.filter((sh) => sh && sh.id && sh.kind !== 'vertical') : [];
  const byId = new Map(subs.map((s) => [s.id, s]));
  const showById = new Map(showList.map((sh) => [sh.id, sh]));
  const rows = [];

  const ready = new Map();
  const titleNeeds = [];
  for (const s of subs) {
    const why = needsYou(s);
    if (!why) continue;
    if (why === 'Ready to go public' && s.seriesId) {
      const g = ready.get(s.seriesId) || { showId: s.seriesId, name: text(s.seriesName), approved: 0 };
      g.approved += 1;
      ready.set(s.seriesId, g);
      continue;
    }
    titleNeeds.push({ s, why });
  }
  for (const sh of showList) {
    if (sh.state === 'ready' && !ready.has(sh.id)) ready.set(sh.id, { showId: sh.id, name: text(sh.name), approved: sh.counts ? n(sh.counts.live) : 0 });
  }
  for (const g of ready.values()) {
    const sh = showById.get(g.showId);
    const name = g.name || (sh && text(sh.name)) || 'Your show';
    const canPublish = Boolean(sh && sh.makePublic && sh.makePublic.ok);
    rows.push({
      key: `ready:${g.showId}`,
      title: `${name} is ready to go public`,
      sub: g.approved > 0 ? `${plural(g.approved, 'episode', 'episodes')} approved` : 'An episode is approved',
      action: canPublish ? { kind: 'publish', label: 'Make it public', showId: g.showId, name } : { kind: 'link', label: 'Open the show', href: (sh && sh.href) || showHref(g.showId) }
    });
  }

  for (const { s, why } of titleNeeds) {
    const sid = showIdOf(s, byId);
    const own = displayTitle(s);
    const code = s.contentType === 'bonus' ? 'extra' : episodeCodeOf(s);
    const showName = sid ? text(s.seriesName) || (showById.get(sid) && text(showById.get(sid).name)) || '' : '';
    const numbered = /^Episode \d+$/.test(own);
    rows.push({
      key: `title:${s.id}`,
      title: sid ? [showName, code, numbered ? '' : own].filter(Boolean).join(' · ') : own,
      sub: why,
      action: { kind: 'link', label: fixLabel(why), href: sid ? showHref(sid, `ep-${s.id}`) : '/creator/my-work?attention=1' }
    });
  }

  for (const sh of showList) {
    for (const p of Array.isArray(sh.problems) ? sh.problems : []) {
      if (!p || !NUMBERING[p.code]) continue;
      rows.push({
        key: `numbering:${sh.id}:${p.code}:${p.words}`,
        title: `${text(sh.name) || 'A show'}: ${p.words}`,
        sub: NUMBERING[p.code],
        action: { kind: 'link', label: 'Open the show', href: sh.href || showHref(sh.id) }
      });
    }
  }

  if (money && money.top && money.top.nextPayout && money.top.nextPayout.reason === 'set up payouts') {
    const owed = n(money.top.owedCents);
    rows.push({
      key: 'payouts',
      title: 'Set up payouts',
      sub: owed > 0 ? `${dollars(owed)} is waiting for a bank account` : 'So what you earn can reach your bank',
      action: { kind: 'link', label: 'Set up payouts', href: '/creator/money#payouts' }
    });
  }

  const cap = Math.max(1, Math.floor(n(limit)) || NEEDS_LIMIT);
  return { rows: rows.slice(0, cap), total: rows.length, more: Math.max(0, rows.length - cap) };
}

// --- money this month ------------------------------------------------------------

const LANE_LABEL = { member_support: 'Member support', ad_share: 'Ad share', tips: 'Tips', sales: 'Title sales', backing: 'Backing', bookings: 'Bookings' };
const LANE_KEYS = ['member_support', 'tips', 'sales', 'backing', 'ad_share', 'bookings'];

// The lanes as bars (one colour: each bar carries its own name and
// amount), biggest first, then when the money moves.
export function dashboardMoney(money, { period = null, now = Date.now() } = {}) {
  if (!money || !money.top || !money.lanes) return null;
  const thisMonth = !isPeriod(period) || period === currentPeriod(now);
  const lanes = [];
  for (const key of LANE_KEYS) {
    const lane = money.lanes[key];
    if (!lane) continue;
    if (key === 'bookings' && !lane.shows) continue;
    lanes.push({ key, label: LANE_LABEL[key], cents: n(lane.monthCents) });
  }
  lanes.sort((a, b) => b.cents - a.cents || LANE_KEYS.indexOf(a.key) - LANE_KEYS.indexOf(b.key));
  const max = Math.max(0, ...lanes.map((l) => l.cents));
  for (const lane of lanes) lane.share = max > 0 && lane.cents > 0 ? lane.cents / max : 0;

  const top = money.top;
  const next = top.nextPayout || null;
  const owed = n(top.owedCents);
  let firstSub = 'Member support and ad share, sent to your Stripe account';
  if (top.studioKept) firstSub = 'A studio account’s member support and ad share stay with the studio';
  else if (next && next.reason === 'set up payouts') firstSub = 'Member support and ad share · set up payouts to receive it';
  else if (next && next.reason === 'on hold') firstSub = 'Member support and ad share · on hold';
  else if (next && next.reason && /minimum/.test(next.reason)) firstSub = `Member support and ad share · under the ${top.minimumCents ? `${dollars(top.minimumCents)} ` : ''}minimum, it carries over`;
  const onFirst = { title: next && next.on ? `On ${dayLabel(next.on)}` : 'On the 1st', sub: firstSub, value: dollars(top.studioKept ? 0 : owed) };

  const p = money.payouts || {};
  let stripe = null;
  if (p.availableCents != null || p.pendingCents != null) {
    const bank = p.bank && p.bank.last4 ? ` · ••${p.bank.last4}` : '';
    const nextBank = p.nextBankPayout && p.nextBankPayout.arrivalDate ? `Next bank payout ${dayLabel(p.nextBankPayout.arrivalDate)}${bank}` : `No bank payout lined up${bank}`;
    stripe = { title: 'In Stripe now', sub: `Tips, sales and backing. ${nextBank}`, value: dollars(n(p.availableCents) + n(p.pendingCents)) };
  }
  return {
    label: thisMonth ? 'Money this month' : `Money in ${monthName(period)}`,
    total: dollars(top.monthCents),
    lanes,
    adShareNote: DASH_WORDS.adShareNote,
    onFirst,
    stripe,
    stripeError: p.summaryError || null,
    payoutsReady: p.state === 'ready'
  };
}

// The six months ending with the chosen one, as bars.
export function dashboardMonths(money) {
  const list = money && money.dashboard && Array.isArray(money.dashboard.months) ? money.dashboard.months : [];
  if (!list.length) return null;
  const max = Math.max(0, ...list.map((m) => n(m.cents)));
  const bars = list.map((m) => ({ period: m.period, label: monthShort(m.period), cents: n(m.cents), value: dollars(m.cents), current: Boolean(m.current), share: max > 0 && n(m.cents) > 0 ? n(m.cents) / max : 0 }));
  const last = bars[bars.length - 1];
  const first = bars[0];
  return {
    bars,
    empty: max <= 0,
    note: last.current ? `${monthName(last.period)} is the month so far.` : '',
    summary: `Earnings by month from ${first.value} in ${monthName(first.period)} to ${last.value}${last.current ? ' so far' : ''} in ${monthName(last.period)}`
  };
}

// --- views a day -----------------------------------------------------------------

export function dashboardViews(numbers) {
  if (!numbers || !Array.isArray(numbers.trend)) return null;
  const points = numbers.trend.map((d) => ({ date: d.date, views: n(d.views) }));
  const max = Math.max(0, ...points.map((p) => p.views));
  let peak = null;
  for (const p of points) if (p.views > 0 && (!peak || p.views > peak.views)) peak = p;
  const day = (iso) => dayLabel(`${iso}T12:00:00Z`);
  return {
    tracking: numbers.tracking !== false,
    points,
    max,
    total: points.reduce((s, p) => s + p.views, 0),
    empty: max <= 0,
    peak: peak ? { ...peak, label: `${day(peak.date)} · ${plural(peak.views, 'view', 'views').replace(/^\d+/, count(peak.views))}` } : null,
    firstLabel: points.length ? day(points[0].date) : '',
    lastLabel: points.length ? day(points[points.length - 1].date) : '',
    summary: points.length ? `Views a day from ${day(points[0].date)} to ${day(points[points.length - 1].date)}${peak ? `, highest on ${day(peak.date)} with ${count(peak.views)}` : ''}` : ''
  };
}

// --- latest ----------------------------------------------------------------------

const BACK_WORD = { refund: 'refunded', chargeback: 'disputed', reversal: 'reversed', returned: 'paid back', forfeit: 'moved to the pool' };

// The newest things that happened: money lines (the money page's own, all
// lanes) and titles going live or being turned down in the last 30 days.
export function dashboardLatest({ money = null, submissions = null, now = Date.now(), limit = LATEST_LIMIT } = {}) {
  const out = [];
  const lines = money && money.dashboard && Array.isArray(money.dashboard.latest) ? money.dashboard.latest : [];
  for (const l of lines) {
    if (!l || !l.at) continue;
    const lane = LANE_LABEL[l.lane] || (l.lane === 'payouts' ? 'Payout' : 'Money');
    let words;
    if (l.kind === 'tip') words = `${text(l.label) || 'A fan'} tipped you ${dollars(l.amountCents != null ? l.amountCents : l.cents)}`;
    else if (l.kind === 'sale') words = `${text(l.label) || 'A title'} sold`;
    else if (l.kind === 'backing') words = `${text(l.detail) || 'Someone backed'} · ${text(l.label)}`.replace(/ · $/, '');
    else if (BACK_WORD[l.kind]) words = `${lane} · ${text(l.label)} · ${BACK_WORD[l.kind]}`;
    else if (l.lane === 'payouts') words = text(l.label) || 'Creator Share payout';
    else if (l.kind === 'member_share') words = [lane, text(l.detail)].filter(Boolean).join(' · ');
    else if (l.lane === 'member_support') words = [text(l.label) || lane, text(l.detail)].filter(Boolean).join(' · ');
    else words = [lane, text(l.label) !== lane ? text(l.label) : ''].filter(Boolean).join(' · ');
    const note = l.kind === 'tip' ? text(l.note) : '';
    out.push({ key: `money:${l.id}`, at: l.at, text: words, amount: l.kind === 'tip' ? '' : dollars(l.cents), quote: note ? `“${note}”` : '', href: '/creator/money' });
  }
  const since = now - 30 * 24 * 3600000;
  const subs = Array.isArray(submissions) ? submissions.filter(Boolean) : [];
  const byId = new Map(subs.map((s) => [s.id, s]));
  for (const s of subs) {
    const at = Date.parse(s.reviewedAt || '');
    if (!Number.isFinite(at) || at < since || at > now) continue;
    if (s.status !== 'approved' && s.status !== 'rejected') continue;
    const sid = showIdOf(s, byId);
    const own = displayTitle(s);
    const name = sid ? [text(s.seriesName), episodeCodeOf(s), /^Episode \d+$/.test(own) ? '' : own].filter(Boolean).join(' ') : own;
    let words;
    if (s.status === 'rejected') words = `${name}: not this time`;
    else if (sid && s.seriesStatus === 'pending') words = `${name} was approved`;
    else words = `${name} went live`;
    out.push({ key: `title:${s.id}`, at: s.reviewedAt, text: words, amount: '', quote: '', href: sid ? showHref(sid, `ep-${s.id}`) : '/creator/my-work' });
  }
  out.sort((a, b) => String(b.at).localeCompare(String(a.at)));
  return out.slice(0, Math.max(1, Math.floor(n(limit)) || LATEST_LIMIT)).map((row) => ({ ...row, when: whenLabel(row.at, now) }));
}

// --- start something -------------------------------------------------------------

// The shortcuts under Submit a title: one per kind of title (the caller
// hands in lib/submitRules.js SUBMIT_TYPES, so this file keeps its one
// import), then a pitch.
export function dashboardStart(types) {
  const out = [];
  for (const t of Array.isArray(types) ? types : []) {
    if (!t || !t.value || !text(t.label)) continue;
    out.push({ key: String(t.value), label: text(t.label), href: `/creator/submit?type=${encodeURIComponent(t.value)}` });
  }
  out.push({ key: 'pitch', label: 'Pitch a project', href: '/creator/pitch/new' });
  return out;
}

// "“The Long Quiet” is in." after the three steps (?submitted=, &show=).
export function submittedFlash(title, showId = null) {
  const name = text(title);
  if (!name) return null;
  return {
    strong: `“${name}” is in.`,
    rest: 'It’s in review now, and it goes live when it’s approved. A file still uploading carries on while you look around.',
    link: text(showId) ? { label: 'Open the show page', href: showHref(text(showId)) } : null
  };
}

// --- who gets paid ---------------------------------------------------------------

// An invite to be paid for a title: who asked, what accepting means, and
// the two answers (POST /api/payees/invites/<id> { action }).
export function dashboardInvites(invites) {
  const out = [];
  for (const inv of Array.isArray(invites) ? invites : []) {
    if (!inv || !inv.id) continue;
    const who = text(inv.inviterName) || 'Someone on Studio Tapa';
    out.push({
      key: `invite:${inv.id}`,
      id: inv.id,
      headline: text(inv.headline) || 'Get paid for a title?',
      asked: `${who} asked${inv.sentLabel ? ` on ${inv.sentLabel}` : ''}`,
      body: (Array.isArray(inv.body) ? inv.body : []).map(text).filter(Boolean).map((line) => ({ text: line, payouts: line === DASH_WORDS.payoutsLine })),
      foot: `Not now tells ${who} you said no. They can ask again.`,
      inviterName: who
    });
  }
  return out;
}

// What the page says once an invite is answered: { text, payouts } —
// `payouts` when the money can't reach them until payouts are set up.
export function inviteAnswered(action, data, inviterName) {
  const accept = action === 'accept';
  const words = data && text(data.words);
  return { text: words || (accept ? 'Done.' : `${text(inviterName) || 'They'} was told.`), payouts: accept && Boolean(data) && data.payoutsReady === false };
}

// The titles whose earnings come to this account, each with the question
// "Stop getting it…" asks (POST /api/payees { action: 'step_down' }).
export function dashboardPaidFor(paidFor) {
  const out = [];
  for (const t of Array.isArray(paidFor) ? paidFor : []) {
    if (!t || !t.titleId || !t.titleType) continue;
    const name = text(t.title) || 'A title';
    const what = t.titleType === 'series' ? name : `“${name}”`;
    const back = t.titleType === 'series' ? 'whoever runs it' : t.showId ? 'the show’s paid account' : 'whoever uploaded it';
    out.push({
      key: `${t.titleType}:${t.titleId}`,
      titleType: t.titleType,
      titleId: t.titleId,
      title: name,
      href: text(t.href) || null,
      meta: [text(t.scopeWords), t.sinceLabel ? `since ${t.sinceLabel}` : ''].filter(Boolean).join(' · '),
      canStop: Boolean(t.canStepDown),
      locked: t.canStepDown ? '' : text(t.lockedLine),
      ask: `Stop getting the earnings of ${what}? They go back to ${back} from now on; what’s already credited to you stays yours.`
    });
  }
  return out;
}

// --- supporters ------------------------------------------------------------------

const NAMES_SHOWN = 6;

// Who is behind the money: counts, and names only where a member chose to
// share theirs (the money page's own rule).
export function dashboardSupporters(money) {
  const s = money && money.supporters ? money.supporters : null;
  if (!s) return null;
  const rows = [
    { key: 'picked', label: 'Picked you in their lineup', value: count(s.picked) },
    { key: 'watching', label: 'By watching this month', value: count(s.watching) },
    { key: 'backers', label: 'Backed a pitch', value: count(s.backers) },
    { key: 'buyers', label: 'Bought a title', value: count(s.buyers) }
  ];
  if (n(s.tippers) > 0) rows.push({ key: 'tippers', label: 'Tipped you', value: count(s.tippers) });
  const names = (Array.isArray(s.names) ? s.names : []).map((x) => text(x && x.displayName)).filter(Boolean);
  const shown = names.slice(0, NAMES_SHOWN);
  const more = names.length - shown.length;
  return {
    rows,
    empty: rows.every((r) => r.value === '0'),
    // Drawn as a list under "Shared their name", then the note.
    names: shown,
    more: more > 0 ? `and ${count(more)} more` : '',
    namesLabel: 'Shared their name',
    note: shown.length ? 'Everyone else is counted, not named.' : 'Members are counted, not named, unless they chose to share their name in Artist Support.',
    href: '/creator/money#supporters'
  };
}

// --- also yours ------------------------------------------------------------------

export function dashboardPitch(money) {
  const list = money && money.lanes && money.lanes.backing && Array.isArray(money.lanes.backing.pitches) ? money.lanes.backing.pitches : [];
  if (!list.length) return null;
  const p = list.slice().sort((a, b) => n(b.allRaisedCents) - n(a.allRaisedCents))[0];
  const goal = n(p.goalCents);
  const raised = n(p.allRaisedCents);
  return {
    title: text(p.title) || 'A pitch',
    line: goal > 0 ? `${dollars(raised).replace(/\.00$/, '')} raised of ${dollars(goal).replace(/\.00$/, '')}` : `${dollars(raised).replace(/\.00$/, '')} raised`,
    share: goal > 0 ? Math.max(0, Math.min(1, raised / goal)) : null,
    href: '/creator/pitch/dashboard',
    action: 'Post an update'
  };
}

export function dashboardLink(money) {
  const link = money && money.link ? money.link : null;
  if (!link || !link.linkPath) return null;
  return {
    path: link.linkPath,
    joined: `${count(link.joined)} joined through it · ${count(link.active)} still ${n(link.active) === 1 ? 'a member' : 'members'}`,
    bonus: `Referral bonus this month: ${dollars(link.bonusMonthCents)}`
  };
}

// The months the money can be shown for, newest first: [{ value, label }].
export function periodOptions(money, now = Date.now()) {
  const list = money && Array.isArray(money.periods) ? money.periods.filter(isPeriod) : [];
  const all = list.length ? list : [currentPeriod(now)];
  return all.map((p) => ({ value: p, label: monthLabel(p) }));
}
