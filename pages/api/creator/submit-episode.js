import { getRoleContext } from '../../../lib/roles';
import { getSupabase } from '../../../lib/supabase';
import { cloudflarePlaybackUrl } from '../../../lib/cloudflareUpload';
import { checkRateLimit, rateLimitKeyForRequest } from '../../../lib/rateLimit';

// Every one of these has to be present and non-empty — this is the actual
// enforcement of "creators must submit complete metadata," not just a UI
// nicety. A form can be bypassed by anyone calling this endpoint directly;
// this check can't be.
const REQUIRED_FIELDS = ['title', 'description', 'contentType', 'genre', 'mainGenre', 'runtime', 'artist', 'tier', 'videoUid'];
const VALID_TIERS = ['free', 'premium'];
const VALID_CONTENT_TYPES = ['series', 'movie', 'short', 'vertical', 'podcast'];

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { userId, isCreator } = await getRoleContext(req);
  if (!isCreator) {
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
  // Series-specific fields are only required when contentType is 'series' —
  // a standalone movie/short/vertical/podcast has no season or order.
  if (body.contentType === 'series' && (!body.seriesId || !body.seriesOrder)) {
    return res.status(400).json({ error: 'Series episodes need seriesId and seriesOrder.' });
  }

  const src = cloudflarePlaybackUrl(body.videoUid);
  if (!src) {
    return res.status(500).json({ error: 'Could not resolve the uploaded video — is Cloudflare Stream fully configured?' });
  }

  // A stable, URL-safe id derived from the title — good enough for a
  // creator-facing flow; an admin can rename it during review if a
  // collision or something unreadable comes through.
  const id = `${body.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')}-${Date.now().toString(36)}`;

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
    series_id: body.contentType === 'series' && !isNewSeries ? body.seriesId : null,
    season: body.contentType === 'series' ? Number(body.season) || 1 : null,
    series_order: body.contentType === 'series' ? Number(body.seriesOrder) : null,
    artist: body.artist,
    runtime: body.runtime,
    video_type: 'html5',
    src,
    status: 'pending',
    submitted_by: userId
  });

  if (error) {
    console.error('submit-episode error:', error.message);
    return res.status(500).json({ error: 'Could not save the submission.' });
  }

  return res.status(200).json({ ok: true, id, status: 'pending' });
}
