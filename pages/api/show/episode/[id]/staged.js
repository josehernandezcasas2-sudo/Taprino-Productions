import { startShowRoute, showViewer, showLimit, showRouteError, idFrom } from '../../../../../lib/showRoute';
import { cancelEpisodeStaged } from '../../../../../lib/showPage';

// DELETE ?field=title|description|pageNotes|poster|thumbnail|titleImage|trailer|video
// → { ok, cancelled }:
// the uploader (or the team) takes back a change that waits for approval;
// its file is orphaned (lib/showPage.js cancelEpisodeStaged).
export default async function handler(req, res) {
  if (!startShowRoute(req, res, ['DELETE'])) return;
  try {
    const viewer = await showViewer(req, res);
    if (!viewer) return;
    const id = idFrom(req);
    if (!id) return res.status(404).json({ error: 'That episode isn’t there.' });
    if (!(await showLimit(req, res, viewer, 'show-episode-patch', 60))) return;
    const field = typeof req.query.field === 'string' ? req.query.field : (req.body && req.body.field) || '';
    return res.status(200).json(await cancelEpisodeStaged(id, String(field), viewer));
  } catch (err) {
    return showRouteError(res, err, 'show/episode/[id]/staged', 'Could not take that change back.');
  }
}
