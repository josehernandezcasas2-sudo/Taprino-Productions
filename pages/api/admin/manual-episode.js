import { findUserByEmail } from '../../../lib/roles';
import { requireCapability } from '../../../lib/adminAuth';
import { hasCapability } from '../../../lib/capabilities';
import { getSupabase } from '../../../lib/supabase';
import { cloudflarePlaybackUrl, getCloudflareVideoStatus } from '../../../lib/cloudflareUpload';
import { bunnyPlaybackUrl, isValidBunnyHost, muxPlaybackUrl, isValidMuxPlaybackId } from '../../../lib/videoProviders';
import { uploadArtworkImage } from '../../../lib/artworkUpload';
import { normalizeUrl } from '../../../lib/normalizeUrl';
import { recordAudit } from '../../../lib/auditLog';
import { invalidateCache } from '../../../lib/redis';
import { syncStreamProtection } from '../../../lib/streamProtection';
import { recordOrphan, storagePathFromUrl } from '../../../lib/orphanedMedia';
import { internalError, sendError } from '../../../lib/apiErrors';
import { VIDEO_UID_PATTERN } from '../../../lib/videoOwnership';
import { isTitleId } from '../../../lib/titleIds';
import { createShow, mintTitleId } from '../../../lib/showPage';
import { MAX_EPISODE_NUMBER, inRunningOrder, isPublicShow, slotCheck } from '../../../lib/showRules';

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
//
// A new show (newSeriesName) is made by createShow in lib/showPage.js
// (the series revamp, 2026-11-02): its own "-show" id, attributed to the
// creator the title is for, the episode's choices as its defaults, made
// only after every check has passed and removed again if the episode
// can't be saved — and private until it is made public (decision 2).
// Creating the episode already approved ("Approved — live immediately")
// is the spec's "Live now" and puts the show up with it, as this route
// always did, when the person doing it may make a show public: a full
// admin, or the show's own owner (a title attributed to themselves).
// `liveNow: false` keeps the show private even then. Until 2026-11-02 the
// show went up live and unattributed whatever the episode's status (a
// manage_episodes sub-admin could make a live show by accident), before
// the episode was checked or saved.
const REQUIRED_FIELDS = ['title', 'description', 'contentType', 'genre', 'mainGenre', 'runtime', 'artist', 'tier'];
const VALID_TIERS = ['free', 'premium'];
const VALID_STATUSES = ['pending', 'approved', 'rejected'];
const VALID_CONTENT_TYPES = ['series', 'movie', 'short', 'vertical', 'podcast', 'bonus'];
const VALID_VIDEO_PROVIDERS = ['cloudflare', 'bunny', 'mux'];
const BONUS_PARENT_TYPES = ['series', 'episode'];

export const config = {
  api: { bodyParser: { sizeLimit: '10mb' } }
};

