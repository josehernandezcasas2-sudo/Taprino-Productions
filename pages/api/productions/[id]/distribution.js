import { getRoleContext } from '../../../../lib/roles';
import { getDistribution, updateDistribution } from '../../../../lib/distribution';
import { applyCors } from '../../../../lib/cors';

// A production's distribution page (migration 109), owner or admin.
//   GET   → { production, release, festivals, notes, pressKitUrl, trailerUrl, premiereOn, premiereNote, screeners, episodes, partners, checklist }
//   PATCH { festivals?, notes?, pressKitUrl?, trailerUrl?, premiereOn?, premiereNote? } → the same
export default async function handler(req, res) {
  applyCors(req, res);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PATCH, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  const id = String(req.query.id || '');
  if (!/^[0-9a-f-]{36}$/i.test(id)) return res.status(404).json({ error: 'That production isn’t here.' });
  try {
    const account = await getRoleContext(req).catch(() => ({ userId: null, isAdmin: false }));
    if (!account.userId) return res.status(401).json({ error: 'Sign in first.' });
    if (req.method === 'GET') return res.status(200).json(await getDistribution(id, { viewerId: account.userId, isAdmin: account.isAdmin }));
    if (req.method === 'PATCH') return res.status(200).json(await updateDistribution(account.userId, id, req.body || {}, { isAdmin: account.isAdmin }));
    res.setHeader('Allow', 'GET, PATCH');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('productions/[id]/distribution:', err.message);
    return res.status(500).json({ error: 'Could not load distribution right now.' });
  }
}
