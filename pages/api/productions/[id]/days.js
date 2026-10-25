import { getRoleContext } from '../../../../lib/roles';
import { saveDay, deleteDay } from '../../../../lib/productions';

// Shoot days (the call sheet), owner or admin.
//   PUT    { dayId?, shootOn, callTime, wrapTime, locationId, placeLabel, address, parking, scenes, notes }
//          → the production (new day when dayId is missing)
//   DELETE { dayId }
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  const id = String(req.query.id || '');
  if (!/^[0-9a-f-]{36}$/i.test(id)) return res.status(404).json({ error: 'That production isn’t here.' });
  try {
    const account = await getRoleContext(req).catch(() => ({ userId: null, isAdmin: false }));
    if (!account.userId) return res.status(401).json({ error: 'Sign in first.' });
    const body = req.body || {};
    if (req.method === 'PUT') return res.status(200).json(await saveDay(account.userId, id, body, { isAdmin: account.isAdmin }));
    if (req.method === 'DELETE') return res.status(200).json(await deleteDay(account.userId, id, body.dayId, { isAdmin: account.isAdmin }));
    res.setHeader('Allow', 'PUT, DELETE');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('productions/[id]/days:', err.message);
    return res.status(500).json({ error: 'Could not save that day right now.' });
  }
}
