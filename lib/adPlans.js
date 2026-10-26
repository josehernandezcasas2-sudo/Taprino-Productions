import { getSupabase } from './supabase';
import { parseRuntimeToSeconds } from './videoMetadata';
import { signedSrcForStoredUrl } from './videoSigning';
import { signedImpressionPath } from './adImpressionSig';
import { hasCapability } from './capabilities';
import {
  normalizePlan, defaultPlanFor, airBreaks, airSeconds, adsSeconds, adsPerHour, fillBreak, fitsFor, eligibleCount, selfAdConflicts,
  DEFAULT_SIZES, DEFAULT_RANGES, DEFAULT_ROUND, DEFAULT_HOUR_CAP, FLEX_PRESETS
} from './adPlanRules';

// Episode Ad Curator, server side: the plan rows (migration 087), what can
// fill a break (approved ads, approved channel clips) and the fill itself
// with playable URLs. The rules are in lib/adPlanRules.js. Only a plan
// with status 'ready' ever reaches a player; everything else is the
// curator's business.

export class AdPlanError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
const fail = (message, status = 400) => { throw new AdPlanError(message, status); };

export function isMissingAdPlanTable(err) {
  const msg = String((err && err.message) || err || '');
  return /episode_ad_plans|ad_section_sizes|ad_hour_cap_seconds|ad_break_round_seconds/.test(msg) && /does not exist|not find|schema cache|column/i.test(msg);
}

// Who can curate: full admins, sub-admins who schedule or edit episodes,
// and content schedulers (they run channels, so they shape what airs).
export function canCurate(roleContext) {
  if (!roleContext || !roleContext.userId) return false;
  return !!(roleContext.isAdmin || roleContext.isContentScheduler || hasCapability(roleContext, 'manage_schedule') || hasCapability(roleContext, 'manage_episodes'));
}

/* ---------------- settings ---------------- */

export async function getAdPlanSettings() {
  const out = { sizes: DEFAULT_SIZES, ranges: DEFAULT_RANGES, flexPresets: FLEX_PRESETS, roundTo: DEFAULT_ROUND, hourCapSeconds: DEFAULT_HOUR_CAP };
  try {
    const { data, error } = await getSupabase().from('site_settings').select('ad_section_sizes, ad_hour_cap_seconds, ad_break_round_seconds').eq('id', 1).maybeSingle();
    if (error) throw error;
    if (data) {
      const sizes = Array.isArray(data.ad_section_sizes) ? data.ad_section_sizes.map(Number).filter((n) => Number.isFinite(n) && n >= 3 && n <= 600) : [];
      if (sizes.length) out.sizes = [...new Set(sizes)].sort((a, b) => a - b);
      if (Number(data.ad_hour_cap_seconds) > 0) out.hourCapSeconds = Number(data.ad_hour_cap_seconds);
      if (Number(data.ad_break_round_seconds) > 0) out.roundTo = Number(data.ad_break_round_seconds);
    }
  } catch (err) {
    // Before migration 087 the columns don't exist; the defaults are fine.
    if (!isMissingAdPlanTable(err)) console.error('getAdPlanSettings:', err.message);
  }
  // Ranges follow the size list: each neighbouring pair.
  const s = out.sizes;
  out.ranges = s.length > 1 ? s.slice(0, -1).map((v, i) => [v, s[i + 1]]) : DEFAULT_RANGES;
  return out;
}

/* ---------------- rows ---------------- */

const PLAN_FIELDS = 'episode_id, status, breaks, self_ads, round_to, merge_adjacent, auto_bumper, on_demand, air_seconds, ads_seconds, updated_at';

function rowToPlan(row) {
  return {
    status: row.status,
    breaks: Array.isArray(row.breaks) ? row.breaks : [],
    selfAds: Array.isArray(row.self_ads) ? row.self_ads : [],
    roundTo: row.round_to || DEFAULT_ROUND,
    mergeAdjacent: row.merge_adjacent !== false,
    autoBumper: row.auto_bumper || 'station_id',
    onDemand: row.on_demand !== false,
    airSeconds: row.air_seconds || null,
    adsSeconds: row.ads_seconds || 0,
    updatedAt: row.updated_at || null
  };
}

