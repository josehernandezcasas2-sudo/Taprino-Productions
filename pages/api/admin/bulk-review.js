import { getRoleContext } from '../../../lib/roles';
import { getSupabase } from '../../../lib/supabase';

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

  const { userId, isAdmin } = await getRoleContext(req);
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

  return res.status(200).json({ ok: true, updatedCount: (data || []).length, decision });
}
