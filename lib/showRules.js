// Shows (series and podcasts) and their episodes: the rules behind the
// show page, the episode editor, the Move sheet and the review queue's
// show card (the series revamp, mockups/series-revamp-spec.md; Jose's
// decisions 2, 5-7, 9-11, 13, 15, 16 and 19-21). Pure and client-safe,
// and on purpose it imports nothing, so the app's copy
// (mobile/src/lib/showRules.js) is this file word for word below its
// header: scripts/test-show-rules.mjs checks that and runs every case on
// both. Change both together.
//
// A row comes in either shape: a database row (series_order, created_at,
// submitted_by, moderation_hold...) or the camelCase one the pages and the
// API hand around (seriesOrder, createdAt, submittedBy, held...). A draft
// (creator_drafts, `kind: 'draft'`) may keep its season and number in its
// form, as strings.
//
// Play order (compareEpisodes): season (none = 1), then number (none =
// after the numbered ones), then the oldest first, then the id. That is
// the order the spec gives sortEpisodes in lib/seriesResume.js; this file
// keeps its own copy of the comparison so it needs no import.

export const SHOW_KINDS = ['series', 'podcast', 'vertical'];
export const FILES_PER_DROP = 30;
export const DRAFTS_CAP = 100;
export const MAX_EPISODE_NUMBER = 9999;
// A number this far past the one before it in its season is "parked":
// migration 118 moves duplicate numbers out of the way to the season's
// highest + 1000 (decision 16), and a typo like E900 lands there too.
// Parked rows are flagged and never set the next free number.
export const PARKED_JUMP = 500;
export const CREDIT_KEYS = ['maker', 'studio', 'producer'];

const NUMBERED_TYPES = ['series', 'podcast'];

// The built-in minimum ages, the same table as lib/ageGate.js
// (MIN_AGE_BY_RATING); custom ratings come in as `ratings` (the live list
// from lib/ratings.js or /api/ratings) and carry their own.
const BUILT_IN_MIN_AGE = {
  'G': 0,
  'TV-Y': 0,
  'TV-G': 0,
  'PG': 0,
  'TV-PG': 0,
  'TV-Y7': 7,
  'PG-13': 13,
  'TV-14': 14,
  'R': 17,
  'NC-17': 17,
  'TV-MA': 17,
  'Not Rated': 17
};

// --- reading a row -----------------------------------------------------------

function blank(v) {
  return v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
}

function text(v) {
  return blank(v) ? null : String(v).trim();
}

