import { getAuth } from '@clerk/nextjs/server';
import { getOwnCard, saveCard, deleteCard } from '../../../lib/crewCards';
import { crewOptions } from '../../../lib/crewOptions';
import { getCreditedWork } from '../../../lib/userProfiles';
import { checkRateLimit } from '../../../lib/rateLimit';

// The signed-in person's own Crew Call working card.
//   GET    → { card | null, creditedWork, options }
//   POST   → save the whole card (lib/crewCards.js cleanCardInput) → { card }
//   DELETE → remove it → { ok }
// Same CORS shape as the other account routes so the app can call it
// with a Bearer token.
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');

  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: 'Sign in to set up your working card.' });

  try {
    if (req.method === 'GET') {
      const [card, creditedWork] = await Promise.all([getOwnCard(userId), getCreditedWork(userId)]);
      return res.status(200).json({ card, creditedWork, options: crewOptions() });
    }
    if (req.method === 'POST') {
      if (!(await checkRateLimit(`crew-card:${userId}`, 30, 600))) {
        return res.status(429).json({ error: 'That’s a lot of saves — give it a minute.' });
      }
      const card = await saveCard(userId, req.body || {});
      return res.status(200).json({ card });
    }
    if (req.method === 'DELETE') {
      await deleteCard(userId);
      return res.status(200).json({ ok: true });
    }
    res.setHeader('Allow', 'GET, POST, DELETE');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    if (err.status === 400) return res.status(400).json({ error: err.message });
    console.error('crew/card:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
