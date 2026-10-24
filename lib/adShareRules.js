// Ad share (migration 103; Jose, 2026-10-24): the pure maths. The
// impression rows say what each ad play inside each episode cost the
// advertiser; this turns a month of them into one 'ad_share' ledger
// line per title. Tested by `node scripts/test-ad-share.mjs`.

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

export function periodLabel(period) {
  const [y, m] = String(period).split('-').map(Number);
  if (!y || !m) return String(period);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

// rows: [{ episode_id, impressions, credit_cents }] for one period (any
// number per episode: one per ad per surface per day).
// episodes: { [id]: { id, title, creatorId, contentType } }.
// Skipped: an unknown episode, a title with no creator, a podcast (its
// ads are the creator's own, or the studio's later), a creator in
// `excludeCreators` (full admins: a studio-owned title keeps everything;
// creators who left: no new credits). Cents are floored, never rounded
// up, so the studio can't credit more than the advertiser paid.
export function adShareLines({ rows, episodes, percent, period, createdBy = 'cron' }, { excludeCreators = new Set() } = {}) {
  const pct = normalizeAdSharePercent(percent);
  const byEpisode = new Map();
  for (const r of rows || []) {
    if (!r || !r.episode_id) continue;
    const cur = byEpisode.get(r.episode_id) || { impressions: 0, creditCents: 0 };
    cur.impressions += Math.max(0, Math.round(Number(r.impressions) || 0));
    cur.creditCents += Math.max(0, Number(r.credit_cents) || 0);
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
    if (!ep.creatorId) { skipped.push({ episodeId, reason: 'no creator' }); continue; }
    if (ep.contentType === 'podcast') { skipped.push({ episodeId, reason: 'podcast' }); continue; }
    if (excludeCreators.has(ep.creatorId)) { skipped.push({ episodeId, reason: 'creator excluded' }); continue; }
    const cents = Math.floor((agg.creditCents * pct) / 100);
    if (cents <= 0) { skipped.push({ episodeId, reason: 'under a cent' }); continue; }
    lines.push({
      creator_id: ep.creatorId,
      lane: 'earnings',
      kind: 'ad_share',
      cents,
      moves_money: true,
      basis: null,
      episode_id: episodeId,
      units: agg.impressions,
      period,
      note: `${ep.title || 'A title'} · ${agg.impressions.toLocaleString('en-US')} ad${agg.impressions === 1 ? '' : 's'} · ${periodLabel(period)}`,
      created_by: createdBy
    });
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
