import { startShowRoute, showViewer, showLimit, showRouteError, idFrom } from '../../../../../lib/showRoute';
import { requestRestore } from '../../../../../lib/titleRemoval';

// POST { action: 'request', reason? } | { action: 'cancel' } → { ok, type,
// id, asked }: "Ask to bring it back" on a removed title, and taking the
// request back (migration 124; lib/titleRemoval.js requestRestore). Its
// uploader, or a full admin; a title the team removed only through a full
// admin; an episode that came off with its show comes back with the show.
// Someone on the team approves it in the review queue (kind 'restore').
// Before 124: 503 { code: 'migration-124' }.
export default async function handler(req, res) {
  if (!startShowRoute(req, res, ['POST'])) return;
  try {
    const viewer = await showViewer(req, res);
    if (!viewer) return;
    const id = idFrom(req);
    if (!id) return res.status(404).json({ error: 'That title isn’t there.' });
    if (!(await showLimit(req, res, viewer, 'title-restore', 20))) return;
    const body = req.body || {};
    return res.status(200).json(await requestRestore('episode', id, { action: body.action === 'cancel' ? 'cancel' : 'request', reason: body.reason }, viewer));
  } catch (err) {
    return showRouteError(res, err, 'show/episode/[id]/restore', 'Could not save your request.');
  }
}
