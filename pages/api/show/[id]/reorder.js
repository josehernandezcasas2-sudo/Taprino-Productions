import { startShowRoute, showViewer, showLimit, showRouteError, idFrom } from '../../../../lib/showRoute';
import { reorderForViewer } from '../../../../lib/showPage';

// POST { season, episodes: [{ id, number }], drafts: [{ id, number }] }
// (lib/showRules.js planMove's single-season shape, amendment 14) → { ok,
// rows, drafts, words }. The show's owner or the team; 503 before
// migration 118, 409 for a number another episode keeps.
export default async function handler(req, res) {
  if (!startShowRoute(req, res, ['POST'])) return;
  try {
    const viewer = await showViewer(req, res);
    if (!viewer) return;
    const id = idFrom(req);
    if (!id) return res.status(404).json({ error: 'That show isn’t there.' });
    if (!(await showLimit(req, res, viewer, 'show-reorder', 120))) return;
    return res.status(200).json(await reorderForViewer(id, req.body || {}, viewer));
  } catch (err) {
    return showRouteError(res, err, 'show/[id]/reorder', 'Could not change the order.');
  }
}
