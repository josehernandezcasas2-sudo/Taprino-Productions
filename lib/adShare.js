import { createHash } from 'node:crypto';
import { getSupabase } from './supabase';
import { getShareSettings } from './artistSupport';
import { getStandingMap } from './creatorStanding';
import { adShareLines, periodDays } from './adShareRules';
import { payeeOnDay, payeeShowOf, readPayeeContext, studioAccountsAmong } from './payees';

// SERVER-ONLY. Ad share (migration 103; Jose, 2026-10-24): on the 1st,
// before the payout batch pays anyone, the month before is credited:
// every ad_impression_days row of that month is grouped by the episode
// the ad played in, the title's paid account gets ad_share_percent of the
// credit those plays cost the advertiser, as one 'ad_share' line per
// title (lib/adShareRules.js). Since slice 3b a day's plays belong to the
// account the title paid at 00:00 UTC that day (lib/payees.js: before the
// cut-over the uploader, else the show's owner; from it the title's paid
// account, read through its history), so a month that spans a change
// becomes one line per account. A month with one account keeps the old
// (title, month) id; a split month's lines are (title, month, account);
// and any ad_share line already there for a (title, month), whatever its
// id, skips that title's month — running twice credits nothing twice.
// Skipped: podcasts (their ads are the creator's own; the studio's audio
// ads come later), studio-owned titles (paid to a full admin), creators
// who left (creator_standing.left_at), a title with nobody to pay.

const PAGE = 1000;
const isMissingTable = (error) => Boolean(error && /could not find the table|relation .* does not exist|PGRST205/i.test(error.message || ''));

