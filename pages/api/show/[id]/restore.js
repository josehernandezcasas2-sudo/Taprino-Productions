import { startShowRoute, showViewer, showLimit, showRouteError, idFrom } from '../../../../lib/showRoute';
import { requestRestore } from '../../../../lib/titleRemoval';

// POST { action: 'request', reason? } | { action: 'cancel' } → { ok, type,
// id, asked }: "Ask to bring it back" on a removed show, and taking the
// request back (migration 124; lib/titleRemoval.js requestRestore). Its
// owner, or a full admin; a show the team removed only through a full
// admin. Someone on the team approves it in the review queue (kind
// 'restore'), and what came off with the show comes back with it. Before
// 124: 503 { code: 'migration-124' }.
export default async function handler(req, res) {
  if (!startShowRoute(req, res, ['POST'])) return;
  try {
    const viewer = await showViewer(req, res);
    if (!viewer) return;
    const id = idFrom(req);
    if (!id) return res.status(404).json({ error: 'That show isn’t there.' });
    if (!(await showLimit(req, res, viewer, 'show-restore', 20))) return;
    const body = req.body || {};
    return res.status(200).json(await requestRestore('series', id, { action: body.action === 'cancel' ? 'cancel' : 'request', reason: body.reason }, viewer));
  } catch (err) {
    return showRouteError(res, err, 'show/[id]/restore', 'Could not save your request.');
  }
}
