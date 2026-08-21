import { getAuth } from '@clerk/nextjs/server';
import { getSupabase } from '../../lib/supabase';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const { userId } = getAuth(req);
  if (!userId) {
    return res.status(401).json({ error: 'Sign in to report a comment.' });
  }

  const { commentId, reason } = req.body || {};
  if (!commentId) return res.status(400).json({ error: 'commentId is required.' });

  const supabase = getSupabase();
  // A report flags for review — it does NOT hide the comment itself. A
  // single report shouldn't be able to silently take down someone's
  // comment before a person looks at it; that's what the admin queue is
  // for. This also means reporting the same comment twice just updates
  // the reason rather than doing anything more drastic.
  const { error } = await supabase
    .from('pitch_comments')
    .update({ reported: true, report_reason: reason || null })
    .eq('id', commentId);

  if (error) {
    console.error('pitch-comment-report error:', error.message);
    return res.status(500).json({ error: 'Could not submit that report.' });
  }
  return res.status(200).json({ ok: true });
}
