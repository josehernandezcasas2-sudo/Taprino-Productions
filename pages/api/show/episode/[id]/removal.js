import { startShowRoute, showViewer, showLimit, showRouteError, idFrom } from '../../../../../lib/showRoute';
import { setEpisodeRemoval } from '../../../../../lib/showPage';

// POST { action: 'request', reason } | { action: 'cancel' } → { ok,
// episodeId, deletionRequested, hiddenNow }: "Remove this episode…" and its
// Cancel — the same logic as /api/creator/request-episode-deletion
// (lib/showPage.js setEpisodeRemoval). Its uploader.
export default async function handler(req, res) {
  if (!startShowRoute(req, res, ['POST'])) return;
  try {
    const viewer = await showViewer(req, res);
    if (!viewer) return;
    const id = idFrom(req);
    if (!id) return res.status(404).json({ error: 'That episode isn’t there.' });
    if (!(await showLimit(req, res, viewer, 'show-removal', 20))) return;
    const body = req.body || {};
    return res.status(200).json(await setEpisodeRemoval(id, { action: body.action, reason: body.reason }, viewer));
  } catch (err) {
    return showRouteError(res, err, 'show/episode/[id]/removal', 'Could not save your request.');
  }
}
