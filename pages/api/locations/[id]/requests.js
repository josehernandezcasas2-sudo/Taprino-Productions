import { getAuth } from '@clerk/nextjs/server';
import { createRequest } from '../../../../lib/locationRequests';
import { applyCors } from '../../../../lib/cors';

// Producer: ask for dates at one place.
//   POST { startsOn, endsOn, hoursFrom, hoursTo, crewSize, vehicles, project: {type,id}|null, shooting, message, pricing: 'posted'|'offer', offer }
//        → { request }
export default async function handler(req, res) {
  applyCors(req, res);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: 'Sign in to request dates.' });
  try {
    return res.status(201).json({ request: await createRequest(userId, String(req.query.id || ''), req.body || {}) });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('location request:', err.message);
    return res.status(500).json({ error: 'Could not send that request right now.' });
  }
}
