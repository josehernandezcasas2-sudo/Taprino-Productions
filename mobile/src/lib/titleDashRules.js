// A title's dashboard and a show's Overview (the canvas
// https://claude.ai/artifact/6LuuNpyuaKTS5PkCij8Nfc, boards "Dashboard · a
// film" and "Dashboard · a series"; Jose, 2026-11-14: "for series, and
// single items like a film/short, add a dashboard that will encompass the
// work's back end and analytics … so that we can more edit the work and add
// more information"; built 2026-11-15). Pure and client-safe: it turns what
// the creator routes already answer into the page's numbers, chart, money,
// checklist and history, so the website and the app say the same thing.
//
//   title    a row of GET /api/creator/my-submissions
//   detail   GET /api/creator/episode-detail-analytics?episodeId=
//   money    GET /api/creator/money?period=<this year>   (its `history`)
//   price    a row of GET /api/creator/pricing's `prices`
//   show     GET /api/show/<id>
//   numbers  GET /api/creator/analytics?days=30&compare=1
//
// Any of them may be null (loading, refused or failed): each builder says
// what it has and never draws a missing answer as a zero. Earned per title
// is its title sales plus its ad share and nothing else (the Dashboard's
// rule: member support, tips and backing are paid to the creator, not to a
// title).
//
// The app's mobile/src/lib/titleDashRules.js is this file word for word
// (scripts/test-title-dash.mjs checks it).
import { compareEpisodes } from './showRules.js';
import { displayTitle, dayLabel, count, dollars, currentPeriod, DASH_WORDS } from './creatorDashboardRules.js';
import { isLiveTitle, titlePill, titleNeed, titleWaiting, priceWords, runtimeWords, publicPath, notesBoxShows } from './workListRules.js';

export const TITLE_TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'details', label: 'Details' },
  { key: 'artwork', label: 'Artwork' },
  { key: 'video', label: 'Video and captions' },
  { key: 'selling', label: 'Selling' },
  { key: 'channels', label: 'Channels' }
];

export const SHOW_TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'episodes', label: 'Episodes' }
];

export const TITLE_WORDS = {
  back: 'Your work',
  views: 'Views',
  avgWatch: 'Average watch',
  watched: 'Watched through',
  earned: 'Earned this year',
  keptWatching: 'Kept watching',
  chartViews: 'Views',
  chartWatch: 'Watch time',
  chartTitle: 'Last 30 days',
  chartEmpty: 'No views in the last 30 days yet.',
  money: 'What it has earned',
  moneyShow: 'What the show has earned',
  moneyNote: 'Title sales and ad share this year. The Money page has every line.',
  openMoney: 'Open the Money page',
  checklist: 'Checklist',
  history: 'History',
  episodes: 'Episode by episode',
  episodesNote: 'Since each one went live. Open one to edit it.',
  needs: 'Needs you',
  needsNone: 'Nothing needs you right now.',
  waiting: 'Waiting on us',
  waitingNone: 'Nothing is waiting on the team.',
  people: 'Who’s on it',
  notFound: 'This title isn’t one of yours, or it was removed.',
  loading: 'Loading…',
  failed: 'Couldn’t load this. Try again.',
  noTracking: DASH_WORDS.noTracking,
  adShareNote: DASH_WORDS.adShareNote
};

const n = (v) => Number(v) || 0;
const text = (v) => (typeof v === 'string' ? v.trim() : '');
const plural = (k, one, many) => `${count(k)} ${k === 1 ? one : many}`;
const TYPE_WORD = { movie: 'Film', short: 'Short', series: 'Episode', podcast: 'Podcast episode', vertical: 'Vertical', bonus: 'Extra' };
const TIER_WORD = { free: 'Free for everyone', premium: 'Tapa + members' };

// "52 min", "1 h 4 min", "45 s", or '—'.
export function watchWords(seconds) {
  if (seconds == null || !Number.isFinite(Number(seconds))) return '—';
  const s = Math.max(0, Math.round(Number(seconds)));
  if (s < 60) return `${s} s`;
  const minutes = Math.round(s / 60);
  if (minutes < 60) return `${minutes} min`;
  const rest = minutes % 60;
  return rest ? `${Math.floor(minutes / 60)} h ${rest} min` : `${Math.floor(minutes / 60)} h`;
}

