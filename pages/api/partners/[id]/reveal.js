import { getAuth } from '@clerk/nextjs/server';
import { revealCode } from '../../../../lib/partners';

// Open a partner's code (migration 108): the gate is checked here, and
// the first reveal per person is logged for the partner.
//   POST { productionId? } → { code, note, url, deal }
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  const id = String(req.query.id || '');
  if (!/^[0-9a-f-]{36}$/i.test(id)) return res.status(404).json({ error: 'Not found.' });
  const { userId } = getAuth(req);
  try {
    return res.status(200).json(await revealCode(userId || null, id, { productionId: (req.body || {}).productionId }));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('partners/reveal:', err.message);
    return res.status(500).json({ error: 'Could not open that code right now.' });
  }
}
