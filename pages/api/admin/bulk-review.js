import { getRoleContext } from '../../../lib/roles';
import { getSupabase } from '../../../lib/supabase';
import { recordAudit } from '../../../lib/auditLog';
import { notifyCreator } from '../../../lib/notify';

// Same update shape as review-submission.js, just applied to a batch.
// Bulk reject uses one shared reason for every item in the batch — if a
// creator's submissions need genuinely different rejection reasons, reject
// those individually instead; this is for the common case of rejecting a
// handful of similar problems (e.g. a batch that's all missing artwork) at
// once, not a replacement for the single-item flow.
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { userId, email, isAdmin } = await getRoleContext(req);
  if (!isAdmin) {
    return res.status(403).json({ error: 'Admin access required.' });
  }

  const { episodeIds, decision, rejectionReason } = req.body || {};
  if (!Array.isArray(episodeIds) || episodeIds.length === 0) {
    return res.status(400).json({ error: 'episodeIds must be a non-empty array.' });
  }
  if (episodeIds.length > 100) {
    return res.status(400).json({ error: 'Please select 100 or fewer at a time.' });
  }
  if (!['approve', 'reject'].includes(decision)) {
    return res.status(400).json({ error: 'decision must be "approve" or "reject".' });
  }
  if (decision === 'reject' && (!rejectionReason || !rejectionReason.trim())) {
    return res.status(400).json({ error: 'A reason is required to reject.' });
  }

  const supabase = getSupabase();

  // Fetched before the update so notifications can go out to the right
  // people — once the row's updated there's no way to tell who to notify
  // for episodes that were already approved by someone else in the meantime.
  const { data: targets } = await supabase.from('episodes').select('id, title, submitted_by').in('id', episodeIds).eq('status', 'pending');

  const updates = {
    status: decision === 'approve' ? 'approved' : 'rejected',
    reviewed_by: userId,
    reviewed_at: new Date().toISOString()
  };
  if (decision === 'reject') updates.rejection_reason = rejectionReason;

  // Same `.eq('status', 'pending')` guard as the single-item endpoint —
  // only rows still actually pending get touched, so nothing already
  // reviewed by someone else in the meantime gets clobbered.
  const { data, error } = await supabase
    .from('episodes')
    .update(updates)
    .in('id', episodeIds)
    .eq('status', 'pending')
    .select('id');

  if (error) {
    console.error('bulk-review error:', error.message);
    return res.status(500).json({ error: 'Could not update these submissions.' });
  }

  const updatedCount = (data || []).length;

  await recordAudit({
    adminId: userId,
    adminEmail: email,
    action: decision === 'approve' ? 'bulk_approve_submissions' : 'bulk_reject_submissions',
    targetType: 'episode',
    targetId: null,
    details: `${updatedCount} episode(s)${decision === 'reject' ? `, reason: ${rejectionReason}` : ''}`
  });

  await Promise.all(
    (targets || []).map((t) =>
      notifyCreator({
        userId: t.submitted_by,
        type: decision === 'approve' ? 'episode_approved' : 'episode_rejected',
        message: decision === 'approve'
          ? `"${t.title}" was approved and is now live.`
          : `"${t.title}" was rejected.${rejectionReason ? ` Reason: ${rejectionReason}` : ''}`,
        episodeId: t.id
      })
    )
  );

  return res.status(200).json({ ok: true, updatedCount, decision });
}
