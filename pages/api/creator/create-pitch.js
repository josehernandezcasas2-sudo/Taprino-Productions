import { getRoleContext } from '../../../lib/roles';
import { checkRateLimit } from '../../../lib/rateLimit';
import { getSupabase } from '../../../lib/supabase';
import { uploadArtworkImage } from '../../../lib/artworkUpload';
import { normalizeUrl } from '../../../lib/normalizeUrl';
import { PITCH_TAGS } from '../../../lib/pitches';
import { applyCors } from '../../../lib/cors';

// Default Next.js API body limit is 1MB — a base64-encoded image (roughly
// 33% larger than the original file) plus the rest of the JSON payload
// blows past that for any normally-sized upload, failing with a 413
// before the handler below ever runs. Matches the limit already used by
// every other image-upload endpoint in this app (e.g. add-artwork.js).
export const config = {
  api: { bodyParser: { sizeLimit: '10mb' } }
};

export default async function handler(req, res) {
  // The app's Submit a project screen posts here too.
  applyCors(req, res);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { userId, isCreator } = await getRoleContext(req);
  if (!userId) {
    return res.status(401).json({ error: 'Sign in to submit a project.' });
  }
  // /creator/pitch/new is creator-only; the route has to be too.
  if (!isCreator) {
    return res.status(403).json({ error: 'Creator access required.' });
  }
  if (!(await checkRateLimit(`create-pitch:${userId}`, 5, 3600))) {
    return res.status(429).json({ error: 'That’s a lot of projects in one hour — try again later.' });
  }

  const body = req.body || {};
  const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const num = (v) => { const n = Number(v); return v !== '' && v != null && Number.isFinite(n) && n >= 0 ? n : null; };
  const title = str(body.title, 200);
  const logline = str(body.logline, 500);
  if (!title || !logline) {
    return res.status(400).json({ error: 'Title and logline are required.' });
  }
  if (body.tag && !PITCH_TAGS.includes(body.tag)) {
    return res.status(400).json({ error: `tag must be one of: ${PITCH_TAGS.join(', ')}` });
  }

  let thumbnail = null;
  let heroImage = null;
  try {
    if (body.thumbnailBase64) {
      thumbnail = await uploadArtworkImage({ base64: body.thumbnailBase64, fileName: body.thumbnailFileName, pathPrefix: 'pitch-thumb' });
    }
    if (body.heroImageBase64) {
      heroImage = await uploadArtworkImage({ base64: body.heroImageBase64, fileName: body.heroImageFileName, pathPrefix: 'pitch-hero' });
    }
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const supabase = getSupabase();
  // Self-submitted pitches land as 'pending' — an admin has to approve
  // before this shows up anywhere public. This is the one real difference
  // from the admin-direct-add path, which auto-approves.
  const { data, error } = await supabase
    .from('pitches')
    .insert({
      title,
      logline,
      description: str(body.description, 5000) || null,
      project_url: normalizeUrl(body.projectUrl),
      tag: body.tag || null,
      thumbnail,
      hero_image: heroImage,
      funding_goal: num(body.fundingGoal),
      funding_raised: num(body.fundingRaised),
      funding_deadline: /^\d{4}-\d{2}-\d{2}$/.test(String(body.fundingDeadline || '')) ? body.fundingDeadline : null,
      // Team members are plain objects of short strings (name, role…).
      team: Array.isArray(body.team)
        ? body.team.slice(0, 20).filter((m) => m && typeof m === 'object').map((m) => Object.fromEntries(Object.entries(m).filter(([, v]) => typeof v === 'string').map(([k, v]) => [k.slice(0, 40), v.slice(0, 200)])))
        : [],
      status: 'pending',
      created_by: userId,
      submitted_by: userId
    })
    .select('id')
    .single();

  if (error) {
    console.error('create-pitch error:', error.message);
    return res.status(500).json({ error: 'Could not submit your project right now. Try again in a moment.' });
  }

  return res.status(200).json({ ok: true, pitchId: data.id });
}
