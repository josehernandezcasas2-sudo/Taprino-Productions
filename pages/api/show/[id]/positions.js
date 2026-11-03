import { startShowRoute, showViewer, showLimit, showRouteError, idFrom } from '../../../../lib/showRoute';
import { showPositions } from '../../../../lib/showPage';

// GET ?season=&number=&exclude= → a season's numbers (lib/showPage.js
// showPositions): taken (episodes and the viewer's drafts), the next free
// number, gaps, and with `number` whether it is free for the row `exclude`.
// The submit page's Place block and the editors' number steppers.
export default async function handler(req, res) {
  if (!startShowRoute(req, res, ['GET'])) return;
  try {
    const viewer = await showViewer(req, res);
    if (!viewer) return;
    const id = idFrom(req);
    if (!id) return res.status(404).json({ error: 'That show isn’t there.' });
    if (!(await showLimit(req, res, viewer, 'show-positions', 240))) return;
    const q = req.query || {};
    return res.status(200).json(await showPositions(id, { season: q.season, number: q.number, exclude: q.exclude }, viewer));
  } catch (err) {
    return showRouteError(res, err, 'show/[id]/positions', 'Could not read the numbers.');
  }
}
