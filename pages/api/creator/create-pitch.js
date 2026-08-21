import { getAuth } from '@clerk/nextjs/server';
import { getSupabase } from '../../../lib/supabase';
import { uploadArtworkImage } from '../../../lib/artworkUpload';
import { PITCH_TAGS } from '../../../lib/pitches';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { userId } = getAuth(req);
  if (!userId) {
    return res.status(401).json({ error: 'Sign in to submit a project.' });
  }

  const body = req.body || {};
  if (!body.title || !body.logline || !body.projectUrl) {
    return res.status(400).json({ error: 'Title, logline, and project URL are required.' });
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
      title: body.title,
      logline: body.logline,
      description: body.description || null,
      project_url: body.projectUrl,
      tag: body.tag || null,
      thumbnail,
      hero_image: heroImage,
      funding_goal: body.fundingGoal ? Number(body.fundingGoal) : null,
      funding_raised: body.fundingRaised ? Number(body.fundingRaised) : null,
      team: Array.isArray(body.team) ? body.team : [],
      status: 'pending',
      created_by: userId,
      submitted_by: userId
    })
    .select('id')
    .single();

  if (error) {
    console.error('create-pitch error:', error.message);
    return res.status(500).json({ error: `Could not submit your project: ${error.message}` });
  }

  return res.status(200).json({ ok: true, pitchId: data.id });
}