function changeNote(pct) {
  if (pct == null) return '';
  if (pct === 0) return 'the same as the 30 days before';
  return `${pct > 0 ? '+' : '−'}${Math.abs(pct)}% on the 30 days before`;
}

// The last `days` of a daily trend, and the change against the days before.
export function lastDays(trend, days = 30) {
  const list = Array.isArray(trend) ? trend.filter(Boolean) : [];
  const recent = list.slice(-days);
  const before = list.length >= days * 2 ? list.slice(-days * 2, -days) : null;
  const sum = (xs, key) => xs.reduce((a, d) => a + n(d[key]), 0);
  const now = sum(recent, 'views');
  const then = before ? sum(before, 'views') : null;
  return { recent, views: now, watchSeconds: sum(recent, 'watchSeconds'), changePct: then ? Math.round(((now - then) / then) * 100) : null };
}

// One title's money from the year's lines: { salesCents, adsCents, bought,
// monthCents }. `ids` are the episode ids that count, `seriesId` a show
// whose whole-series sales count too.
export function moneyOf(lines, { ids = [], seriesId = null, now = Date.now() } = {}) {
  const set = new Set(ids);
  const month = currentPeriod(now);
  let salesCents = 0;
  let adsCents = 0;
  let bought = 0;
  let monthCents = 0;
  for (const l of Array.isArray(lines) ? lines : []) {
    if (!l) continue;
    let cents = 0;
    if (l.lane === 'sales' && l.titleId && ((l.titleType === 'series' && seriesId && l.titleId === seriesId) || (l.titleType !== 'series' && set.has(l.titleId)))) {
      cents = n(l.cents);
      salesCents += cents;
      if (l.kind === 'sale') bought += 1;
      if (l.kind === 'refund') bought -= 1;
    } else if (l.lane === 'ad_share' && l.episodeId && set.has(l.episodeId)) {
      cents = n(l.cents);
      adsCents += cents;
    } else {
      continue;
    }
    if (String(l.at || '').slice(0, 7) === month) monthCents += cents;
  }
  return { salesCents, adsCents, bought: Math.max(0, bought), monthCents };
}

function moneyCard(m, { haveMoney, sellable, year }) {
  if (!haveMoney) return { available: false, rows: [], total: '', month: '', note: '' };
  const rows = [];
  if (sellable || m.salesCents) rows.push({ key: 'sales', label: 'Title sales', detail: m.bought ? plural(m.bought, 'bought', 'bought') : 'none yet', amount: dollars(m.salesCents) });
  rows.push({ key: 'ads', label: 'Ad share', detail: 'from the ads that play in it', amount: dollars(m.adsCents) });
  return {
    available: true,
    yearLabel: String(year),
    rows,
    total: dollars(m.salesCents + m.adsCents),
    month: `${dollars(m.monthCents)} of it this month`,
    note: TITLE_WORDS.adShareNote
  };
}

function bars(recent, mode) {
  const list = recent.map((d) => ({ date: d.date, value: mode === 'watch' ? Math.round(n(d.watchSeconds) / 60) : n(d.views) }));
  const max = list.reduce((a, b) => Math.max(a, b.value), 0);
  return { list, max, empty: max === 0 };
}

// --- a title of its own (a film, a short, an extra, a vertical) ---------------

