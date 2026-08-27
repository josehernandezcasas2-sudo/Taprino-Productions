import { getRoleContext, findUserByEmail } from '../../../lib/roles';
import { getSupabase } from '../../../lib/supabase';
import { cloudflarePlaybackUrl, getCloudflareVideoStatus } from '../../../lib/cloudflareUpload';
import { uploadArtworkImage } from '../../../lib/artworkUpload';
import { normalizeUrl } from '../../../lib/normalizeUrl';
import { recordAudit } from '../../../lib/auditLog';

// The manual fallback path: for when a creator's in-app upload keeps
// getting blocked (ad blocker, firewall, flaky network — see
// lib/uploadErrors.js), the actual workaround is uploading the file
// directly through Cloudflare's own dashboard (admin-only, since that
// requires the Cloudflare account itself, not just this app) and then
// creating the episode here from the resulting video ID — completely
// bypassing this app's own upload pipeline for that one file.
//
// This is admin-only, not creator-facing, for a concrete reason: it
// requires values (attributing submitted_by, setting status/tier
// directly) that only make sense with admin trust already established.
const REQUIRED_FIELDS = ['title', 'description', 'contentType', 'genre', 'mainGenre', 'runtime', 'artist', 'tier', 'cloudflareVideoUid'];
const VALID_TIERS = ['free', 'premium'];
const VALID_STATUSES = ['pending', 'approved', 'rejected'];
const VALID_CONTENT_TYPES = ['series', 'movie', 'short', 'vertical', 'podcast', 'bonus'];

