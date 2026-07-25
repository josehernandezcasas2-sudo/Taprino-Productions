import { getRoleContext } from '../../../lib/roles';
import { getSupabase } from '../../../lib/supabase';
import { recordAudit } from '../../../lib/auditLog';
import { notifyCreator } from '../../../lib/notify';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { userId, email, isAdmin } = await getRoleContext(req);
  if (!isAdmin) {
    return res.status(403).json({ error: 'Admin access required.' });
  }

  const { episodeId, decision, rejectionReason, tierOverride, featured } = req.body || {};
  if (!episodeId || !['approve', 'reject'].includes(decision)) {
    return res.status(400).json({ error: 'episodeId and a decision of approve/reject are required.' });
  }

  const supabase = getSupabase();

  const { data: existing } = await supabase.from('episodes').select('title, submitted_by').eq('id', episodeId).maybeSingle();

  const updates = {
    status: decision === 'approve' ? 'approved' : 'rejected',
    reviewed_by: userId,
    reviewed_at: new Date().toISOString()
  };
  if (decision === 'reject') {
    updates.rejection_reason = rejectionReason || null;
  }
  // The admin gets final say on tier and whether it's featured — a creator
  // can suggest, but pricing/promotion decisions stay with you.
  if (decision === 'approve' && tierOverride && ['free', 'premium'].includes(tierOverride)) {
    updates.tier = tierOverride;
  }
  if (decision === 'approve' && typeof featured === 'boolean') {
    updates.featured = featured;
  }

  const { error } = await supabase.from('episodes').update(updates).eq('id', episodeId).eq('status', 'pending');

  if (error) {
    console.error('review-submission error:', error.message);
    return res.status(500).json({ error: 'Could not update the submission.' });
  }

  await recordAudit({
    adminId: userId,
    adminEmail: email,
    action: decision === 'approve' ? 'approve_submission' : 'reject_submission',
    targetType: 'episode',
    targetId: episodeId,
    details: existing ? existing.title : undefined
  });

  if (existing) {
    await notifyCreator({
      userId: existing.submitted_by,
      type: decision === 'approve' ? 'episode_approved' : 'episode_rejected',
      message: decision === 'approve'
        ? `"${existing.title}" was approved and is now live.`
        : `"${existing.title}" was rejected.${rejectionReason ? ` Reason: ${rejectionReason}` : ''}`,
      episodeId
    });
  }

  return res.status(200).json({ ok: true, episodeId, status: updates.status });
}