export async function getPlanRow(episodeId) {
  try {
    const { data, error } = await getSupabase().from('episode_ad_plans').select(PLAN_FIELDS).eq('episode_id', episodeId).maybeSingle();
    if (error) throw error;
    return data ? rowToPlan(data) : null;
  } catch (err) {
    if (isMissingAdPlanTable(err)) return null;
    throw err;
  }
}

// Ready plans for many episodes at once, in the shape the channel engine
// and the players want: { [episodeId]: { breaks (air positions), airSeconds, adsSeconds, onDemand, selfAds } }.
// Only 'ready' rows count; the rest leave the episode as it was.
export async function getReadyPlansByIds(episodeIds) {
  const ids = [...new Set((episodeIds || []).filter(Boolean))];
  const out = {};
  if (!ids.length) return out;
  try {
    const { data, error } = await getSupabase().from('episode_ad_plans').select(PLAN_FIELDS).in('episode_id', ids).eq('status', 'ready');
    if (error) throw error;
    for (const row of data || []) {
      const plan = rowToPlan(row);
      const breaks = airBreaks(plan);
      if (!breaks.length) continue;
      out[row.episode_id] = { breaks, adsSeconds: adsSeconds(plan), roundTo: plan.roundTo, onDemand: plan.onDemand, selfAds: plan.selfAds };
    }
  } catch (err) {
    if (!isMissingAdPlanTable(err)) console.error('getReadyPlansByIds:', err.message);
  }
  return out;
}

// All ready plans (the channel engine loads the whole eligible library).
export async function getAllReadyPlans() {
  const out = {};
  try {
    const { data, error } = await getSupabase().from('episode_ad_plans').select(PLAN_FIELDS).eq('status', 'ready');
    if (error) throw error;
    for (const row of data || []) {
      const plan = rowToPlan(row);
      const breaks = airBreaks(plan);
      if (!breaks.length) continue;
      out[row.episode_id] = { breaks, adsSeconds: adsSeconds(plan), roundTo: plan.roundTo, onDemand: plan.onDemand, selfAds: plan.selfAds };
    }
  } catch (err) {
    if (!isMissingAdPlanTable(err)) console.error('getAllReadyPlans:', err.message);
  }
  return out;
}

// Plan state for library rows: { [episodeId]: { status, airSeconds, adsSeconds, breakCount } }.
export async function listPlanStates(episodeIds) {
  const ids = [...new Set((episodeIds || []).filter(Boolean))];
  const out = {};
  if (!ids.length) return out;
  try {
    const { data, error } = await getSupabase().from('episode_ad_plans').select(PLAN_FIELDS).in('episode_id', ids);
    if (error) throw error;
    for (const row of data || []) {
      const plan = rowToPlan(row);
      out[row.episode_id] = { status: plan.status, airSeconds: plan.airSeconds, adsSeconds: plan.adsSeconds, breakCount: airBreaks(plan).length };
    }
  } catch (err) {
    if (!isMissingAdPlanTable(err)) console.error('listPlanStates:', err.message);
  }
  return out;
}

/* ---------------- the episode ---------------- */

