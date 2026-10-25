import { getRoleContext } from '../../../../lib/roles';
import { createScreener, revokeScreener } from '../../../../lib/distribution';
import { applyCors } from '../../../../lib/cors';

// Screeners on a production (migration 109), owner or admin.
//   POST   { episodeId, label, recipientEmail?, days (3|7|14|30|60), maxViews } → { screener }
//   DELETE { screenerId } → { ok }   (revokes; the link stops working at once)
export default async function handler(req, res) {
  applyCors(req, res);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'POST, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  const id = String(req.query.id || '');
  if (!/^[0-9a-f-]{36}$/i.test(id)) return res.status(404).json({ error: 'That production isn’t here.' });
  try {
    const account = await getRoleContext(req).catch(() => ({ userId: null, isAdmin: false }));
    if (!account.userId) return res.status(401).json({ error: 'Sign in first.' });
    const body = req.body || {};
    if (req.method === 'POST') return res.status(201).json({ screener: await createScreener(account.userId, id, body, { isAdmin: account.isAdmin }) });
    if (req.method === 'DELETE') return res.status(200).json(await revokeScreener(account.userId, id, String(body.screenerId || ''), { isAdmin: account.isAdmin }));
    res.setHeader('Allow', 'POST, DELETE');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('productions/[id]/screeners:', err.message);
    return res.status(500).json({ error: 'Could not do that right now.' });
  }
}
