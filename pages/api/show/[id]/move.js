import { startShowRoute, showViewer, showLimit, showRouteError, idFrom } from '../../../../lib/showRoute';
import { moveForViewer } from '../../../../lib/showPage';

// POST { episodeId | draftId, toShowId?, toSeason?, toNumber?, mode?:
// 'swap' | 'insert', closeGap? } → { ok, words, rows | drafts, lines,
// earningsMove, buyersAffected, leavesSite }: Move to… (lib/showRules.js
// canMoveTo, then move_episode / reorder_show_season). 503 before
// migration 118 for an episode; 409 with the holder and the choices for a
// taken number.
export default async function handler(req, res) {
  if (!startShowRoute(req, res, ['POST'])) return;
  try {
    const viewer = await showViewer(req, res);
    if (!viewer) return;
    const id = idFrom(req);
    if (!id) return res.status(404).json({ error: 'That show isn’t there.' });
    if (!(await showLimit(req, res, viewer, 'show-move', 60))) return;
    return res.status(200).json(await moveForViewer(id, req.body || {}, viewer));
  } catch (err) {
    return showRouteError(res, err, 'show/[id]/move', 'Could not move it.');
  }
}