export async function getEpisodeForPlan(episodeId) {
  const supabase = getSupabase();
  const { data: e, error } = await supabase
    .from('episodes')
    .select('id, title, runtime, ad_break_seconds, ads_enabled, status, series_id, season, series_order, thumbnail, poster, artist, content_type, rating, src')
    .eq('id', episodeId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!e) return null;
  let seriesName = null;
  if (e.series_id) {
    const { data: s } = await supabase.from('series').select('name').eq('id', e.series_id).maybeSingle();
    seriesName = s ? s.name : null;
  }
  const label = e.series_order == null ? null : e.season != null ? `S${e.season} E${e.series_order}` : `E${e.series_order}`;
  return {
    id: e.id,
    title: e.title,
    seriesName,
    label,
    artist: e.artist || null,
    contentType: e.content_type || null,
    rating: e.rating || null,
    status: e.status,
    thumbnail: e.thumbnail || e.poster || null,
    runtime: e.runtime || null,
    runtimeSeconds: parseRuntimeToSeconds(e.runtime) || 0,
    adBreakSeconds: Array.isArray(e.ad_break_seconds) && e.ad_break_seconds.length ? e.ad_break_seconds : [0],
    adsEnabled: e.ads_enabled !== false,
    hasVideo: !!e.src
  };
}

// Every approved episode with its plan state, for /admin/ad-plans.
export async function listEpisodesWithPlans() {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('episodes')
    .select('id, title, runtime, series_id, season, series_order, content_type, thumbnail, poster, ad_break_seconds, ads_enabled, tier, created_at')
    .eq('status', 'approved')
    .eq('deletion_requested', false)
    .eq('moderation_hold', false)
    .order('created_at', { ascending: false })
    .limit(500);
  if (error) throw new Error(error.message);
  const eps = data || [];
  const seriesIds = [...new Set(eps.map((e) => e.series_id).filter(Boolean))];
  const seriesNames = {};
  if (seriesIds.length) {
    const { data: rows } = await supabase.from('series').select('id, name').in('id', seriesIds);
    for (const s of rows || []) seriesNames[s.id] = s.name;
  }
  const plans = await listPlanStates(eps.map((e) => e.id));
  return eps.map((e) => {
    const plan = plans[e.id] || null;
    const runtimeSeconds = parseRuntimeToSeconds(e.runtime) || 0;
    return {
      id: e.id,
      title: e.title,
      seriesName: e.series_id ? seriesNames[e.series_id] || null : null,
      label: e.series_order == null ? null : e.season != null ? `S${e.season} E${e.series_order}` : `E${e.series_order}`,
      contentType: e.content_type || null,
      tier: e.tier || null,
      thumbnail: e.thumbnail || e.poster || null,
      runtime: e.runtime || null,
      runtimeSeconds,
      creatorBreaks: Array.isArray(e.ad_break_seconds) && e.ad_break_seconds.length ? e.ad_break_seconds : [0],
      adsEnabled: e.ads_enabled !== false,
      status: plan ? plan.status : 'none',
      airSeconds: plan && plan.airSeconds ? plan.airSeconds : null,
      adsSeconds: plan ? plan.adsSeconds : 0,
      breakCount: plan ? plan.breakCount : null
    };
  });
}

/* ---------------- what can fill a break ---------------- */

const todayStr = () => new Date().toISOString().slice(0, 10);

// Every ad that could play today: active, approved, inside its dates, and
// allowed on the surface asked for (or on any surface when none is given,
// which is what the curator's counts use). Advertisers whose credits ran
// out are already inactive (migration 061).
export async function listEligibleAds({ placement = null } = {}) {
  const supabase = getSupabase();
  const { data, error } = await supabase.from('house_ads').select('*').eq('active', true).eq('review_status', 'approved');
  if (error) throw new Error(error.message);
  const today = todayStr();
  const rows = (data || []).filter((ad) => {
    if (ad.start_date && today < ad.start_date) return false;
    if (ad.end_date && today > ad.end_date) return false;
    if (placement && ad.placements && ad.placements.length > 0 && !ad.placements.includes(placement)) return false;
    return Number(ad.duration_seconds) > 0 && !!ad.video_url;
  });
  const accountIds = [...new Set(rows.map((r) => r.ad_account_id).filter(Boolean))];
  const companies = {};
  if (accountIds.length) {
    const { data: accts } = await supabase.from('ad_accounts').select('id, company_name').in('id', accountIds);
    for (const a of accts || []) companies[a.id] = a.company_name;
  }
  return rows.map((ad) => {
    const house = !ad.ad_account_id;
    return {
      id: ad.id,
      title: ad.title,
      durationSeconds: Math.round(Number(ad.duration_seconds)),
      weight: Math.max(1, Number(ad.weight) || 1),
      house,
      brand: house ? (ad.advertiser || 'Studio Tapa') : (companies[ad.ad_account_id] || ad.advertiser || 'Advertiser'),
      videoUrl: ad.video_url,
      clickUrl: ad.click_url || null,
      width: Number(ad.width) || 1280,
      height: Number(ad.height) || 720,
      placements: Array.isArray(ad.placements) && ad.placements.length ? ad.placements : null,
      pinnable: house
    };
  });
}

