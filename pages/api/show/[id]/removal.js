import { startShowRoute, showViewer, showLimit, showRouteError, idFrom } from '../../../../lib/showRoute';
import { setShowRemoval } from '../../../../lib/showPage';

// POST { action: 'request', reason } | { action: 'cancel' } → { ok,
// seriesId, deletionRequested }: "Remove this show…" and its Cancel — the
// same logic as /api/creator/request-series-deletion (lib/showPage.js
// setShowRemoval); an admin confirms it. The owner or a full admin.
export default async function handler(req, res) {
  if (!startShowRoute(req, res, ['POST'])) return;
  try {
    const viewer = await showViewer(req, res);
    if (!viewer) return;
    const id = idFrom(req);
    if (!id) return res.status(404).json({ error: 'That show isn’t there.' });
    if (!(await showLimit(req, res, viewer, 'show-removal', 20))) return;
    const body = req.body || {};
    return res.status(200).json(await setShowRemoval(id, { action: body.action, reason: body.reason }, viewer));
  } catch (err) {
    return showRouteError(res, err, 'show/[id]/removal', 'Could not save your request.');
  }
}
