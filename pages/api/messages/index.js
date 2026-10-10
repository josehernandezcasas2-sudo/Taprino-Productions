import { getAuth } from '@clerk/nextjs/server';
import { listThreads, sendMessage } from '../../../lib/messages';

// Messages inbox.
//   GET  → { threads, unread }
//   POST { toUserId, body, context? } → starts (or continues) the
//          conversation with that person → { threadId, message }
// CORS like the other account routes so the app can call it with a
// Bearer token.
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');

  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: 'Sign in to see your messages.' });

  try {
    if (req.method === 'GET') return res.status(200).json(await listThreads(userId));
    if (req.method === 'POST') {
      const { toUserId, body, context } = req.body || {};
      return res.status(201).json(await sendMessage(userId, { toUserId, body, context }));
    }
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('messages:', err.message);
    return res.status(500).json({ error: 'Could not load your messages right now.' });
  }
}