// Approved channel clips that can be bumpers or pieces.
export async function listBumpers() {
  const { data, error } = await getSupabase()
    .from('channel_media')
    .select('id, title, kind, duration_seconds, thumbnail, src')
    .eq('status', 'approved')
    .eq('moderation_hold', false)
    .in('kind', ['bumper', 'station_id', 'promo']);
  if (error) throw new Error(error.message);
  return (data || []).filter((m) => Number(m.duration_seconds) > 0).map((m) => ({
    id: m.id, title: m.title, kind: m.kind, durationSeconds: Math.round(Number(m.duration_seconds)), thumbnail: m.thumbnail || null, src: m.src
  }));
}

/* ---------------- the curator ---------------- */

function stats(runtimeSeconds, plan, settings) {
  const breaks = airBreaks(plan);
  return {
    runtimeSeconds,
    adsSeconds: adsSeconds(plan),
    airSeconds: airSeconds(runtimeSeconds, plan),
    adsPerHour: adsPerHour(runtimeSeconds, plan),
    hourCapSeconds: settings.hourCapSeconds,
    overCap: adsPerHour(runtimeSeconds, plan) > settings.hourCapSeconds,
    breakCount: breaks.length,
    breaks
  };
}

export async function getCuratorData(episodeId) {
  const [episode, settings] = await Promise.all([getEpisodeForPlan(episodeId), getAdPlanSettings()]);
  if (!episode) fail('That episode no longer exists.', 404);
  const [saved, ads, bumpers] = await Promise.all([getPlanRow(episodeId), listEligibleAds(), listBumpers()]);
  const plan = saved || defaultPlanFor({ adBreakSeconds: episode.adBreakSeconds, runtimeSeconds: episode.runtimeSeconds, sizes: settings.sizes, roundTo: settings.roundTo });
  const palette = {
    exact: settings.sizes.map((seconds) => ({ seconds, count: eligibleCount({ kind: 'exact', seconds }, ads) })),
    range: settings.ranges.map(([min, max]) => ({ min, max, count: eligibleCount({ kind: 'range', min, max }, ads) })),
    flex: settings.flexPresets.map((seconds) => ({ seconds, count: eligibleCount({ kind: 'flex', seconds }, ads) }))
  };
  return {
    episode,
    plan,
    settings,
    palette,
    ads: ads.map((a) => ({ ...a, videoUrl: undefined, fits: fitsFor(a.durationSeconds, settings) })),
    bumpers,
    stats: stats(episode.runtimeSeconds, plan, settings),
    conflicts: selfAdConflicts(plan)
  };
}

