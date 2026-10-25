import { getRoleContext } from '../../../../lib/roles';
import { getCallSheet } from '../../../../lib/productions';
import { applyCors } from '../../../../lib/cors';

// One day's call sheet — the crew on the production, the owner, admins.
//   GET ?day=<n> → { production, day, days, departments, crewCount, listing, requestHref, canEdit }
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
  const id = String(req.query.id || '');
  if (!/^[0-9a-f-]{36}$/i.test(id)) return res.status(404).json({ error: 'That production isn’t here.' });
  try {
    const account = await getRoleContext(req).catch(() => ({ userId: null, isAdmin: false }));
    if (!account.userId) return res.status(401).json({ error: 'Sign in to see the call sheet.' });
    return res.status(200).json(await getCallSheet(id, Number(req.query.day) || 1, { viewerId: account.userId, isAdmin: account.isAdmin }));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('productions/[id]/sheet:', err.message);
    return res.status(500).json({ error: 'Could not load the call sheet right now.' });
  }
}
