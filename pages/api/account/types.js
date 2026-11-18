import { getRoleContext } from '../../../lib/roles';
import { readAccountTypes, saveAccountTypes, suggestedTypesFor } from '../../../lib/accountTypes';
import { applyCors } from '../../../lib/cors';
import { checkRateLimit } from '../../../lib/rateLimit';
import { sendError } from '../../../lib/apiErrors';

// Account types (migration 126; rules in lib/accountTypeRules.js).
//   GET  → { types, main, asked, watcher, available, suggested, isCreator }
//   POST { types: [...], main } or { skip: true } → the saved state
// Signed in only; the person's own types, nobody else's.
export default async function handler(req, res) {
  applyCors(req, res);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  res.setHeader('Cache-Control', 'private, no-store');

  const { userId, isCreator } = await getRoleContext(req);
  if (!userId) return res.status(401).json({ error: 'Not signed in.' });

  try {
    if (req.method === 'GET') {
      const [state, suggested] = await Promise.all([
        readAccountTypes(userId),
        suggestedTypesFor(userId, { isCreator: Boolean(isCreator) })
      ]);
      return res.status(200).json({ ...state, suggested, isCreator: Boolean(isCreator) });
    }
    if (req.method === 'POST') {
      if (!(await checkRateLimit(`account-types:${userId}`, 60, 3600))) {
        return res.status(429).json({ error: 'That’s a lot of changes. Try again in a while.' });
      }
      const state = await saveAccountTypes(userId, req.body || {});
      return res.status(200).json({ ...state, isCreator: Boolean(isCreator) });
    }
    res.setHeader('Allow', 'GET, POST, OPTIONS');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    if (err && err.code === 'migration-126') return res.status(503).json({ error: err.message, code: 'migration-126' });
    return sendError(res, err, 'account/types');
  }
}
