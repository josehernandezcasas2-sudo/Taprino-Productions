import { getRoleContext } from '../../../../lib/roles';
import { decideCredit, removeCredit } from '../../../../lib/locationCredits';

// One "Shot here" credit (migration 107).
//   PATCH  { decision: 'approve' | 'decline' } → { id, status }   host (or admin)
//   DELETE → { ok }                                                host, claimant or admin
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'PATCH, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  const id = String(req.query.id || '');
  if (!/^[0-9a-f-]{36}$/i.test(id)) return res.status(404).json({ error: 'Not found.' });
  try {
    const account = await getRoleContext(req).catch(() => ({ userId: null, isAdmin: false }));
    if (!account.userId) return res.status(401).json({ error: 'Sign in first.' });
    if (req.method === 'PATCH') return res.status(200).json(await decideCredit(account.userId, id, (req.body || {}).decision, { isAdmin: account.isAdmin }));
    if (req.method === 'DELETE') return res.status(200).json(await removeCredit(account.userId, id, { isAdmin: account.isAdmin }));
    res.setHeader('Allow', 'PATCH, DELETE');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('locations/credits/[id]:', err.message);
    return res.status(500).json({ error: 'Could not do that right now.' });
  }
}
