import { getRoleContext } from '../../../lib/roles';
import { getSupabase } from '../../../lib/supabase';
import { getCloudflareVideoStatus, cloudflareUidFromUrl } from '../../../lib/cloudflareUpload';
import { getViewCounts } from '../../../lib/redis';
import { captionsHref } from '../../../lib/episodes';
import { sortEpisodes } from '../../../lib/seriesResume';
import { kindOf } from '../../../lib/showRules';
import { FLAG_REASONS } from '../../../lib/reportReasons';
import { applyCors } from '../../../lib/cors';

// A creator's own titles, every status, for Creator Studio's piles, Your
// work (web + app) and the app's hub. Filtered by the signed-in account,
// never by anything the browser sends.
//
// The series revamp (slice 1) added, per row: the staged changes waiting
// on a live title (pendingTitle / pendingDescription; pendingSrc = a new
// video is waiting, with pendingVideoState = where Cloudflare says that
// file stands), titleImageUrl, discoverCurated, hasVideo / hasAudio (Your
// work reads them), holdReason (why an admin pulled it), and the show it
// is in: seriesKind ('series' | 'podcast' | 'vertical'), seriesStatus
// ('pending' = not public yet, 'approved', 'rejected') and seriesHeld; and
// captionsStale once a new video was approved over captions made for the
// old file (migration 118's captions_stale_at). The rows of one show come
// together in play order (lib/seriesResume.js sortEpisodes), placed where
// the show's newest row falls; everything else stays newest first.
//
// A row's picture is its own still, else its show's — never Cloudflare's
// frame grab, which stops loading once a video demands signed links.
// Cloudflare is asked about a video only while it can still be changing
// (not approved yet, approved in the last two days, or a new video
// waiting), and each answer is remembered for a minute.
const CLOUDFLARE_MEMO_MS = 60 * 1000;
const RECENT_MS = 2 * 24 * 60 * 60 * 1000;
const cloudflareMemo = new Map();

async function cloudflareStatus(uid) {
  if (!uid) return null;
  const hit = cloudflareMemo.get(uid);
  if (hit && Date.now() - hit.at < CLOUDFLARE_MEMO_MS) return hit.status;
  const status = await getCloudflareVideoStatus(uid).catch(() => null);
  cloudflareMemo.set(uid, { at: Date.now(), status });
  if (cloudflareMemo.size > 1000) cloudflareMemo.delete(cloudflareMemo.keys().next().value);
  return status;
}

const CLOUDFLARE_FRAME = /(cloudflarestream\.com|videodelivery\.net)\/[^/]+\/thumbnails\//i;
function ownArt(url) {
  return url && !CLOUDFLARE_FRAME.test(String(url)) ? url : null;
}

function stillChanging(ep, now) {
  if (ep.pending_src) return true;
  if (ep.status !== 'approved') return true;
  const at = Date.parse(ep.reviewed_at || ep.created_at || '');
  return !Number.isFinite(at) || now - at < RECENT_MS;
}

// Rows newest first, but a show's rows together in play order, where the
// show's newest row falls.
function showsInPlayOrder(rows) {
  const byShow = new Map();
  for (const r of rows) {
    if (!r.seriesId) continue;
    if (!byShow.has(r.seriesId)) byShow.set(r.seriesId, []);
    byShow.get(r.seriesId).push(r);
  }
  const out = [];
  const placed = new Set();
  for (const r of rows) {
    if (!r.seriesId) {
      out.push(r);
      continue;
    }
    if (placed.has(r.seriesId)) continue;
    placed.add(r.seriesId);
    out.push(...sortEpisodes(byShow.get(r.seriesId)));
  }
  return out;
}

// Why an admin pulled a title: the open flag's reason (and the note the
// owner was already sent), else the viewers' reports.
async function holdReasons(supabase, heldIds) {
  if (heldIds.length === 0) return {};
  const { data, error } = await supabase
    .from('content_flags')
    .select('target_id, reason, note, created_at')
    .eq('target_type', 'episode')
    .in('target_id', heldIds)
    .is('resolved_at', null)
    .order('created_at', { ascending: false });
  if (error) console.error('my-submissions flags:', error.message);
  const out = {};
  for (const f of error ? [] : data || []) {
    if (out[f.target_id]) continue;
    const label = FLAG_REASONS[f.reason] || 'Pulled for review';
    out[f.target_id] = f.note ? `${label}: ${String(f.note).slice(0, 300)}` : label;
  }
  for (const id of heldIds) if (!out[id]) out[id] = 'Viewers reported it, and an admin is looking at it';
  return out;
}