// A stable uuid for (episode, period) — or (episode, period, payee) for a
// month split between accounts: sha1 laid out as a version-5-style uuid.
export function adShareLineId(episodeId, period, payeeId = null) {
  const h = createHash('sha1').update(payeeId ? `ad_share:${episodeId}:${period}:${payeeId}` : `ad_share:${episodeId}:${period}`).digest('hex');
  const v = ((parseInt(h[16], 16) & 3) | 8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${v}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

async function impressionRows(period) {
  const { from, to } = periodDays(period);
  const rows = [];
  for (let start = 0; ; start += PAGE) {
    const { data, error } = await getSupabase()
      .from('ad_impression_days')
      .select('episode_id, day, impressions, credit_cents')
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

// The titles, as adShareLines reads them, from a payee context
// (lib/payees.js readPayeeContext). creatorId is the old rule's payee (the
// uploader, else the show's owner), for anything that reads it. The show is
// the one its money follows (an extra's through bonus_parent_*: extras
// follow their show, Jose 2026-11-06).
function episodesOf(ctx, ownerId = null) {
  const out = {};
  for (const e of ctx.episodes.values()) {
    const show = payeeShowOf(ctx, e.id);
    out[e.id] = { id: e.id, title: e.title, creatorId: e.submitted_by || (show && show.creator_id) || ownerId || null, contentType: e.content_type || null, seriesId: show ? show.id : e.series_id || null };
  }
  return out;
}

// Who each play's day paid: the payee at 00:00 UTC of that day.
function payeeOnFor(ctx, ownerId = null) {
  return (episodeId, day) => payeeOnDay(ctx, episodeId, day) || ownerId || null;
}

// The (title, month)s that already have an ad_share line, whatever its id
// (a month credited before slice 3b, or by the removal path).
async function creditedEpisodes(period, episodeIds) {
  const done = new Set();
  const ids = [...new Set(episodeIds.filter(Boolean))];
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await getSupabase().from('creator_ledger').select('episode_id').eq('kind', 'ad_share').eq('period', period).in('episode_id', ids.slice(i, i + 200));
    if (error) {
      if (isMissingTable(error)) return done;
      throw new Error(`creator_ledger read failed: ${error.message}`);
    }
    for (const r of data || []) if (r.episode_id) done.add(r.episode_id);
  }
  return done;
}

// Plans a month's lines with their ids and the guard applied:
//   → { planned, lines (to insert, without split/segmentPayee), already, split }
async function planMonth({ rows, ctx, period, percent, createdBy, ownerId = null }) {
  const payeeOn = payeeOnFor(ctx, ownerId);
  const episodes = episodesOf(ctx, ownerId);
  const payees = [...new Set(rows.map((r) => payeeOn(r.episode_id, r.day)).filter(Boolean))];
  const excluded = await excludedCreators(payees);
  const planned = adShareLines({ rows, episodes, percent, period, createdBy, payeeOn }, { excludeCreators: excluded });
  const done = await creditedEpisodes(period, planned.lines.map((l) => l.episode_id));
  let already = 0;
  const withIds = [];
  for (const l of planned.lines) {
    if (done.has(l.episode_id)) {
      already += 1;
      continue;
    }
    const { split, segmentPayee, ...line } = l;
    withIds.push({ ...line, id: split ? adShareLineId(l.episode_id, period, segmentPayee) : adShareLineId(l.episode_id, period) });
  }
  const split = new Set(planned.lines.filter((l) => l.split).map((l) => l.episode_id)).size;
  return { planned, lines: withIds, already, split };
}

// Full admins (studio-owned titles) and creators who left earn nothing.
// Both reads are strict: one that fails throws (the month isn't credited;
// the batch reports it and a later run that month credits it) — never a
// month's ad share credited to a leaver, or to a studio account, because
// who left or who is on the team couldn't be read. The team is asked of
// Clerk 100 accounts at a time (lib/payees.js studioAccountsAmong), not
// one call per payee.
async function excludedCreators(creatorIds) {
  const out = new Set();
  if (!creatorIds.length) return out;
  const [standing, studio] = await Promise.all([
    getStandingMap(creatorIds, { strict: true }),
    studioAccountsAmong(creatorIds, { strict: true })
  ]);
  for (const id of creatorIds) {
    if (studio.has(id)) out.add(id);
    if (standing[id] && standing[id].left_at) out.add(id);
  }
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
  const ctx = await readPayeeContext([...new Set(rows.map((r) => r.episode_id).filter(Boolean))]);
  const { planned, lines: withIds, already, split } = await planMonth({ rows, ctx, period, percent: settings.adSharePercent, createdBy });

  const supabase = getSupabase();
  const ids = withIds.map((l) => l.id);
  const existing = new Set();
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await supabase.from('creator_ledger').select('id').in('id', ids.slice(i, i + 200));
    if (error) throw new Error(`creator_ledger read failed: ${error.message}`);
    for (const r of data || []) existing.add(r.id);
  }
  const fresh = withIds.filter((l) => !existing.has(l.id));
  // One insert is one statement: a title's month (all its accounts' lines)
  // never straddles two, so the guard above can't skip half of one.
  const batches = [];
  let batch = [];
  for (const l of fresh) {
    const sameTitle = batch.length && batch[batch.length - 1].episode_id === l.episode_id;
    if (batch.length >= 500 && !sameTitle) {
      batches.push(batch);
      batch = [];
    }
    batch.push(l);
  }
  if (batch.length) batches.push(batch);
  for (const part of batches) {
    const { error } = await supabase.from('creator_ledger').insert(part);
    if (error) throw new Error(`creator_ledger insert failed: ${error.message}`);
  }
  return {
    period,
    available: true,
    percent: planned.percent,
    inserted: fresh.length,
    alreadyCredited: already + withIds.length - fresh.length,
    totalCents: fresh.reduce((s, l) => s + l.cents, 0),
    impressions: planned.impressions,
    creditCents: planned.creditCents,
    creators: new Set(fresh.map((l) => l.creator_id)).size,
    split,
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

// Before titles are deleted for good (a show removed with everything in
// it: lib/showDelete.js; one episode's confirmed removal:
// pages/api/admin/resolve-deletion.js): their ad plays in every month not
// credited yet are credited now. Once a title's row is gone the 1st's run
// can't tell whose they were ("no such title") and the share would be
// lost, though the advertiser was charged. Their plays are final — a
// deleted title plays nothing more — so crediting the current month early
// takes nothing from it; the lines are split by who the title paid each
// day and carry the same ids the 1st's run would, and a (title, month)
// with any ad_share line already is skipped, so nothing is credited twice.
//   rows = the episode rows about to go (select('*')); series = their show
//   (its row, read before it goes); ownerId = the show's creator, the last
//   fallback for an episode with nobody else to pay.
//   → { available, inserted, totalCents } — throws on a read or write error.
export async function creditAdShareBeforeDelete(rows, { series = null, ownerId = null, createdBy = 'removal' } = {}) {
  const list = (rows || []).filter((r) => r && r.id);
  if (!list.length) return { available: true, inserted: 0, totalCents: 0 };
  const supabase = getSupabase();
  const ids = list.map((r) => r.id);
  const plays = [];
  for (let i = 0; i < ids.length; i += 100) {
    for (let start = 0; ; start += PAGE) {
      const { data, error } = await supabase.from('ad_impression_days')
        .select('episode_id, day, impressions, credit_cents')
        .in('episode_id', ids.slice(i, i + 100))
        .gt('credit_cents', 0)
        .order('day', { ascending: true })
        .range(start, start + PAGE - 1);
      if (error) {
        if (isMissingTable(error)) return { available: false, inserted: 0, totalCents: 0 };
        throw new Error(`ad_impression_days read failed: ${error.message}`);
      }
      plays.push(...(data || []));
      if (!data || data.length < PAGE) break;
    }
  }
  if (!plays.length) return { available: true, inserted: 0, totalCents: 0 };
  const ctx = await readPayeeContext(ids, { rows: list, series });
  const settings = await getShareSettings();
  const byPeriod = new Map();
  for (const p of plays) {
    const period = String(p.day || '').slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(period)) continue;
    if (!byPeriod.has(period)) byPeriod.set(period, []);
    byPeriod.get(period).push(p);
  }
  let inserted = 0;
  let totalCents = 0;
  for (const [period, periodRows] of byPeriod) {
    const { lines: withIds } = await planMonth({ rows: periodRows, ctx, period, percent: settings.adSharePercent, createdBy, ownerId });
    if (!withIds.length) continue;
    const { data: existing, error } = await supabase.from('creator_ledger').select('id').in('id', withIds.map((l) => l.id));
    if (error && isMissingTable(error)) return { available: false, inserted, totalCents };
    if (error) throw new Error(`creator_ledger read failed: ${error.message}`);
    const have = new Set((existing || []).map((r) => r.id));
    const fresh = withIds.filter((l) => !have.has(l.id));
    if (!fresh.length) continue;
    const { error: insertError } = await supabase.from('creator_ledger').insert(fresh);
    if (insertError) throw new Error(`creator_ledger insert failed: ${insertError.message}`);
    inserted += fresh.length;
    totalCents += fresh.reduce((s, l) => s + l.cents, 0);
  }
  return { available: true, inserted, totalCents };
}
