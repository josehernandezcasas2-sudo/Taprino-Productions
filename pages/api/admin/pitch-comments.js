import { getRoleContext } from '../../../lib/roles';
import { getSupabase } from '../../../lib/supabase';
import { getReportedComments } from '../../../lib/pitches';
import { recordAudit } from '../../../lib/auditLog';

export default async function handler(req, res) {
  const { userId, email, isAdmin } = await getRoleContext(req);
  if (!isAdmin) {
    return res.status(403).json({ error: 'Admin access required.' });
  }

  if (req.method === 'GET') {
    const comments = await getReportedComments();
    return res.status(200).json({ comments });
  }

  if (req.method === 'PATCH') {
    const { commentId, action } = req.body || {};
    if (!commentId || !['keep', 'delete'].includes(action)) {
      return res.status(400).json({ error: 'commentId and action (keep|delete) are required.' });
    }
    const supabase = getSupabase();
    // "Keep" clears the report flag but leaves the comment visible.
    // "Delete" soft-deletes via status, preserving a record of what was
    // removed rather than a hard row delete.
    const updates = action === 'keep'
      ? { reported: false, report_reason: null }
      : { status: 'deleted', reported: false };
    const { error } = await supabase.from('pitch_comments').update(updates).eq('id', commentId);
    if (error) {
      console.error('pitch-comments moderate error:', error.message);
      return res.status(500).json({ error: `Could not update that comment: ${error.message}` });
    }
    await recordAudit({ adminId: userId, adminEmail: email, action: `pitch_comment_${action}`, targetType: 'pitch_comment', targetId: commentId });
    return res.status(200).json({ ok: true });
  }

  res.setHeader('Allow', 'GET, PATCH');
  return res.status(405).json({ error: 'Method not allowed' });
}