export function titleDashboard({ title = null, detail = null, money = null, price = null, chartMode = 'views', canEditAll = false, now = Date.now() } = {}) {
  if (!title) return null;
  const s = title;
  const live = isLiveTitle(s);
  const pill = titlePill(s, live);
  const typeWord = TYPE_WORD[s.contentType] || 'Title';
  const runtime = runtimeWords(s.runtime);
  const meta = [runtime, text(s.mainGenre) || text(s.genre), text(s.rating), TIER_WORD[s.tier] || '', s.releasedAt || s.reviewedAt ? (live ? `live since ${dayLabel(s.releasedAt || s.reviewedAt)}` : '') : ''].filter(Boolean).join(' · ');

  const tracking = Boolean(detail && detail.tracking !== false);
  const totals = (detail && detail.totals) || null;
  const window = lastDays(detail && detail.trend, 30);
  const haveMoney = Boolean(money && Array.isArray(money.history));
  const year = new Date(now).getUTCFullYear();
  const m = moneyOf(haveMoney ? money.history : [], { ids: [s.id], now });
  const sellable = s.contentType !== 'bonus';

  const tiles = [
    { key: 'views', label: TITLE_WORDS.views, value: totals ? count(totals.views) : '—', note: !detail ? '' : !tracking ? TITLE_WORDS.noTracking : changeNote(window.changePct) || `${count(window.views)} in the last 30 days` },
    { key: 'avg', label: TITLE_WORDS.avgWatch, value: totals ? watchWords(totals.avgWatchSeconds) : '—', note: runtime ? `of ${runtime}` : '' },
    { key: 'watched', label: TITLE_WORDS.watched, value: totals && totals.watchThroughPct != null ? `${totals.watchThroughPct}%` : '—', note: 'of it, on average' },
    { key: 'earned', label: TITLE_WORDS.earned, value: haveMoney ? dollars(m.salesCents + m.adsCents) : '—', note: haveMoney ? (m.bought ? plural(m.bought, 'copy bought', 'copies bought') : 'sales and ad share') : '' }
  ];
  const chart = { title: TITLE_WORDS.chartTitle, mode: chartMode === 'watch' ? 'watch' : 'views', unit: chartMode === 'watch' ? 'min' : 'views', available: Boolean(detail), ...bars(window.recent, chartMode), from: window.recent.length ? dayLabel(window.recent[0].date) : '', to: window.recent.length ? dayLabel(window.recent[window.recent.length - 1].date) : '' };

  // The checklist: what a finished title has, each with the button that fixes it.
  const checklist = [];
  const hasArt = Boolean(s.poster) && Boolean(s.thumbnail);
  checklist.push({ key: 'artwork', label: 'Poster and still', note: hasArt ? (s.artworkPending ? 'new artwork waiting for approval' : '') : s.poster || s.thumbnail ? 'one of the two is missing' : 'none yet', done: hasArt, action: hasArt ? null : { key: 'artwork', label: s.poster || s.thumbnail ? 'Add the other' : 'Add artwork' } });
  if (s.contentType !== 'podcast') {
    const ok = Boolean(s.captionsUrl) && !s.captionsStale;
    checklist.push({ key: 'captions', label: 'Captions', note: s.captionsUrl ? (s.captionsStale ? 'may be out of sync with the new video' : text(s.captionsLabel) || 'added') : 'none yet', done: ok, action: ok ? null : { key: 'captions', label: s.captionsUrl ? 'Replace captions' : 'Add captions' } });
  }
  if (sellable && live && s.canPrice !== false) {
    const p = priceWords(price, now);
    checklist.push({ key: 'selling', label: 'Selling', note: p ? p.replace(/^on sale /, 'on sale at ') : 'not for sale', done: Boolean(p), action: p ? null : { key: 'sell', label: 'Sell it' } });
  }
  if (s.contentType !== 'bonus') {
    checklist.push({ key: 'channels', label: 'Channels can air it', note: s.channelOptIn ? 'on' : 'off', done: Boolean(s.channelOptIn), action: s.channelOptIn || s.deletionRequested ? null : { key: 'channels', label: 'Turn it on' } });
  }

  // History, newest first: only what the row really knows the date of.
  const history = [];
  if (s.createdAt) history.push({ at: s.createdAt, what: 'Sent for review' });
  if (s.reviewedAt && s.status === 'approved') history.push({ at: s.reviewedAt, what: live ? 'Approved and live' : 'Approved' });
  if (s.reviewedAt && s.status === 'rejected') history.push({ at: s.reviewedAt, what: s.rejectionReason ? `Sent back: ${text(s.rejectionReason)}` : 'Sent back' });
  if (s.deletionRequestedAt) history.push({ at: s.deletionRequestedAt, what: s.deletionReason ? `You asked us to remove it: “${text(s.deletionReason)}”` : 'You asked us to remove it' });
  history.sort((a, b) => String(b.at).localeCompare(String(a.at)));

  return {
    head: {
      title: displayTitle(s),
      typeWord,
      pill,
      meta,
      poster: s.poster || s.thumbnail || null,
      publicPath: live ? publicPath(s) : null
    },
    need: titleNeed(s),
    waiting: titleWaiting(s),
    tiles,
    chart,
    money: moneyCard(m, { haveMoney, sellable, year }),
    checklist,
    history: history.map((h) => ({ when: dayLabel(h.at), what: h.what })),
    trackingOff: Boolean(detail) && !tracking,
    tabs: TITLE_TABS.filter((t) => (t.key === 'selling' ? sellable : t.key === 'channels' ? s.contentType !== 'bonus' : true)),
    details: titleDetails(s, { canEditAll }),
    artwork: {
      poster: s.poster || null,
      still: s.thumbnail || null,
      titleImage: s.titleImageUrl || null,
      waiting: s.artworkPending ? 'New artwork is waiting for approval.' : '',
      action: s.deletionRequested ? null : { key: 'artwork', label: s.poster || s.thumbnail ? 'Replace artwork' : 'Add artwork' }
    },
    video: titleVideo(s),
    selling: {
      sellable: sellable && s.canPrice !== false,
      live,
      price: priceWords(price, now) || 'Not for sale',
      note: !live ? 'Selling opens once it is live.' : s.canPrice === false ? 'Whoever runs this title sets its price.' : '',
      action: live && sellable && s.canPrice !== false && !s.deletionRequested ? { key: 'sell', label: price ? 'Price and sales' : 'Sell it' } : null,
      payee: s.deletionRequested ? null : { key: 'payee', label: 'Who gets paid' }
    },
    channels: { on: Boolean(s.channelOptIn), locked: Boolean(s.deletionRequested || s.held), lockedWhy: s.deletionRequested ? 'Locked while its removal is requested.' : s.held ? 'Locked while it’s pulled.' : '' },
    removal: s.withdrawnAt ? null : s.deletionRequested ? { key: 'cancel_removal', label: 'Cancel the removal request', line: s.deletionReason ? `You asked us to remove it: “${text(s.deletionReason)}”` : 'You asked us to remove it.' } : { key: 'remove', label: 'Ask to remove it…', line: 'We confirm it soon. Anyone who bought it keeps it.' }
  };
}

