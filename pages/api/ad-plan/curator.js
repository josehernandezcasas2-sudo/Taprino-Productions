import { getRoleContext } from '../../../lib/roles';
import { canCurate, getCuratorData, savePlan, deletePlan, AdPlanError } from '../../../lib/adPlans';
import { recordAudit } from '../../../lib/auditLog';

// The Episode Ad Curator's data: GET ?episode=<id> loads the episode, its
// plan (or a default one), the palette with eligible-ad counts, the ads
// and bumpers; POST { episodeId, plan } saves (draft or ready); DELETE
// ?episode=<id> removes the plan so the episode is back to default.
// Admins, scheduling/episode sub-admins and content schedulers only.
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  const roleContext = await getRoleContext(req);
  if (!roleContext.userId) return res.status(401).json({ error: 'Sign in first.' });
  if (!canCurate(roleContext)) return res.status(403).json({ error: 'Only admins and content schedulers curate ad plans.' });
  try {
    if (req.method === 'GET') {
      const episodeId = String(req.query.episode || '');
      if (!episodeId) return res.status(400).json({ error: 'Which episode?' });
      return res.status(200).json(await getCuratorData(episodeId));
    }
    if (req.method === 'POST') {
      const { episodeId, plan } = req.body || {};
      if (!episodeId) return res.status(400).json({ error: 'Which episode?' });
      const result = await savePlan(String(episodeId), plan || {}, { userId: roleContext.userId });
      recordAudit({ adminId: roleContext.userId, adminEmail: roleContext.email || null, action: 'ad_plan_saved', targetType: 'episode', targetId: String(episodeId), details: `${result.plan.status} · ${result.stats.breakCount} breaks · ${result.stats.adsSeconds}s ads` }).catch(() => {});
      return res.status(200).json(result);
    }
    if (req.method === 'DELETE') {
      const episodeId = String(req.query.episode || '');
      if (!episodeId) return res.status(400).json({ error: 'Which episode?' });
      await deletePlan(episodeId);
      recordAudit({ adminId: roleContext.userId, adminEmail: roleContext.email || null, action: 'ad_plan_reset', targetType: 'episode', targetId: episodeId, details: null }).catch(() => {});
      return res.status(200).json({ ok: true });
    }
    res.setHeader('Allow', 'GET, POST, DELETE');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    if (err instanceof AdPlanError) return res.status(err.status).json({ error: err.message });
    console.error('ad-plan/curator:', err.message);
    return res.status(500).json({ error: 'Could not load the ad plan right now.' });
  }
}
