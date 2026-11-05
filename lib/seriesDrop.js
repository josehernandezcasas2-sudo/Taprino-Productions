import { getSupabase } from './supabase';
import { internalError } from './apiErrors';
import { getStripe, isStripeConfigured } from './stripe';
import { sendEmail } from './notify';
import { firstInWindow, releaseWindow } from './rateLimit';
import { isTitleId } from './titleIds';
import { FULL_ADMIN_LINE } from './showAdminRules';
import { ShowError, auditWords, readShowRow } from './showPage';
import { recordAudit } from './auditLog';

// SERVER-ONLY. Telling the people who saved a show about its new episodes
// (the series revamp, slice 3a: mockups/series-slice3a-contract.md §4.3).
// Saved shows live in Stripe customer metadata (`wishlist`, comma-separated
// ids — the same list My List writes), so finding the savers means paging
// through customers; a run checks at most SAVER_CUSTOMERS_PER_RUN of them
// and keeps its place (a cursor) for the next run.
//
//   runSaverStep({ now })   the daily step in /api/cron/expire-content
//   tellSaversNow(id, rc)   Admin → Shows → the show → Decisions → Tell savers
//
// Where the place is kept: migration 118's series_drop_runs. A show's own
// row holds the newest release it has announced (last_episode_seen) and,
// for the button's one-show pass, its cursor; the sentinel row
// series_id = '__pass__' holds the daily pass in progress as JSON in
// customer_cursor: { after: "<cus id>", shows: ["…"], until: "<iso>" }.
// A database without the table runs one capped pass a day over the last
// 36 hours with no cursor; the weekly per-customer window below keeps
// anyone from being mailed twice about one show.

export const SAVER_CUSTOMERS_PER_RUN = Number(process.env.SERIES_DROP_MAX_CUSTOMERS) || 1000;
export const PASS_ROW = '__pass__';
const FIRST_MARK_MS = 36 * 60 * 60 * 1000;
const WEEK_SECONDS = 7 * 24 * 60 * 60;
const DAY_SECONDS = 24 * 60 * 60;
const SITE_ORIGIN = 'https://www.studiotapatv.site';

// The env is read on each run (the stand-in suite sets it per run).
function perRun() {
  return Number(process.env.SERIES_DROP_MAX_CUSTOMERS) || SAVER_CUSTOMERS_PER_RUN;
}

