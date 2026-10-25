import { getAuth } from '@clerk/nextjs/server';
import { listProductions, createProduction } from '../../../lib/productions';
import { productionRules } from '../../../lib/productionRules';
import { checkRateLimit, rateLimitKeyForRequest } from '../../../lib/rateLimit';
import { applyCors } from '../../../lib/cors';

// Productions (migration 104).
//   GET  ?q=&kind=&status=&owner=   → { productions, total, rules }   (public ones)
//   POST { title, logline, kind, startsOn, endsOn, place, project, notes, visibility }
//        → the new production (same shape as GET /api/productions/<id>)
export default async function handler(req, res) {
  applyCors(req, res);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  const { userId } = getAuth(req);
  try {
    if (req.method === 'GET') {
      if (!(await checkRateLimit(rateLimitKeyForRequest(req, 'productions'), 120, 60))) return res.status(429).json({ error: 'Slow down a little.' });
      const { q, kind, status, owner } = req.query;
      const result = await listProductions({ q: q || '', kind: kind || null, status: status || null, owner: owner || null }, { viewerId: userId || null });
      return res.status(200).json({ ...result, rules: productionRules() });
    }
    if (req.method === 'POST') {
      if (!userId) return res.status(401).json({ error: 'Sign in to start a production.' });
      return res.status(201).json(await createProduction(userId, req.body || {}));
    }
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('productions:', err.message);
    return res.status(500).json({ error: 'Could not load productions right now.' });
  }
}
