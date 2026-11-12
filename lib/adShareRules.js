// Ad share (migration 103; Jose, 2026-10-24): the pure maths. The
// impression rows say what each ad play inside each episode cost the
// advertiser; this turns a month of them into one 'ad_share' ledger
// line per title — per title and paid account when the month spans a
// change of who the title pays (slice 3b). Tested by
// `node scripts/test-ad-share.mjs`.
import { dayRangeLabel } from './showRules.js'; // explicit .js so plain Node can run the tests

export const DEFAULT_AD_SHARE_PERCENT = 50;

// A whole percent, 0–100; anything else is the default.
export function normalizeAdSharePercent(v, fallback = DEFAULT_AD_SHARE_PERCENT) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : fallback;
}

export function isPeriod(key) {
  return typeof key === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(key);
}

// The days a period covers, as 'YYYY-MM-DD' (end exclusive).
export function periodDays(period) {
  if (!isPeriod(period)) throw new Error(`Not a period: ${period}`);
  const [y, m] = period.split('-').map(Number);
  const pad = (n) => String(n).padStart(2, '0');
  const next = m === 12 ? `${y + 1}-01` : `${y}-${pad(m + 1)}`;
  return { from: `${period}-01`, to: `${next}-01` };
}

// The months the payout batch looks back over for ad share (a month whose
// 1st couldn't credit it is credited by a later run): `newest` and the
// `count - 1` months before it, oldest first.
export const AD_SHARE_LOOKBACK_MONTHS = 6;
export function lookbackPeriods(newest, count = AD_SHARE_LOOKBACK_MONTHS) {
  if (!isPeriod(newest)) return [];
  const [y, m] = newest.split('-').map(Number);
  const n = Math.max(1, Math.min(24, Math.round(Number(count)) || 1));
  const out = [];
  for (let i = n - 1; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

// One month's result in a few words, for the audit line and the admin page.
//   r = creditAdShare's answer, or { period, error }
const usd = (cents) => `$${(Math.round(Number(cents) || 0) / 100).toFixed(2)}`;
export function adShareMonthWords(r) {
  if (!r || !r.period) return '';
  if (r.error) return `${r.period} failed`;
  if (r.skipped === 'period not over') return `${r.period} not over`;
  if (r.available === false) return `${r.period} no ad plays table`;
  if (r.inserted > 0) return `${r.period} ${usd(r.totalCents)} to ${r.creators || 0} creator${r.creators === 1 ? '' : 's'}`;
  if (r.alreadyCredited > 0) return `${r.period} nothing new`;
  return `${r.period} no ad plays`;
}

// The batch's whole ad share step (lib/adShare.js creditAdShareMonths:
// { months: [result…] }, or one month's result) as "ad share 2026-05
// nothing new · 2026-06 $12.34 to 3 creators · …".
export function adShareAuditWords(adShare) {
  if (!adShare) return '';
  const months = Array.isArray(adShare.months) ? adShare.months : [adShare];
  const words = months.map(adShareMonthWords).filter(Boolean);
  return words.length ? `ad share ${words.join(' · ')}` : '';
}

export function periodLabel(period) {
  const [y, m] = String(period).split('-').map(Number);
  if (!y || !m) return String(period);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

// rows: [{ episode_id, day, impressions, credit_cents }] for one period
// (any number per episode: one per ad per surface per day).
// episodes: { [id]: { id, title, creatorId, contentType } }.
// payeeOn(episodeId, day) → who the title paid that day (slice 3b: the
// account in force at 00:00 UTC, lib/payees.js); default the title's
// creatorId. A month whose plays fall to more than one account is split
// into one line per account ("segment"), each noted with its days; the
// line carries `split` and `segmentPayee`, which the server strips.
// Skipped: an unknown episode, a podcast (its ads are the creator's own,
// or the studio's later), a segment with no payee, a payee in
// `excludeCreators` (full admins: a studio-owned title keeps everything;
// creators who left: no new credits). Cents are floored, never rounded
// up, so the studio can't credit more than the advertiser paid.
export function adShareLines({ rows, episodes, percent, period, createdBy = 'cron', payeeOn = null }, { excludeCreators = new Set() } = {}) {
  const pct = normalizeAdSharePercent(percent);
  const payeeFor = typeof payeeOn === 'function' ? payeeOn : (id) => (episodes && episodes[id] ? episodes[id].creatorId || null : null);
  const byEpisode = new Map();
  for (const r of rows || []) {
    if (!r || !r.episode_id) continue;
    const cur = byEpisode.get(r.episode_id) || { impressions: 0, creditCents: 0, rows: [] };
    cur.impressions += Math.max(0, Math.round(Number(r.impressions) || 0));
    cur.creditCents += Math.max(0, Number(r.credit_cents) || 0);
    cur.rows.push(r);
    byEpisode.set(r.episode_id, cur);
  }
  const lines = [];
  const skipped = [];
  let impressions = 0;
  let creditCents = 0;
  for (const [episodeId, agg] of [...byEpisode.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    impressions += agg.impressions;
    creditCents += agg.creditCents;
    const ep = episodes && episodes[episodeId];
    if (!ep) { skipped.push({ episodeId, reason: 'no such title' }); continue; }
    if (ep.contentType === 'podcast') { skipped.push({ episodeId, reason: 'podcast' }); continue; }
    // The month's plays, by who the title paid on the day they played.
    const segments = new Map();
    for (const r of agg.rows) {
      const payee = payeeFor(episodeId, r.day) || null;
      const key = payee || '';
      const seg = segments.get(key) || { payee, impressions: 0, creditCents: 0, firstDay: null, lastDay: null };
      seg.impressions += Math.max(0, Math.round(Number(r.impressions) || 0));
      seg.creditCents += Math.max(0, Number(r.credit_cents) || 0);
      const day = typeof r.day === 'string' ? r.day.slice(0, 10) : null;
      if (day && (!seg.firstDay || day < seg.firstDay)) seg.firstDay = day;
      if (day && (!seg.lastDay || day > seg.lastDay)) seg.lastDay = day;
      segments.set(key, seg);
    }
    const split = segments.size > 1;
    // The days each payee was paid for, as runs of days in a row: a title
    // paid to Mara, then Pat, then Mara again reads "Oct 15–19, Oct 26–31"
    // for Mara, never one range across Pat's days.
    const runs = new Map();
    let lastKey = null;
    for (const day of [...new Set(agg.rows.map((r) => (typeof r.day === 'string' ? r.day.slice(0, 10) : null)).filter(Boolean))].sort()) {
      const key = payeeFor(episodeId, day) || '';
      if (!runs.has(key)) runs.set(key, []);
      const list = runs.get(key);
      if (key === lastKey && list.length) list[list.length - 1][1] = day;
      else list.push([day, day]);
      lastKey = key;
    }
    const ordered = [...segments.values()].sort((a, b) => String(a.firstDay || '').localeCompare(String(b.firstDay || '')));
    for (const seg of ordered) {
      if (!seg.payee) { skipped.push({ episodeId, reason: 'no creator', ...(split ? { split: true } : {}) }); continue; }
      if (excludeCreators.has(seg.payee)) { skipped.push({ episodeId, reason: 'creator excluded', ...(split ? { split: true, payeeId: seg.payee } : {}) }); continue; }
      const cents = Math.floor((seg.creditCents * pct) / 100);
      if (cents <= 0) { skipped.push({ episodeId, reason: 'under a cent', ...(split ? { split: true, payeeId: seg.payee } : {}) }); continue; }
      const range = split ? (runs.get(seg.payee) || [[seg.firstDay, seg.lastDay]]).map(([a, b]) => dayRangeLabel(a, b)).join(', ') : null;
      lines.push({
        creator_id: seg.payee,
        lane: 'earnings',
        kind: 'ad_share',
        cents,
        moves_money: true,
        basis: null,
        episode_id: episodeId,
        units: seg.impressions,
        period,
        note: `${ep.title || 'A title'} · ${seg.impressions.toLocaleString('en-US')} ad${seg.impressions === 1 ? '' : 's'} · ${periodLabel(period)}${range ? ` (${range})` : ''}`,
        created_by: createdBy,
        split,
        segmentPayee: seg.payee
      });
    }
  }
  return {
    lines,
    skipped,
    percent: pct,
    impressions,
    creditCents: Math.round(creditCents),
    totalCents: lines.reduce((s, l) => s + l.cents, 0)
  };
}

// Where an ad played, for the impression pixel: the pre-roll before a
// title, a break of an ad plan on demand, or a live channel break.
export const SURFACES = ['preroll', 'vod', 'live'];
export function normalizeSurface(v, fallback = 'preroll') {
  return SURFACES.includes(v) ? v : fallback;
}
