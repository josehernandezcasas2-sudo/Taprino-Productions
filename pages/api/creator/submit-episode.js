import { getRoleContext } from '../../../lib/roles';
import { getSupabase } from '../../../lib/supabase';
import { cloudflarePlaybackUrl, getCloudflareVideoStatus } from '../../../lib/cloudflareUpload';
import { checkRateLimit, rateLimitKeyForRequest } from '../../../lib/rateLimit';
import { uploadArtworkImage } from '../../../lib/artworkUpload';

// Every one of these has to be present and non-empty — this is the actual
// enforcement of "creators must submit complete metadata," not just a UI
// nicety. A form can be bypassed by anyone calling this endpoint directly;
// this check can't be.
const REQUIRED_FIELDS = ['title', 'description', 'contentType', 'genre', 'mainGenre', 'runtime', 'artist', 'tier'];
const VALID_TIERS = ['free', 'premium'];
const VALID_CONTENT_TYPES = ['series', 'movie', 'short', 'vertical', 'podcast'];

// Poster/thumbnail arrive as base64 data URLs in the JSON body (see
// pages/creator.js) rather than a real multipart upload — simplest thing
// that works given how small these files are, but it does mean the
// default 1MB Next.js API body limit has to grow to fit two images plus
// the video's TUS uid (which is tiny). 10MB comfortably covers a poster
// and thumbnail even before compression.
export const config = {
  api: { bodyParser: { sizeLimit: '10mb' } }
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { userId, isCreator, isAdmin } = await getRoleContext(req);
  if (!isCreator && !isAdmin) {
    return res.status(403).json({ error: 'Creator access required.' });
  }

  const allowed = await checkRateLimit(rateLimitKeyForRequest(req, 'creator-submit'), 20, 3600);
  if (!allowed) {
    return res.status(429).json({ error: 'Too many submissions — please wait a bit and try again.' });
  }

  const body = req.body || {};

  const missing = REQUIRED_FIELDS.filter((f) => !body[f] || String(body[f]).trim() === '');
  if (missing.length > 0) {
    return res.status(400).json({ error: `Missing required field${missing.length === 1 ? '' : 's'}: ${missing.join(', ')}` });
  }
  if (!VALID_TIERS.includes(body.tier)) {
    return res.status(400).json({ error: `tier must be one of: ${VALID_TIERS.join(', ')}` });
  }
  if (!VALID_CONTENT_TYPES.includes(body.contentType)) {
    return res.status(400).json({ error: `contentType must be one of: ${VALID_CONTENT_TYPES.join(', ')}` });
  }
  // Series-specific fields are required for 'series' AND 'podcast' — a
  // podcast episode always belongs to a show (even a show with only one
  // episode so far), same reasoning as a series episode always belonging
  // to a series. Standalone movie/short/vertical has no season or order.
  if ((body.contentType === 'series' || body.contentType === 'podcast') && (!body.seriesId || !body.seriesOrder)) {
    return res.status(400).json({ error: `${body.contentType === 'podcast' ? 'Podcast' : 'Series'} episodes need a show/series and an episode number.` });
  }
  // Bonus content attaches to a show but isn't part of its own numbered
  // episode sequence — no season/order needed, just which show it's for.
  if (body.contentType === 'bonus' && !body.seriesId) {
    return res.status(400).json({ error: 'Choose which show this bonus content is for.' });
  }

  // Every episode needs at least one way to actually play — a video, an
  // audio file, or both (podcasts specifically can be either/or/both;
  // every other content type is video-only in practice, but this check
  // doesn't need to special-case that since a video-only submission
  // naturally satisfies it).
  if (!body.videoUid && !body.audioUrl) {
    return res.status(400).json({ error: 'Add a video, an audio file, or both — there\u2019s nothing to play otherwise.' });
  }

  let src = null;
  if (body.videoUid) {
    src = cloudflarePlaybackUrl(body.videoUid);
    if (!src) {
      return res.status(500).json({ error: 'Could not resolve the uploaded video — is Cloudflare Stream fully configured?' });
    }
    // SECURITY: a videoUid arriving from this app's own upload flow (TUS or
    // URL import) is inherently trustworthy — it's the direct result of an
    // upload that just happened. A hand-typed video ID (the "paste a
    // Cloudflare video ID" option) is not — there's no proof it's ready,
    // finished processing, or even belongs to this creator, so it gets
    // re-verified against Cloudflare directly before being trusted, same
    // as manual episode entry and house ads already do.
    if (body.videoIdWasManuallyEntered) {
      const status = await getCloudflareVideoStatus(body.videoUid);
      if (!status || !status.readyToStream) {
        return res.status(400).json({ error: 'That video ID isn\u2019t ready to stream yet in Cloudflare — wait for it to finish processing.' });
      }
    }
  }

  // trailerUid is optional — a creator may not have a separate trailer cut
  // ready yet. If they uploaded one, it went through the exact same TUS
  // flow as the main video (see get-upload-url.js), just a second time.
  let trailerSrc = null;
  if (body.trailerUid) {
    trailerSrc = cloudflarePlaybackUrl(body.trailerUid);
    if (!trailerSrc) {
      return res.status(500).json({ error: 'Could not resolve the uploaded trailer — is Cloudflare Stream fully configured?' });
    }
    if (body.trailerIdWasManuallyEntered) {
      const trailerStatus = await getCloudflareVideoStatus(body.trailerUid);
      if (!trailerStatus || !trailerStatus.readyToStream) {
        return res.status(400).json({ error: 'That trailer video ID isn\u2019t ready to stream yet in Cloudflare.' });
      }
    }
  }

  // A stable, URL-safe id derived from the title — good enough for a
  // creator-facing flow; an admin can rename it during review if a
  // collision or something unreadable comes through.
  const id = `${body.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')}-${Date.now().toString(36)}`;

  // Poster and thumbnail are both optional — a submission is still valid
  // without them (it just shows the gradient placeholder until an admin
  // or a follow-up submission adds artwork). Errors here (e.g. a file
  // that's too large) DO fail the whole submission rather than silently
  // dropping the image, so a creator finds out immediately rather than
  // discovering a missing poster days later.
  let poster = null;
  let thumbnail = null;
  try {
    [poster, thumbnail] = await Promise.all([
      uploadArtworkImage({ base64: body.posterBase64, fileName: body.posterFileName, pathPrefix: `${id}-poster` }),
      uploadArtworkImage({ base64: body.thumbnailBase64, fileName: body.thumbnailFileName, pathPrefix: `${id}-thumbnail` })
    ]);
  } catch (err) {
    console.error('submit-episode artwork error:', err.message);
    return res.status(400).json({ error: err.message });
  }

  // "__new__" means the creator picked "a new series not listed here" in
  // the dropdown — there's no real series row for it yet, so series_id has
  // to stay null (the column has a foreign key to series.id) rather than
  // trying to insert a value that doesn't exist there. The creator was
  // told in the UI to name the new series in their description instead;
  // the admin sets up the real series and reassigns this during review.
  const isNewSeries = body.seriesId === '__new__';

  const supabase = getSupabase();
  const { error } = await supabase.from('episodes').insert({
    id,
    title: body.title,
    description: body.description,
    tier: body.tier,
    genre: body.genre,
    main_genre: body.mainGenre,
    content_type: body.contentType,
    series_id: (body.contentType === 'series' || body.contentType === 'podcast') && !isNewSeries ? body.seriesId : null,
    season: (body.contentType === 'series' || body.contentType === 'podcast') ? Number(body.season) || 1 : null,
    series_order: (body.contentType === 'series' || body.contentType === 'podcast') ? Number(body.seriesOrder) : null,
    bonus_parent_type: body.contentType === 'bonus' ? 'series' : null,
    bonus_parent_id: body.contentType === 'bonus' ? body.seriesId : null,
    artist: body.artist,
    runtime: body.runtime,
    rating: body.rating || null,
    video_type: 'html5',
    src,
    audio_url: body.audioUrl || null,
    trailer_src: trailerSrc,
    poster,
    thumbnail,
    status: 'pending',
    submitted_by: userId
  });

  if (error) {
    console.error('submit-episode error:', error.message);
    return res.status(500).json({ error: 'Could not save the submission.' });
  }

  return res.status(200).json({ ok: true, id, status: 'pending' });
}
