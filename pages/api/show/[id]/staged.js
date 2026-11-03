import { startShowRoute, showViewer, showLimit, showRouteError, idFrom } from '../../../../lib/showRoute';
import { cancelShowStaged } from '../../../../lib/showPage';

// DELETE ?field=name|description|poster|thumbnail|heroImage|titleImage|trailer
// → { ok, cancelled }: the owner (or the team) takes back a change that
// waits for approval; its file is orphaned (lib/showPage.js cancelShowStaged).
export default async function handler(req, res) {
  if (!startShowRoute(req, res, ['DELETE'])) return;
  try {
    const viewer = await showViewer(req, res);
    if (!viewer) return;
    const id = idFrom(req);
    if (!id) return res.status(404).json({ error: 'That show isn’t there.' });
    if (!(await showLimit(req, res, viewer, 'show-patch', 60))) return;
    const field = typeof req.query.field === 'string' ? req.query.field : (req.body && req.body.field) || '';
    return res.status(200).json(await cancelShowStaged(id, String(field), viewer));
  } catch (err) {
    return showRouteError(res, err, 'show/[id]/staged', 'Could not take that change back.');
  }
}
