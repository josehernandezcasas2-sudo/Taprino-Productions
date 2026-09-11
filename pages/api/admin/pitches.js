import { getRoleContext } from '../../../lib/roles';
import { getSupabase } from '../../../lib/supabase';
import { getAllPitches, PITCH_TAGS } from '../../../lib/pitches';
import { getTotalRaisedForPitch } from '../../../lib/pitchDonations';
import { uploadArtworkImage } from '../../../lib/artworkUpload';
import { normalizeUrl } from '../../../lib/normalizeUrl';
import { recordAudit } from '../../../lib/auditLog';

// Default Next.js API body limit is 1MB — a base64-encoded image (roughly
// 33% larger than the original file) plus the rest of the JSON payload
// blows past that for any normally-sized upload, failing with a 413
// before the handler below ever runs. Matches the limit already used by
// every other image-upload endpoint in this app (e.g. add-artwork.js).
export const config = {
  api: { bodyParser: { sizeLimit: '10mb' } }
};

export default async function handler(req, res) {
  const { userId, email, isAdmin } = await getRoleContext(req);
  if (!isAdmin) {
    return res.status(403).json({ error: 'Admin access required.' });
  }

  const supabase = getSupabase();

  if (req.method === 'GET') {
    const pitches = await getAllPitches();
    // Only worth the extra query for pitches that actually use in-platform
    // funding — everything else (the large majority, still using the
    // original external-link model) has nothing to sum here at all.
    const withTotals = await Promise.all(
      pitches.map(async (p) => {
        if (!p.funding_enabled) return p;
        const totalRaisedCents = await getTotalRaisedForPitch(p.id);
        return { ...p, total_raised_cents: totalRaisedCents };
      })
    );
    return res.status(200).json({ pitches: withTotals });
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
      project_url: normalizeUrl(projectUrl),
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
    const { pitchId, status, cutPercent, disableFunding } = req.body || {};
    if (!pitchId) {
      return res.status(400).json({ error: 'pitchId is required.' });
    }

    // Funding enable/disable is a separate, optional action from a
    // status change — admin typically enables funding on a pitch that's
    // already approved, as its own follow-up step, not bundled into the
    // same request that first approved it.
    if (cutPercent != null || disableFunding) {
      if (disableFunding) {
        const { error } = await supabase.from('pitches').update({ funding_enabled: false }).eq('id', pitchId);
        if (error) {
          console.error('pitches disable-funding error:', error.message);
          return res.status(500).json({ error: `Could not disable funding: ${error.message}` });
        }
        await recordAudit({ adminId: userId, adminEmail: email, action: 'pitch_funding_disabled', targetType: 'pitch', targetId: pitchId });
      } else {
        const numericCut = Number(cutPercent);
        if (!Number.isFinite(numericCut) || numericCut < 0 || numericCut > 100) {
          return res.status(400).json({ error: 'cutPercent must be a number between 0 and 100.' });
        }
        const { data: pitchRow, error: fetchError } = await supabase.from('pitches').select('status').eq('id', pitchId).maybeSingle();
        if (fetchError || !pitchRow) {
          return res.status(404).json({ error: 'Pitch not found.' });
        }
        if (pitchRow.status !== 'approved') {
          return res.status(400).json({ error: 'Only an approved pitch can have funding enabled.' });
        }
        const { error } = await supabase
          .from('pitches')
          .update({ funding_enabled: true, platform_cut_percent: numericCut, reviewed_by: email, reviewed_at: new Date().toISOString() })
          .eq('id', pitchId);
        if (error) {
          console.error('pitches enable-funding error:', error.message);
          return res.status(500).json({ error: `Could not enable funding: ${error.message}` });
        }
        await recordAudit({ adminId: userId, adminEmail: email, action: 'pitch_funding_enabled', targetType: 'pitch', targetId: pitchId, details: `${numericCut}%` });
      }
      if (!status) return res.status(200).json({ ok: true });
    }

    if (status) {
      if (!['pending', 'approved', 'rejected'].includes(status)) {
        return res.status(400).json({ error: 'status must be pending, approved, or rejected.' });
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
    }
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