function posInt(v) {
  if (v === undefined || v === null || v === '' || typeof v === 'boolean') return null;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

async function orphanArtwork(urls, reason, context) {
  for (const url of urls) {
    const path = storagePathFromUrl(url || '');
    if (path) await recordOrphan({ kind: 'storage_image', reference: path, reason, context: context ? String(context).slice(0, 200) : null });
  }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Full admins pass; a sub-admin needs the same capability the Library
  // page that calls this route is gated on (lib/adminAuth.js).
  const roleContext = await requireCapability(req, res, 'manage_episodes');
  if (!roleContext) return;

  try {
    return await createManualEpisode(req, res, roleContext);
  } catch (err) {
    // createShow's lines (a name too long, an id taken) reach the admin;
    // a database or storage error is logged and answered plainly.
    return sendError(res, err, 'admin/manual-episode', 'Could not create the episode.', { plainStatus: 400 });
  }
}

async function createManualEpisode(req, res, roleContext) {
  const { userId, email, isAdmin } = roleContext;
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
  // A Cloudflare id goes into Cloudflare API paths, so its shape is checked
  // first (security round, 2026-10-26).
  if (hasCloudflareVideo && !VIDEO_UID_PATTERN.test(String(cloudflareVideoUid))) {
    return res.status(400).json({ error: 'That doesn’t look like a Cloudflare video ID — copy it again from the Stream dashboard.' });
  }
  if (trailerCloudflareUid && !VIDEO_UID_PATTERN.test(String(trailerCloudflareUid))) {
    return res.status(400).json({ error: 'That doesn’t look like a Cloudflare video ID for the trailer.' });
  }
  if (videoProvider === 'bunny' && body.bunnyPullZoneHost && !isValidBunnyHost(body.bunnyPullZoneHost)) {
    return res.status(400).json({ error: 'That doesn’t look like a Bunny.net pull zone hostname — it should end in .b-cdn.net.' });
  }
  if (videoProvider === 'mux' && body.muxPlaybackId && !isValidMuxPlaybackId(body.muxPlaybackId)) {
    return res.status(400).json({ error: 'That doesn’t look like a valid Mux playback ID — letters and numbers only, no slashes or spaces.' });
  }
  if (!VALID_TIERS.includes(body.tier)) {
    return res.status(400).json({ error: `tier must be one of: ${VALID_TIERS.join(', ')}` });
  }
  if (!VALID_CONTENT_TYPES.includes(body.contentType)) {
    return res.status(400).json({ error: `contentType must be one of: ${VALID_CONTENT_TYPES.join(', ')}` });
  }
  const status = body.status && VALID_STATUSES.includes(body.status) ? body.status : 'pending';
  // A title created already approved skips review: only someone who may
  // review can do that (security round 2, 2026-10-28).
  if (status !== 'pending' && !hasCapability(roleContext, 'review_submissions')) {
    return res.status(403).json({ error: 'Creating a title that isn’t pending review needs the review capability.' });
  }

  const numbered = body.contentType === 'series' || body.contentType === 'podcast';
  const showWord = body.contentType === 'podcast' ? 'show' : 'series';
  const newSeriesName = typeof body.newSeriesName === 'string' ? body.newSeriesName.trim() : '';
  const pickedSeriesId = typeof body.seriesId === 'string' ? body.seriesId.trim() : '';
  if (numbered && (!pickedSeriesId || pickedSeriesId === '__new__') && !newSeriesName) {
    return res.status(400).json({ error: `Choose a ${showWord}, or provide newSeriesName to create one.` });
  }
  if (numbered && newSeriesName.length > 120) {
    return res.status(400).json({ error: `A ${showWord}’s name is limited to 120 characters.` });
  }
  // Same rule the creator-facing form enforces — without a number, a
  // series/podcast episode drew as a bare "Season 1" badge instead of
  // "S1 E<n>".
  let season = null;
  let seriesOrder = null;
  if (numbered) {
    if (!body.seriesOrder) {
      return res.status(400).json({ error: `${body.contentType === 'podcast' ? 'Podcast' : 'Series'} episodes need an episode number.` });
    }
    seriesOrder = posInt(body.seriesOrder);
    if (!seriesOrder || seriesOrder > MAX_EPISODE_NUMBER) return res.status(400).json({ error: `Episode numbers run from 1 to ${MAX_EPISODE_NUMBER}.` });
    if (body.season !== undefined && body.season !== null && body.season !== '' && !posInt(body.season)) {
      return res.status(400).json({ error: 'Seasons are numbered from 1.' });
    }
    season = posInt(body.season) || 1;
  }
  const bonusParentType = body.contentType === 'bonus' ? body.bonusParentType : null;
  const bonusParentId = body.contentType === 'bonus' ? body.bonusParentId : null;
  if (body.contentType === 'bonus' && (!bonusParentType || !bonusParentId)) {
    return res.status(400).json({ error: 'Choose which series or movie/short this bonus content belongs under.' });
  }

  const supabase = getSupabase();

  // Bonus content goes under something that exists: a show, or a title
  // that isn't bonus content itself.
  if (body.contentType === 'bonus') {
    if (!BONUS_PARENT_TYPES.includes(bonusParentType) || !isTitleId(String(bonusParentId))) {
      return res.status(400).json({ error: 'Choose which series or movie/short this bonus content belongs under.' });
    }
    const { data: parent, error: parentError } = bonusParentType === 'series'
      ? await supabase.from('series').select('id').eq('id', bonusParentId).maybeSingle()
      : await supabase.from('episodes').select('id, content_type').eq('id', bonusParentId).maybeSingle();
    if (parentError) throw internalError(parentError, 'manual-episode bonus parent');
    if (!parent) return res.status(400).json({ error: 'That isn’t there any more — pick what this bonus content belongs under again.' });
    if (bonusParentType === 'episode' && parent.content_type === 'bonus') {
      return res.status(400).json({ error: 'Bonus content goes under a show or a title, not under other bonus content.' });
    }
  }

  // An existing show has to be there and take new titles, and the number
  // can't be one another episode of the season keeps (a declined or
  // withdrawn one keeps none).
  let existingShow = null;
  let adoptKind = false;
  if (numbered && !newSeriesName) {
    if (!isTitleId(pickedSeriesId)) return res.status(400).json({ error: `That ${showWord} isn’t there any more — pick another.` });
    const { data: showRow, error: showError } = await supabase.from('series').select('*').eq('id', pickedSeriesId).maybeSingle();
    if (showError) throw internalError(showError, 'manual-episode show');
    if (!showRow) return res.status(404).json({ error: `That ${showWord} isn’t there any more — pick another.` });
    if (showRow.deletion_requested) return res.status(400).json({ error: `That ${showWord}’s removal is requested — it takes nothing new.` });
    if (showRow.moderation_hold) return res.status(400).json({ error: `That ${showWord} is pulled while it’s looked at — restore it first.` });
    existingShow = showRow;
    const { data: rows, error: rowsError } = await supabase.from('episodes').select('id, title, season, series_order, status, content_type, withdrawn_at, created_at').eq('series_id', showRow.id);
    if (rowsError) throw internalError(rowsError, 'manual-episode slots');
    // A show with no episode in its running order yet takes its kind from
    // its first one, as submit-episode and rss-import do (written after the
    // insert): one made through "Add series" reads as a series once
    // migration 118 has run, and a podcast filed into it here would
    // otherwise keep rendering at /series/<id> as a series.
    // A vertical (Snippet) series is left as it is (decision 17).
    adoptKind = Object.prototype.hasOwnProperty.call(showRow, 'kind') && (showRow.kind === 'series' || showRow.kind === 'podcast') && showRow.kind !== body.contentType
      && !(rows || []).some((r) => inRunningOrder(r) && (r.content_type === 'series' || r.content_type === 'podcast'));
    if (status !== 'rejected') {
      const slot = slotCheck(rows || [], { season, number: seriesOrder });
      if (!slot.free) {
        return res.status(409).json({
          error: `${slot.words}. The next free number is E${slot.nextFree}.`,
          code: 'taken', season, number: seriesOrder, holder: slot.holder ? { id: slot.holder.id, title: slot.holder.title || null } : null, nextFree: slot.nextFree
        });
      }
    }
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

  // A stable, URL-safe id derived from the title (two minted in one
  // millisecond still differ, lib/showPage.js).
  const id = mintTitleId(body.title, { fallback: 'title' });

  let poster = null;
  let thumbnail = null;
  try {
    [poster, thumbnail] = await Promise.all([
      uploadArtworkImage({ base64: body.posterBase64, fileName: body.posterFileName, pathPrefix: `${id}-poster` }),
      uploadArtworkImage({ base64: body.thumbnailBase64, fileName: body.thumbnailFileName, pathPrefix: `${id}-thumbnail` })
    ]);
  } catch (err) {
    // A storage failure is marked internal (lib/artworkUpload.js) and
    // answered plainly; a file that's too big or not an image is a line
    // for the admin.
    if (err && err.internal) throw err;
    return res.status(400).json({ error: (err && err.message) || 'Could not store the artwork.' });
  }

  // A new show: only now, with everything checked. "Live now" (the title
  // created approved) puts it up with the episode when this person may
  // make a show public; otherwise it waits, private, for its owner or a
  // full admin.
  const now = new Date().toISOString();
  const liveShow = status === 'approved' && body.liveNow !== false && (isAdmin || submittedBy === userId);
  let newShow = null;
  if (numbered && newSeriesName) {
    try {
      newShow = await createShow({
        name: newSeriesName,
        kind: body.contentType,
        defaults: { tier: body.tier, rating: body.rating || null, mainGenre: body.mainGenre, genre: body.genre, artist: body.artist, adsEnabled: body.adsEnabled !== false },
        creatorId: submittedBy,
        submittedBy: email || null,
        submittedByUserId: userId,
        live: liveShow,
        reviewedBy: email || null,
        reviewedByUserId: userId
      });
    } catch (err) {
      await orphanArtwork([poster, thumbnail], 'manual episode failed (new show)', body.title);
      throw err;
    }
  }
  const seriesId = numbered ? (newShow ? newShow.id : existingShow.id) : null;

  const insert = {
    id,
    title: body.title,
    description: body.description,
    tier: body.tier,
    genre: body.genre,
    main_genre: body.mainGenre,
    content_type: body.contentType,
    series_id: seriesId,
    season: numbered ? season : null,
    series_order: numbered ? seriesOrder : null,
    artist: body.artist,
    runtime: body.runtime,
    rating: body.rating || null,
    release_year: body.releaseYear && Number.isInteger(Number(body.releaseYear)) ? Number(body.releaseYear) : null,
    bonus_parent_type: body.contentType === 'bonus' ? bonusParentType : null,
    bonus_parent_id: body.contentType === 'bonus' ? bonusParentId : null,
    video_type: 'html5',
    video_provider: videoProvider,
    src,
    trailer_src: trailerSrc,
    poster,
    thumbnail,
    featured: !!body.featured,
    is_original: !!body.isOriginal,
    // Studio Tapa's own uploads: on unless unticked.
    channel_opt_in: body.channelOptIn !== false,
    funding_url: normalizeUrl(body.fundingUrl),
    audio_url: body.audioUrl || null,
    audio_bytes: body.audioBytes || null,
    ads_enabled: body.adsEnabled !== false,
    ad_break_seconds: Array.isArray(body.adBreakSeconds) && body.adBreakSeconds.length > 0 ? body.adBreakSeconds : [0],
    // Written out like every title made in one go (lib/creatorApplications.js).
    deletion_requested: false,
    moderation_hold: false,
    status,
    submitted_by: submittedBy,
    reviewed_by: status !== 'pending' ? userId : null,
    reviewed_at: status !== 'pending' ? now : null,
    // Approved at once: its release is now (early screenings and the "New
    // episode" banner start here, as an approval in the queue does).
    ...(status === 'approved' ? { released_at: now } : {})
  };

  let { error } = await supabase.from('episodes').insert(insert);
  if (error && insert.released_at && /released_at/i.test(error.message || '')) {
    delete insert.released_at;
    ({ error } = await supabase.from('episodes').insert(insert));
  }
  if (error) {
    if (newShow) {
      const { error: undoError } = await supabase.from('series').delete().eq('id', newShow.id);
      if (undoError) console.error('manual-episode show undo:', undoError.message);
      if (newShow.status === 'approved') await invalidateCache('all_series_approved_v1');
    }
    await orphanArtwork([poster, thumbnail], 'manual episode failed', body.title);
    // Taken between the check and the write, under migration 118's index.
    if (error.code === '23505' && /episodes_show_position_uq/.test(error.message || '')) {
      return res.status(409).json({ error: `E${seriesOrder} in Season ${season} was just taken — pick another number.`, code: 'taken', season, number: seriesOrder });
    }
    console.error('manual-episode insert error:', error.message);
    return res.status(500).json({ error: 'Could not create the episode.' });
  }
  // The empty show's kind follows its first episode (see adoptKind above);
  // best effort — the episode is in either way.
  if (adoptKind && existingShow) {
    const { error: kindError } = await supabase.from('series').update({ kind: body.contentType }).eq('id', existingShow.id);
    if (kindError) console.error('manual-episode show kind:', kindError.message);
    else if (existingShow.status === 'approved') await invalidateCache('all_series_approved_v1');
  }
  await invalidateCache('public_episodes_v1');
  // Every Cloudflare video the site plays demands a signed link: one
  // linked by id (uploaded through Cloudflare's own dashboard, or before
  // 2026-10-25) is protected from now, and its trailer too (decision 12).
  // Best effort; "Protect every video" catches up.
  await Promise.all([syncStreamProtection({ src }), syncStreamProtection({ src: trailerSrc })]);

  const videoDescription = hasCloudflareVideo
    ? `${body.videoUid ? 'uploaded' : 'manually-linked'} Cloudflare video ${cloudflareVideoUid}`
    : hasBunnyVideo
    ? `manually-linked Bunny.net video ${body.bunnyVideoId}`
    : hasMuxVideo
    ? `manually-linked Mux video ${body.muxPlaybackId}`
    : 'imported audio file';
  const showLine = newShow ? `, in a new ${newShow.status === 'approved' ? 'public' : 'private'} show ${newShow.id}` : '';
  await recordAudit({
    adminId: userId,
    adminEmail: email,
    action: 'manual_episode_created',
    targetType: 'episode',
    targetId: id,
    details: `${body.title} — via ${videoDescription}${body.creatorEmail ? `, attributed to ${body.creatorEmail}` : ''}${showLine}`
  });
  if (newShow) {
    await recordAudit({
      adminId: userId,
      adminEmail: email,
      action: 'show_created',
      targetType: 'series',
      targetId: newShow.id,
      details: `${newShow.name}: ${newShow.status === 'approved' ? 'public with its first episode' : 'private until it is made public'} (from a manual episode)`
    });
  }

  // An approved title in a show that isn't public stays off the site until
  // the show is; the answer says so.
  const show = newShow
    ? { id: newShow.id, name: newShow.name, status: newShow.status, isPublic: newShow.status === 'approved' }
    : existingShow ? { id: existingShow.id, name: existingShow.name || null, status: existingShow.status || 'approved', isPublic: isPublicShow(existingShow) } : null;
  const showNote = show && !show.isPublic && status === 'approved'
    ? `${show.name || 'The show'} isn’t public yet: the episode shows once its owner or a full admin makes it public.`
    : null;

  return res.status(200).json({ ok: true, episodeId: id, videoState: videoStatus ? videoStatus.state : null, show, showNote });
}
