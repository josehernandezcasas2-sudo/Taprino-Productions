import { getRoleContext } from '../../../lib/roles';
import { getSupabase } from '../../../lib/supabase';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { userId, isAdmin } = await getRoleContext(req);
  if (!isAdmin) {
    return res.status(403).json({ error: 'Admin access required.' });
  }

  const { episodeId, decision, rejectionReason, tierOverride, featured } = req.body || {};
  if (!episodeId || !['approve', 'reject'].includes(decision)) {
    return res.status(400).json({ error: 'episodeId and a decision of approve/reject are required.' });
  }

  const supabase = getSupabase();

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

  return res.status(200).json({ ok: true, episodeId, status: updates.status });
}
