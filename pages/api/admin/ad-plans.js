import { getRoleContext } from '../../../lib/roles';
import { canCurate, listEpisodesWithPlans } from '../../../lib/adPlans';

// Every approved episode with its ad plan state, for /admin/ad-plans.
// Same gate as the curator: admins, scheduling / episode sub-admins and
// content schedulers.
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  res.setHeader('Cache-Control', 'private, no-store');
  const roleContext = await getRoleContext(req);
  if (!roleContext.userId) return res.status(401).json({ error: 'Sign in first.' });
  if (!canCurate(roleContext)) return res.status(403).json({ error: 'Only admins and content schedulers curate ad plans.' });
  try {
    return res.status(200).json({ episodes: await listEpisodesWithPlans() });
  } catch (err) {
    console.error('admin/ad-plans:', err.message);
    return res.status(500).json({ error: 'Could not load the episodes.' });
  }
}
