import { getAuth } from '@clerk/nextjs/server';
import { getSupabase } from '../../../lib/supabase';
import { uploadArtworkImage } from '../../../lib/artworkUpload';
import { normalizeUrl } from '../../../lib/normalizeUrl';
import { PITCH_TAGS } from '../../../lib/pitches';

const EDITABLE_FIELDS = ['title', 'logline', 'description', 'projectUrl', 'tag', 'fundingGoal', 'fundingRaised', 'team', 'photos'];
const FIELD_TO_COLUMN = { projectUrl: 'project_url', fundingGoal: 'funding_goal', fundingRaised: 'funding_raised' };

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { userId } = getAuth(req);
  if (!userId) {
    return res.status(401).json({ error: 'Not signed in.' });
  }

  const { pitchId, ...fields } = req.body || {};
  if (!pitchId) {
    return res.status(400).json({ error: 'pitchId is required.' });
  }

  const supabase = getSupabase();
  const { data: existing, error: fetchError } = await supabase.from('pitches').select('created_by').eq('id', pitchId).maybeSingle();
  if (fetchError || !existing) {
    return res.status(404).json({ error: 'Pitch not found.' });
  }
  // SECURITY: only the creator who submitted this pitch can edit it —
  // being a creator elsewhere on the platform doesn't grant access to
  // someone else's project.
  if (existing.created_by !== userId) {
    return res.status(403).json({ error: 'You can only edit your own pitches.' });
  }

  if (fields.tag && !PITCH_TAGS.includes(fields.tag)) {
    return res.status(400).json({ error: `tag must be one of: ${PITCH_TAGS.join(', ')}` });
  }

  const updates = {};
  for (const f of EDITABLE_FIELDS) {
    if (fields[f] === undefined) continue;
    const column = FIELD_TO_COLUMN[f] || f;
    if ((f === 'fundingGoal' || f === 'fundingRaised') && fields[f] !== '') {
      updates[column] = Number(fields[f]);
    } else if ((f === 'fundingGoal' || f === 'fundingRaised') && fields[f] === '') {
      updates[column] = null;
    } else if (f === 'projectUrl') {
      updates[column] = normalizeUrl(fields[f]);
    } else {
      updates[column] = fields[f];
    }
  }

  try {
    if (fields.thumbnailBase64) {
      updates.thumbnail = await uploadArtworkImage({ base64: fields.thumbnailBase64, fileName: fields.thumbnailFileName, pathPrefix: 'pitch-thumb' });
    }
    if (fields.heroImageBase64) {
      updates.hero_image = await uploadArtworkImage({ base64: fields.heroImageBase64, fileName: fields.heroImageFileName, pathPrefix: 'pitch-hero' });
    }
    if (fields.newPhotoBase64) {
      const newUrl = await uploadArtworkImage({ base64: fields.newPhotoBase64, fileName: fields.newPhotoFileName, pathPrefix: 'pitch-photo' });
      const { data: current } = await supabase.from('pitches').select('photos').eq('id', pitchId).maybeSingle();
      updates.photos = [...((current && current.photos) || []), newUrl];
    }
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const { error } = await supabase.from('pitches').update(updates).eq('id', pitchId);
  if (error) {
    console.error('edit-pitch error:', error.message);
    return res.status(500).json({ error: `Could not save changes: ${error.message}` });
  }

  return res.status(200).json({ ok: true });
}
