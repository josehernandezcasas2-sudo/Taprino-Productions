import { getRoleContext } from '../../../lib/roles';
import { listReviewQueue, decideReviewItem } from '../../../lib/reviewQueue';

// GET  → { items, counts }           the merged review queue
// POST → { kind, id, decision, reason?, tierOverride? }
// CORS/OPTIONS so the mobile app (Bearer token) can call it, same as the
// public API routes it already uses.
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  res.setHeader('Cache-Control', 'private, no-store');

  const rc = await getRoleContext(req);
  if (!rc.canAccessAdmin) return res.status(403).json({ error: 'Admin access required.' });

  try {
    if (req.method === 'GET') {
      return res.status(200).json(await listReviewQueue(rc));
    }
    if (req.method === 'POST') {
      const result = await decideReviewItem(rc, req.body || {});
      return res.status(200).json(result);
    }
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message });
  }
}
