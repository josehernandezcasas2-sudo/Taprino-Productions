import { getAuth } from '@clerk/nextjs/server';
import { normalizeHandle, handleError, isHandleTaken } from '../../../lib/userProfiles';

// Live "@name is available / taken" under the handle field on the
// account page (web and app). Advisory only: saving still runs the same
// checks and the database's unique index has the final say.
//   GET ?handle=<name> → { handle, ok, reason }
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  res.setHeader('Cache-Control', 'private, no-store');
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: 'Sign in first.' });

  const handle = normalizeHandle(req.query.handle);
  if (!handle) return res.status(200).json({ handle: null, ok: true, reason: null });
  const problem = handleError(handle);
  if (problem) return res.status(200).json({ handle, ok: false, reason: problem });
  try {
    const taken = await isHandleTaken(handle, userId);
    return res.status(200).json({ handle, ok: !taken, reason: taken ? `@${handle} is already taken — try another.` : null });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
