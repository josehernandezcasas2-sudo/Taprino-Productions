import { getRoleContext } from '../../../../lib/roles';
import { creditsForLocation, claimCredit } from '../../../../lib/locationCredits';
import { getSupabase } from '../../../../lib/supabase';
import { applyCors } from '../../../../lib/cors';

// "Shot here" credits on one place (migration 107).
//   GET  → { credits }   approved ones; pending too for the host / claimant / admin
//   POST { release: { type: 'episode'|'series', id }, note?, productionId? } → { id, status }
//        a maker's claim (pending until the host approves; the host's own is approved at once)
export default async function handler(req, res) {
  applyCors(req, res);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  const id = String(req.query.id || '');
  if (!/^[0-9a-f-]{36}$/i.test(id)) return res.status(404).json({ error: 'That place isn’t here.' });
  try {
    const account = await getRoleContext(req).catch(() => ({ userId: null, isAdmin: false }));
    if (req.method === 'GET') {
      const { data: loc } = await getSupabase().from('locations').select('host_id').eq('id', id).maybeSingle();
      const isHost = Boolean(loc && account.userId && loc.host_id === account.userId);
      return res.status(200).json({ credits: await creditsForLocation(id, { viewerId: account.userId, isHost, isAdmin: account.isAdmin }) });
    }
    if (req.method === 'POST') {
      if (!account.userId) return res.status(401).json({ error: 'Sign in first.' });
      const body = req.body || {};
      return res.status(201).json(await claimCredit(account.userId, id, { release: body.release, note: body.note, productionId: body.productionId }));
    }
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('locations/[id]/credits:', err.message);
    return res.status(500).json({ error: 'Could not do that right now.' });
  }
}
