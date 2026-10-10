import { getAuth } from '@clerk/nextjs/server';
import { getConversation, sendMessage, setMuted } from '../../../lib/messages';

// One conversation.
//   GET   ?since=<iso> → { thread, messages } (only { messages } with since)
//   POST  { body }     → { threadId, message }
//   PATCH { muted }    → { muted }
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');

  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: 'Sign in to see your messages.' });
  const threadId = String(req.query.id || '');
  if (!/^[0-9a-f-]{36}$/i.test(threadId)) return res.status(404).json({ error: 'Not found.' });

  try {
    if (req.method === 'GET') {
      const since = req.query.since ? String(req.query.since) : null;
      return res.status(200).json(await getConversation(userId, threadId, { since }));
    }
    if (req.method === 'POST') {
      const { body } = req.body || {};
      return res.status(201).json(await sendMessage(userId, { threadId, body }));
    }
    if (req.method === 'PATCH') {
      const { muted } = req.body || {};
      if (muted === undefined) return res.status(400).json({ error: 'Nothing to change.' });
      return res.status(200).json(await setMuted(userId, threadId, muted));
    }
    res.setHeader('Allow', 'GET, POST, PATCH');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('messages/[id]:', err.message);
    return res.status(500).json({ error: 'Could not load that conversation right now.' });
  }
}
