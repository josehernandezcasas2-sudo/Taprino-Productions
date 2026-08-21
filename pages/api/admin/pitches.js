import { getRoleContext } from '../../../lib/roles';
import { getSupabase } from '../../../lib/supabase';
import { getAllPitches, PITCH_TAGS } from '../../../lib/pitches';
import { uploadArtworkImage } from '../../../lib/artworkUpload';
import { recordAudit } from '../../../lib/auditLog';

export default async function handler(req, res) {
  const { userId, email, isAdmin } = await getRoleContext(req);
  if (!isAdmin) {
    return res.status(403).json({ error: 'Admin access required.' });
  }

  const supabase = getSupabase();

  if (req.method === 'GET') {
    const pitches = await getAllPitches();
    return res.status(200).json({ pitches });
  }

  if (req.method === 'POST') {
    const { title, logline, description, projectUrl, creatorName, creatorEmail, tag, fundingGoal, fundingRaised, thumbnailBase64, thumbnailFileName } = req.body || {};
    if (!title || !logline) {
      return res.status(400).json({ error: 'Title and logline are required.' });
    }
    if (tag && !PITCH_TAGS.includes(tag)) {
      return res.status(400).json({ error: `tag must be one of: ${PITCH_TAGS.join(', ')}` });
    }

    let thumbnail = null;
    if (thumbnailBase64) {
      try {
        thumbnail = await uploadArtworkImage({ base64: thumbnailBase64, fileName: thumbnailFileName, pathPrefix: 'pitch-thumb' });
      } catch (err) {
        return res.status(400).json({ error: err.message });
      }
    }

    // An admin adding this directly IS the approval — status defaults to
    // 'approved' at the table level. This will need to change to 'pending'
    // once there's an actual public submission form artists use themselves.
    const { error } = await supabase.from('pitches').insert({
      title,
      logline,
      description: description || null,
      project_url: projectUrl || null,
      creator_name: creatorName || null,
      creator_email: creatorEmail || null,
      tag: tag || null,
      funding_goal: fundingGoal ? Number(fundingGoal) : null,
      funding_raised: fundingRaised ? Number(fundingRaised) : null,
      thumbnail,
      reviewed_by: email,
      reviewed_at: new Date().toISOString()
    });
    if (error) {
      console.error('pitches insert error:', error.message);
      return res.status(500).json({ error: `Could not create pitch: ${error.message}` });
    }
    await recordAudit({ adminId: userId, adminEmail: email, action: 'create_pitch', targetType: 'pitch', details: title });
    return res.status(200).json({ ok: true });
  }

  if (req.method === 'PATCH') {
    const { pitchId, status } = req.body || {};
    if (!pitchId || !['pending', 'approved', 'rejected'].includes(status)) {
      return res.status(400).json({ error: 'pitchId and a valid status are required.' });
    }
    const { error } = await supabase
      .from('pitches')
      .update({ status, reviewed_by: email, reviewed_at: new Date().toISOString() })
      .eq('id', pitchId);
    if (error) {
      console.error('pitches update error:', error.message);
      return res.status(500).json({ error: `Could not update pitch: ${error.message}` });
    }
    await recordAudit({ adminId: userId, adminEmail: email, action: `pitch_${status}`, targetType: 'pitch', targetId: pitchId });
    return res.status(200).json({ ok: true });
  }

  if (req.method === 'DELETE') {
    const { pitchId } = req.body || {};
    if (!pitchId) return res.status(400).json({ error: 'pitchId is required.' });
    const { error } = await supabase.from('pitches').delete().eq('id', pitchId);
    if (error) {
      console.error('pitches delete error:', error.message);
      return res.status(500).json({ error: `Could not delete pitch: ${error.message}` });
    }
    await recordAudit({ adminId: userId, adminEmail: email, action: 'delete_pitch', targetType: 'pitch', targetId: pitchId });
    return res.status(200).json({ ok: true });
  }

  res.setHeader('Allow', 'GET, POST, PATCH, DELETE');
  return res.status(405).json({ error: 'Method not allowed' });
}
