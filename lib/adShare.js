import { createHash } from 'node:crypto';
import { getSupabase } from './supabase';
import { getShareSettings } from './artistSupport';
import { getStandingMap } from './creatorStanding';
import { getUserRole } from './roles';
import { adShareLines, periodDays } from './adShareRules';

// SERVER-ONLY. Ad share (migration 103; Jose, 2026-10-24): on the 1st,
// before the payout batch pays anyone, the month before is credited:
// every ad_impression_days row of that month is grouped by the episode
// the ad played in, the title's creator gets ad_share_percent of the
// credit those plays cost the advertiser, as one 'ad_share' line per
// title (lib/adShareRules.js). A line's id is derived from the title and
// the month, so running twice credits nothing twice. Skipped: podcasts
// (their ads are the creator's own; the studio's audio ads come later),
// studio-owned titles (the creator is a full admin), creators who left
// (creator_standing.left_at), a title with no creator.

const PAGE = 1000;
const isMissingTable = (error) => Boolean(error && /could not find the table|relation .* does not exist|PGRST205/i.test(error.message || ''));

// A stable uuid for (episode, period): sha1 laid out as a version-5-style uuid.
export function adShareLineId(episodeId, period) {
  const h = createHash('sha1').update(`ad_share:${episodeId}:${period}`).digest('hex');
  const v = ((parseInt(h[16], 16) & 3) | 8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${v}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

async function impressionRows(period) {
  const { from, to } = periodDays(period);
  const rows = [];
  for (let start = 0; ; start += PAGE) {
    const { data, error } = await getSupabase()
      .from('ad_impression_days')
      .select('episode_id, impressions, credit_cents')
      .gte('day', from)
      .lt('day', to)
      .gt('credit_cents', 0)
      .order('episode_id', { ascending: true })
      .range(start, start + PAGE - 1);
    if (error) {
      if (isMissingTable(error)) return null;
      throw new Error(`ad_impression_days read failed: ${error.message}`);
    }
    rows.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

// Title → creator. An episode's creator is who submitted it; a series
// episode without one falls back to the series' owner.
async function episodesFor(ids) {
  const out = {};
  if (!ids.length) return out;
  const supabase = getSupabase();
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const { data, error } = await supabase.from('episodes').select('id, title, submitted_by, content_type, series_id').in('id', chunk);
    if (error) throw new Error(`episodes read failed: ${error.message}`);
    for (const e of data || []) out[e.id] = { id: e.id, title: e.title, creatorId: e.submitted_by || null, contentType: e.content_type || null, seriesId: e.series_id || null };
  }
  const seriesIds = [...new Set(Object.values(out).filter((e) => !e.creatorId && e.seriesId).map((e) => e.seriesId))];
  if (seriesIds.length) {
    const { data } = await supabase.from('series').select('id, creator_id').in('id', seriesIds);
    const owner = Object.fromEntries((data || []).map((s) => [s.id, s.creator_id]));
    for (const e of Object.values(out)) if (!e.creatorId && e.seriesId && owner[e.seriesId]) e.creatorId = owner[e.seriesId];
  }
  return out;
}

// Full admins (studio-owned titles) and creators who left earn nothing.
async function excludedCreators(creatorIds) {
  const out = new Set();
  if (!creatorIds.length) return out;
  const [standing, roles] = await Promise.all([
    getStandingMap(creatorIds).catch(() => ({})),
    Promise.all(creatorIds.map((id) => getUserRole(id).catch(() => null)))
  ]);
  creatorIds.forEach((id, i) => {
    if (roles[i] === 'admin') out.add(id);
    if (standing[id] && standing[id].left_at) out.add(id);
  });
  return out;
}

// Credits one month. Returns what happened; never throws past a read
// error, so the payout batch can go on without it. Only a month that is
// over (security round 2, 2026-10-28): a batch run by hand mid-month
// used to credit the month's first half under the (title, month) id, and
// the 1st then found every id taken and never credited the second half.
export async function creditAdShare({ period, createdBy = 'cron', now = new Date() }) {
  const { to } = periodDays(period);
  if (to > now.toISOString().slice(0, 10)) return { period, available: true, skipped: 'period not over', inserted: 0, alreadyCredited: 0, totalCents: 0, impressions: 0, creditCents: 0, skippedTitles: [] };
  const rows = await impressionRows(period);
  if (rows === null) return { period, available: false, inserted: 0, alreadyCredited: 0, totalCents: 0, impressions: 0, creditCents: 0, skipped: [] };
  if (!rows.length) return { period, available: true, inserted: 0, alreadyCredited: 0, totalCents: 0, impressions: 0, creditCents: 0, skipped: [] };
  const settings = await getShareSettings();
  const episodes = await episodesFor([...new Set(rows.map((r) => r.episode_id).filter(Boolean))]);
  const creatorIds = [...new Set(Object.values(episodes).map((e) => e.creatorId).filter(Boolean))];
  const excluded = await excludedCreators(creatorIds);
  const planned = adShareLines({ rows, episodes, percent: settings.adSharePercent, period, createdBy }, { excludeCreators: excluded });
  const withIds = planned.lines.map((l) => ({ ...l, id: adShareLineId(l.episode_id, period) }));

  const supabase = getSupabase();
  const ids = withIds.map((l) => l.id);
  const existing = new Set();
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await supabase.from('creator_ledger').select('id').in('id', ids.slice(i, i + 200));
    if (error) throw new Error(`creator_ledger read failed: ${error.message}`);
    for (const r of data || []) existing.add(r.id);
  }
  const fresh = withIds.filter((l) => !existing.has(l.id));
  for (let i = 0; i < fresh.length; i += 500) {
    const { error } = await supabase.from('creator_ledger').insert(fresh.slice(i, i + 500));
    if (error) throw new Error(`creator_ledger insert failed: ${error.message}`);
  }
  return {
    period,
    available: true,
    percent: planned.percent,
    inserted: fresh.length,
    alreadyCredited: withIds.length - fresh.length,
    totalCents: fresh.reduce((s, l) => s + l.cents, 0),
    impressions: planned.impressions,
    creditCents: planned.creditCents,
    creators: new Set(fresh.map((l) => l.creator_id)).size,
    skipped: planned.skipped
  };
}

// What this month holds so far, for the admin page: plays and credit
// served inside titles, and what the share would be at today's percent.
export async function adShareSoFar(period) {
  const rows = await impressionRows(period);
  if (rows === null) return { available: false };
  const settings = await getShareSettings();
  const impressions = rows.reduce((s, r) => s + (Number(r.impressions) || 0), 0);
  const creditCents = rows.reduce((s, r) => s + (Number(r.credit_cents) || 0), 0);
  return { available: true, period, impressions, creditCents: Math.round(creditCents), shareCents: Math.floor((creditCents * settings.adSharePercent) / 100), titles: new Set(rows.map((r) => r.episode_id)).size };
}
