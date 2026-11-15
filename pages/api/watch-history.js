import { getAuth } from '@clerk/nextjs/server';
import { recordWatched, removeWatchHistoryEntry } from '../../lib/watchHistory';
import { applyCors } from '../../lib/cors';
import { checkRateLimit } from '../../lib/rateLimit';
import { isTitleId } from '../../lib/titleIds';

export default async function handler(req, res) {
  applyCors(req, res);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'POST, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  const { userId } = getAuth(req);
  if (!userId) {
    return res.status(401).json({ error: 'Not signed in.' });
  }

  if (req.method === 'POST') {
    const { episodeId } = req.body || {};
    if (!episodeId || !isTitleId(String(episodeId))) return res.status(400).json({ error: 'episodeId is required.' });
    // A title is finished once in a while, never hundreds of times an hour
    // (2026-11-15): what's watched steers a member's share to creators.
    if (!(await checkRateLimit(`watch-history:${userId}`, 120, 3600))) return res.status(429).json({ error: 'Slow down a little.' });
    await recordWatched(userId, String(episodeId));
    return res.status(200).json({ ok: true });
  }

  if (req.method === 'DELETE') {
    const { episodeId } = req.body || {};
    if (!episodeId || !isTitleId(String(episodeId))) return res.status(400).json({ error: 'episodeId is required.' });
    await removeWatchHistoryEntry(userId, String(episodeId));
    return res.status(200).json({ ok: true });
  }

  res.setHeader('Allow', 'POST, DELETE');
  return res.status(405).json({ error: 'Method not allowed' });
}
