import { getAuth } from '@clerk/nextjs/server';
import { listMyRequests } from '../../../../lib/locationRequests';
import { locationRules } from '../../../../lib/locationRules';
import { applyCors } from '../../../../lib/cors';

// Every request the signed-in person is part of.
//   GET → { asHost: [...], asProducer: [...], rules }
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
  if (!userId) return res.status(401).json({ error: 'Sign in first.' });
  try {
    return res.status(200).json({ ...(await listMyRequests(userId)), rules: locationRules() });
  } catch (err) {
    console.error('location requests:', err.message);
    return res.status(500).json({ error: 'Could not load your requests.' });
  }
}
