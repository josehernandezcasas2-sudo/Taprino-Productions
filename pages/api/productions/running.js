import { getAuth } from '@clerk/nextjs/server';
import { getRunningProductions } from '../../../lib/productionDashboard';
import { checkRateLimit } from '../../../lib/rateLimit';
import { sendError } from '../../../lib/apiErrors';
import { applyCors } from '../../../lib/cors';

// The ☰ menu's "Running now" (lib/siteMenuRules.js menuRunning): the
// productions the signed-in person runs (owns, or is a listed producer of)
// that are still being made, the ones that need them first. The menu reads
// it as it opens, at most every two minutes.
//   GET → { items: [{ id, title, status, statusLabel, line, needsYou }], total }
export default async function handler(req, res) {
  applyCors(req, res);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: 'Sign in first.' });
  if (!(await checkRateLimit(`productions-running:${userId}`, 60, 60))) return res.status(429).json({ error: 'Slow down a little.' });
  try {
    return res.status(200).json(await getRunningProductions(userId));
  } catch (err) {
    return sendError(res, err, 'productions/running', 'Could not load your productions right now.');
  }
}