export const config = {
  api: { bodyParser: { sizeLimit: '10mb' } }
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { userId, email, isAdmin } = await getRoleContext(req);
  if (!isAdmin) {
    return res.status(403).json({ error: 'Admin access required.' });
  }

  const body = req.body || {};
  const missing = REQUIRED_FIELDS.filter((f) => !body[f] || String(body[f]).trim() === '');
  if (missing.length > 0) {
    return res.status(400).json({ error: `Missing required fields: ${missing.join(', ')}` });
  }
  if (!VALID_TIERS.includes(body.tier)) {
    return res.status(400).json({ error: `tier must be one of: ${VALID_TIERS.join(', ')}` });
  }
  if (!VALID_CONTENT_TYPES.includes(body.contentType)) {
    return res.status(400).json({ error: `contentType must be one of: ${VALID_CONTENT_TYPES.join(', ')}` });
  }
  const status = body.status && VALID_STATUSES.includes(body.status) ? body.status : 'pending';
  if ((body.contentType === 'series' || body.contentType === 'podcast') && (!body.seriesId || body.seriesId === '__new__') && !body.newSeriesName) {
    return res.status(400).json({ error: `Choose a ${body.contentType === 'podcast' ? 'show' : 'series'}, or provide newSeriesName to create one.` });
  }
  if (body.contentType === 'bonus' && (!body.bonusParentType || !body.bonusParentId)) {
    return res.status(400).json({ error: 'Choose which series or movie/short this bonus content belongs under.' });
  }

  // The whole point of this endpoint — verify Cloudflare actually
  // processed the file before an episode gets built around it. A video
  // that failed transcoding (corrupted file, wrong format) shouldn't
  // silently become a published episode with a broken player.
  const videoStatus = await getCloudflareVideoStatus(body.cloudflareVideoUid);
  if (!videoStatus) {
    return res.status(404).json({ error: 'No Cloudflare video found with that ID — check it was copied correctly.' });
  }
  if (videoStatus.state === 'error') {
    return res.status(400).json({ error: `Cloudflare could not process this video: ${videoStatus.errorReasonText || videoStatus.errorReasonCode}. Re-export and re-upload it before linking.` });
  }

  const src = cloudflarePlaybackUrl(body.cloudflareVideoUid);
  let trailerSrc = null;
  if (body.trailerCloudflareUid) {
    trailerSrc = cloudflarePlaybackUrl(body.trailerCloudflareUid);
  }

  // Attributing this to a specific creator is optional — if provided, it
  // has to resolve to a real account, since submitted_by drives their
  // dashboard, notifications, and view counts. Left blank, the episode is
  // attributed to the admin creating it (still useful for e.g. an
  // official studio short with no individual creator).
  let submittedBy = userId;
  if (body.creatorEmail && body.creatorEmail.trim()) {
    const creatorUser = await findUserByEmail(body.creatorEmail.trim());
    if (!creatorUser) {
      return res.status(404).json({ error: `No account found for ${body.creatorEmail} — they need to have signed up already.` });
    }
    submittedBy = creatorUser.id;
  }

  const supabase = getSupabase();

  let seriesId = null;
  if (body.contentType === 'series' || body.contentType === 'podcast') {
    if (body.newSeriesName) {
      seriesId = `${body.newSeriesName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')}-${Date.now().toString(36)}`;
      const { error: seriesError } = await supabase.from('series').insert({ id: seriesId, name: body.newSeriesName, creator_id: submittedBy });
      if (seriesError) {
        console.error('manual-episode series create error:', seriesError.message);
        return res.status(500).json({ error: 'Could not create the new series.' });
      }
    } else {
      seriesId = body.seriesId;
    }
  }

  let poster = null;
  let thumbnail = null;
  try {
    [poster, thumbnail] = await Promise.all([
      uploadArtworkImage({ base64: body.posterBase64, fileName: body.posterFileName, pathPrefix: `manual-${Date.now().toString(36)}-poster` }),
      uploadArtworkImage({ base64: body.thumbnailBase64, fileName: body.thumbnailFileName, pathPrefix: `manual-${Date.now().toString(36)}-thumbnail` })
    ]);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const id = `${body.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')}-${Date.now().toString(36)}`;

  const { error } = await supabase.from('episodes').insert({
    id,
    title: body.title,
    description: body.description,
    tier: body.tier,
    genre: body.genre,
    main_genre: body.mainGenre,
    content_type: body.contentType,
    series_id: seriesId,
    season: (body.contentType === 'series' || body.contentType === 'podcast') ? (Number(body.season) || 1) : null,
    series_order: (body.contentType === 'series' || body.contentType === 'podcast') ? (Number(body.seriesOrder) || null) : null,
    artist: body.artist,
    runtime: body.runtime,
    rating: body.rating || null,
    bonus_parent_type: body.contentType === 'bonus' ? body.bonusParentType : null,
    bonus_parent_id: body.contentType === 'bonus' ? body.bonusParentId : null,
    video_type: 'html5',
    src,
    trailer_src: trailerSrc,
    poster,
    thumbnail,
    featured: !!body.featured,
    is_original: !!body.isOriginal,
    funding_url: normalizeUrl(body.fundingUrl),
    audio_url: body.audioUrl || null,
    ads_enabled: body.adsEnabled !== false,
    ad_break_seconds: Array.isArray(body.adBreakSeconds) && body.adBreakSeconds.length > 0 ? body.adBreakSeconds : [0],
    status,
    submitted_by: submittedBy,
    reviewed_by: status !== 'pending' ? userId : null,
    reviewed_at: status !== 'pending' ? new Date().toISOString() : null
  });

  if (error) {
    console.error('manual-episode insert error:', error.message);
    return res.status(500).json({ error: 'Could not create the episode.' });
  }

  await recordAudit({
    adminId: userId,
    adminEmail: email,
    action: 'manual_episode_created',
    targetType: 'episode',
    targetId: id,
    details: `${body.title} — via manually-linked Cloudflare video ${body.cloudflareVideoUid}${body.creatorEmail ? `, attributed to ${body.creatorEmail}` : ''}`
  });

  return res.status(200).json({ ok: true, episodeId: id, videoState: videoStatus.state });
}
