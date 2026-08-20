import { getAuth } from '@clerk/nextjs/server';
import { recordWatched, removeWatchHistoryEntry } from '../../lib/watchHistory';

export default async function handler(req, res) {
  const { userId } = getAuth(req);
  if (!userId) {
    return res.status(401).json({ error: 'Not signed in.' });
  }

  if (req.method === 'POST') {
    const { episodeId } = req.body || {};
    if (!episodeId) return res.status(400).json({ error: 'episodeId is required.' });
    await recordWatched(userId, episodeId);
    return res.status(200).json({ ok: true });
  }

  if (req.method === 'DELETE') {
    const { episodeId } = req.body || {};
    if (!episodeId) return res.status(400).json({ error: 'episodeId is required.' });
    await removeWatchHistoryEntry(userId, episodeId);
    return res.status(200).json({ ok: true });
  }

  res.setHeader('Allow', 'POST, DELETE');
  return res.status(405).json({ error: 'Method not allowed' });
}