export function isMissingSeriesDropTable(error) {
  return Boolean(error) && (error.code === 'PGRST205' || error.code === '42P01' || /series_drop_runs/i.test(error.message || ''));
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function parseCursor(raw) {
  if (!raw || typeof raw !== 'string') return null;
  try {
    const c = JSON.parse(raw);
    if (!c || typeof c !== 'object' || !Array.isArray(c.shows) || !c.until) return null;
    const shows = c.shows.filter((id) => typeof id === 'string' && isTitleId(id));
    if (shows.length === 0 || !Number.isFinite(Date.parse(c.until))) return null;
    return { after: typeof c.after === 'string' && /^cus_[A-Za-z0-9]+$/.test(c.after) ? c.after : null, shows, until: new Date(c.until).toISOString() };
  } catch (err) {
    return null;
  }
}

// Every series_drop_runs row, or null when the table isn't there.
async function readRuns() {
  const { data, error } = await getSupabase().from('series_drop_runs').select('*');
  if (error) {
    if (isMissingSeriesDropTable(error)) return null;
    throw internalError(error, 'seriesDrop runs');
  }
  return new Map((data || []).map((r) => [r.series_id, r]));
}

async function writeRun(seriesId, patch) {
  const { error } = await getSupabase().from('series_drop_runs')
    .upsert({ series_id: seriesId, ...patch, updated_at: new Date().toISOString() }, { onConflict: 'series_id' });
  if (error && !isMissingSeriesDropTable(error)) throw internalError(error, 'seriesDrop write');
}

function isPublic(show) {
  return Boolean(show) && (show.status === 'approved' || !show.status) && !show.moderation_hold && !show.deletion_requested && !show.withdrawn_at;
}

async function publicShows(ids = null) {
  let q = getSupabase().from('series').select('*').eq('status', 'approved');
  if (ids) q = q.in('id', ids);
  const { data, error } = await q;
  if (error) throw internalError(error, 'seriesDrop shows');
  return (data || []).filter(isPublic);
}

function markOf(runs, seriesId, now) {
  const row = runs ? runs.get(seriesId) : null;
  const t = row && row.last_episode_seen ? Date.parse(row.last_episode_seen) : NaN;
  return Number.isFinite(t) ? t : now - FIRST_MARK_MS;
}

// The new episodes of each show: approved, in its running order, not
// pulled, withdrawn or on its way out, released after the show's mark and
// by `until`, and out (available_from empty or past).
//   → Map(seriesId → count)
async function newEpisodeCounts(shows, runs, untilMs, nowMs) {
  const out = new Map();
  if (shows.length === 0) return out;
  const marks = new Map(shows.map((s) => [s.id, markOf(runs, s.id, nowMs)]));
  const earliest = Math.min(...marks.values());
  const supabase = getSupabase();
  for (let i = 0; i < shows.length; i += 100) {
    const ids = shows.slice(i, i + 100).map((s) => s.id);
    const { data, error } = await supabase.from('episodes')
      .select('id, series_id, content_type, status, moderation_hold, withdrawn_at, deletion_requested, released_at, available_from')
      .in('series_id', ids)
      .eq('status', 'approved')
      .gt('released_at', new Date(earliest).toISOString())
      .lte('released_at', new Date(untilMs).toISOString());
    if (error) throw internalError(error, 'seriesDrop episodes');
    for (const e of data || []) {
      if (e.content_type !== 'series' && e.content_type !== 'podcast') continue;
      if (e.moderation_hold || e.withdrawn_at || e.deletion_requested) continue;
      const released = Date.parse(e.released_at || '');
      if (!Number.isFinite(released) || released <= marks.get(e.series_id) || released > untilMs) continue;
      const from = e.available_from ? Date.parse(e.available_from) : NaN;
      if (Number.isFinite(from) && from > nowMs) continue;
      out.set(e.series_id, (out.get(e.series_id) || 0) + 1);
    }
  }
  return out;
}

function showLink(show) {
  return show.kind === 'podcast' ? `${SITE_ORIGIN}/podcasts/${encodeURIComponent(show.id)}` : `${SITE_ORIGIN}/series/${encodeURIComponent(show.id)}`;
}

function mailFor(list) {
  const one = list.length === 1 ? list[0] : null;
  const subject = one
    ? (one.count === 1 ? `A new episode of ${one.name}` : `${one.count} new episodes of ${one.name}`)
    : `New episodes of ${list.length} shows you saved`;
  const lines = list.map((s) => `<p><strong>${escapeHtml(s.name)}</strong> — ${s.count === 1 ? '1 new episode' : `${s.count} new episodes`}<br><a href="${escapeHtml(s.href)}">${escapeHtml(s.href)}</a></p>`);
  const html = `${lines.join('')}<p style="color:#888">You saved these on Studio Tapa TV. Take a show off My List to stop these: <a href="${SITE_ORIGIN}/wishlist">${SITE_ORIGIN}/wishlist</a></p>`;
  return { subject: subject.slice(0, 200), html };
}

// One pass over Stripe's customers from `after`, at most `max` of them.
//   shows = [{ id, name, count, href }]
async function sendPass(shows, after, max) {
  let checked = 0;
  let matched = 0;
  let sent = 0;
  let cursor = after || null;
  let finished = false;
  const byId = new Map(shows.map((s) => [s.id, s]));
  while (checked < max) {
    const limit = Math.max(1, Math.min(100, max - checked));
    const page = await getStripe().customers.list({ limit, ...(cursor ? { starting_after: cursor } : {}) });
    const data = (page && page.data) || [];
    for (const c of data) {
      checked += 1;
      cursor = c.id;
      const meta = c.metadata || {};
      if (!c.email || meta.newsletter === 'opted_out') continue;
      const saved = String(meta.wishlist || '').split(',').map((x) => x.trim()).filter(Boolean);
      const hits = saved.filter((id, i) => byId.has(id) && saved.indexOf(id) === i).map((id) => byId.get(id));
      if (hits.length === 0) continue;
      matched += 1;
      const due = [];
      for (const s of hits) if (await firstInWindow(`series-drop-mail:${s.id}:${c.id}`, WEEK_SECONDS)) due.push(s);
      if (due.length === 0) continue;
      const mail = mailFor(due);
      const res = await sendEmail({ to: c.email, subject: mail.subject, html: mail.html });
      if (res && (res.sent || res.skipped)) sent += 1;
    }
    if (!page || !page.has_more || data.length === 0) {
      finished = true;
      break;
    }
  }
  return { checked, matched, sent, finished, cursor };
}

async function showsForMail(ids, runs, untilMs, nowMs) {
  const shows = await publicShows(ids);
  const counts = await newEpisodeCounts(shows, runs, untilMs, nowMs);
  return shows.filter((s) => counts.get(s.id) > 0).map((s) => ({ id: s.id, name: s.name || 'A show you saved', count: counts.get(s.id), href: showLink(s) }));
}

// The cron's daily step: a pass in progress continues; else a new pass
// over every public show with new episodes.
//   → { ok, shows, checked, matched, sent, finished }
export async function runSaverStep({ now = Date.now() } = {}) {
  if (!isStripeConfigured()) return { ok: true, shows: [], checked: 0, matched: 0, sent: 0, finished: true, skipped: 'no-stripe' };
  const nowMs = typeof now === 'number' ? now : Date.parse(now) || Date.now();
  const runs = await readRuns();
  const max = perRun();
  if (!runs) {
    // No series_drop_runs: one capped pass over the last 36 hours.
    const shows = await showsForMail(null, null, nowMs, nowMs);
    if (shows.length === 0) return { ok: true, shows: [], checked: 0, matched: 0, sent: 0, finished: true };
    const r = await sendPass(shows, null, max);
    return { ok: true, shows: shows.map((s) => s.id), checked: r.checked, matched: r.matched, sent: r.sent, finished: r.finished };
  }
  let pass = parseCursor(runs.get(PASS_ROW) ? runs.get(PASS_ROW).customer_cursor : null);
  if (!pass) {
    const shows = await showsForMail(null, runs, nowMs, nowMs);
    if (shows.length === 0) return { ok: true, shows: [], checked: 0, matched: 0, sent: 0, finished: true };
    pass = { after: null, shows: shows.map((s) => s.id), until: new Date(nowMs).toISOString() };
  }
  const untilMs = Date.parse(pass.until);
  const shows = await showsForMail(pass.shows, runs, untilMs, nowMs);
  const r = shows.length > 0 ? await sendPass(shows, pass.after, max) : { checked: 0, matched: 0, sent: 0, finished: true, cursor: null };
  if (r.finished) {
    for (const id of pass.shows) await writeRun(id, { last_episode_seen: pass.until });
    await writeRun(PASS_ROW, { customer_cursor: null, last_episode_seen: pass.until });
  } else {
    await writeRun(PASS_ROW, { customer_cursor: JSON.stringify({ after: r.cursor, shows: pass.shows, until: pass.until }) });
  }
  return { ok: true, shows: pass.shows, checked: r.checked, matched: r.matched, sent: r.sent, finished: r.finished };
}

// When a show's savers were last told (its row's mark, by the cron or the
// button), or null.
export async function lastToldAt(showId) {
  const { data, error } = await getSupabase().from('series_drop_runs').select('series_id, last_episode_seen, updated_at').eq('series_id', showId).maybeSingle();
  if (error || !data || !data.last_episode_seen) return null;
  return data.updated_at || data.last_episode_seen;
}

// "Tell savers" (a full admin): one capped pass for one public show, its
// own cursor in its row. Once a day per show.
//   → { ok, checked, matched, sent, finished, lastToldAt }
export async function tellSaversNow(showId, rc = {}) {
  if (!rc || rc.isAdmin !== true) throw new ShowError(FULL_ADMIN_LINE, 403, { code: 'full-admin' });
  if (!isTitleId(String(showId || ''))) throw new ShowError('That show isn’t there.', 404);
  const show = await readShowRow(String(showId), 'tellSavers show');
  if (!show) throw new ShowError('That show isn’t there.', 404);
  if (!isPublic(show)) throw new ShowError('Only a public show has savers to tell.', 409, { code: 'not-public' });
  // Saved shows live in Stripe's customer records: nothing to read without it.
  if (!isStripeConfigured()) throw new ShowError('Saved shows are kept in Stripe, which isn’t set up here.', 503, { code: 'no-stripe' });
  // The day's slot is taken first (two presses at once send one pass) and
  // given back when no pass ran: nothing new, or Stripe (or the database)
  // failing — its own words are logged, never shown.
  const slot = `series-drop-tell:${show.id}`;
  if (!(await firstInWindow(slot, DAY_SECONDS))) throw new ShowError('Its savers were told less than a day ago.', 429, { code: 'told-today' });
  let pass;
  let shows;
  let runs;
  let r;
  try {
    const nowMs = Date.now();
    runs = await readRuns();
    const row = runs ? runs.get(show.id) : null;
    const own = parseCursor(row ? row.customer_cursor : null);
    pass = own && own.shows.length === 1 && own.shows[0] === show.id ? own : { after: null, shows: [show.id], until: new Date(nowMs).toISOString() };
    shows = await showsForMail([show.id], runs, Date.parse(pass.until), nowMs);
    if (shows.length === 0) throw new ShowError('Nothing new since its savers were last told.', 409, { code: 'nothing-new' });
    r = await sendPass(shows, pass.after, perRun());
  } catch (err) {
    await releaseWindow(slot);
    if (err instanceof ShowError) throw err;
    throw internalError(err, 'tell savers');
  }
  if (runs) {
    if (r.finished) await writeRun(show.id, { last_episode_seen: pass.until, customer_cursor: null });
    else await writeRun(show.id, { customer_cursor: JSON.stringify({ after: r.cursor, shows: [show.id], until: pass.until }) });
  }
  const told = new Date().toISOString();
  await recordAudit({
    adminId: rc.userId || 'system',
    adminEmail: rc.email || null,
    action: 'tell_savers',
    targetType: 'series',
    targetId: show.id,
    details: auditWords('admin', `${show.name || show.id}: told ${r.matched} ${r.matched === 1 ? 'person' : 'people'} who saved it (${r.checked} checked${r.finished ? '' : ', more next time'})`, { checked: r.checked, matched: r.matched, sent: r.sent, finished: r.finished })
  });
  return { ok: true, checked: r.checked, matched: r.matched, sent: r.sent, finished: r.finished, lastToldAt: told };
}