function titleDetails(s, { canEditAll }) {
  const rows = [
    { key: 'title', label: 'Title', value: displayTitle(s), waiting: s.pendingTitle ? `“${text(s.pendingTitle)}” is waiting for approval` : '' },
    { key: 'about', label: 'About', value: text(s.description) || 'Nothing yet', waiting: s.pendingDescription ? 'A new description is waiting for approval' : '' }
  ];
  if (s.pageNotesReady && (text(s.pageNotes) || typeof s.pendingPageNotes === 'string')) rows.push({ key: 'notes', label: 'Notes on its page', value: text(s.pageNotes) || 'None', waiting: typeof s.pendingPageNotes === 'string' ? 'New notes are waiting for approval' : '' });
  rows.push({ key: 'type', label: 'Type', value: TYPE_WORD[s.contentType] || 'Title', waiting: '' });
  if (text(s.mainGenre) || text(s.genre)) rows.push({ key: 'genre', label: 'Genre', value: [text(s.mainGenre), text(s.genre)].filter(Boolean).join(' · '), waiting: '' });
  if (text(s.rating)) rows.push({ key: 'rating', label: 'Rating', value: text(s.rating), waiting: '' });
  if (s.releaseYear) rows.push({ key: 'year', label: 'Year', value: String(s.releaseYear), waiting: '' });
  if (s.runtime) rows.push({ key: 'runtime', label: 'Runtime', value: runtimeWords(s.runtime), waiting: '' });
  rows.push({ key: 'tier', label: 'Who can watch', value: TIER_WORD[s.tier] || 'Free for everyone', waiting: '' });
  if (s.hasFlashingLights) rows.push({ key: 'flashing', label: 'Flashing lights', value: 'Marked: viewers see the warning', waiting: '' });
  if (s.contentType !== 'podcast' && s.downloadsAllowedReady !== false) rows.push({ key: 'downloads', label: 'Downloads in the app', value: s.downloadsAllowed === false ? 'Off' : 'On', waiting: '' });
  let action = null;
  if (!s.deletionRequested && !s.withdrawnAt) {
    if (canEditAll) action = { key: 'edit_full', label: 'Edit full details' };
    else if (s.status === 'pending') action = { key: 'edit_submission', label: 'Edit the submission' };
    else action = { key: 'edit_words', label: notesBoxShows(s) ? 'Edit title, description and notes' : 'Edit title and description' };
  }
  return { rows, action, note: s.status === 'approved' && !canEditAll ? 'On a live title a new title, description or notes wait for the team’s approval; the rest applies when you save. Who can watch and the rating stay with the team.' : '' };
}

