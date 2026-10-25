import { getRoleContext } from '../../../../lib/roles';
import { getProduction, updateProduction } from '../../../../lib/productions';
import { applyCors } from '../../../../lib/cors';

// One production.
//   GET    → { production, members, days, calls, isOwner, isMember, canEdit, canConfirm, confirmHint }
//   PATCH  → edit fields; or { status }; or { release: { type, id } | null } — owner (or admin)
//   DELETE → archive it (owner)
export default async function handler(req, res) {
  applyCors(req, res);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PATCH, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  const id = String(req.query.id || '');
  if (!/^[0-9a-f-]{36}$/i.test(id)) return res.status(404).json({ error: 'That production isn’t here.' });
  try {
    const account = await getRoleContext(req).catch(() => ({ userId: null, isAdmin: false }));
    if (req.method === 'GET') return res.status(200).json(await getProduction(id, { viewerId: account.userId, isAdmin: account.isAdmin }));
    if (!account.userId) return res.status(401).json({ error: 'Sign in first.' });
    if (req.method === 'PATCH') return res.status(200).json(await updateProduction(account.userId, id, req.body || {}, { isAdmin: account.isAdmin }));
    if (req.method === 'DELETE') return res.status(200).json(await updateProduction(account.userId, id, { status: 'archived' }, { isAdmin: account.isAdmin }));
    res.setHeader('Allow', 'GET, PATCH, DELETE');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('productions/[id]:', err.message);
    return res.status(500).json({ error: 'Could not load that production right now.' });
  }
}
