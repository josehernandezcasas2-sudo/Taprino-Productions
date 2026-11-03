import { startShowRoute, showViewer, showLimit, showRouteError, idFrom } from '../../../../lib/showRoute';
import { seasonsAction } from '../../../../lib/showPage';

// PATCH { action: 'rename', number, label } | { action: 'add', label? } |
// { action: 'renumber', number } (lib/showPage.js seasonsAction): a
// season's name, the next season, "Renumber from 1". The show's owner or
// the team; renaming and renumbering need migration 118 (503).
export default async function handler(req, res) {
  if (!startShowRoute(req, res, ['PATCH'])) return;
  try {
    const viewer = await showViewer(req, res);
    if (!viewer) return;
    const id = idFrom(req);
    if (!id) return res.status(404).json({ error: 'That show isn’t there.' });
    if (!(await showLimit(req, res, viewer, 'show-seasons', 60))) return;
    return res.status(200).json(await seasonsAction(id, req.body || {}, viewer));
  } catch (err) {
    return showRouteError(res, err, 'show/[id]/seasons', 'Could not change the seasons.');
  }
}