export async function savePlan(episodeId, raw, { userId } = {}) {
  const [episode, settings] = await Promise.all([getEpisodeForPlan(episodeId), getAdPlanSettings()]);
  if (!episode) fail('That episode no longer exists.', 404);
  if (!episode.runtimeSeconds) fail(`"${episode.title}" has no usable runtime; set it on the episode first (mm:ss).`);
  const { plan, errors } = normalizePlan(raw, { runtimeSeconds: episode.runtimeSeconds, sizes: settings.sizes });
  if (plan.status === 'ready' && !plan.breaks.length) fail('A plan needs at least one break before it can be ready for air. Save it as a draft, or add a break.');
  const air = airSeconds(episode.runtimeSeconds, plan);
  const row = {
    episode_id: episodeId,
    status: plan.status,
    breaks: plan.breaks,
    self_ads: plan.selfAds,
    round_to: plan.roundTo,
    merge_adjacent: plan.mergeAdjacent,
    auto_bumper: plan.autoBumper,
    on_demand: plan.onDemand,
    air_seconds: air,
    ads_seconds: adsSeconds(plan),
    updated_by: userId || null,
    updated_at: new Date().toISOString()
  };
  const { data, error } = await getSupabase().from('episode_ad_plans').upsert(row, { onConflict: 'episode_id' }).select(PLAN_FIELDS).single();
  if (error) {
    if (isMissingAdPlanTable(error)) fail('The ad plans table is not there yet: run migration 087 in the Supabase SQL editor.', 503);
    throw new Error(error.message);
  }
  const fresh = rowToPlan(data);
  return { plan: fresh, errors, stats: stats(episode.runtimeSeconds, fresh, settings), conflicts: selfAdConflicts(fresh) };
}

export async function deletePlan(episodeId) {
  const { error } = await getSupabase().from('episode_ad_plans').delete().eq('episode_id', episodeId);
  if (error && !isMissingAdPlanTable(error)) throw new Error(error.message);
}

/* ---------------- air time ---------------- */

// Fills one break of a ready plan with what should play right now, with
// playable URLs: ads are direct MP4s (plus the impression pixel to fire as
// each one starts), bumpers are signed Cloudflare streams, cards and the
// hold card are drawn by the player. `surface` is 'live' or 'vod'.
// Returns null when the episode has no ready plan (or, for vod, the plan
// keeps on-demand off), so the caller falls back to what it did before.
export async function fillForBreak(episodeId, breakIndex, { surface = 'live', origin = '' } = {}) {
  const saved = await getPlanRow(episodeId);
  if (!saved || saved.status !== 'ready') return null;
  if (surface === 'vod' && !saved.onDemand) return null;
  const breaks = airBreaks(saved);
  const b = breaks[Number(breakIndex)];
  if (!b) return null;
  const brk = saved.breaks.slice().sort((x, y) => x.at - y.at)[b.index];
  const [ads, bumpers] = await Promise.all([listEligibleAds({ placement: surface === 'vod' ? 'main_player' : 'live_tv' }), listBumpers()]);
  const fill = fillBreak(brk, { ads, bumpers, roundTo: saved.roundTo, mergeAdjacent: saved.mergeAdjacent, autoBumper: saved.autoBumper });
  const items = [];
  for (const it of fill.items) {
    if (it.type === 'ad') {
      items.push({
        type: 'ad', id: it.id, seconds: it.seconds, title: it.ad.title, brand: it.ad.brand, house: it.ad.house,
        src: it.ad.videoUrl, clickUrl: it.ad.clickUrl,
        // + the title and surface, so the play counts toward ad share (migration 103).
        impressionUrl: `${origin}${signedImpressionPath({ ad: it.id, episode: episodeId, surface: surface === 'vod' ? 'vod' : 'live' })}`,
        clickTrackUrl: `${origin}/api/house-ads/click?ad=${it.id}`
      });
    } else if (it.type === 'bumper') {
      let src = it.media.src;
      try {
        const signed = await signedSrcForStoredUrl(it.media.src, { expiresInSeconds: 15 * 60 });
        if (signed && signed.src) src = signed.src;
      } catch (err) {
        console.error('ad plan bumper signing:', err.message);
      }
      items.push({ type: 'bumper', id: it.id, seconds: it.seconds, title: it.media.title, kind: it.media.kind, src });
    } else {
      items.push(it);
    }
  }
  return { index: b.index, at: b.at, booked: fill.booked, items, adsSeconds: fill.adsSeconds, bumperSeconds: fill.bumperSeconds, holdSeconds: fill.holdSeconds, cardSeconds: fill.cardSeconds };
}
