import { getAuth } from '@clerk/nextjs/server';
import { searchPeople, suggestedPeople } from '../../../lib/messagePeople';
import { checkRateLimit, rateLimitKeyForRequest } from '../../../lib/rateLimit';
import { applyCors } from '../../../lib/cors';
import { sendError } from '../../../lib/apiErrors';

// New message's people (lib/messagePeople.js), signed in only.
//   GET                → { productions: [...], following: [...] }  (suggested)
//   GET ?q=<name|@handle> → { people: [...] }  (two letters at least)
// 60 asks a minute per account and 120 per address, so the box can't be
// used to list every account on the site.
export default async function handler(req, res) {
  applyCors(req, res);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: 'Sign in to write to someone.' });
  const [mine, here] = await Promise.all([
    checkRateLimit(`dm-people:${userId}`, 60, 60),
    checkRateLimit(rateLimitKeyForRequest(req, 'dm-people'), 120, 60)
  ]);
  if (!mine || !here) return res.status(429).json({ error: 'Slow down a little.' });
  try {
    const q = typeof req.query.q === 'string' ? req.query.q : '';
    if (q.trim()) return res.status(200).json(await searchPeople(userId, q));
    return res.status(200).json(await suggestedPeople(userId));
  } catch (err) {
    return sendError(res, err, 'messages/people');
  }
}