function titleVideo(s) {
  const cf = s.cloudflareState;
  const file = cf === 'error' ? `The file failed to process${s.cloudflareError ? `: ${text(s.cloudflareError)}` : ''}` : cf === 'pendingupload' ? 'The upload never finished' : cf && cf !== 'ready' ? 'The file is processing' : s.hasVideo ? 'Ready to stream' : s.hasAudio ? 'Audio only' : 'No file yet';
  const gone = s.deletionRequested || s.withdrawnAt;
  return {
    file: [file, runtimeWords(s.runtime)].filter(Boolean).join(' · '),
    waiting: s.pendingSrc ? (s.pendingVideoState && s.pendingVideoState !== 'ready' ? 'A new video is waiting for approval (still processing).' : 'A new video is waiting for approval.') : '',
    action: gone ? null : { key: 'video', label: s.hasVideo ? 'Replace the video' : 'Add a video' },
    audio: s.contentType === 'podcast' ? { has: Boolean(s.hasAudio), action: s.hasVideo && !s.hasAudio && !gone ? { key: 'extract_audio', label: 'Extract the audio' } : null } : null,
    captions: s.contentType === 'podcast' ? null : {
      line: s.captionsUrl ? `${text(s.captionsLabel) || 'Captions'}${s.captionsStale ? ' · may be out of sync with the new video' : ''}` : 'None yet',
      action: gone ? null : { key: 'captions', label: s.captionsUrl ? 'Replace captions' : 'Add captions' }
    }
  };
}

// --- a show's Overview ---------------------------------------------------------

