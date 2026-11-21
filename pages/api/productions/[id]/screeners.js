import { getRoleContext } from '../../../../lib/roles';
import { endLinkFromDistribution, sendScreeningError } from '../../../../lib/screenings';
import { applyCors } from '../../../../lib/cors';
import { requestOrigin } from '../../../../lib/stripe';
import { SCREENING_WORDS } from '../../../../lib/screeningRules';

// A production's screeners (migration 109) became private screening links
// (migration 128, lib/screenings.js), made on the title's own page under
// Private screenings. What this route still answers, for older builds:
//   POST   → 410 { error } (links are made on the title's page now)
//   DELETE { screenerId } → { ok: true, link } (ends the link at once, for
//          whoever runs its title or owns the old screener)
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
    if (req.method === 'POST') return res.status(410).json({ error: SCREENING_WORDS.distributionLine });
    if (req.method === 'DELETE') {
      const body = req.body || {};
      return res.status(200).json(await endLinkFromDistribution(account, String(body.screenerId || ''), { origin: requestOrigin(req) }));
    }
    res.setHeader('Allow', 'POST, DELETE');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    return sendScreeningError(res, err, 'productions/[id]/screeners');
  }
}
