import { getAuth } from '@clerk/nextjs/server';
import { reportThread } from '../../../lib/messages';
import { REPORT_REASONS } from '../../../lib/reportReasons';

// Report a conversation: POST { threadId, reason } → { ok }. Snapshots
// the last messages for the admin (dm_reports) and files a profile
// report on the other person through lib/moderation.js.
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: 'Sign in first.' });
  const { threadId, reason } = req.body || {};
  if (!REPORT_REASONS[reason]) return res.status(400).json({ error: 'Pick a reason.' });
  if (!/^[0-9a-f-]{36}$/i.test(String(threadId || ''))) return res.status(404).json({ error: 'Not found.' });
  try {
    return res.status(200).json(await reportThread(userId, threadId, reason));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('messages/report:', err.message);
    return res.status(500).json({ error: 'Could not send that report right now.' });
  }
}