export function showOverview({ show = null, numbers = null, money = null, now = Date.now() } = {}) {
  if (!show || !show.show) return null;
  const sid = show.show.id;
  const rows = [];
  for (const season of Array.isArray(show.seasons) ? show.seasons : []) {
    for (const r of Array.isArray(season.rows) ? season.rows : []) if (r && r.kind === 'episode' && r.id) rows.push(r);
  }
  const extras = (Array.isArray(show.extras) ? show.extras : []).filter((x) => x && x.id);
  rows.sort(compareEpisodes);
  const ids = [...rows, ...extras].map((r) => r.id);
  const per = new Map((numbers && Array.isArray(numbers.perEpisode) ? numbers.perEpisode : []).map((e) => [e.id, e]));
  const haveNumbers = Boolean(numbers && numbers.totals);
  const tracking = Boolean(numbers && numbers.tracking !== false);

  let windowViews = 0;
  let allViews = 0;
  let weighted = 0;
  let weight = 0;
  let spark = null;
  for (const id of ids) {
    const e = per.get(id);
    if (!e) continue;
    windowViews += n(e.windowViews);
    allViews += n(e.views);
    if (e.watchThroughPct != null) {
      const w = Math.max(1, n(e.views));
      weighted += n(e.watchThroughPct) * w;
      weight += w;
    }
    if (Array.isArray(e.spark) && e.spark.length) spark = spark ? spark.map((x, i) => x + n(e.spark[i])) : e.spark.map(n);
  }
  const firstTwo = rows.filter((r) => (Number(r.season) || 1) === (Number(rows[0] && rows[0].season) || 1)).slice(0, 2);
  const e1 = firstTwo[0] ? per.get(firstTwo[0].id) : null;
  const e2 = firstTwo[1] ? per.get(firstTwo[1].id) : null;
  const kept = e1 && e2 && n(e1.views) > 0 ? Math.min(100, Math.round((n(e2.views) / n(e1.views)) * 100)) : null;
  const haveMoney = Boolean(money && Array.isArray(money.history));
  const m = moneyOf(haveMoney ? money.history : [], { ids, seriesId: sid, now });
  const year = new Date(now).getUTCFullYear();

  const tiles = [
    { key: 'views', label: `${TITLE_WORDS.views} · 30 days`, value: haveNumbers ? count(windowViews) : '—', note: !haveNumbers ? '' : !tracking ? TITLE_WORDS.noTracking : `${count(allViews)} since it went live` },
    { key: 'watched', label: TITLE_WORDS.watched, value: haveNumbers && weight ? `${Math.round(weighted / weight)}%` : '—', note: 'of an episode, on average' },
    { key: 'kept', label: TITLE_WORDS.keptWatching, value: kept != null ? `${kept}%` : '—', note: firstTwo.length === 2 ? `${firstTwo[1].code || 'E2'} views next to ${firstTwo[0].code || 'E1'}’s` : 'once a second episode is live' },
    { key: 'earned', label: TITLE_WORDS.earned, value: haveMoney ? dollars(m.salesCents + m.adsCents) : '—', note: haveMoney ? 'sales and ad share' : '' }
  ];
  const sparkBars = (spark || []).map((v, i) => ({ date: String(i), value: n(v) }));
  const max = sparkBars.reduce((a, b) => Math.max(a, b.value), 0);
  const chart = { title: `${TITLE_WORDS.views} · ${TITLE_WORDS.chartTitle.toLowerCase()}`, available: haveNumbers, list: sparkBars, max, empty: max === 0, from: '30 days ago', to: 'today', unit: 'views' };

  const statusPill = (r) => {
    if (r.status === 'pending') return { label: 'In review', tone: 'review' };
    if (r.status === 'rejected') return { label: 'Not this time', tone: 'declined' };
    if (r.deletionRequested) return { label: 'Removal requested', tone: 'quiet' };
    if (r.held) return { label: 'Pulled', tone: 'declined' };
    return null;
  };
  const episodes = [...rows, ...extras].map((r) => {
    const e = per.get(r.id);
    const pill = statusPill(r);
    return {
      id: r.id,
      code: r.kind === 'extra' || !r.code ? 'Extra' : r.code,
      title: text(r.displayTitle) || displayTitle(r),
      views: !pill && e ? count(e.views) : '—',
      avg: !pill && e ? watchWords(e.avgWatchSeconds) : '—',
      pct: !pill && e && e.watchThroughPct != null ? e.watchThroughPct : null,
      pill,
      href: `/creator/show/${encodeURIComponent(sid)}/episode/${encodeURIComponent(r.id)}`
    };
  });

  const needs = (Array.isArray(show.problems) ? show.problems : []).filter((p) => p && p.level !== 'info' && text(p.words)).map((p) => ({ key: p.code, text: text(p.words) }));
  for (const r of rows) {
    if (r.status === 'rejected') needs.push({ key: `rejected:${r.id}`, text: `${r.code ? `${r.code} ` : ''}${text(r.displayTitle)} was sent back${r.rejectionReason ? `: ${text(r.rejectionReason)}` : ''}` });
  }
  const waiting = [];
  for (const r of rows) {
    const label = `${r.code ? `${r.code} ` : ''}${text(r.displayTitle)}`;
    if (r.status === 'pending') waiting.push({ key: `review:${r.id}`, text: `${label}: in review` });
    const st = r.staged || {};
    const parts = [];
    if (st.title) parts.push('a new title');
    if (st.description) parts.push('a new description');
    if (st.pageNotes) parts.push('new notes');
    if (st.poster || st.thumbnail) parts.push('new artwork');
    if (st.titleImage) parts.push('a new title image');
    if (st.trailer) parts.push('a new trailer');
    if (st.newVideo) parts.push('a new video');
    if (parts.length) waiting.push({ key: `staged:${r.id}`, text: `${label}: ${parts.join(', ')}` });
  }
  // GET /api/show/<id>'s show.staged: null / false / [] when nothing waits.
  const sst = show.show.staged || {};
  const waits = (v) => (Array.isArray(v) ? v.length > 0 : Boolean(v));
  if (sst.any === true || ['name', 'description', 'poster', 'thumbnail', 'heroImage', 'titleImage', 'titleImageUrl', 'titleImageRemoval', 'trailer', 'seasonArt'].some((k) => waits(sst[k]))) waiting.push({ key: 'show', text: 'A change to the show itself' });

  const people = [];
  const payee = show.payee || null;
  if (payee && payee.runsIt && payee.runsIt.name) people.push({ key: 'runs', label: 'Runs it', value: payee.runsIt.name });
  if (payee && payee.paidTo && payee.paidTo.name && show.viewer && show.viewer.seesWhoIsPaid !== false) people.push({ key: 'paid', label: 'Earnings go to', value: payee.paidTo.name });
  for (const c of Array.isArray(show.show.creditLines) ? show.show.creditLines : []) {
    if (c && text(c.label) && text(c.name)) people.push({ key: `credit:${c.key || c.label}`, label: text(c.label), value: text(c.name) });
  }

  return {
    tiles,
    chart,
    money: moneyCard(m, { haveMoney, sellable: true, year }),
    episodes,
    episodesTotal: rows.length + extras.length,
    needs,
    waiting,
    people,
    trackingOff: haveNumbers && !tracking
  };
}
