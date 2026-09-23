import { getRoleContext, findUserByEmail } from '../../../lib/roles';
import { getSupabase } from '../../../lib/supabase';
import { cloudflarePlaybackUrl, getCloudflareVideoStatus } from '../../../lib/cloudflareUpload';
import { bunnyPlaybackUrl, isValidBunnyHost, muxPlaybackUrl, isValidMuxPlaybackId } from '../../../lib/videoProviders';
import { uploadArtworkImage } from '../../../lib/artworkUpload';
import { normalizeUrl } from '../../../lib/normalizeUrl';
import { recordAudit } from '../../../lib/auditLog';
import { invalidateCache } from '../../../lib/redis';

// Admin's direct add-an-episode path — components/ManualEpisodeForm.js.
// Accepts a video the exact same three ways the creator-facing
// submit-episode.js does (an in-app upload or link import, both via
// contexts/UploadContext.js and arriving here as `videoUid`/`trailerUid`;
// or a video already sitting in Cloudflare/Bunny/Mux, pasted as an ID —
// `cloudflareVideoUid`/`trailerCloudflareUid` — for when the in-app
// upload itself is what's broken: ad blocker, firewall, flaky network,
// see lib/uploadErrors.js).
//
// This is admin-only, not creator-facing, for a concrete reason: it
// requires values (attributing submitted_by, setting status/tier
// directly) that only make sense with admin trust already established.
const REQUIRED_FIELDS = ['title', 'description', 'contentType', 'genre', 'mainGenre', 'runtime', 'artist', 'tier'];
const VALID_TIERS = ['free', 'premium'];
const VALID_STATUSES = ['pending', 'approved', 'rejected'];
const VALID_CONTENT_TYPES = ['series', 'movie', 'short', 'vertical', 'podcast', 'bonus'];
const VALID_VIDEO_PROVIDERS = ['cloudflare', 'bunny', 'mux'];

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
  const videoProvider = body.videoProvider && VALID_VIDEO_PROVIDERS.includes(body.videoProvider) ? body.videoProvider : 'cloudflare';
  if (body.videoProvider && !VALID_VIDEO_PROVIDERS.includes(body.videoProvider)) {
    return res.status(400).json({ error: `videoProvider must be one of: ${VALID_VIDEO_PROVIDERS.join(', ')}` });
  }
  // videoUid arrives from ManualEpisodeForm's own in-app upload/link-import
  // (the same UploadContext flow the creator form uses) — cloudflareVideoUid
  // is the older "paste an ID from a video already uploaded via Cloudflare's
  // own dashboard" path. Both name the same thing once they get here.
  const cloudflareVideoUid = body.cloudflareVideoUid || body.videoUid;
  const trailerCloudflareUid = body.trailerCloudflareUid || body.trailerUid;
  const hasCloudflareVideo = videoProvider === 'cloudflare' && !!cloudflareVideoUid;
  const hasBunnyVideo = videoProvider === 'bunny' && !!body.bunnyPullZoneHost && !!body.bunnyVideoId;
  const hasMuxVideo = videoProvider === 'mux' && !!body.muxPlaybackId;
  if (!hasCloudflareVideo && !hasBunnyVideo && !hasMuxVideo && !body.audioUrl) {
    return res.status(400).json({ error: 'Provide a video ID for the selected provider, or an imported audio file.' });
  }
  if (videoProvider === 'bunny' && body.bunnyPullZoneHost && !isValidBunnyHost(body.bunnyPullZoneHost)) {
    return res.status(400).json({ error: 'That doesn\u2019t look like a Bunny.net pull zone hostname \u2014 it should end in .b-cdn.net.' });
  }
  if (videoProvider === 'mux' && body.muxPlaybackId && !isValidMuxPlaybackId(body.muxPlaybackId)) {
    return res.status(400).json({ error: 'That doesn\u2019t look like a valid Mux playback ID \u2014 letters and numbers only, no slashes or spaces.' });
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
  // Same rule the creator-facing form already enforces (submit-episode.js)
  // — without this, this endpoint let a series/podcast episode through
  // with a null series_order, which the series page's own sort
  // (`(a.seriesOrder || 0) - (b.seriesOrder || 0)`) then puts FIRST in the
  // list ahead of episode 1, and renders as a bare "Season 1" badge
  // instead of "S1 E<n>" since there's no number to show.
  if ((body.contentType === 'series' || body.contentType === 'podcast') && !body.seriesOrder) {
    return res.status(400).json({ error: `${body.contentType === 'podcast' ? 'Podcast' : 'Series'} episodes need an episode number.` });
  }
  if (body.contentType === 'bonus' && (!body.bonusParentType || !body.bonusParentId)) {
    return res.status(400).json({ error: 'Choose which series or movie/short this bonus content belongs under.' });
  }

  // The whole point of this endpoint — verify Cloudflare actually
  // processed the file before an episode gets built around it. A video
  // that failed transcoding (corrupted file, wrong format) shouldn't
  // silently become a published episode with a broken player. Skipped
  // entirely for an audio-only podcast episode, since there's no video to
  // check in that case at all.
  //
  // Bunny and Mux don't get this check — that requires each platform's
  // own API key, which doesn't exist yet (see lib/videoProviders.js).
  // Their src is computed directly from what's typed in and trusted, the
  // same as pasting a raw URL would be.
  let videoStatus = null;
  let src = null;
  if (hasCloudflareVideo) {
    videoStatus = await getCloudflareVideoStatus(cloudflareVideoUid);
    if (!videoStatus) {
      return res.status(404).json({ error: 'No Cloudflare video found with that ID — check it was copied correctly.' });
    }
    if (videoStatus.state === 'error') {
      return res.status(400).json({ error: `Cloudflare could not process this video: ${videoStatus.errorReasonText || videoStatus.errorReasonCode}. Re-export and re-upload it before linking.` });
    }
    src = cloudflarePlaybackUrl(cloudflareVideoUid);
  } else if (hasBunnyVideo) {
    src = bunnyPlaybackUrl(body.bunnyPullZoneHost, body.bunnyVideoId);
  } else if (hasMuxVideo) {
    src = muxPlaybackUrl(body.muxPlaybackId);
  }
  let trailerSrc = null;
  if (trailerCloudflareUid) {
    trailerSrc = cloudflarePlaybackUrl(trailerCloudflareUid);
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
    release_year: body.releaseYear && Number.isInteger(Number(body.releaseYear)) ? Number(body.releaseYear) : null,
    bonus_parent_type: body.contentType === 'bonus' ? body.bonusParentType : null,
    bonus_parent_id: body.contentType === 'bonus' ? body.bonusParentId : null,
    video_type: 'html5',
    video_provider: videoProvider,
    src,
    trailer_src: trailerSrc,
    poster,
    thumbnail,
    featured: !!body.featured,
    is_original: !!body.isOriginal,
    funding_url: normalizeUrl(body.fundingUrl),
    audio_url: body.audioUrl || null,
    audio_bytes: body.audioBytes || null,
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
  await invalidateCache('public_episodes_v1');

  const videoDescription = hasCloudflareVideo
    ? `${body.videoUid ? 'uploaded' : 'manually-linked'} Cloudflare video ${cloudflareVideoUid}`
    : hasBunnyVideo
    ? `manually-linked Bunny.net video ${body.bunnyVideoId}`
    : hasMuxVideo
    ? `manually-linked Mux video ${body.muxPlaybackId}`
    : 'imported audio file';
  await recordAudit({
    adminId: userId,
    adminEmail: email,
    action: 'manual_episode_created',
    targetType: 'episode',
    targetId: id,
    details: `${body.title} — via ${videoDescription}${body.creatorEmail ? `, attributed to ${body.creatorEmail}` : ''}`
  });

  return res.status(200).json({ ok: true, episodeId: id, videoState: videoStatus ? videoStatus.state : null });
}