function posInt(v) {
  if (blank(v) || typeof v === 'boolean') return null;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function pick(row, camel, snake) {
  if (!row || typeof row !== 'object') return undefined;
  if (row[camel] !== undefined) return row[camel];
  if (snake && row[snake] !== undefined) return row[snake];
  if (row.form && typeof row.form === 'object' && row.form[camel] !== undefined) return row.form[camel];
  return undefined;
}

function timeOf(v) {
  if (blank(v)) return null;
  if (v instanceof Date) return Number.isFinite(v.getTime()) ? v.getTime() : null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const t = Date.parse(String(v));
  return Number.isFinite(t) ? t : null;
}

function sameId(a, b) {
  return a !== undefined && a !== null && b !== undefined && b !== null && String(a) === String(b);
}

export function seasonOf(row) {
  return posInt(pick(row, 'season', 'season')) || 1;
}

export function numberOf(row) {
  return posInt(pick(row, 'seriesOrder', 'series_order'));
}

function contentTypeOf(row) {
  return text(pick(row, 'contentType', 'content_type'));
}

function statusOf(row) {
  if (!row) return null;
  if (row.kind === 'draft' || row.isDraft === true) return 'draft';
  return text(row.status);
}

function isWithdrawn(row) {
  return !blank(pick(row, 'withdrawnAt', 'withdrawn_at'));
}

function isHeld(row) {
  return Boolean(row && (row.held === true || row.moderationHold === true || row.moderation_hold === true));
}

function removalRequested(row) {
  return Boolean(pick(row, 'deletionRequested', 'deletion_requested'));
}

function createdAt(row) {
  return timeOf(pick(row, 'createdAt', 'created_at'));
}

function titleOf(row) {
  return text(pick(row, 'title', 'title'));
}

function tierOf(row) {
  return text(pick(row, 'tier', 'tier')) === 'premium' ? 'premium' : 'free';
}

function adsOn(row) {
  return pick(row, 'adsEnabled', 'ads_enabled') !== false;
}

function uploaderOf(row) {
  return text(pick(row, 'submittedBy', 'submitted_by'));
}

function seriesIdOf(row) {
  return text(pick(row, 'seriesId', 'series_id'));
}

// Who runs a show: its owner, series.creator_id (decision 19). A
// standalone title's runner is its uploader.
export function runnerOf(show) {
  return text(pick(show, 'creatorId', 'creator_id'));
}

function pl(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

function listWords(items) {
  const xs = items.filter(Boolean);
  if (xs.length <= 1) return xs.join('');
  return `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;
}

function dayLabel(v) {
  const t = timeOf(v);
  if (t === null) return null;
  try {
    return new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/Los_Angeles' });
  } catch (err) {
    return null;
  }
}

function nameLookup(names) {
  return (id) => {
    if (!id) return null;
    if (typeof names === 'function') return text(names(id));
    if (names && typeof names.get === 'function') return text(names.get(id));
    if (names && typeof names === 'object') return text(names[id]);
    return null;
  };
}

function parseJson(raw) {
  if (typeof raw !== 'string') return raw;
  try {
    return JSON.parse(raw);
  } catch (err) {
    return null;
  }
}

// --- kinds -------------------------------------------------------------------

// The show kind a content type belongs to; null for one that joins no
// numbered list (a film, a short, an extra).
export function kindForType(contentType) {
  const t = text(contentType);
  return t === 'series' || t === 'podcast' || t === 'vertical' ? t : null;
}

// Migration 118's backfill for series.kind: a podcast when any episode is
// a podcast and none is a series episode, vertical when every one is
// vertical, otherwise a series. Extras don't count.
export function kindFromEpisodes(episodes) {
  const types = (episodes || []).map(contentTypeOf).filter((t) => t && t !== 'bonus');
  if (types.includes('podcast') && !types.includes('series')) return 'podcast';
  if (types.length > 0 && types.every((t) => t === 'vertical')) return 'vertical';
  return 'series';
}

// A show's kind: the column (migration 118), else what its episodes say,
// else a series.
export function kindOf(show, episodes) {
  const k = text(pick(show, 'kind', 'kind'));
  if (k && SHOW_KINDS.includes(k)) return k;
  return episodes ? kindFromEpisodes(episodes) : 'series';
}

// "show" for a podcast, "series" otherwise (the same words as
// showNoun in lib/submitRules.js, which takes a content type).
export function showNoun(kind) {
  return kind === 'podcast' ? 'show' : 'series';
}

// Public: approved (a row from before the status column counts as
// approved), not pulled, not on its way out. The inverse of seriesHidden.
export function isPublicShow(show) {
  if (!show) return false;
  const st = text(show.status);
  return (st === null || st === 'approved') && !isHeld(show) && !removalRequested(show);
}

// --- play order and places ---------------------------------------------------

export function compareEpisodes(a, b) {
  const s = seasonOf(a) - seasonOf(b);
  if (s !== 0) return s;
  const na = numberOf(a);
  const nb = numberOf(b);
  if (na !== nb) {
    if (na === null) return 1;
    if (nb === null) return -1;
    return na - nb;
  }
  const ta = createdAt(a);
  const tb = createdAt(b);
  if (ta !== tb) {
    if (ta === null) return 1;
    if (tb === null) return -1;
    return ta - tb;
  }
  const ia = String(a && a.id !== undefined && a.id !== null ? a.id : '');
  const ib = String(b && b.id !== undefined && b.id !== null ? b.id : '');
  return ia < ib ? -1 : ia > ib ? 1 : 0;
}

function numberedType(row) {
  const t = contentTypeOf(row);
  return t === null || NUMBERED_TYPES.includes(t);
}

// Whether a row is in its season's running order: an episode (or a draft)
// of a series or podcast that isn't declined and isn't withdrawn (amendment
// 6: those stop holding their number). A row whose removal is requested
// keeps its place until an admin decides; extras are never numbered.
export function inRunningOrder(row) {
  if (!row || typeof row !== 'object' || !numberedType(row)) return false;
  if (statusOf(row) === 'rejected') return false;
  return !isWithdrawn(row);
}

export function holdsSlot(row) {
  return inRunningOrder(row) && numberOf(row) !== null;
}

function seasonRows(rows, season) {
  return (rows || []).filter((r) => inRunningOrder(r) && seasonOf(r) === season).sort(compareEpisodes);
}

function splitRun(sortedDistinct) {
  const regular = [];
  const parked = [];
  for (let i = 0; i < sortedDistinct.length; i += 1) {
    const n = sortedDistinct[i];
    if (parked.length > 0 || (i > 0 && n - sortedDistinct[i - 1] > PARKED_JUMP)) parked.push(n);
    else regular.push(n);
  }
  return { regular, parked };
}

function splitSeason(list) {
  const numbered = list.filter((r) => numberOf(r) !== null);
  const distinct = [...new Set(numbered.map(numberOf))].sort((a, b) => a - b);
  const parked = new Set(splitRun(distinct).parked);
  return {
    regular: numbered.filter((r) => !parked.has(numberOf(r))),
    parked: numbered.filter((r) => parked.has(numberOf(r))),
    unnumbered: list.filter((r) => numberOf(r) === null)
  };
}

function nextAfter(regular) {
  let max = 0;
  for (const r of regular) max = Math.max(max, numberOf(r));
  return max + 1;
}

function strictlyRising(numbers) {
  for (let i = 1; i < numbers.length; i += 1) if (!(numbers[i] > numbers[i - 1])) return false;
  return true;
}

// The seasons the running order uses, lowest first.
export function seasonsOf(rows) {
  return [...new Set((rows || []).filter(inRunningOrder).map(seasonOf))].sort((a, b) => a - b);
}

// A season's running order as the show page draws it: the numbered rows,
// then any parked ones, then the rows without a number. planMove's index
// targets count in this list.
export function seasonOrder(rows, season) {
  const split = splitSeason(seasonRows(rows, posInt(season) || 1));
  return [...split.regular, ...split.parked, ...split.unnumbered];
}

// The number a new episode gets in a season when none is typed: one past
// the highest (gaps are never filled by themselves, decision 10).
export function nextFreeNumber(rows, season) {
  return nextAfter(splitSeason(seasonRows(rows, posInt(season) || 1)).regular);
}

function gapRanges(numbers, leading) {
  const out = [];
  if (!numbers.length) return out;
  let prev = leading ? 0 : numbers[0] - 1;
  for (const n of numbers) {
    if (n - prev > 1) out.push({ from: prev + 1, to: n - 1 });
    prev = n;
  }
  return out;
}

// What a season holds: the number → its row (the oldest when two share
// it), the shared numbers, the next free number, the gaps as ranges (a
// podcast numbered on from an earlier season isn't missing its first
// numbers, so `kind: 'podcast'` counts gaps from the lowest number), the
// parked numbers and the rows without one.
export function positionsFor(rows, season, opts = {}) {
  const s = posInt(season) || 1;
  const split = splitSeason(seasonRows(rows, s));
  const taken = {};
  const duplicates = {};
  for (const r of [...split.regular, ...split.parked]) {
    const n = numberOf(r);
    if (taken[n]) {
      if (!duplicates[n]) duplicates[n] = [taken[n].id];
      duplicates[n].push(r.id);
      continue;
    }
    taken[n] = { id: r.id, title: titleOf(r), status: statusOf(r) };
  }
  const regularNumbers = [...new Set(split.regular.map(numberOf))].sort((a, b) => a - b);
  return {
    season: s,
    taken,
    duplicates,
    nextFree: nextAfter(split.regular),
    gaps: gapRanges(regularNumbers, opts.kind !== 'podcast'),
    parked: [...new Set(split.parked.map(numberOf))].sort((a, b) => a - b),
    unnumbered: split.unnumbered.map((r) => r.id)
  };
}

// Whether a season + number is free in a show for one row: submit-episode's
// 409 (with the holder and the next free number to offer), "Send again for
// review" on a declined episode (amendment 6: its old number may have been
// taken meanwhile), an approve. `excludeId` is the row being checked, so
// its own number doesn't count against it. Declined and withdrawn rows
// hold nothing.
export function slotCheck(rows, { season, number, excludeId } = {}) {
  const s = posInt(season) || 1;
  const n = posInt(number);
  const others = (rows || []).filter((r) => r && typeof r === 'object' && !sameId(r.id, excludeId));
  const p = positionsFor(others, s);
  if (!n) return { free: false, code: 'unnumbered', season: s, number: null, holder: null, nextFree: p.nextFree, words: 'It needs an episode number' };
  const holder = p.taken[n] || null;
  if (!holder) return { free: true, code: 'free', season: s, number: n, holder: null, nextFree: p.nextFree, words: `E${n} is free` };
  return { free: false, code: 'taken', season: s, number: n, holder, nextFree: p.nextFree, words: `E${n} in Season ${s} is ${holder.title ? `taken by “${holder.title}”` : 'taken'}` };
}

// The 409 a number another episode keeps answers with, the same wherever a
// number is set (submit-episode, the creator's edit, the admin's edit): the
// holder and the next free number to offer. A number that reads free again
// by the time it is asked (whoever took it a moment ago is gone) says so
// plainly instead of "E3 is free".
export function slotTakenBody(slot) {
  const s = slot || {};
  return {
    error: s.free || !s.words ? 'That number was just taken — reload and pick another.' : `${s.words}. The next free number is E${s.nextFree}.`,
    code: 'taken',
    season: s.season ?? null,
    number: s.number ?? null,
    holder: s.holder ? { id: s.holder.id, title: s.holder.title || null } : null,
    nextFree: s.nextFree ?? null
  };
}

// The numbering lines for the status card, season by season: two rows on
// one number, a hole in the run, a parked number, rows with no number.
export function numberingProblems(rows, opts = {}) {
  const seasons = seasonsOf(rows);
  const many = seasons.length > 1;
  const out = [];
  for (const s of seasons) {
    const p = positionsFor(rows, s, opts);
    for (const key of Object.keys(p.duplicates).sort((a, b) => Number(a) - Number(b))) {
      const ids = p.duplicates[key];
      out.push({ code: 'duplicate', season: s, numbers: [Number(key)], episodeIds: ids, words: `${ids.length} episodes share E${key} in Season ${s} — pick one` });
    }
    for (const g of p.gaps) {
      const numbers = [];
      for (let n = g.from; n <= g.to && numbers.length < 50; n += 1) numbers.push(n);
      out.push({
        code: 'gap',
        season: s,
        numbers,
        from: g.from,
        to: g.to,
        episodeIds: [],
        words: g.from === g.to ? `E${g.from} is missing in Season ${s}` : `E${g.from}–E${g.to} are missing in Season ${s}`
      });
    }
    if (p.parked.length) {
      const ids = seasonRows(rows, s).filter((r) => p.parked.includes(numberOf(r))).map((r) => r.id);
      const codes = listWords(p.parked.map((n) => `E${n}`));
      out.push({
        code: 'parked',
        season: s,
        numbers: p.parked,
        episodeIds: ids,
        words: ids.length === 1 ? `${codes} in Season ${s} sits far past the rest — give it its own number` : `${codes} in Season ${s} sit far past the rest — give them their own numbers`
      });
    }
    if (p.unnumbered.length) {
      out.push({ code: 'unnumbered', season: s, numbers: [], episodeIds: p.unnumbered, words: `${pl(p.unnumbered.length, 'episode has', 'episodes have')} no number${many ? ` in Season ${s}` : ''}` });
    }
  }
  return out;
}

// --- moving rows -------------------------------------------------------------

function refuse(code, reason, extra) {
  return { ok: false, code, reason, ...(extra || {}) };
}

function codeOf(season, number, withSeason) {
  const e = number === null || number === undefined ? 'no number' : `E${number}`;
  return withSeason ? `S${season} ${e}` : e;
}

function rangeCode(season, from, to, withSeason) {
  return from === to ? codeOf(season, from, withSeason) : `${codeOf(season, from, withSeason)}–E${to}`;
}

// "E3–E6 become E4–E7", "E2 becomes E4, E4 becomes E5", one clause per run
// of rows whose old and new numbers both count up by one.
function runWords(changes, withSeason) {
  const numbered = changes.filter((c) => c.from !== null).sort((a, b) => (a.fromSeason - b.fromSeason) || (a.from - b.from));
  const runs = [];
  for (const c of numbered) {
    const run = runs[runs.length - 1];
    const last = run && run[run.length - 1];
    if (last && last.fromSeason === c.fromSeason && last.toSeason === c.toSeason && c.from === last.from + 1 && c.to === last.to + 1) run.push(c);
    else runs.push([c]);
  }
  const clauses = runs.map((run) => {
    const a = run[0];
    const b = run[run.length - 1];
    if (run.length === 1) return `${codeOf(a.fromSeason, a.from, withSeason)} becomes ${codeOf(a.toSeason, a.to, withSeason)}`;
    return `${rangeCode(a.fromSeason, a.from, b.from, withSeason)} become ${rangeCode(a.toSeason, a.to, b.to, withSeason)}`;
  });
  for (const c of changes.filter((x) => x.from === null)) {
    clauses.push(`${c.title ? `“${c.title}”` : 'An episode with no number'} becomes ${codeOf(c.toSeason, c.to, withSeason)}`);
  }
  return clauses.join(', ');
}

function rowKind(row) {
  return statusOf(row) === 'draft' ? 'draft' : 'episode';
}

// The writes an assignment (row → { season, number }) makes, with their
// undo. `showOf(row)` says which show a row sits in once the plan has run
// (a move to another show changes the moved row's; `moved` = { row, from,
// to } then, and its write and undo carry seriesId).
function planFrom(scope, assign, showOf, moved) {
  const writes = [];
  const undo = [];
  const changed = [];
  for (const [row, to] of assign) {
    const fromSeason = seasonOf(row);
    const from = numberOf(row);
    const showMove = Boolean(moved && moved.row === row);
    if (!showMove && fromSeason === to.season && from === to.number) continue;
    const write = { id: row.id, kind: rowKind(row), season: to.season, number: to.number };
    const back = { id: row.id, kind: rowKind(row), season: fromSeason, number: from };
    if (showMove) {
      write.seriesId = moved.to;
      back.seriesId = moved.from;
    }
    writes.push(write);
    undo.push(back);
    changed.push({ id: row.id, title: titleOf(row), fromSeason, from, toSeason: to.season, to: to.number, ...(showMove ? { fromShow: moved.from, toShow: moved.to } : {}) });
  }
  // Nothing may end up sharing a place it didn't share before.
  const placeOf = (r) => {
    const p = assign.has(r) ? assign.get(r) : { season: seasonOf(r), number: numberOf(r) };
    return `${showOf(r)}|${p.season}|${p.number}`;
  };
  const holders = scope.filter(holdsSlot);
  for (const [row, to] of assign) {
    if (to.number > MAX_EPISODE_NUMBER) return { error: refuse('number', `Episode numbers go up to ${MAX_EPISODE_NUMBER}.`) };
    const key = placeOf(row);
    const clash = holders.find((r) => r !== row && placeOf(r) === key);
    if (clash) return { error: refuse('conflict', `That would put two episodes on S${to.season} E${to.number}.`, { holder: { id: clash.id, title: titleOf(clash) } }) };
  }
  return { writes, undo, changed };
}

function singleSeasonShape(writes) {
  const seasons = new Set(writes.map((w) => w.season));
  if (seasons.size !== 1) return {};
  return {
    season: writes[0].season,
    ids: writes.map((w) => w.id),
    numbers: writes.map((w) => w.number),
    episodes: writes.filter((w) => w.kind === 'episode').map((w) => ({ id: w.id, number: w.number })),
    drafts: writes.filter((w) => w.kind === 'draft').map((w) => ({ id: w.id, number: w.number }))
  };
}

function neighbourOf(all, target) {
  if (!target || typeof target !== 'object') return { id: null, row: null };
  const id = target.beforeId !== undefined && target.beforeId !== null ? target.beforeId : target.afterId;
  if (id === undefined || id === null) return { id: null, row: null };
  return { id, row: all.find((r) => sameId(r.id, id)) || null };
}

// `toRows` are the rows of the show it goes to; `crossShow` when that is
// another show (its season then defaults to 1, as move_episode does).
function resolveMoveTarget(all, toRows, moved, target, crossShow) {
  const fromSeason = seasonOf(moved);
  if (typeof target === 'number') {
    if (!Number.isInteger(target)) return { error: refuse('target', 'Pick where it goes.') };
    return { season: fromSeason, mode: 'index', index: target };
  }
  if (!target || typeof target !== 'object') return { error: refuse('target', 'Pick where it goes.') };
  const neighbour = neighbourOf(all, target);
  if (neighbour.id !== null) {
    const other = neighbour.row;
    if (!other || !inRunningOrder(other) || (other !== moved && !toRows.includes(other))) return { error: refuse('target', 'That spot isn’t in the running order.') };
    if (other === moved) return { season: fromSeason, mode: 'stay' };
    return { season: seasonOf(other), mode: 'next-to', other, after: target.beforeId === undefined || target.beforeId === null };
  }
  const season = blank(target.season) ? (crossShow ? 1 : fromSeason) : posInt(target.season);
  if (!season) return { error: refuse('season', 'Seasons are numbered from 1.') };
  if (!blank(target.number)) {
    const number = posInt(target.number);
    if (!number) return { error: refuse('number', 'Episode numbers start at 1.') };
    if (number > MAX_EPISODE_NUMBER) return { error: refuse('number', `Episode numbers go up to ${MAX_EPISODE_NUMBER}.`) };
    let how = 'ask';
    if (target.mode === 'swap' || target.swap === true) how = 'swap';
    else if (target.mode === 'insert' || target.insert === true || target.shift === true) how = 'insert';
    return { season, mode: 'number', number, how };
  }
  if (target.index !== undefined && target.index !== null) {
    const index = Number(target.index);
    if (!Number.isInteger(index)) return { error: refuse('target', 'Pick where it goes.') };
    return { season, mode: 'index', index };
  }
  return { season, mode: 'end' };
}

function unchangedPlan(moved) {
  const place = { season: seasonOf(moved), number: numberOf(moved) };
  return { ok: true, code: 'same', episodeId: moved.id, from: place, to: place, writes: [], undo: [], changed: [], words: 'Nothing moves', crossSeason: false };
}

// Where one row goes and what that does to the others (decision 5 and
// spec decision 10). A drag is an insert: the row takes the place it is
// dropped on and the rows between its old place and the new one each move
// one place along the numbers they already hold, so every other number
// and every gap stays put. Nothing renumbers a season by itself.
// move_episode and reorder_show_season (migration 118) write exactly what
// this plans; scripts/check-migration-118.mjs runs both on the same rows.
//
// `rows` are one show's episodes and drafts (they may leave out seriesId);
// for a move to another show, pass both shows' rows with their seriesId and
// name the show as target.seriesId (its season then defaults to 1).
// `target` is one of:
//   a number            the row's index in seasonOrder(rows, its season)
//                       once moved (a drag, or ↑/↓);
//   { beforeId } / { afterId }   dropped next to another row (any season);
//   { season, index }   an index in another season's order;
//   { season }          that season's end (a season header, "End of season");
//   { season?, number, mode }    a typed number: free → it takes it; taken
//                       → mode 'insert' (the holder and the rows after it
//                       move along) or 'swap' (the two trade places), and
//                       without a mode the answer is code 'taken' with the
//                       holder, so the page can offer Swap | Insert here;
// plus, on any object, seriesId (another show) and showName (its name, for
// the words). `opts.closeGap` (or target.closeGap): on a move out of a
// season, the rows after it there move up to close the hole.
//
// The answer: { ok, code, episodeId, from, to, writes: [{ id, kind,
// season, number }] (every row whose place changes; kind 'draft' rows are
// written into their form; the moved row's also carries seriesId when it
// changes show), undo (the same rows as they were), changed, words
// ('E7 → E3; E3–E6 become E4–E7'), crossSeason, crossShow } plus, when it
// all stays in one season of one show, the reorder RPC's shape { season,
// ids, numbers, episodes, drafts }. Refusals are { ok: false, code, reason }.
export function planMove(rows, episodeId, target, opts = {}) {
  const all = (rows || []).filter((r) => r && typeof r === 'object');
  const moved = all.find((r) => sameId(r.id, episodeId));
  if (!moved) return refuse('missing', 'That episode isn’t in this show.');
  if (!inRunningOrder(moved)) {
    if (statusOf(moved) === 'rejected') return refuse('not-in-order', 'Send it again for review before it takes a place.');
    if (isWithdrawn(moved)) return refuse('not-in-order', 'It’s withdrawn and kept for its buyers.');
    return refuse('not-in-order', 'Extras don’t take a number — use “Place after…”.');
  }
  const t = target && typeof target === 'object' ? target : null;
  const movedShow = seriesIdOf(moved);
  let toShow = t && !blank(t.seriesId) ? text(t.seriesId) : null;
  const neighbour = neighbourOf(all, t);
  if (toShow === null && neighbour.row && movedShow && seriesIdOf(neighbour.row) && seriesIdOf(neighbour.row) !== movedShow) toShow = seriesIdOf(neighbour.row);
  const crossShow = toShow !== null && toShow !== movedShow;
  const ofShow = (r) => {
    const s = seriesIdOf(r);
    return movedShow === null ? true : s === null || s === movedShow;
  };
  const fromRows = crossShow ? all.filter((r) => seriesIdOf(r) === movedShow) : all.filter(ofShow);
  const toRows = crossShow ? all.filter((r) => seriesIdOf(r) === toShow) : fromRows;
  const spec = resolveMoveTarget(all, toRows, moved, target, crossShow);
  if (spec.error) return spec.error;
  if (spec.mode === 'stay') return unchangedPlan(moved);

  const fromSeason = seasonOf(moved);
  const fromNumber = numberOf(moved);
  const toSeason = spec.season;
  const same = !crossShow && toSeason === fromSeason;
  const source = splitSeason(seasonRows(fromRows, fromSeason));
  const movedRegular = source.regular.includes(moved);
  const regularOrder = source.regular;
  const into = splitSeason(seasonRows(toRows, toSeason).filter((r) => r !== moved)).regular;
  const closeGap = !same && (opts.closeGap === true || Boolean(t && t.closeGap === true));
  const assign = new Map();
  const put = (row, season, number) => assign.set(row, { season, number });
  const sharedNumbers = () => refuse('duplicate', 'Two episodes share a number in the way — sort that out first.');

  // Same season, the row already numbered: rotate between its place and
  // the new one. `k` is its final index.
  const rotate = (k0) => {
    const s = regularOrder.indexOf(moved);
    const k = Math.max(0, Math.min(k0, regularOrder.length - 1));
    if (k === s) return null;
    const lo = Math.min(s, k);
    const hi = Math.max(s, k);
    const pool = regularOrder.slice(lo, hi + 1).map(numberOf);
    if (!strictlyRising(pool)) return sharedNumbers();
    const order = regularOrder.filter((r) => r !== moved);
    order.splice(k, 0, moved);
    for (let i = lo; i <= hi; i += 1) put(order[i], toSeason, pool[i - lo]);
    return null;
  };
  // The row comes in from outside the run (another season or show, no
  // number, or a parked one): it takes the number at index k and the rows
  // from there on each move one number along; the last takes the next free
  // number.
  const insert = (k0) => {
    const k = Math.max(0, Math.min(k0, into.length));
    const tail = into.slice(k);
    const pool = [...tail.map(numberOf), nextAfter(into)];
    if (!strictlyRising(pool)) return sharedNumbers();
    put(moved, toSeason, pool[0]);
    tail.forEach((r, i) => put(r, toSeason, pool[i + 1]));
    return null;
  };

  let error = null;
  if (spec.mode === 'index') {
    error = same && movedRegular ? rotate(spec.index) : insert(spec.index);
  } else if (spec.mode === 'next-to') {
    if (same && movedRegular) {
      const rest = regularOrder.filter((r) => r !== moved);
      let k = rest.indexOf(spec.other);
      if (k === -1) k = rest.length;
      else if (spec.after) k += 1;
      error = rotate(k);
    } else {
      let k = into.indexOf(spec.other);
      if (k === -1) k = into.length;
      else if (spec.after) k += 1;
      error = insert(k);
    }
  } else if (spec.mode === 'number') {
    const n = spec.number;
    const holders = seasonRows(toRows, toSeason).filter((r) => r !== moved && numberOf(r) === n);
    if (holders.length > 1) return refuse('duplicate', `${holders.length} episodes share E${n} — sort that out first.`);
    const holder = holders[0] || null;
    if (!holder) {
      put(moved, toSeason, n);
    } else if (spec.how === 'swap') {
      if (fromNumber === null) return refuse('swap-unnumbered', 'It has no number to swap — use Insert here.');
      if (crossShow) return refuse('swap-shows', 'Swapping works inside one show — use Insert here.');
      put(moved, toSeason, n);
      put(holder, fromSeason, fromNumber);
    } else if (spec.how === 'insert') {
      if (same && movedRegular) {
        const k = regularOrder.indexOf(holder);
        if (k === -1) return refuse('parked', `E${n} sits outside the running order — give it its own number first.`);
        error = rotate(k);
      } else {
        const k = into.indexOf(holder);
        if (k === -1) return refuse('parked', `E${n} sits outside the running order — give it its own number first.`);
        error = insert(k);
      }
    } else {
      const title = titleOf(holder);
      return refuse('taken', title ? `E${n} is ${title}` : `E${n} is taken`, { holder: { id: holder.id, title, season: toSeason, number: n }, choices: crossShow ? ['insert'] : ['swap', 'insert'] });
    }
  } else {
    // 'end': the next free number of the season.
    const base = same && movedRegular ? regularOrder.filter((r) => r !== moved) : into;
    put(moved, toSeason, nextAfter(base));
  }
  if (error) return error;

  if (closeGap && movedRegular) {
    const s = regularOrder.indexOf(moved);
    const pool = regularOrder.slice(s).map(numberOf);
    if (!strictlyRising(pool)) return sharedNumbers();
    regularOrder.slice(s + 1).forEach((r, i) => put(r, fromSeason, pool[i]));
  }

  const showOf = crossShow ? (r) => (r === moved ? toShow : seriesIdOf(r)) : () => '';
  const scope = crossShow ? [...fromRows, ...toRows] : fromRows;
  const plan = planFrom(scope, assign, showOf, crossShow ? { row: moved, from: movedShow, to: toShow } : null);
  if (plan.error) return plan.error;
  if (!plan.writes.length) return unchangedPlan(moved);

  const multi = crossShow || plan.changed.some((c) => c.fromSeason !== c.toSeason) || new Set(plan.changed.map((c) => c.toSeason)).size > 1;
  const mine = plan.changed.find((c) => sameId(c.id, moved.id));
  const showName = text(t && t.showName);
  const clauses = [];
  if (mine) {
    const from = mine.from === null ? (mine.title ? `“${mine.title}”` : 'It') : codeOf(mine.fromSeason, mine.from, multi);
    const there = crossShow ? `${showName || 'the other show'}, ` : '';
    clauses.push(`${from} → ${there}${codeOf(mine.toSeason, mine.to, multi)}`);
  }
  const rest = plan.changed.filter((c) => c !== mine);
  const theirs = crossShow ? runWords(rest.filter((c) => toRows.some((r) => sameId(r.id, c.id))), true) : '';
  const ours = runWords(crossShow ? rest.filter((c) => !toRows.some((r) => sameId(r.id, c.id))) : rest, multi);
  if (theirs) clauses.push(`${showName || 'There'}: ${theirs}`);
  if (ours) clauses.push(ours);
  if (!same && !closeGap && movedRegular) {
    const after = regularOrder.slice(regularOrder.indexOf(moved) + 1).map(numberOf);
    if (after.length) clauses.push(`${rangeCode(fromSeason, after[0], after[after.length - 1], true)} ${after.length === 1 ? 'keeps its number' : 'keep their numbers'}`);
  }

  return {
    ok: true,
    code: 'moved',
    episodeId: moved.id,
    from: { season: fromSeason, number: fromNumber },
    to: assign.get(moved),
    writes: plan.writes,
    undo: plan.undo,
    changed: plan.changed,
    words: clauses.join('; '),
    crossSeason: !same,
    crossShow,
    ...(multi ? {} : singleSeasonShape(plan.writes))
  };
}

// "Renumber from 1" (and the admin's Fix numbering): the season's rows in
// play order get 1, 2, 3… — shared numbers in the order they were added,
// parked and unnumbered rows last. Explicit, never automatic.
export function renumberFromOne(rows, season) {
  const s = posInt(season) || 1;
  const all = (rows || []).filter((r) => r && typeof r === 'object');
  const list = seasonOrder(all, s);
  const assign = new Map();
  list.forEach((r, i) => assign.set(r, { season: s, number: i + 1 }));
  const plan = planFrom(all, assign, () => '', null);
  if (plan.error) return plan.error;
  if (!plan.writes.length) {
    const words = list.length === 0 ? `Season ${s} has no episodes` : list.length === 1 ? `Season ${s} already starts at E1` : `Season ${s} already runs E1–E${list.length}`;
    return { ok: true, code: 'same', season: s, writes: [], undo: [], changed: [], words, ids: [], numbers: [], episodes: [], drafts: [] };
  }
  return { ok: true, code: 'renumbered', writes: plan.writes, undo: plan.undo, changed: plan.changed, words: runWords(plan.changed, false), ...singleSeasonShape(plan.writes) };
}

// --- adding several ----------------------------------------------------------

function baseName(name) {
  const last = String(name || '').split(/[\\/]/).pop() || '';
  return last.replace(/\.[a-z0-9]{2,5}$/i, '');
}

const CODE_PATTERNS = [
  { re: /(?:^|[^a-z0-9])(s(\d{1,3})[\s._-]*e(\d{1,4}))(?![0-9])/i, season: 2, number: 3 },
  { re: /(?:^|[^a-z0-9])(s(\d{1,3})[\s._-]*(?:episode|ep)\.?[\s._-]*(\d{1,4}))(?![0-9])/i, season: 2, number: 3 },
  { re: /(?:^|[^a-z0-9])((?:season|series)[\s._-]*(\d{1,3})[\s._,–-]*(?:episode|ep)\.?[\s._-]*(\d{1,4}))(?![0-9])/i, season: 2, number: 3 },
  { re: /(?:^|[^a-z0-9])((\d{1,2})x(\d{1,3}))(?![0-9a-z])/i, season: 2, number: 3 },
  { re: /(?:^|[^a-z0-9])((?:episode|ep)\.?[\s._-]*(\d{1,4}))(?![0-9])/i, season: 0, number: 2 },
  { re: /(?:^|[^a-z0-9])(e(\d{1,4}))(?![0-9])/i, season: 0, number: 2 }
];

// The season and episode a file's name carries: "S02E04", "s2e4",
// "S2 E4", "S1 Ep 2", "2x04", "Season 2 Episode 4", "Ep 3", "Episode 3",
// "E03" (the last three without a season). Null when the name says nothing; a season
// 0 (specials) or above 99 reads as no season.
export function parseEpisodeCode(name) {
  const base = baseName(name);
  for (const p of CODE_PATTERNS) {
    const m = p.re.exec(base);
    if (!m) continue;
    const number = posInt(m[p.number]);
    if (!number) continue;
    let season = p.season ? posInt(m[p.season]) : null;
    if (season && season > 99) season = null;
    return { season, number, match: m[1] };
  }
  return null;
}

const TECH_TOKEN = /^(?:\d{3,4}p|[48]k|uhd|hdr|hdr10|x26[45]|h26[45]|hevc|prores)$/i;

function trimSeparators(s) {
  return s.replace(/^[\s\-–—|:,]+/, '').replace(/[\s\-–—|:,]+$/, '');
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// A title from a file's name: no folders, no extension, no episode code,
// no resolution or codec tags, separators as spaces, the show's name off
// the front, a lowercase name given a capital. '' when nothing is left
// (the row then reads "Episode N").
export function titleFromFilename(name, opts = {}) {
  const raw = baseName(name);
  const spaced = /\s/.test(raw);
  let s = raw;
  const code = parseEpisodeCode(s);
  if (code) s = s.replace(code.match, ' ');
  s = s.replace(/h\.26[45]/gi, ' ');
  s = s.replace(/[_.]+/g, ' ');
  if (!spaced) s = s.replace(/-+/g, ' ');
  s = s.split(/\s+/).filter((w) => w && !TECH_TOKEN.test(w.replace(/^[[(]+|[\])]+$/g, ''))).join(' ');
  s = s.replace(/[[(]\s*[\])]/g, ' ').replace(/\s*\(\d{1,2}\)\s*$/, '').replace(/\s+v\d{1,2}\s*$/i, '');
  s = s.replace(/(?:\s*[-–—|:]\s*){2,}/g, ' - ');
  s = trimSeparators(s.replace(/\s{2,}/g, ' '));
  const show = text(opts.showName);
  if (show) {
    const words = show.split(/[\s._-]+/).filter(Boolean).map(escapeRegex);
    if (words.length) s = trimSeparators(s.replace(new RegExp(`^${words.join('[\\s._-]+')}(?=$|[\\s\\-–—|:,])`, 'i'), ''));
  }
  if (/[a-z]/.test(s) && s === s.toLowerCase()) s = s.charAt(0).toUpperCase() + s.slice(1);
  return s.slice(0, 120).trim();
}

function naturalCompare(a, b) {
  const xs = String(a || '').toLowerCase().match(/\d+|\D+/g) || [];
  const ys = String(b || '').toLowerCase().match(/\d+|\D+/g) || [];
  for (let i = 0; i < Math.min(xs.length, ys.length); i += 1) {
    const p = xs[i];
    const q = ys[i];
    if (p === q) continue;
    if (/^\d/.test(p) && /^\d/.test(q)) {
      const d = Number(p) - Number(q);
      if (d !== 0) return d;
      if (p.length !== q.length) return q.length - p.length;
      continue;
    }
    return p < q ? -1 : 1;
  }
  return xs.length - ys.length;
}

function itemName(item) {
  return String((item && (item.name || item.fileName)) || '');
}

// "+ Add several" (decision 8): up to 30 files, each a draft numbered in
// file-name order (or date order). A number the name (or a feed item's
// own season/number) carries is honoured when free; the rest take the
// next free numbers, from `startAt` when given. Rows already in the show
// are `rows`. Answers { items: [{ index, name, title, season,
// seriesOrder, fromCode, note }], skipped } — index is the file's place in
// what was dropped.
export function planBatch(items, opts = {}) {
  const season = posInt(opts.season) || 1;
  const rows = (opts.rows || []).filter((r) => r && typeof r === 'object');
  const list = (items || []).map((item, index) => ({ item: item || {}, index }));
  if (opts.sortBy === 'date') {
    list.sort((a, b) => {
      const ta = timeOf(a.item.lastModified);
      const tb = timeOf(b.item.lastModified);
      if (ta !== tb) {
        if (ta === null) return 1;
        if (tb === null) return -1;
        return ta - tb;
      }
      return naturalCompare(itemName(a.item), itemName(b.item)) || a.index - b.index;
    });
  } else if (opts.sortBy !== 'given') {
    list.sort((a, b) => naturalCompare(itemName(a.item), itemName(b.item)) || a.index - b.index);
  }
  const kept = list.slice(0, FILES_PER_DROP);
  const skipped = list.slice(FILES_PER_DROP).map(({ item, index }) => ({ index, name: itemName(item), reason: `Up to ${FILES_PER_DROP} files at a time` }));

  const taken = new Map();
  const take = (s, n) => {
    if (!taken.has(s)) taken.set(s, new Set());
    taken.get(s).add(n);
  };
  const isTaken = (s, n) => taken.has(s) && taken.get(s).has(n);
  for (const r of rows) if (holdsSlot(r)) take(seasonOf(r), numberOf(r));

  const plan = kept.map(({ item, index }) => {
    const name = itemName(item);
    const own = posInt(item.number !== undefined ? item.number : item.seriesOrder);
    // A feed item's own season stays its season even without a number of
    // its own (it then takes that season's next free number).
    const ownSeason = posInt(item.season);
    const code = own ? { season: ownSeason, number: own } : parseEpisodeCode(name);
    return { index, name, code, ownSeason, title: text(item.title) || titleFromFilename(name, { showName: opts.showName }), season: null, seriesOrder: null, fromCode: false, note: null };
  });
  for (const p of plan) {
    if (!p.code) continue;
    p.season = p.code.season || season;
    if (p.code.number <= MAX_EPISODE_NUMBER && !isTaken(p.season, p.code.number)) {
      p.seriesOrder = p.code.number;
      p.fromCode = true;
      take(p.season, p.code.number);
    } else {
      p.note = `E${p.code.number} is taken`;
    }
  }
  const pointers = new Map();
  for (const p of plan) {
    if (p.seriesOrder) continue;
    const s = p.season || p.ownSeason || season;
    let n = pointers.get(s);
    if (n === undefined) {
      const claimed = plan.filter((x) => x.fromCode && x.season === s).map((x) => x.seriesOrder + 1);
      n = s === season && posInt(opts.startAt) ? posInt(opts.startAt) : Math.max(nextFreeNumber(rows, s), ...claimed);
    }
    while (isTaken(s, n)) n += 1;
    p.season = s;
    if (n > MAX_EPISODE_NUMBER) {
      p.note = 'No episode number left';
      continue;
    }
    p.seriesOrder = n;
    take(s, n);
    pointers.set(s, n + 1);
    if (p.note) p.note = `${p.note}, so it goes to E${n}`;
  }
  return {
    items: plan.map((p) => ({ index: p.index, name: p.name, title: p.title, season: p.season, seriesOrder: p.seriesOrder, fromCode: p.fromCode, note: p.note })),
    skipped
  };
}

// --- the master --------------------------------------------------------------

const CLOUDFLARE_SRC = /cloudflarestream\.com\/([a-zA-Z0-9]+)\//;

// Cloudflare's words (pendingupload, downloading, queued, inprogress,
// ready, error) and ours (uploading, processing, ready, error, deleted) as
// ours; a status object ({ state, readyToStream }) works too.
export function videoStateOf(state) {
  let s = state;
  if (s && typeof s === 'object') {
    if (s.readyToStream === true) return 'ready';
    s = s.state;
  }
  const v = text(s);
  if (!v) return null;
  const k = v.toLowerCase();
  if (k === 'ready') return 'ready';
  if (k === 'pendingupload' || k === 'uploading') return 'uploading';
  if (k === 'downloading' || k === 'queued' || k === 'inprogress' || k === 'processing') return 'processing';
  if (k === 'error') return 'error';
  if (k === 'deleted') return 'deleted';
  return null;
}

// What the row's master is: 'audio' (an audio_url and no src), 'external'
// (Bunny, a self-hosted file, a manual entry), a Cloudflare video's state
// ('ready' | 'uploading' | 'processing' | 'error' | 'deleted', or
// 'unknown' when nobody could say), or 'none'. A draft's upload counts
// ({ video: { uid, state } }). `state` overrides what the row carries.
export function masterState(row, state) {
  if (!row || typeof row !== 'object') return 'none';
  const src = text(pick(row, 'src', 'src'));
  const audio = text(pick(row, 'audioUrl', 'audio_url'));
  const uid = text(pick(row, 'videoUid', 'video_uid')) || (row.video && typeof row.video === 'object' ? text(row.video.uid) : null);
  if (!src && !uid) return audio ? 'audio' : 'none';
  if (src && !CLOUDFLARE_SRC.test(src)) return 'external';
  let given = state;
  if (given === undefined) given = pick(row, 'cloudflareState', 'cloudflare_state');
  if (given === undefined || given === null) given = pick(row, 'videoState', 'video_state');
  if ((given === undefined || given === null) && row.video && typeof row.video === 'object') given = row.video.state;
  return videoStateOf(given) || 'unknown';
}

// Amendment 3: a master is ready when the row plays audio, a file that
// isn't Cloudflare's, or a Cloudflare video whose state is ready — and
// nothing else (no captions or art test here). Approve and Send for
// review are refused otherwise.
export function masterReady(row, state) {
  const s = masterState(row, state);
  return s === 'ready' || s === 'audio' || s === 'external';
}

// Why an episode can't be approved right now, or null (the review queue's
// Approve, a show's Approve all, the admin show page's rows). opts = {
// slotRows (the show's rows, for its number), state (Cloudflare's word
// for the master), show }. First match wins: the show pulled or its
// removal requested, a show episode without a number or on a number
// another episode holds, then the master (amendment 3: 'unknown' — nobody
// could say — doesn't block). A standalone title is only asked about its
// master. The answer is a 409 body.
export function approvalBlocker(episode, { slotRows = [], state, show = null } = {}) {
  if (!episode || typeof episode !== 'object') return { status: 409, code: 'missing', error: 'That episode isn’t there any more.' };
  if (show && typeof show === 'object') {
    if (isHeld(show)) return { status: 409, code: 'show-held', error: 'Its show is pulled — restore the show first.' };
    if (removalRequested(show)) return { status: 409, code: 'show-removal', error: 'Its show’s removal is requested — decide that first.' };
  }
  const t = contentTypeOf(episode);
  if (seriesIdOf(episode) && (t === 'series' || t === 'podcast')) {
    if (!numberOf(episode)) return { status: 409, code: 'unnumbered', error: 'Give it an episode number before approving it.' };
    const slot = slotCheck(slotRows, { season: seasonOf(episode), number: numberOf(episode), excludeId: episode.id });
    if (!slot.free) return { status: 409, ...slotTakenBody(slot) };
  }
  const master = masterState(episode, state);
  const masterLine = {
    none: 'There’s no file to approve yet.',
    uploading: 'Not yet: the video is still uploading.',
    processing: 'Not yet: Cloudflare is still processing the video.',
    error: 'Not yet: Cloudflare could not process the video — replace it first.',
    deleted: 'Not yet: Cloudflare could not process the video — replace it first.'
  };
  if (master === 'none') return { status: 409, code: 'no-file', error: masterLine.none, master };
  if (Object.prototype.hasOwnProperty.call(masterLine, master)) return { status: 409, code: 'master-not-ready', error: masterLine[master], master };
  return null;
}

// --- what a show looks like from outside --------------------------------------

function isPublicEpisode(ep) {
  if (!ep || typeof ep !== 'object' || !numberedType(ep)) return false;
  const st = statusOf(ep);
  if (st !== null && st !== 'approved') return false;
  return !isWithdrawn(ep) && !isHeld(ep) && !removalRequested(ep);
}

function isInReviewEpisode(ep) {
  if (!ep || typeof ep !== 'object' || !numberedType(ep)) return false;
  return statusOf(ep) === 'pending' && !isWithdrawn(ep) && !isHeld(ep) && !removalRequested(ep);
}

function latestFirst(a, b) {
  const ta = createdAt(a);
  const tb = createdAt(b);
  if (ta !== tb) {
    if (ta === null) return 1;
    if (tb === null) return -1;
    return tb - ta;
  }
  return compareEpisodes(b, a);
}

// The value most rows have (a row without one doesn't vote); a tie goes to
// the value of the newest row, newest by `order`.
function majority(rows, read, order) {
  const counts = new Map();
  for (const r of rows) {
    const v = read(r);
    if (v === null) continue;
    counts.set(v, (counts.get(v) || 0) + 1);
  }
  if (!counts.size) return null;
  const top = Math.max(...counts.values());
  const newest = [...rows].sort(order || latestFirst).find((r) => {
    const v = read(r);
    return v !== null && counts.get(v) === top;
  });
  return newest ? read(newest) : null;
}

// Migration 118's "newest episode" for a tie: added last, then the higher
// season, then the higher number (a missing one counts as oldest), then
// the id.
function newestVoteFirst(a, b) {
  const desc = (x, y) => {
    if (x === y) return 0;
    if (x === null) return 1;
    if (y === null) return -1;
    return y - x;
  };
  const byTime = desc(createdAt(a), createdAt(b));
  if (byTime) return byTime;
  const bySeason = desc(posInt(pick(a, 'season', 'season')), posInt(pick(b, 'season', 'season')));
  if (bySeason) return bySeason;
  const byNumber = desc(numberOf(a), numberOf(b));
  if (byNumber) return byNumber;
  const ia = String(a && a.id !== undefined && a.id !== null ? a.id : '');
  const ib = String(b && b.id !== undefined && b.id !== null ? b.id : '');
  return ia < ib ? 1 : ia > ib ? -1 : 0;
}

export function ratingMinAge(code, ratings) {
  const c = text(code) || 'Not Rated';
  let required = BUILT_IN_MIN_AGE[c];
  if (Array.isArray(ratings)) {
    const live = ratings.find((r) => r && r.code === c);
    if (live && Number.isFinite(live.minAge)) required = live.minAge;
  }
  return required === undefined ? BUILT_IN_MIN_AGE['Not Rated'] : required;
}

function ratingCode(ep) {
  return text(pick(ep, 'rating', 'rating')) || 'Not Rated';
}

function highestRating(eps, ratings) {
  const counts = new Map();
  for (const e of eps) counts.set(ratingCode(e), (counts.get(ratingCode(e)) || 0) + 1);
  const latest = [...eps].sort(latestFirst);
  let best = null;
  for (const [code, count] of counts) {
    const cand = { code, minAge: ratingMinAge(code, ratings), count, real: code !== 'Not Rated', recency: latest.findIndex((e) => ratingCode(e) === code) };
    const better = !best
      || cand.minAge > best.minAge
      || (cand.minAge === best.minAge && cand.real && !best.real)
      || (cand.minAge === best.minAge && cand.real === best.real && (cand.count > best.count || (cand.count === best.count && cand.recency < best.recency)));
    if (better) best = cand;
  }
  return best;
}

function mixedFreeLabel(eps, free) {
  const k = free.length;
  const lead = eps.slice(0, k);
  if (lead.every((e) => tierOf(e) === 'free')) {
    const s = seasonOf(lead[0]);
    if (lead.every((e, i) => seasonOf(e) === s && numberOf(e) === i + 1)) return k === 1 ? 'E1 free' : `E1–E${k} free`;
  }
  return `${k} free`;
}

// What viewers see of a show (decision 10, option A): `tier` 'premium'
// (every public episode is Tapa +), 'free' or 'mixed'; `tierLabel` the
// "Tapa +" pill (null when it's all free); `freeLabel` the green chip —
// "E1 free" / "E1–E3 free" when the free ones are the first episodes in
// order, else "2 free"; "Free with ads" ("Free" when no free episode has
// ads) when all of it is free. `rating` is the highest minimum age among
// the episodes (unrated = 17+; a real rating beats "Not Rated" at the same
// age; then the most common, then the latest). Only public episodes count:
// pass the show's episodes and the rest (drafts, in review, declined,
// pulled, withdrawn, extras) are left out. With opts.includeInReview an
// episode in review counts too (the owner's preview of a show that isn't
// public yet: V3 reads "Free with ads · TV-14 · 1 season · 1 episode"
// while its one episode is in review).
export function showRollup(episodes, show, opts = {}) {
  const counts = opts.includeInReview === true ? (e) => isPublicEpisode(e) || isInReviewEpisode(e) : isPublicEpisode;
  const eps = (episodes || []).filter(counts).sort(compareEpisodes);
  if (!eps.length) {
    return { tier: null, tierLabel: null, freeLabel: null, firstFree: false, freeIds: [], episodeCount: 0, seasonCount: 0, rating: null, minAge: null, mainGenre: null };
  }
  const free = eps.filter((e) => tierOf(e) === 'free');
  let tier = 'mixed';
  let freeLabel = null;
  if (free.length === eps.length) {
    tier = 'free';
    freeLabel = free.every((e) => !adsOn(e)) ? 'Free' : 'Free with ads';
  } else if (!free.length) {
    tier = 'premium';
  } else {
    freeLabel = mixedFreeLabel(eps, free);
  }
  const rating = highestRating(eps, opts.ratings);
  return {
    tier,
    tierLabel: tier === 'free' ? null : 'Tapa +',
    freeLabel,
    firstFree: tierOf(eps[0]) === 'free',
    freeIds: free.map((e) => e.id),
    episodeCount: eps.length,
    seasonCount: new Set(eps.map(seasonOf)).size,
    rating: rating ? rating.code : null,
    minAge: rating ? rating.minAge : null,
    mainGenre: majority(eps, (e) => text(pick(e, 'mainGenre', 'main_genre')))
  };
}

// The FREE / TAPA + word on a row of the series page (decision 10, board
// D10): only in a mixed show; an all-free or all-Tapa + show says it once,
// in the hero. CSS uppercases it.
export function rowTierWord(ep, rollup) {
  if (!rollup || rollup.tier !== 'mixed') return null;
  return tierOf(ep) === 'free' ? 'Free' : 'Tapa +';
}

// "S1 E3", or null without a number: the same spelling as episodeCode in
// lib/seriesResume.js (the Continue Watching card's).
export function episodeCodeOf(ep) {
  const n = numberOf(ep);
  return n ? `S${seasonOf(ep)} E${n}` : null;
}

function extraParentType(row) {
  return text(pick(row, 'bonusParentType', 'bonus_parent_type'));
}

function extraParentId(row) {
  return text(pick(row, 'bonusParentId', 'bonus_parent_id'));
}

function shelfOrder(a, b) {
  const na = numberOf(a);
  const nb = numberOf(b);
  if (na !== nb) {
    if (na === null) return 1;
    if (nb === null) return -1;
    return na - nb;
  }
  const ta = createdAt(a);
  const tb = createdAt(b);
  if (ta !== tb) {
    if (ta === null) return 1;
    if (tb === null) return -1;
    return ta - tb;
  }
  const ia = String(a && a.id !== undefined && a.id !== null ? a.id : '');
  const ib = String(b && b.id !== undefined && b.id !== null ? b.id : '');
  return ia < ib ? -1 : ia > ib ? 1 : 0;
}

// The Extras tab of a series page (board V1): the show's own extras first
// ("With the show"), then one group per episode they hang on, in play
// order ("After S1 E3 · Transfer"; "After Pilot" without a number).
// `extras` are content_type 'bonus' rows, `episodes` the show's episodes
// on the page: an extra whose episode isn't among them is left out
// (amendment 23 — never moved to "With the show"). Within a group, shelf
// order (series_order; none last), then the oldest, then the id.
export function extraGroups(extras, episodes) {
  const eps = (episodes || []).filter((e) => e && typeof e === 'object' && e.id !== undefined && e.id !== null);
  const byId = new Map(eps.map((e) => [String(e.id), e]));
  const show = [];
  const hung = new Map();
  for (const x of extras || []) {
    if (!x || typeof x !== 'object') continue;
    const type = extraParentType(x);
    if (type === 'series') {
      show.push(x);
      continue;
    }
    if (type !== 'episode') continue;
    const pid = extraParentId(x);
    if (!pid || !byId.has(pid)) continue;
    if (!hung.has(pid)) hung.set(pid, []);
    hung.get(pid).push(x);
  }
  const out = [];
  if (show.length) out.push({ key: 'show', parentId: null, heading: 'With the show', items: [...show].sort(shelfOrder) });
  const parents = [...hung.keys()].map((pid) => byId.get(pid)).sort(compareEpisodes);
  for (const parent of parents) {
    const pid = String(parent.id);
    const code = episodeCodeOf(parent);
    const title = titleOf(parent) || 'Untitled';
    out.push({ key: `episode:${pid}`, parentId: pid, heading: code ? `After ${code} · ${title}` : `After ${title}`, items: [...hung.get(pid)].sort(shelfOrder) });
  }
  return out;
}

// --- a show's defaults ---------------------------------------------------------

// series.defaults (migration 118), cleaned: { tier, rating, mainGenre,
// genre, artist, adsEnabled }, each only when set. Copied onto an episode
// when it is added (amendment 2); rating and tier are never read-time
// fallbacks.
export function normalizeShowDefaults(raw) {
  const src = parseJson(raw);
  const out = {};
  if (!src || typeof src !== 'object' || Array.isArray(src)) return out;
  if (src.tier === 'free' || src.tier === 'premium') out.tier = src.tier;
  const rating = text(src.rating);
  if (rating) out.rating = rating.slice(0, 40);
  const mainGenre = text(src.mainGenre !== undefined ? src.mainGenre : src.main_genre);
  if (mainGenre) out.mainGenre = mainGenre.slice(0, 60);
  const genre = text(src.genre);
  if (genre) out.genre = genre.slice(0, 120);
  const artist = text(src.artist);
  if (artist) out.artist = artist.slice(0, 120);
  const ads = src.adsEnabled !== undefined ? src.adsEnabled : src.ads_enabled;
  if (typeof ads === 'boolean') out.adsEnabled = ads;
  return out;
}

export function showDefaults(show) {
  return normalizeShowDefaults(pick(show, 'defaults', 'defaults'));
}

// A new episode's fields with the show's defaults filled into the blanks
// (decision 9): what the creator typed always wins.
export function applyShowDefaults(fields, show) {
  const out = { ...(fields || {}) };
  const d = showDefaults(show);
  for (const key of ['tier', 'rating', 'mainGenre', 'genre', 'artist', 'adsEnabled']) {
    if (d[key] !== undefined && blank(out[key])) out[key] = d[key];
  }
  return out;
}

// Migration 118's backfill for an existing show's defaults, the same rule
// as its SQL: for each of tier, rating, mainGenre, genre, artist and
// adsEnabled, the value most of its episodes have — an episode without one
// doesn't vote — the newest episode breaking a tie (not episode 1's, so a
// show with a free first episode and the rest Tapa + defaults to Tapa +).
// Extras don't vote; a declined episode only when the show has nothing
// else. A key nobody votes for is left out.
export function showDefaultsFromEpisodes(episodes) {
  const all = (episodes || []).filter((e) => e && typeof e === 'object' && contentTypeOf(e) !== 'bonus');
  const open = all.filter((e) => statusOf(e) !== 'rejected');
  const pool = open.length ? open : all;
  const out = {};
  const readers = {
    tier: (e) => text(pick(e, 'tier', 'tier')),
    rating: (e) => text(pick(e, 'rating', 'rating')),
    mainGenre: (e) => text(pick(e, 'mainGenre', 'main_genre')),
    genre: (e) => text(pick(e, 'genre', 'genre')),
    artist: (e) => text(pick(e, 'artist', 'artist')),
    adsEnabled: (e) => {
      const v = pick(e, 'adsEnabled', 'ads_enabled');
      return typeof v === 'boolean' ? v : null;
    }
  };
  for (const key of Object.keys(readers)) {
    const v = majority(pool, readers[key], newestVoteFirst);
    if (v !== null) out[key] = v;
  }
  return out;
}

// --- an episode inside its show ----------------------------------------------

// A thin episode's title: its own, else "Episode N".
export function episodeDisplayTitle(ep, show) {
  const own = titleOf(ep);
  if (own) return own;
  const n = numberOf(ep);
  return n ? `Episode ${n}` : 'Untitled';
}

function ownValue(ep, key) {
  if (key === 'description') return text(pick(ep, 'description', 'description')) || text(pick(ep, 'desc', 'desc'));
  if (key === 'releaseYear') return posInt(pick(ep, 'releaseYear', 'release_year'));
  if (key === 'mainGenre') return text(pick(ep, 'mainGenre', 'main_genre'));
  if (key === 'adsEnabled') return pick(ep, 'adsEnabled', 'ads_enabled') === undefined ? null : adsOn(ep);
  return text(pick(ep, key, key));
}

function showValue(show, key) {
  if (!show) return null;
  if (key === 'description') return text(pick(show, 'description', 'description')) || text(pick(show, 'desc', 'desc'));
  if (key === 'releaseYear') return posInt(pick(show, 'releaseYear', 'release_year'));
  const d = showDefaults(show);
  return d[key] === undefined ? null : d[key];
}

const READ_TIME_FALLBACKS = ['description', 'genre', 'artist', 'releaseYear'];

// What a thin episode shows for `key` (amendment 2): its own value, else —
// for the presentational ones only (description, genre label, Made by,
// year) — the show's; the title falls back to "Episode N". Rating, Who can
// watch and the main genre never borrow: they were copied when the episode
// was added.
export function inheritedField(ep, show, key) {
  if (key === 'title') return episodeDisplayTitle(ep, show);
  const own = ownValue(ep, key);
  if (own !== null) return own;
  return READ_TIME_FALLBACKS.includes(key) ? showValue(show, key) : null;
}

// The editor's "Same as the show" chip turns into "Differs from the show
// · Reset" when this is true.
export function differsFromShow(ep, show, key) {
  const def = showValue(show, key);
  if (def === null) return false;
  if (key === 'tier') return tierOf(ep) !== def;
  if (key === 'adsEnabled') return adsOn(ep) !== def;
  if (key === 'rating') return ownValue(ep, 'rating') !== def;
  const own = ownValue(ep, key);
  return own !== null && own !== def;
}

// Decision 11: an episode's own page is a switch. Unset = by type — a film
// or a short gets its page, a series or podcast episode (or an extra, or a
// Snippet) plays straight from the show.
export function episodeHasPage(ep) {
  const v = pick(ep, 'hasPage', 'has_page');
  if (v === true || v === false) return v;
  const t = contentTypeOf(ep);
  if (t === 'series' || t === 'podcast' || t === 'bonus' || t === 'vertical') return false;
  if (t === null && seriesIdOf(ep)) return false;
  return true;
}

// "Season 2 · The Return" from series.seasons ([{ number, name }]).
export function seasonLabel(show, season) {
  const s = posInt(season) || 1;
  const list = parseJson(pick(show, 'seasons', 'seasons'));
  const entry = Array.isArray(list) ? list.find((x) => x && posInt(x.number) === s) : null;
  const name = entry ? text(entry.name !== undefined ? entry.name : entry.label) : null;
  return name ? `Season ${s} · ${name}` : `Season ${s}`;
}

// --- the editors' words (slice 2) --------------------------------------------

// A title (and a show) has one description; the editors draw it as two
// fields, the way the boards do: "One line about it" (its first paragraph,
// one line of at most ONE_LINE_MAX characters: what a card shows) and
// "About it" (the rest). A first paragraph that is longer, or broken over
// lines, is all "About it". joinDescription puts the two back with a blank
// line between; splitting a description and joining it back gives the
// same text (line endings aside), so the editors compare joined values and
// never rewrite a description nobody touched.
export const ONE_LINE_MAX = 300;

export function splitDescription(value, max = ONE_LINE_MAX) {
  const s = typeof value === 'string' ? value.trim() : '';
  if (!s) return { oneLine: '', about: '' };
  const gap = /\r?\n[ \t]*\r?\n/.exec(s);
  const first = (gap ? s.slice(0, gap.index) : s).trim();
  if (first.length > max || /\n/.test(first)) return { oneLine: '', about: s };
  return { oneLine: first, about: gap ? s.slice(gap.index + gap[0].length).trim() : '' };
}

export function joinDescription(oneLine, about) {
  const line = typeof oneLine === 'string' ? oneLine.replace(/\s+/g, ' ').trim() : '';
  const rest = typeof about === 'string' ? about.trim() : '';
  return [line, rest].filter(Boolean).join('\n\n');
}

const STAGED_WORDS = {
  title: 'the new title',
  name: 'the new name',
  description: 'the description',
  poster: 'the poster',
  thumbnail: 'the still',
  heroImage: 'the hero image',
  titleImage: 'the title image',
  titleImageRemoval: 'removing the title image',
  trailer: 'the new trailer',
  video: 'the new file'
};

// The editors' Save button for the changes made so far (each { field,
// mode }, the mode from fieldPolicy or the editor payload's policy): plain
// "Save" with nothing to save, "Save · applies at once" when everything
// does, "Save · 2 changes go to review" when some wait for an admin, with
// the line under the button naming them ("Goes to review: the new title
// and the poster; the rest applies at once").
export function saveSummary(changes) {
  const list = (changes || []).filter((c) => c && typeof c === 'object' && !blank(c.field));
  const staged = [...new Set(list.filter((c) => c.mode === 'staged').map((c) => String(c.field)))];
  const direct = list.filter((c) => c.mode !== 'staged').length;
  if (list.length === 0) return { label: 'Save', note: null, staged: [], direct: 0, count: 0 };
  if (staged.length === 0) return { label: 'Save · applies at once', note: null, staged, direct, count: list.length };
  return {
    label: `Save · ${pl(staged.length, 'change goes', 'changes go')} to review`,
    note: `Goes to review: ${listWords(staged.map((f) => STAGED_WORDS[f] || f))}${direct > 0 ? '; the rest applies at once' : ''}`,
    staged,
    direct,
    count: list.length
  };
}

// --- who gets paid (decisions 13, 19, 21–24) ----------------------------------

// Earnings follow a title's paid account (slice 3b) from PAYEE_RULE_FROM
// on: money a title earned before that instant follows the old rule (the
// uploader, else the show's owner: legacyPayeeOf), money it earns from then
// on follows payeeOf, read through the title's history (payeeAt). The
// server may move the instant earlier outside production
// (lib/payees.js payeeRuleFrom); set at commit time to the first 00:00 UTC
// after the push that ships the rule (2026-11-06's push → Nov 7).
export const PAYEE_RULE_LIVE = true;
export const PAYEE_RULE_FROM = '2026-11-07T00:00:00.000Z';

// Is the rule in force at `at`?
export function payeeRuleLiveAt(at, from = PAYEE_RULE_FROM) {
  const t = timeOf(at);
  const f = timeOf(from);
  return PAYEE_RULE_LIVE === true && t !== null && f !== null && t >= f;
}

// An extra filed under a parent only through bonus_parent_* (the submit
// flow stores an extra with no series_id): { type: 'series' | 'episode',
// id }. Anything else — a title with a series_id, not an extra, no parent —
// null.
export function extraParentOf(episode) {
  if (!episode || typeof episode !== 'object' || seriesIdOf(episode) || contentTypeOf(episode) !== 'bonus') return null;
  const type = text(pick(episode, 'bonusParentType', 'bonus_parent_type'));
  const id = text(pick(episode, 'bonusParentId', 'bonus_parent_id'));
  if (!id || (type !== 'series' && type !== 'episode')) return null;
  return { type, id };
}

// The show a title's money follows (Jose, 2026-11-06: extras follow their
// show): its own series_id; else, for an extra filed only through
// bonus_parent_*, that show ('series') or its parent episode's show
// ('episode'; parent = that episode's row — another row, or none, is no
// show). An extra with no show anywhere up the chain is a title of its
// own (null): it pays its uploader like any standalone title. Every lane,
// the picker and the stamps resolve a title's show through this.
export function payeeShowIdOf(episode, parent = null) {
  const own = seriesIdOf(episode);
  if (own) return own;
  const ref = extraParentOf(episode);
  if (!ref) return null;
  if (ref.type === 'series') return ref.id;
  if (!parent || typeof parent !== 'object' || !sameId(text(parent.id), ref.id)) return null;
  return seriesIdOf(parent);
}

// The account a title's earnings go to: the title's own paid account, else
// the show's, else the show's owner, else whoever uploaded it. Money
// already credited never moves (payeeAt reads it through time). `series`
// is the show its money follows (payeeShowIdOf: an extra's show too).
export function payeeOf(episode, series) {
  return text(pick(episode, 'paidTo', 'paid_to'))
    || text(series ? pick(series, 'paidTo', 'paid_to') : null)
    || runnerOf(series)
    || uploaderOf(episode)
    || null;
}

// A whole-series sale goes to the show's paid account (decisions 21, 24;
// the original creator unless the owner chose someone): an episode paid to
// someone else takes no share of it.
export function seriesSalePayee(series) {
  return text(pick(series, 'paidTo', 'paid_to')) || runnerOf(series) || null;
}

// What every lane paid before the rule: the uploader, else the show's owner.
export function legacyPayeeOf(episode, series) {
  return uploaderOf(episode) || runnerOf(series) || null;
}

// Who runs a title — sets its price and picks who is paid: a show's
// episode, the show's owner; a standalone title (or one in a show nobody
// owns), its uploader.
export function titleRunnerOf(episode, series) {
  return runnerOf(series) || uploaderOf(episode) || null;
}

// Who "back to the default" pays: for a show, whoever runs it; for an
// episode, the show's paid account (else its owner), else the uploader.
export function payeeFallback(scope, episode, series) {
  if (scope === 'series') return runnerOf(series);
  const fromShow = series ? (text(pick(series, 'paidTo', 'paid_to')) || runnerOf(series)) : null;
  return fromShow || uploaderOf(episode) || null;
}

// Which part of payeeOf answered.
export function payeeSourceOf(episode, series) {
  if (text(pick(episode, 'paidTo', 'paid_to'))) return 'own';
  if (series && text(pick(series, 'paidTo', 'paid_to'))) return 'show';
  if (runnerOf(series)) return 'runner';
  if (uploaderOf(episode)) return 'uploader';
  return null;
}

// The history row covering `t` (ms): from_at ≤ t < to_at (open rows run on);
// the latest from_at wins.
function coveringRow(history, t) {
  let best = null;
  for (const h of history || []) {
    const from = timeOf(pick(h, 'fromAt', 'from_at'));
    const to = timeOf(pick(h, 'toAt', 'to_at'));
    if (from === null || from > t) continue;
    if (to !== null && to <= t) continue;
    if (!best || from > best.from) best = { from, payee: text(pick(h, 'payeeId', 'payee_id')) };
  }
  return best;
}

// Who a title paid on a given day, from its title_payees history ({
// payee_id, from_at, to_at }); null when no row covers it.
export function payeeOnDate(history, at) {
  const t = timeOf(at);
  if (t === null) return null;
  const row = coveringRow(history, t);
  return row ? row.payee : null;
}

// Who an episode paid at instant `at` (every lane's rule): a history row
// covering it; else, before the rule, the legacy payee; else payeeOf on
// the title's columns now. A bad `at` → null.
export function payeeAt({ history, episode, series, at, from = PAYEE_RULE_FROM } = {}) {
  const t = timeOf(at);
  if (t === null) return null;
  const row = coveringRow(history, t);
  if (row) return row.payee;
  if (!payeeRuleLiveAt(t, from)) return legacyPayeeOf(episode, series);
  return payeeOf(episode, series);
}

// 'YYYY-MM-DD' → its first instant, UTC.
export function dayStartIso(day) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(typeof day === 'string' ? day.trim() : '');
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (!Number.isFinite(d.getTime()) || d.toISOString().slice(0, 10) !== `${m[1]}-${m[2]}-${m[3]}`) return null;
  return d.toISOString();
}

function utcParts(v) {
  const t = timeOf(typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.trim()) ? dayStartIso(v) : v);
  if (t === null) return null;
  const d = new Date(t);
  try {
    return { month: d.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' }), day: d.getUTCDate(), key: d.toISOString().slice(0, 10) };
  } catch (err) {
    return null;
  }
}

// 'Nov 9' (UTC): the cut-over's and the history's words.
export function utcDayLabel(v) {
  const p = utcParts(v);
  return p ? `${p.month} ${p.day}` : null;
}

// 'Oct 1–14' | 'Oct 20' | 'Oct 30 – Nov 2' (UTC).
export function dayRangeLabel(fromDay, toDay) {
  const a = utcParts(fromDay);
  const b = toDay === undefined || toDay === null ? null : utcParts(toDay);
  if (!a) return b ? `${b.month} ${b.day}` : null;
  if (!b || b.key === a.key) return `${a.month} ${a.day}`;
  if (b.month === a.month && b.key.slice(0, 7) === a.key.slice(0, 7)) return `${a.month} ${a.day}–${b.day}`;
  return `${a.month} ${a.day} – ${b.month} ${b.day}`;
}

// What choosing a paid account takes (question 22, as built in 3b):
// 'none' when nothing changes; 'direct' when nobody's money changes, for
// going back to the default, or for picking yourself on a title you run;
// 'refused' for picking yourself on a title you don't run; otherwise
// 'invite' — the person accepts first (an admin's pick too) and until then
// the earnings keep going where they went. `store` is what the title's own
// paid_to holds after it (picking whoever the default pays stores null).
//   current = the title's own paid_to now; next = the account picked (null =
//   back to the default); fallback = payeeFallback(scope, …).
export function payeePickKind({ scope, current, next, fallback, actorId, isRunner } = {}) {
  const cur = text(current);
  const nx = text(next);
  const fb = text(fallback);
  const actor = text(actorId);
  const target = nx === fb ? null : nx;
  const effNow = cur || fb;
  const effAfter = target || fb;
  if (target === cur) return { kind: 'none', store: cur };
  if (effAfter === effNow) return { kind: 'direct', store: target };
  if (target === null) return { kind: 'direct', store: null };
  if (target === actor && isRunner === true) return { kind: 'direct', store: target };
  if (target === actor) return { kind: 'refused', store: cur, code: 'self-not-runner' };
  return { kind: 'invite', store: target, scope: scope === 'series' ? 'series' : 'episode' };
}

function isoAt(ms) {
  return new Date(ms).toISOString();
}

// The title_payees writes for a change of paid account at `at`. titles = [{
// type: 'series' | 'episode', id, before (who it paid until now), after
// (who it pays from now), rows (that title's history) }]. A title whose
// open row already pays `after` (or that has none and doesn't change) is
// left alone. With no open row, a `baseline` row [gapStart, at) records
// what the rule was answering until now (gapStart = the cut-over or the
// last row's end); an open row is closed at `at` and a new one opened. The
// closes come before the opens, so the one upsert never holds two open
// rows for one title. Nothing before the rule is live.
//   → { live, baseline: rows[], upsert: rows[] } (rows carry the table's
//   columns; an open's id is null — the server fills it)
export function stampPlan({ titles, at, from = PAYEE_RULE_FROM, setBy = null } = {}) {
  if (!payeeRuleLiveAt(at, from)) return { live: false, baseline: [], upsert: [] };
  const atMs = timeOf(at);
  const fromMs = timeOf(from);
  const baseline = [];
  const closes = [];
  const opens = [];
  for (const t of titles || []) {
    if (!t || !text(t.id)) continue;
    const type = t.type === 'series' ? 'series' : 'episode';
    const id = text(t.id);
    const before = text(t.before);
    const after = text(t.after);
    const rows = Array.isArray(t.rows) ? t.rows : [];
    let open = null;
    for (const r of rows) {
      if (!blank(pick(r, 'toAt', 'to_at'))) continue;
      if (!open || (timeOf(pick(r, 'fromAt', 'from_at')) || 0) > (timeOf(pick(open, 'fromAt', 'from_at')) || 0)) open = r;
    }
    const openPayee = open ? text(pick(open, 'payeeId', 'payee_id')) : null;
    if ((open && openPayee === after) || (!open && before === after)) continue;
    let when = atMs;
    if (open) {
      const openFrom = timeOf(pick(open, 'fromAt', 'from_at'));
      if (openFrom !== null && openFrom > when) when = openFrom;
    }
    const whenIso = isoAt(when);
    if (!open && before) {
      let gapStart = fromMs;
      for (const r of rows) {
        const to = timeOf(pick(r, 'toAt', 'to_at'));
        if (to !== null && to > gapStart) gapStart = to;
      }
      if (gapStart < when) baseline.push({ title_type: type, title_id: id, payee_id: before, from_at: isoAt(gapStart), to_at: whenIso, set_by: 'baseline' });
    }
    if (open) {
      const openFrom = timeOf(pick(open, 'fromAt', 'from_at'));
      closes.push({ id: text(open.id), title_type: type, title_id: id, payee_id: openPayee, from_at: openFrom === null ? whenIso : isoAt(openFrom), to_at: whenIso, set_by: text(pick(open, 'setBy', 'set_by')) });
    }
    if (after) opens.push({ id: null, title_type: type, title_id: id, payee_id: after, from_at: whenIso, to_at: null, set_by: text(setBy) });
  }
  return { live: true, baseline, upsert: [...closes, ...opens] };
}

// "Runs it: Mara Reyes · Paid to: You" — runsIt / paidTo are { id, name };
// a house title pays Studio Tapa.
export function paidLine({ runsIt, paidTo, viewerId, pendingName, house } = {}) {
  const me = text(viewerId);
  const runsId = runsIt ? text(runsIt.id) : null;
  const paidId = paidTo ? text(paidTo.id) : null;
  const runsWord = me && runsId === me ? 'You' : (text(runsIt && runsIt.name) || 'No one yet');
  const paidWord = house === true ? 'Studio Tapa' : me && paidId === me ? 'You' : (text(paidTo && paidTo.name) || 'No one yet');
  const pending = text(pendingName);
  return { runsIt: runsWord, paidTo: paidWord, text: `Runs it: ${runsWord} · Paid to: ${paidWord}`, pending: pending ? `Waiting on ${pending} to accept` : null };
}

// Where the paid account comes from, in words beside its name.
export function payeeSourceWords(source, showName) {
  if (source === 'own') return '(its own)';
  if (source === 'show' && text(showName)) return `(${text(showName)}’s)`;
  return null;
}

export function seriesSaleNote(showName, seriesPayeeName) {
  return `Whole-series sales of ${text(showName) || 'the show'} still go to ${text(seriesPayeeName) || 'the show’s paid account'}.`;
}

// Where tips go, beside who gets paid (Jose, 2026-11-06: tips go to the
// maker): a show has no Tip button of its own, its episodes' pages each
// tip whoever made that one.
export function payeeTipsLine(titleType) {
  return titleType === 'series'
    ? 'Tips on its episodes’ pages go to whoever made each one.'
    : 'Tips on its page go to whoever made it.';
}

// A title named in an invite or a notice: the show, an episode of a show,
// or a standalone title.
export function titleWords({ titleType, titleName, showName, code } = {}) {
  const show = text(showName);
  if (titleType === 'series') return show || text(titleName) || 'this show';
  const name = text(titleName) || 'this title';
  if (show) return `“${name}” (${show}${text(code) ? ` · ${text(code)}` : ''})`;
  return `“${name}”`;
}

export function inviteHeadline(args) {
  return `Get paid for ${titleWords(args)}?`;
}

export function inviteStateWords(status) {
  const words = { pending: 'Waiting for an answer', accepted: 'Accepted', declined: 'Said no', cancelled: 'Withdrawn' };
  return typeof status === 'string' && Object.prototype.hasOwnProperty.call(words, status) ? words[status] : null;
}

// Who sees "Runs it · Paid to" (question 23, as recommended): the team,
// the show's owner, its paid accounts, and anyone with an episode in it.
// Viewers never do.
export function seesWhoIsPaid({ viewerId, isAdmin, show, episodes } = {}) {
  if (isAdmin === true) return true;
  const me = text(viewerId);
  if (!me) return false;
  if (show && (runnerOf(show) === me || text(pick(show, 'paidTo', 'paid_to')) === me)) return true;
  return (episodes || []).some((e) => uploaderOf(e) === me || text(pick(e, 'paidTo', 'paid_to')) === me);
}

// --- credits (decision 20) ---------------------------------------------------

// series.credits / episodes.credits (migration 118), cleaned: { studio:
// { name, userId } | null, producer: { name, userId } | null, order }. A
// key present as null means "none for this title", a missing key "the
// show's". order lists maker / studio / producer once each.
export function normalizeCredits(raw) {
  const src = parseJson(raw);
  const out = {};
  if (!src || typeof src !== 'object' || Array.isArray(src)) return out;
  for (const key of ['studio', 'producer']) {
    if (!Object.prototype.hasOwnProperty.call(src, key)) continue;
    const v = src[key];
    let name = null;
    let userId = null;
    if (typeof v === 'string') name = text(v);
    else if (v && typeof v === 'object') {
      name = text(v.name);
      userId = text(v.userId !== undefined ? v.userId : v.user_id);
    }
    out[key] = name || userId ? { name: name ? name.slice(0, 120) : null, userId: userId ? userId.slice(0, 64) : null } : null;
  }
  if (Array.isArray(src.order)) {
    const order = [];
    for (const k of src.order) if (CREDIT_KEYS.includes(k) && !order.includes(k)) order.push(k);
    for (const k of CREDIT_KEYS) if (!order.includes(k)) order.push(k);
    out.order = order;
  }
  return out;
}

// The credit lines of a title (or of a show, with episode null), in
// order: "Made by" (the original creator: the title's artist text, else
// the show's, else the maker's display name; "Hosted by" on a podcast),
// then the optional Studio and Producer — each a typed name, or a linked
// account's name — the title's own overriding the show's. The runner may
// put Studio or Producer first. Empty lines are dropped. `names` maps an
// account id to its display name (an object, a Map or a function).
export function creditLines(episode, series, names) {
  const nameOf = nameLookup(names);
  const own = normalizeCredits(episode ? pick(episode, 'credits', 'credits') : null);
  const shows = normalizeCredits(series ? pick(series, 'credits', 'credits') : null);
  const podcast = kindOf(series) === 'podcast' || contentTypeOf(episode) === 'podcast';
  const makerId = runnerOf(series) || uploaderOf(episode);
  const makerName = text(episode ? pick(episode, 'artist', 'artist') : null) || showValue(series, 'artist') || nameOf(makerId);
  const lines = {
    maker: makerName ? { key: 'maker', label: podcast ? 'Hosted by' : 'Made by', name: makerName, userId: makerId } : null
  };
  for (const key of ['studio', 'producer']) {
    const c = Object.prototype.hasOwnProperty.call(own, key) ? own[key] : shows[key];
    const name = c ? c.name || nameOf(c.userId) : null;
    lines[key] = name ? { key, label: key === 'studio' ? 'Studio' : 'Producer', name, userId: c.userId || null } : null;
  }
  const order = own.order || shows.order || CREDIT_KEYS;
  return order.map((k) => lines[k]).filter(Boolean);
}

// --- what applies at once, what waits, what's the team's ----------------------

// Decision 6 (and spec decision 16, amendment 22): `live` is what an
// owner's change does on a live title or show — 'direct' (applies at once),
// 'staged' (waits for an admin, visible and cancellable; the current one
// stays), 'locked' (the team only) or 'invite' (the chosen person accepts
// first). `who` is who may change it at all: the 'uploader' (an episode's
// details), the 'runner' (the show's owner: where things sit, the credits,
// who is paid), or 'either'.
export const FIELD_POLICY = {
  episode: {
    title: { live: 'staged', who: 'uploader' },
    description: { live: 'direct', who: 'uploader' },
    poster: { live: 'staged', who: 'uploader' },
    thumbnail: { live: 'staged', who: 'uploader' },
    titleImage: { live: 'staged', who: 'uploader' },
    trailer: { live: 'staged', who: 'uploader' },
    video: { live: 'staged', who: 'uploader' },
    genre: { live: 'direct', who: 'uploader' },
    mainGenre: { live: 'direct', who: 'uploader' },
    artist: { live: 'direct', who: 'uploader' },
    releaseYear: { live: 'direct', who: 'uploader' },
    runtime: { live: 'direct', who: 'uploader' },
    fundingUrl: { live: 'direct', who: 'uploader' },
    adBreakSeconds: { live: 'direct', who: 'uploader' },
    adsEnabled: { live: 'direct', who: 'uploader' },
    channelOptIn: { live: 'direct', who: 'uploader' },
    captions: { live: 'direct', who: 'uploader' },
    pageNotes: { live: 'direct', who: 'uploader' },
    // What kind of extra (migration 121): a label, like the other details.
    extraKind: { live: 'direct', who: 'uploader' },
    hasPage: { live: 'direct', who: 'either' },
    season: { live: 'direct', who: 'runner' },
    seriesOrder: { live: 'direct', who: 'runner' },
    bonusParent: { live: 'direct', who: 'either' },
    seriesId: { live: 'direct', who: 'uploader' },
    credits: { live: 'direct', who: 'runner' },
    paidTo: { live: 'invite', who: 'runner' },
    tier: { live: 'locked', who: 'uploader' },
    rating: { live: 'locked', who: 'uploader' },
    isOriginal: { live: 'locked', who: 'uploader' },
    featured: { live: 'locked', who: 'uploader' }
  },
  show: {
    name: { live: 'staged', who: 'runner' },
    poster: { live: 'staged', who: 'runner' },
    thumbnail: { live: 'staged', who: 'runner' },
    heroImage: { live: 'staged', who: 'runner' },
    titleImage: { live: 'staged', who: 'runner' },
    trailer: { live: 'staged', who: 'runner' },
    description: { live: 'direct', who: 'runner' },
    releaseYear: { live: 'direct', who: 'runner' },
    fundingUrl: { live: 'direct', who: 'runner' },
    channelOptIn: { live: 'direct', who: 'runner' },
    seasons: { live: 'direct', who: 'runner' },
    defaults: { live: 'direct', who: 'runner' },
    credits: { live: 'direct', who: 'runner' },
    paidTo: { live: 'invite', who: 'runner' },
    kind: { live: 'direct', who: 'runner' }
  }
};

// Amendment 22: while pulled, the file can still be replaced (it goes to
// review) and the captions and page notes stay open; the rest waits.
const OPEN_WHILE_PULLED = { video: 'staged', captions: 'direct', pageNotes: 'direct' };

const TEAM_ONLY_WORDS = {
  tier: 'Ask us to change who can watch',
  rating: 'Ask us to change the rating',
  isOriginal: 'Ask us about Tapa Original',
  featured: 'Ask us about the hero spot'
};

function mayChange(who, ctx) {
  if (who === 'runner') return ctx.isRunner === true;
  if (who === 'either') return ctx.isRunner === true || ctx.isUploader === true;
  return ctx.isUploader === true;
}

function episodeLive(ctx) {
  const st = text(ctx.status);
  return st === null || st === 'approved';
}

// What a change to `field` does now. ctx = { target: 'episode' | 'show',
// isAdmin, isRunner (the show's owner; a standalone title's uploader),
// isUploader, status (an episode: draft | pending | approved | rejected; a
// show: pending | approved | rejected), held, showHeld, deletionRequested,
// withdrawn, approvedEpisodes (a show's), episodeCount (a show's) }.
// An admin's change is always direct. A draft, an episode in review or a
// declined one takes everything at once; a live one follows the table. A
// show takes everything at once until its first episode is approved, then
// its name and art wait as on a live show. Pulled, being removed or
// withdrawn: locked (amendment 22's few exceptions aside).
export function fieldPolicy(field, ctx = {}) {
  const target = ctx.target === 'show' ? 'show' : 'episode';
  if (ctx.isAdmin === true) return 'direct';
  const entry = FIELD_POLICY[target][field];
  if (!entry || !mayChange(entry.who, ctx)) return 'locked';
  if (target === 'show') {
    if (ctx.held === true || ctx.deletionRequested === true) return 'locked';
    if (field === 'kind') return Number(ctx.episodeCount) > 0 ? 'locked' : 'direct';
    if (entry.live === 'invite') return 'invite';
    const st = text(ctx.status) || 'approved';
    if (st === 'rejected') return 'direct';
    if (st === 'pending' && !(Number(ctx.approvedEpisodes) > 0)) return 'direct';
    return entry.live;
  }
  if (ctx.withdrawn === true || ctx.deletionRequested === true) return 'locked';
  if (ctx.held === true || ctx.showHeld === true) return OPEN_WHILE_PULLED[field] || 'locked';
  if (entry.live === 'invite') return 'invite';
  return episodeLive(ctx) ? entry.live : 'direct';
}

// The line under a field that doesn't simply save: why it waits, who is
// asked, or why it's closed. Null for a direct field.
export function fieldPolicyLine(field, ctx = {}) {
  const policy = fieldPolicy(field, ctx);
  if (policy === 'direct') return null;
  if (policy === 'staged') return field === 'video' ? 'The new file goes to an admin; the current one keeps playing until then' : 'Waits for approval; what’s there now stays until then';
  if (policy === 'invite') return 'They’re asked first; until they accept, the earnings keep going where they go now';
  const target = ctx.target === 'show' ? 'show' : 'episode';
  const entry = FIELD_POLICY[target][field];
  if (!entry) return 'This can’t be changed here';
  if (!mayChange(entry.who, ctx)) return entry.who === 'uploader' ? 'Only the person who uploaded it can change this' : 'Only the show’s owner can change this';
  if (ctx.withdrawn === true) return 'Withdrawn and kept for its buyers';
  if (ctx.deletionRequested === true) return 'Removal requested — cancel it to make changes';
  if (ctx.held === true || ctx.showHeld === true) return 'Pulled while an admin looks at it';
  if (field === 'kind') return 'A show’s kind is set once it has episodes';
  return TEAM_ONLY_WORDS[field] || 'Ask us to change this';
}

// --- moving a title between shows (decisions 7, 13, 19) ----------------------

function moveRefusal(code, reason, tag) {
  return { ok: false, code, reason, tag: tag || null };
}

// May this viewer move `episode` into `targetShow`? viewer = { userId,
// isAdmin }; opts = { sourceShow (the show it's in now), buyers: {
// source, target } (whole-series buyers of each), pins (the channel
// slots that start their run at this episode: { channel } each, or a
// count), onChannel (a channel airs the source show), names, payeeRuleLive
// (the server passes it; else whether the rule is in force at opts.now,
// default now) }.
// A creator moves only what they uploaded, between their own shows of the
// same kind, never in or out of a show with buyers or off a pinned slot,
// and a standalone title into a show only while it isn't live; never into
// a declined, pulled or vertical show. An admin may move anything except
// into a show whose removal is requested (or across kinds) and is told what
// follows: whose future earnings change (once the rule is live; before
// PAYEE_RULE_FROM, that they stay with the uploader), how many series buyers gain or
// lose it, which pins clear, that it leaves the site until a private show
// goes public. Within one show this answers who may reorder (the owner or
// an admin). `tag` is the greyed label a picker shows.
export function canMoveTo(episode, targetShow, viewer, opts = {}) {
  const v = viewer || {};
  const admin = v.isAdmin === true;
  const me = text(v.userId);
  if (!episode || typeof episode !== 'object') return moveRefusal('missing', 'That episode isn’t there any more.');
  if (contentTypeOf(episode) === 'bonus') return moveRefusal('extra', 'Extras are placed with “Place after…”, not moved.');
  if (!targetShow || typeof targetShow !== 'object') return moveRefusal('no-target', 'Pick a show.');
  if (isWithdrawn(episode)) return moveRefusal('withdrawn', 'It’s withdrawn and kept for its buyers.');
  if (removalRequested(episode)) return moveRefusal('removal', 'Its removal is requested — cancel that first.');
  if (isHeld(episode) && !admin) return moveRefusal('held', 'Pulled while an admin looks at it.');
  if (removalRequested(targetShow)) return moveRefusal('target-removal', 'That show’s removal is requested.', '(removal requested)');
  if (isHeld(targetShow) && !admin) return moveRefusal('target-held', 'That show is pulled while an admin looks at it.', '(pulled)');

  const sourceId = seriesIdOf(episode);
  const targetId = text(targetShow.id);
  const targetRunner = runnerOf(targetShow);
  if (sourceId && targetId && sourceId === targetId) {
    if (!admin && (!me || me !== targetRunner)) return moveRefusal('who', 'Only the show’s owner can change its order.');
    return { ok: true, code: 'same-show', sameShow: true, tag: null };
  }

  const targetKind = kindOf(targetShow);
  const type = contentTypeOf(episode);
  const episodeKind = kindForType(type);
  if (type && !episodeKind) return moveRefusal('kind', 'Only series and podcast episodes join a show.', '(another kind)');
  if (episodeKind && episodeKind !== targetKind) {
    const reason = episodeKind === 'podcast' ? 'A podcast episode only joins a podcast.' : targetKind === 'podcast' ? 'Only podcast episodes join a podcast.' : 'It only joins a show of its own kind.';
    return moveRefusal('kind', reason, targetKind === 'vertical' ? '(vertical — studio only)' : '(another kind)');
  }
  if (targetKind === 'vertical' && !admin) return moveRefusal('vertical', 'Vertical series are set up by the studio.', '(vertical — studio only)');
  if (text(targetShow.status) === 'rejected' && !admin) return moveRefusal('target-declined', 'That show was declined — resubmit it first.', '(not this time)');

  const source = opts.sourceShow || null;
  const uploader = uploaderOf(episode);
  if (!admin) {
    if (!me || me !== uploader) return moveRefusal('uploader', 'Only the person who uploaded it can move it to another show.');
    if (me !== targetRunner) return moveRefusal('target-owner', 'It can only go into one of your own shows.');
    const sourceRunner = sourceId ? runnerOf(source && sameId(source.id, sourceId) ? source : null) : uploader;
    if (sourceRunner !== me) return moveRefusal('owners', 'Only an admin can move a title between owners.');
    if (!sourceId && statusOf(episode) === 'approved') return moveRefusal('live-standalone', 'Ask us to put a live title into a show.');
  }

  const buyers = opts.buyers || {};
  const lose = sourceId ? Math.max(0, Number(buyers.source) || 0) : 0;
  const gain = Math.max(0, Number(buyers.target) || 0);
  if (!admin && (lose > 0 || gain > 0)) return moveRefusal('buyers', 'This show has buyers — ask us.', '(has buyers — ask us)');

  let pins = [];
  if (Array.isArray(opts.pins)) pins = opts.pins.filter(Boolean);
  else if (Number(opts.pins) > 0) pins = Array.from({ length: Number(opts.pins) }, () => ({}));
  if (!sourceId) pins = [];
  if (!admin && pins.length) {
    const channel = text(pins[0] && (pins[0].channel || pins[0].channelName));
    return moveRefusal('pinned', `Pinned on ${channel || 'a channel'} — ask us to unpin it first.`);
  }

  const payeeRuleLive = (opts.payeeRuleLive ?? payeeRuleLiveAt(opts.now ?? new Date())) === true;
  const payeeBefore = payeeOf(episode, sourceId ? source : null);
  const payeeAfter = payeeOf(episode, targetShow);
  const earningsMove = payeeRuleLive && payeeBefore !== payeeAfter;
  const leavesSite = statusOf(episode) === 'approved' && !isPublicShow(targetShow);
  const nameOf = nameLookup(opts.names);
  const lines = [];
  if (earningsMove) lines.push(`Future earnings go to ${nameOf(payeeAfter) || 'the new show’s paid account'}`);
  else if (!payeeRuleLive && uploader !== targetRunner) {
    const who = nameOf(uploader);
    lines.push(who ? `Its earnings stay with ${who}.` : 'Its earnings stay with whoever uploaded it.');
  }
  if (lose > 0) lines.push(`${pl(lose, 'series buyer loses', 'series buyers lose')} this episode`);
  if (gain > 0) lines.push(`${pl(gain, 'series buyer gains', 'series buyers gain')} this episode`);
  if (pins.length) {
    const channels = [...new Set(pins.map((p) => text(p && (p.channel || p.channelName))).filter(Boolean))];
    lines.push(`Clears its pin on ${channels.length ? listWords(channels) : pl(pins.length, 'channel slot', 'channel slots')}`);
  }
  if (leavesSite) lines.push(`It leaves the site until ${text(targetShow.name) || 'that show'} goes public; its buyers keep playing it`);
  if (sourceId && opts.onChannel) lines.push('A channel that was up to this episode starts the show again from episode 1');
  return { ok: true, code: 'ok', sameShow: false, tag: null, payeeBefore, payeeAfter, earningsMove, buyersAffected: { lose, gain }, pinsCleared: pins, leavesSite, lines };
}

// --- removing a show (decision 15) -------------------------------------------

// What "Remove this show" does, before it's asked: anything someone
// bought is withdrawn and kept for them (a whole-series purchase keeps
// the show, its episodes and the extras filed in it; an episode purchase
// keeps that episode, and the show with it while the episode is still filed
// in it), everything else is deleted. buyers = { series: n,
// titles: { [id]: n } }; opts = { channelSlots, outsideReferences }.
// `words` is the creator's card, `adminWords` the admin's.
export function cascadePlan(show, episodes, extras, buyers, opts = {}) {
  const showId = text(show && show.id);
  const name = text(show && show.name) || 'This show';
  const b = buyers || {};
  const seriesBuyers = Math.max(0, Number(b.series) || 0);
  const perTitle = b.titles || b.episodes || {};
  const titleBuyers = (id) => Math.max(0, Number(perTitle[id]) || 0);
  const rows = [];
  const planRow = (r, kind) => {
    const own = titleBuyers(r.id);
    const bySeries = seriesBuyers > 0 && (kind === 'episode' || (showId !== null && seriesIdOf(r) === showId));
    const keep = own > 0 || bySeries || isWithdrawn(r);
    rows.push({ id: r.id, kind, action: keep ? 'withdraw' : 'delete', buyers: own, bySeries });
  };
  for (const e of episodes || []) if (e && typeof e === 'object') planRow(e, 'episode');
  for (const x of extras || []) if (x && typeof x === 'object') planRow(x, 'extra');
  const episodeCount = rows.filter((r) => r.kind === 'episode').length;
  const extraCount = rows.filter((r) => r.kind === 'extra').length;
  const kept = rows.filter((r) => r.action === 'withdraw').length;
  // episodes.series_id has no "on delete cascade": a kept row still filed in
  // the show keeps the show too (withdrawn and hidden with it). So does a
  // kept extra filed under it only through bonus_parent_* (under the show,
  // or after one of its episodes): its money follows the show (Jose,
  // 2026-11-06), which has to stay to say whose it is — lib/showDelete.js
  // files one whose parent episode goes under the show itself.
  const episodeIdsHere = new Set((episodes || []).filter((e) => e && typeof e === 'object').map((e) => text(e.id)).filter(Boolean));
  const filedHere = (r) => {
    if (seriesIdOf(r) === showId) return true;
    const ref = extraParentOf(r);
    return Boolean(ref) && (ref.type === 'series' ? sameId(ref.id, showId) : episodeIdsHere.has(ref.id));
  };
  const keptInShow = showId !== null && [...(episodes || []), ...(extras || [])]
    .some((r) => r && typeof r === 'object' && filedHere(r) && rows.some((x) => x.action === 'withdraw' && sameId(x.id, r.id)));
  const slots = Math.max(0, Number(opts.channelSlots) || 0);
  const outside = Math.max(0, Number(opts.outsideReferences) || 0);

  let words;
  if (episodeCount && extraCount) words = `${name}, its ${pl(episodeCount, 'episode', 'episodes')} and ${pl(extraCount, 'extra', 'extras')}`;
  else if (episodeCount) words = `${name} and its ${pl(episodeCount, 'episode', 'episodes')}`;
  else if (extraCount) words = `${name} and its ${pl(extraCount, 'extra', 'extras')}`;
  else words = `${name} (nothing in it yet)`;
  if (seriesBuyers > 0) words += ` · ${pl(seriesBuyers, 'person', 'people')} bought the whole series, so it will be kept for them`;
  else if (keptInShow) words += ` · ${kept === 1 ? '1 title has buyers, so it and the show are' : `${kept} titles have buyers, so they and the show are`} kept for them`;
  else if (kept > 0) words += ` · ${pl(kept, 'title has', 'titles have')} buyers and will be kept for them`;

  const parts = [pl(episodeCount, 'episode', 'episodes'), pl(extraCount, 'extra', 'extras'), `${kept} with buyers (kept for them)`];
  if (seriesBuyers > 0) parts.push(`${pl(seriesBuyers, 'series buyer', 'series buyers')} (the show is kept)`);
  else if (keptInShow) parts.push('the show is kept (a title in it has buyers)');
  if (slots > 0) parts.push(`channel slots: ${slots}`);
  if (outside > 0) parts.push('outside references kept by title');

  return {
    show: { id: showId, action: seriesBuyers > 0 || keptInShow ? 'withdraw' : 'delete' },
    rows,
    counts: { episodes: episodeCount, extras: extraCount, kept, deleted: rows.length - kept, seriesBuyers, channelSlots: slots },
    words,
    adminWords: parts.join(' · ')
  };
}

// --- a show's state ----------------------------------------------------------

// Where a show stands, for the hub's chip and the status card's headline:
// pulled, removal requested, declined (older rows), live, or not public
// yet — 'ready' once an episode is approved (decision 2: its owner or a
// full admin makes it public), 'review' while the first is in review,
// 'drafts' when only drafts exist, 'empty' before anything is added.
// rows = the show's episodes and drafts.
export function showState(show, rows) {
  if (!show || typeof show !== 'object') return null;
  const st = text(show.status) || 'approved';
  if (isHeld(show)) {
    const why = text(pick(show, 'decisionNote', 'decision_note')) || text(pick(show, 'holdReason', 'hold_reason'));
    return { key: 'pulled', label: 'Pulled', level: 'warn', headline: why ? `Pulled by an admin: ${why}` : 'Pulled by an admin' };
  }
  if (removalRequested(show)) {
    const day = dayLabel(pick(show, 'deletionRequestedAt', 'deletion_requested_at'));
    return { key: 'removal', label: 'Removal requested', level: 'neutral', headline: day ? `Removal requested on ${day}` : 'Removal requested' };
  }
  if (st === 'rejected') {
    const note = text(pick(show, 'decisionNote', 'decision_note'));
    return { key: 'declined', label: 'Not this time', level: 'warn', headline: note ? `An admin declined this show: ${note}` : 'An admin declined this show' };
  }
  if (st === 'approved') return { key: 'live', label: 'Live', level: 'ok', headline: 'Live' };
  const eps = (rows || []).filter((r) => inRunningOrder(r));
  if (eps.some((r) => statusOf(r) === 'approved' && !isHeld(r))) return { key: 'ready', label: 'Ready to go public', level: 'ok', headline: 'Ready to go public' };
  if (eps.some((r) => statusOf(r) === 'pending')) return { key: 'review', label: 'Not public yet', level: 'review', headline: 'Not public yet — your first episode is in review' };
  if (eps.some((r) => statusOf(r) === 'draft')) return { key: 'drafts', label: 'Not public yet', level: 'review', headline: 'Not public yet — send your first episode for review' };
  return { key: 'empty', label: 'Not public yet', level: 'neutral', headline: 'Not public yet — add your first episode' };
}

export function showStatusLabel(show, rows) {
  const s = showState(show, rows);
  return s ? s.label : null;
}

// Decision 2 (option A): the show's owner or a full admin makes a show
// public once at least one of its episodes is approved. It is one-way and
// it is the release: the answer's releaseIds are the approved episodes
// whose released_at starts again now. viewer = { userId, isAdmin } (a full
// admin; a sub-admin is isAdmin false).
export function canMakePublic(show, episodes, viewer) {
  const v = viewer || {};
  if (!show || typeof show !== 'object') return { ok: false, code: 'missing', reason: 'That show isn’t there any more.' };
  const admin = v.isAdmin === true;
  const st = text(show.status) || 'approved';
  if (st === 'approved') return { ok: false, code: 'public', reason: 'It’s public already.' };
  if (isHeld(show)) return { ok: false, code: 'held', reason: 'Pulled while an admin looks at it.' };
  if (removalRequested(show)) return { ok: false, code: 'removal', reason: 'Its removal is requested.' };
  if (st === 'rejected') return { ok: false, code: 'declined', reason: 'An admin declined this show — resubmit it first.' };
  const me = text(v.userId);
  if (!admin && (!me || me !== runnerOf(show))) return { ok: false, code: 'who', reason: 'Only the show’s owner or a full admin can make it public.' };
  if (kindOf(show) === 'vertical' && !admin) return { ok: false, code: 'vertical', reason: 'Vertical series are set up by the studio.' };
  const approved = (episodes || []).filter((e) => isPublicEpisode(e) && statusOf(e) === 'approved');
  if (!approved.length) return { ok: false, code: 'empty', reason: 'Once an episode is approved, it can go public.' };
  return { ok: true, code: 'ok', releaseIds: approved.map((e) => e.id) };
}

// The status card's lines under the headline: numbering, failed or
// unfinished files, live episodes without captions (not podcasts), changes
// waiting for approval, the trailer, and the reminder that a live show's
// changes take a few minutes to reach visitors. opts = { kind,
// trailerState }.
export function showProblems(show, rows, opts = {}) {
  const list = (rows || []).filter((r) => r && typeof r === 'object');
  const kind = opts.kind || kindOf(show, list);
  const out = numberingProblems(list, { kind }).map((p) => ({ ...p, level: 'warn' }));
  const label = (r) => (numberOf(r) ? `Episode ${numberOf(r)}` : titleOf(r) || 'An episode');
  const inPlay = list.filter(inRunningOrder);
  for (const r of inPlay) {
    const st = masterState(r);
    if (st === 'error') out.push({ code: 'file-failed', level: 'warn', season: seasonOf(r), episodeIds: [r.id], words: `${label(r)}’s file failed — replace it` });
  }
  const unfinished = inPlay.filter((r) => masterState(r) === 'uploading');
  if (unfinished.length) out.push({ code: 'uploading', level: 'review', episodeIds: unfinished.map((r) => r.id), words: `${pl(unfinished.length, 'upload hasn’t', 'uploads haven’t')} finished — pick the same file to resume` });
  if (kind !== 'podcast') {
    const bare = inPlay.filter((r) => statusOf(r) === 'approved' && blank(pick(r, 'captionsUrl', 'captions_url')));
    // Before the show is public its approved episodes aren't live yet.
    const which = isPublicShow(show) ? 'live' : 'approved';
    if (bare.length) out.push({ code: 'captions', level: 'review', episodeIds: bare.map((r) => r.id), words: `${pl(bare.length, `${which} episode has`, `${which} episodes have`)} no captions` });
  }
  const showStaged = [['pendingName', 'pending_name', 'name'], ['pendingPoster', 'pending_poster', 'poster'], ['pendingThumbnail', 'pending_thumbnail', 'still'], ['pendingHeroImage', 'pending_hero_image', 'hero image'], ['pendingTitleImageUrl', 'pending_title_image_url', 'title image'], ['pendingTrailerSrc', 'pending_trailer_src', 'trailer']]
    .filter(([camel, snake]) => !blank(pick(show, camel, snake)))
    .map(([, , word]) => word);
  if (showStaged.length) out.push({ code: 'staged', level: 'review', episodeIds: [], words: `Waiting for approval: the new ${listWords(showStaged)}` });
  const stagedEpisodes = inPlay.filter((r) => ['pendingTitle', 'pendingPoster', 'pendingThumbnail', 'pendingSrc', 'pendingTitleImageUrl', 'pendingTrailerSrc'].some((k) => !blank(r[k]))
    || ['pending_title', 'pending_poster', 'pending_thumbnail', 'pending_src', 'pending_title_image_url', 'pending_trailer_src'].some((k) => !blank(r[k]))
    || r.pendingTitleImageRemoval === true || r.pending_title_image_removal === true);
  if (stagedEpisodes.length) out.push({ code: 'staged-episodes', level: 'review', episodeIds: stagedEpisodes.map((r) => r.id), words: `${pl(stagedEpisodes.length, 'episode has', 'episodes have')} changes waiting for approval` });
  const trailer = videoStateOf(opts.trailerState);
  if (trailer === 'uploading' || trailer === 'processing') out.push({ code: 'trailer', level: 'review', episodeIds: [], words: 'Trailer still processing' });
  if (trailer === 'error') out.push({ code: 'trailer-failed', level: 'warn', episodeIds: [], words: 'The trailer failed — replace it' });
  if (isPublicShow(show)) out.push({ code: 'delay', level: 'info', episodeIds: [], words: 'Changes reach visitors within a few minutes' });
  return out;
}

// One answer to "what needs you" for a title row (my-submissions'
// shape), shared by Creator Studio's pile, Your work's Needs attention and
// the app: the reason, or null. An approved episode of a show that isn't
// public yet is "Ready to go public" (decision 2), never Live.
export function needsYou(s) {
  if (!s || typeof s !== 'object') return null;
  if (s.status === 'rejected') return s.rejectionReason ? `Not this time: ${s.rejectionReason}` : 'Not this time';
  if (s.deletionRequested) return null;
  if (s.held && s.status === 'approved') return 'Pulled while an admin looks at it';
  if (s.status === 'approved' && s.seriesHeld) return 'Its show is pulled while an admin looks at it';
  if (s.status === 'approved' && s.seriesStatus === 'pending') return 'Ready to go public';
  if (s.status === 'approved' && s.seriesStatus === 'rejected') return 'An admin declined the show — resubmit it';
  if (s.missingArtwork) return 'Missing a poster or a still';
  if (s.status === 'approved' && s.contentType !== 'podcast' && !s.captionsUrl) return 'No captions yet';
  const state = videoStateOf(s.cloudflareState);
  if (state === 'error') return 'The video failed to process';
  if (state === 'uploading') return 'The upload never finished';
  return null;
}

// --- the show pickers and the submit page's Place block (slice 2) -------------

const PICKER_TAGS = {
  review: { tag: '(in review)', ok: true },
  ready: { tag: '(ready to go public)', ok: true },
  drafts: { tag: '(not public yet)', ok: true },
  empty: { tag: '(not public yet)', ok: true },
  removal: { tag: '(removal requested — can’t add)', ok: false },
  declined: { tag: '(not this time — fix it first)', ok: false },
  pulled: { tag: '(pulled — can’t add)', ok: false }
};

// The words a show picker (the submit page's Place block, the app's) puts
// after a show's name, and whether the show takes a new episode: nothing
// for a live show; "(in review)" while its first episode is, "(ready to go
// public)", "(not public yet)"; greyed "(removal requested — can’t add)",
// "(not this time — fix it first)", "(pulled — can’t add)" and "(vertical
// — studio only)". `show` is a GET /api/show summary (its `state`) or a
// series row, read with no episodes when it has no state (a private show
// then reads "(not public yet)").
export function showPickerTag(show) {
  if (!show || typeof show !== 'object') return { tag: null, ok: false };
  if (kindOf(show) === 'vertical') return { tag: '(vertical — studio only)', ok: false };
  const st = text(show.state) ? null : showState(show, []);
  const key = text(show.state) || (st ? st.key : null);
  return PICKER_TAGS[key] ? { ...PICKER_TAGS[key] } : { tag: null, ok: true };
}

// The next free number in a season for a row being placed, from a GET
// /api/show/[id]/positions answer ({ taken, duplicates, parked }): one past
// the highest number anything else holds, parked numbers aside. The
// answer's own nextFree counts the viewer's drafts, the one being placed
// among them, which would push its own suggestion one along. 1 for an
// empty season.
export function nextFreeExcept(positions, excludeId) {
  const p = positions && typeof positions === 'object' ? positions : {};
  const taken = p.taken && typeof p.taken === 'object' ? p.taken : {};
  const dupes = p.duplicates && typeof p.duplicates === 'object' ? p.duplicates : {};
  const parked = new Set((Array.isArray(p.parked) ? p.parked : []).map(posInt).filter(Boolean));
  let max = 0;
  for (const key of Object.keys(taken)) {
    const n = posInt(key);
    if (!n || parked.has(n)) continue;
    const holders = Array.isArray(dupes[key]) && dupes[key].length ? dupes[key] : [taken[key] && taken[key].id];
    if (!blank(excludeId) && holders.every((id) => sameId(id, excludeId))) continue;
    max = Math.max(max, n);
  }
  return max + 1;
}

// --- the control room (slice 2) ----------------------------------------------

// The POST /api/show/[id]/reorder body (amendment 14) for writes that all
// stay in one season of one show — a plan's own writes, or its undo: {
// season, episodes: [{ id, number }], drafts: [{ id, number }] }. Null when
// they span seasons or shows (those go through /move), or when a row had
// no number to go back to (nothing can give it "no number" again).
export function reorderBody(writes) {
  const list = (writes || []).filter((w) => w && typeof w === 'object' && !blank(w.id));
  if (!list.length) return null;
  const seasons = new Set(list.map((w) => posInt(w.season) || 1));
  if (seasons.size !== 1 || list.some((w) => !blank(w.seriesId) || !posInt(w.number))) return null;
  return {
    season: [...seasons][0],
    episodes: list.filter((w) => w.kind !== 'draft').map((w) => ({ id: w.id, number: posInt(w.number) })),
    drafts: list.filter((w) => w.kind === 'draft').map((w) => ({ id: w.id, number: posInt(w.number) }))
  };
}

// How to undo a move POST /api/show/[id]/move made inside one show, from
// its answer's rows ([{ id, season, number, seriesId, fromSeriesId,
// fromSeason, fromNumber }]). Inside one season (a number typed in the
// Move sheet, Insert here, Swap) the place it left is held by then, so
// every row goes back in one /reorder of that season. Across seasons: the
// moved row back to its old place first (a /move: that place is free
// again), then the rows it pushed along, one /reorder per season. Steps:
// [{ route: 'move' | 'reorder', body }]. Null when it can't be undone that
// way: it changed show, it had no number before, or a row it pushed (or
// swapped with) changed season.
export function undoMoveSteps(rows, movedId) {
  const list = (rows || []).filter((r) => r && typeof r === 'object' && !blank(r.id));
  const moved = list.find((r) => sameId(r.id, movedId));
  if (!moved) return null;
  const crossShow = (r) => !blank(r.fromSeriesId) && !blank(r.seriesId) && String(r.fromSeriesId) !== String(r.seriesId);
  const fromNumber = posInt(moved.fromNumber);
  if (crossShow(moved) || !fromNumber) return null;
  const movedSeason = posInt(moved.season) || 1;
  if ((posInt(moved.fromSeason) || 1) === movedSeason) {
    const episodes = [{ id: moved.id, number: fromNumber }];
    for (const r of list) {
      if (r === moved) continue;
      const back = posInt(r.fromNumber);
      if (crossShow(r) || !back || (posInt(r.season) || 1) !== movedSeason || (posInt(r.fromSeason) || 1) !== movedSeason) return null;
      episodes.push({ id: r.id, number: back });
    }
    return [{ route: 'reorder', body: { season: movedSeason, episodes, drafts: [] } }];
  }
  const steps = [{ route: 'move', body: { episodeId: moved.id, toSeason: posInt(moved.fromSeason) || 1, toNumber: fromNumber } }];
  const bySeason = new Map();
  for (const r of list) {
    if (r === moved) continue;
    const season = posInt(r.season) || 1;
    const back = posInt(r.fromNumber);
    if (crossShow(r) || !back || (posInt(r.fromSeason) || 1) !== season) return null;
    if (!bySeason.has(season)) bySeason.set(season, []);
    bySeason.get(season).push({ id: r.id, number: back });
  }
  for (const [season, episodes] of [...bySeason.entries()].sort((a, b) => a[0] - b[0])) steps.push({ route: 'reorder', body: { season, episodes, drafts: [] } });
  return steps;
}

// A row's pill on the show page (the app's too): a draft reads Queued,
// Uploading 41%, Processing or Draft; an episode Live, Approved (its show
// isn't public yet), In review, Not this time, Pulled, Pending deletion or
// Withdrawn. ctx = { showPublic, upload: { status, pct } } — the upload is
// the page's queue item for a draft ('queued' | 'starting' | 'uploading'
// …). `tone` is ok | review | warn | danger | neutral.
export function rowPill(row, ctx = {}) {
  if (!row || typeof row !== 'object') return null;
  if (row.kind === 'draft' || statusOf(row) === 'draft') {
    const up = ctx.upload && typeof ctx.upload === 'object' ? ctx.upload : null;
    if (up && up.status === 'queued') return { label: 'Queued', tone: 'neutral', key: 'queued' };
    if (up && (up.status === 'starting' || up.status === 'uploading')) {
      const pct = Math.max(0, Math.min(100, Math.round(Number(up.pct) || 0)));
      return { label: `Uploading ${pct}%`, tone: 'review', key: 'uploading' };
    }
    const m = text(row.master) || masterState(row);
    // Just uploaded: Cloudflare is on it, whatever an older read of the row said.
    if (m === 'processing' || m === 'unknown' || (up && up.status === 'uploaded' && m !== 'ready')) return { label: 'Processing', tone: 'review', key: 'processing' };
    return { label: 'Draft', tone: 'neutral', key: 'draft' };
  }
  if (isWithdrawn(row)) return { label: 'Withdrawn', tone: 'neutral', key: 'withdrawn' };
  if (removalRequested(row)) return { label: 'Pending deletion', tone: 'neutral', key: 'removal' };
  if (isHeld(row)) return { label: 'Pulled', tone: 'danger', key: 'pulled' };
  const st = statusOf(row);
  if (st === 'rejected') return { label: 'Not this time', tone: 'warn', key: 'declined' };
  if (st === 'pending') return { label: 'In review', tone: 'review', key: 'review' };
  if (ctx.showPublic === false) return { label: 'Approved', tone: 'ok', key: 'approved' };
  return { label: 'Live', tone: 'ok', key: 'live' };
}

// --- the owner's preview (decision 2, amendment 5; board V3) ----------------

function sentence(v) {
  const s = text(v);
  if (!s) return '';
  return /[.!?]$/.test(s) ? s : `${s}.`;
}

function capFirst(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

const OPEN_STATES = ['empty', 'drafts', 'review', 'ready', 'live'];

// The words on the preview bar over a page that isn't public: { strong,
// text }. scope 'show' | 'episode'; role 'owner' | 'contributor' | 'team'
// (an owner who is also on the team is 'owner'; on an episode, its
// uploader counts as 'owner'); state / headline = showState(...).key /
// .headline (the show's, on an episode too); ownerName = the show owner's
// display name or null; showName = the show's name; episodeStatus,
// held and removal (or deletionRequested) the episode's own; standalone =
// an episode with no show.
export function previewBarWords(args = {}) {
  const a = args && typeof args === 'object' ? args : {};
  const role = a.role === 'team' || a.role === 'contributor' ? a.role : 'owner';
  const ownerName = text(a.ownerName);
  const firstWord = ownerName ? ownerName.split(/\s+/)[0] : null;
  const first = firstWord || 'its owner';
  if (a.scope === 'episode') {
    const held = a.held === true;
    const removal = a.removal === true || a.deletionRequested === true;
    if (held) return { strong: 'Only you and our team can see this page.', text: 'Pulled while our team looks at it.' };
    if (removal) return { strong: 'Only you and our team can see this page.', text: 'Its removal is requested.' };
    const show = text(a.showName);
    const showPublic = a.standalone === true || !show || a.state === 'live';
    const status = text(a.episodeStatus);
    let words;
    if (status === 'pending') {
      words = showPublic ? 'It’s in review. It goes live once it’s approved.' : `It’s in review. Once it’s approved, it goes live when ${show} is made public.`;
    } else if (status === 'approved' && !showPublic) {
      words = `It’s approved. It goes live when ${show} is made public.`;
    } else {
      words = 'It isn’t public yet.';
    }
    return {
      strong: role === 'team' ? 'Only the people on this title and our team can see this page.' : 'Only you can see this page.',
      text: words
    };
  }
  const state = text(a.state);
  const trouble = state === 'pulled' || state === 'removal' || state === 'declined';
  const headlineText = sentence(a.headline);
  if (role === 'owner') {
    if (trouble) {
      return {
        strong: 'Only you and our team can see this.',
        text: state === 'declined' ? `${headlineText} Fix what it needs and resubmit it from your show page.`.trim() : headlineText
      };
    }
    if (state === 'ready') return { strong: 'Only you can see this.', text: 'It goes public when you press Make it public.' };
    return { strong: 'Only you can see this.', text: 'Once an episode is approved, press Make it public when you’re ready.' };
  }
  const strong = role === 'contributor'
    ? 'Only the people working on this show can see this.'
    : `Only ${ownerName || 'its owner'} and our team can see this.`;
  if (trouble) return { strong, text: headlineText };
  return { strong, text: `${capFirst(first)} makes it public when they’re ready.` };
}

function agoWords(t, now) {
  const hours = (now - t) / 3600000;
  if (!(hours >= 0)) return 'just now';
  if (hours < 1) return 'just now';
  if (hours < 24) return `${Math.floor(hours)} h ago`;
  if (hours < 48) return 'yesterday';
  return `${Math.floor(hours / 24)} days ago`;
}

// A preview row's pill and note on the series page (V3): "IN REVIEW ·
// sent 3 h ago", "APPROVED · goes public with the show", "PULLED",
// "REMOVAL REQUESTED"; null for a row that is simply public. The server
// calls this and sends the words, so the page and its hydration agree.
export function previewRowNote(row, now = Date.now()) {
  if (!row || typeof row !== 'object') return null;
  if (isHeld(row)) return { pill: 'Pulled', note: null };
  if (removalRequested(row)) return { pill: 'Removal requested', note: null };
  const st = statusOf(row);
  if (st === 'pending') {
    const t = createdAt(row);
    return { pill: 'In review', note: t === null ? null : `sent ${agoWords(t, typeof now === 'number' ? now : timeOf(now) || Date.now())}` };
  }
  if ((st === 'approved' || st === null) && row.showPublic === false) return { pill: 'Approved', note: 'goes public with the show' };
  return null;
}

// Whether a picked file is the one a draft was made from — the same name
// and size as its upload (or the file the draft was made from, before its
// upload started): "Pick the same file to resume", and files re-picked in
// Add several resume their drafts instead of making new ones.
export function fileMatches(file, row) {
  if (!file || !row || typeof row !== 'object') return false;
  const name = text(file.name);
  const size = Number(file.size);
  if (!name || !Number.isFinite(size)) return false;
  const known = [row.video, row.file].filter((x) => x && typeof x === 'object');
  return known.some((k) => text(k.name) === name && Number(k.bytes) === size);
}
