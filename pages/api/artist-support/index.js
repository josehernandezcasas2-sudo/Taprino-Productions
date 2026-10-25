import { getAccountContext } from '../../../lib/accountContext';
import { ArtistSupportError, getArtistSupportPayload, saveLineup } from '../../../lib/artistSupport';
import { checkRateLimit, rateLimitKeyForRequest } from '../../../lib/rateLimit';
import { applyCors } from '../../../lib/cors';

// Membership Artist Support — the member's lineup. GET answers with
// everything the card draws (tier, share, picks, split); POST replaces the
// lineup ({ picks: [{ creatorId, weight }], mode, shareVisible }) and
// answers with the fresh state. Same CORS/OPTIONS shape as the other
// routes the app calls with a Bearer token.
export default async function handler(req, res) {
  applyCors(req, res);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST, OPTIONS');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  res.setHeader('Cache-Control', 'private, no-store');

  const account = await getAccountContext(req);
  if (!account.isSignedIn) return res.status(401).json({ error: 'Sign in to choose your creators.', isSignedIn: false });

  try {
    if (req.method === 'POST') {
      if (!(await checkRateLimit(rateLimitKeyForRequest(req, 'artist-support-save'), 60, 600))) {
        return res.status(429).json({ error: 'Too many changes in a row — give it a minute.' });
      }
      await saveLineup(account.userId, req.body || {});
    }
    const payload = await getArtistSupportPayload(account.userId, account.tier);
    return res.status(200).json(payload);
  } catch (err) {
    const status = err instanceof ArtistSupportError ? err.status : 500;
    if (status === 500) console.error('artist-support error:', err.message);
    return res.status(status).json({ error: err.message });
  }
}
