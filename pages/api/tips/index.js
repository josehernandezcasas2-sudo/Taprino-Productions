import { getAuth } from '@clerk/nextjs/server';
import { getTipping, getTipsSent, getOwnTip } from '../../../lib/tips';
import { applyCors } from '../../../lib/cors';

// Tips (lib/tips.js). GET ?creator=<userId> → whether the Tip button
// shows for that creator and the numbers the sheet needs (public; the
// button is hidden until the creator's Stripe account can take charges).
// GET ?mine=1 → the tips the signed-in viewer has sent. GET ?id=<tipId>
// → one of their own tips, any status (the banner back from Checkout).
// CORS-open for the app.
export default async function handler(req, res) {
  applyCors(req, res);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET, OPTIONS');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  res.setHeader('Cache-Control', 'private, no-store');
  const { userId } = getAuth(req);
  try {
    if (req.query.mine) {
      if (!userId) return res.status(401).json({ error: 'Sign in first.' });
      return res.status(200).json({ tips: await getTipsSent(userId) });
    }
    if (typeof req.query.id === 'string') {
      if (!userId) return res.status(401).json({ error: 'Sign in first.' });
      const tip = await getOwnTip(userId, req.query.id);
      if (!tip) return res.status(404).json({ error: 'No such tip.' });
      return res.status(200).json({ tip });
    }
    const creator = typeof req.query.creator === 'string' ? req.query.creator : null;
    if (!creator) return res.status(400).json({ error: 'creator is required.' });
    return res.status(200).json(await getTipping(creator, { viewerId: userId }));
  } catch (err) {
    console.error('tips error:', err.message);
    return res.status(500).json({ error: 'Could not load tipping right now.' });
  }
}
