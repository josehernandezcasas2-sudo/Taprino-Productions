import { getAuth } from '@clerk/nextjs/server';
import { getSupabase } from '../../lib/supabase';
import { checkRateLimit } from '../../lib/rateLimit';
import { applyCors } from '../../lib/cors';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function handler(req, res) {
  applyCors(req, res);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const { userId } = getAuth(req);
  if (!userId) {
    return res.status(401).json({ error: 'Sign in to report a comment.' });
  }

  const { commentId, reason } = req.body || {};
  if (!UUID_RE.test(String(commentId || ''))) return res.status(400).json({ error: 'commentId is required.' });
  if (!(await checkRateLimit(`comment-report:${userId}`, 20, 3600))) {
    return res.status(429).json({ error: 'That’s a lot of reports for one hour — try again later.' });
  }

  const supabase = getSupabase();
  const { data: comment } = await supabase.from('pitch_comments').select('id, status').eq('id', commentId).maybeSingle();
  if (!comment || comment.status !== 'visible') return res.status(404).json({ error: 'That comment isn’t here.' });
  const cleanReason = typeof reason === 'string' ? reason.trim().slice(0, 300) : '';
  // A report flags for review — it does NOT hide the comment itself. A
  // single report shouldn't be able to silently take down someone's
  // comment before a person looks at it; that's what the admin queue is
  // for. This also means reporting the same comment twice just updates
  // the reason rather than doing anything more drastic.
  const { error } = await supabase
    .from('pitch_comments')
    .update({ reported: true, report_reason: cleanReason || null })
    .eq('id', commentId);

  if (error) {
    console.error('pitch-comment-report error:', error.message);
    return res.status(500).json({ error: 'Could not submit that report.' });
  }
  return res.status(200).json({ ok: true });
}