export default async function handler(req, res) {
  applyCors(req, res);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  res.setHeader('Cache-Control', 'private, no-store');

  const { userId, isCreator, isAdmin } = await getRoleContext(req);
  if (!isCreator && !isAdmin) {
    return res.status(403).json({ error: 'Creator access required.' });
  }

  const supabase = getSupabase();
  // Filtered server-side by this creator's own userId — never client-supplied,
  // so there's no way for a creator to see anyone else's submissions.
  // select('*'): the newer columns (migration 118's pending_src and
  // captions_stale_at) are read when the database has them and are simply
  // absent when it doesn't.
  const [{ data, error }, viewCounts] = await Promise.all([
    supabase
      .from('episodes')
      .select('*')
      .eq('submitted_by', userId)
      .order('created_at', { ascending: false }),
    getViewCounts()
  ]);

  if (error) {
    console.error('my-submissions error:', error.message);
    return res.status(500).json({ error: 'Could not load your submissions.' });
  }
  const rows = data || [];

  // Only the shows these rows are in.
  const seriesIds = [...new Set(rows.map((ep) => ep.series_id).filter(Boolean))];
  let seriesRows = [];
  if (seriesIds.length > 0) {
    const { data: found, error: seriesError } = await supabase.from('series').select('*').in('id', seriesIds);
    if (seriesError) console.error('my-submissions series:', seriesError.message);
    seriesRows = found || [];
  }
  const seriesById = Object.fromEntries(seriesRows.map((s) => [s.id, s]));
  const rowsByShow = {};
  for (const ep of rows) if (ep.series_id) (rowsByShow[ep.series_id] = rowsByShow[ep.series_id] || []).push(ep);

  const now = Date.now();
  const [states, pendingStates, holds] = await Promise.all([
    Promise.all(rows.map((ep) => (stillChanging(ep, now) ? cloudflareStatus(cloudflareUidFromUrl(ep.src)) : null))),
    Promise.all(rows.map((ep) => (ep.pending_src ? cloudflareStatus(cloudflareUidFromUrl(ep.pending_src)) : null))),
    holdReasons(supabase, rows.filter((ep) => ep.moderation_hold).map((ep) => ep.id))
  ]);

  const enriched = rows.map((ep, i) => {
    const cf = states[i];
    const pendingCf = pendingStates[i];
    const show = ep.series_id ? seriesById[ep.series_id] || null : null;
    const coveredBySeriesArt = !!(show && (show.poster || show.thumbnail));
    return {
      id: ep.id,
      title: ep.title ?? null,
      description: ep.description ?? null,
      tier: ep.tier ?? null,
      status: ep.status ?? null,
      rejectionReason: ep.rejection_reason ?? null,
      contentType: ep.content_type ?? null,
      genre: ep.genre ?? null,
      mainGenre: ep.main_genre ?? null,
      seriesId: ep.series_id ?? null,
      seriesName: show ? show.name ?? null : null,
      // The show it is in: its kind, whether it is public yet ('pending'
      // until its owner makes it public), and whether it was pulled.
      seriesKind: show ? kindOf(show, rowsByShow[ep.series_id]) : null,
      seriesStatus: show ? show.status || 'approved' : null,
      seriesHeld: Boolean(show && show.moderation_hold),
      season: ep.season ?? null,
      seriesOrder: ep.series_order ?? null,
      artist: ep.artist ?? null,
      runtime: ep.runtime ?? null,
      releaseYear: ep.release_year || null,
      adsEnabled: ep.ads_enabled !== false,
      rating: ep.rating || '',
      adBreakSeconds: ep.ad_break_seconds ?? null,
      availableFrom: ep.available_from ?? null,
      availableUntil: ep.available_until ?? null,
      bonusParentType: ep.bonus_parent_type ?? null,
      bonusParentId: ep.bonus_parent_id ?? null,
      featured: !!ep.featured,
      discoverCurated: !!ep.discover_curated,
      fundingUrl: ep.funding_url || '',
      isOriginal: !!ep.is_original,
      channelOptIn: !!ep.channel_opt_in,
      // Pulled from everywhere while an admin reviews it (lib/moderation.js),
      // and why.
      held: !!ep.moderation_hold,
      holdReason: ep.moderation_hold ? holds[ep.id] || null : null,
      seriesChannelOptIn: !!(show && show.channel_opt_in),
      src: ep.src ?? null,
      hasVideo: Boolean(ep.src),
      hasAudio: Boolean(ep.audio_url),
      createdAt: ep.created_at ?? null,
      reviewedAt: ep.reviewed_at ?? null,
      // Only meaningful once approved and actually live — but harmless to
      // include either way, and saves the dashboard a second round-trip
      // the moment something does go live.
      viewCount: viewCounts[ep.id] || 0,
      captionsUrl: captionsHref(ep),
      captionsLanguage: ep.captions_language || 'en',
      captionsLabel: ep.captions_label || 'English',
      captionsStale: Boolean(ep.captions_stale_at),
      // The creator's own artwork, else the show's (a show's episode needs
      // none of its own).
      poster: ownArt(ep.poster),
      thumbnail: ownArt(ep.thumbnail) || (show ? ownArt(show.thumbnail) : null),
      titleImageUrl: ep.title_image_url ?? null,
      artworkPending: !!(ep.pending_poster || ep.pending_thumbnail),
      // Changes waiting for an admin on a live title.
      pendingTitle: ep.pending_title ?? null,
      pendingDescription: ep.pending_description ?? null,
      pendingSrc: Boolean(ep.pending_src),
      pendingVideoState: ep.pending_src ? (pendingCf ? pendingCf.state || null : null) : null,
      // Whether this episode is genuinely missing artwork — a series
      // episode with no poster/thumbnail of its own isn't "missing"
      // anything if the series itself already has artwork set, since
      // that's exactly what the series-level media is for.
      missingArtwork: !ep.poster && !ep.thumbnail && !coveredBySeriesArt,
      deletionRequested: Boolean(ep.deletion_requested),
      deletionReason: ep.deletion_reason ?? null,
      deletionRequestedAt: ep.deletion_requested_at ?? null,
      cloudflareState: cf ? cf.state || null : null,
      cloudflareError: cf && cf.state === 'error' ? (cf.errorReasonText || cf.errorReasonCode || null) : null
    };
  });

  // Channel opt-in per show, and whether this creator owns the show (only
  // the owner can change it — see pages/api/creator/channel-opt-in.js).
  const seriesChannel = Object.fromEntries(seriesIds.map((id) => {
    const s = seriesById[id];
    return [id, { channelOptIn: !!(s && s.channel_opt_in), canChange: !!(s && (isAdmin || s.creator_id === userId)) }];
  }));

  return res.status(200).json({ submissions: showsInPlayOrder(enriched), seriesChannel });
}
