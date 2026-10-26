import { getAuth } from '@clerk/nextjs/server';
import { getSupabase } from '../../../lib/supabase';
import { uploadArtworkImage } from '../../../lib/artworkUpload';
import { normalizeUrl } from '../../../lib/normalizeUrl';
import { PITCH_TAGS } from '../../../lib/pitches';

// funding_raised isn't here: with real backing it's counted from paid
// donations, never typed in.
const EDITABLE_FIELDS = ['title', 'logline', 'description', 'projectUrl', 'tag', 'fundingGoal', 'fundingDeadline', 'team', 'photos'];
const FIELD_TO_COLUMN = { projectUrl: 'project_url', fundingGoal: 'funding_goal', fundingRaised: 'funding_raised', fundingDeadline: 'funding_deadline' };

// Default Next.js API body limit is 1MB — a base64-encoded image (roughly
// 33% larger than the original file) plus the rest of the JSON payload
// blows past that for any normally-sized upload, failing with a 413
// before the handler below ever runs. Matches the limit already used by
// every other image-upload endpoint in this app (e.g. add-artwork.js).
export const config = {
  api: { bodyParser: { sizeLimit: '10mb' } }
};

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
  const { data: existing, error: fetchError } = await supabase.from('pitches').select('created_by, status').eq('id', pitchId).maybeSingle();
  if (fetchError || !existing) {
    return res.status(404).json({ error: 'Pitch not found.' });
  }
  // SECURITY: only the creator who submitted this pitch can edit it —
  // being a creator elsewhere on the platform doesn't grant access to
  // someone else's project.
  if (existing.created_by !== userId) {
    return res.status(403).json({ error: 'You can only edit your own pitches.' });
  }
  // Only before review: an approved pitch rewritten here would go live
  // without anyone looking at it. Changes after approval go through a
  // pitch update on the dashboard.
  if (existing.status !== 'pending') {
    return res.status(409).json({ error: 'This pitch has been reviewed, so it can’t be edited here. Post an update from your Pitch Room dashboard instead.' });
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
    } else if (f === 'fundingDeadline') {
      updates[column] = fields[f] || null;
    } else if (f === 'projectUrl') {
      updates[column] = normalizeUrl(fields[f]);
    } else if (f === 'team') {
      // Same shape create-pitch accepts (security round, 2026-10-26): up to
      // 20 members, string fields only, each trimmed.
      updates[column] = Array.isArray(fields[f])
        ? fields[f].slice(0, 20).filter((m) => m && typeof m === 'object').map((m) => Object.fromEntries(Object.entries(m).filter(([, v]) => typeof v === 'string').map(([k, v]) => [k.slice(0, 40), v.slice(0, 200)])))
        : [];
    } else if (f === 'photos') {
      // Only https image addresses, at most 12; anything else is dropped
      // rather than stored and later drawn as an image.
      updates[column] = Array.isArray(fields[f])
        ? fields[f].filter((p) => typeof p === 'string' && /^https:\/\/[^\s"'<>()\\;]+$/i.test(p) && p.length <= 500).slice(0, 12)
        : [];
    } else if (typeof fields[f] === 'string') {
      updates[column] = fields[f].slice(0, f === 'description' ? 8000 : 300);
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
    return res.status(500).json({ error: 'Could not save your changes. Try again in a moment.' });
  }

  return res.status(200).json({ ok: true });
}
