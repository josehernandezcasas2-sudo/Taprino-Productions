import { getAuth } from '@clerk/nextjs/server';
import { listCalls, createCall } from '../../../../lib/crewCalls';
import { crewCallRules } from '../../../../lib/crewCallRules';
import { checkRateLimit, rateLimitKeyForRequest } from '../../../../lib/rateLimit';

// The Crew Call board.
//   GET  ?q=&role=&pay=paid,union&remote=1&lat=&lng=&within=50&matches=1&project=pitch:<id>&mine=1&closed=1
//        → { calls, total, hasCard, rules }
//   POST { title, role, spots, payType, payNote, startsOn, endsOn, remote, place, project, details }
//        → the new call (same shape as GET /api/crew/calls/<id>)
// Public to read; posting needs a signed-in account.
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  const { userId } = getAuth(req);

  try {
    if (req.method === 'GET') {
      if (!(await checkRateLimit(rateLimitKeyForRequest(req, 'crew-calls'), 120, 60))) return res.status(429).json({ error: 'Slow down a little.' });
      const { q, role, pay, remote, lat, lng, within, matches, project, mine, closed } = req.query;
      const result = await listCalls({
        q: q || '',
        role: role || null,
        payTypes: pay ? String(pay).split(',').filter(Boolean) : [],
        remoteOnly: remote === '1',
        lat, lng,
        withinMiles: within,
        matches: matches === '1',
        project: project || null,
        mine: mine === '1',
        includeClosed: closed === '1'
      }, { viewerId: userId || null });
      return res.status(200).json({ ...result, rules: crewCallRules() });
    }
    if (req.method === 'POST') {
      if (!userId) return res.status(401).json({ error: 'Sign in to post a call.' });
      return res.status(201).json(await createCall(userId, req.body || {}));
    }
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('crew/calls:', err.message);
    return res.status(500).json({ error: 'Could not load the board right now.' });
  }
}
