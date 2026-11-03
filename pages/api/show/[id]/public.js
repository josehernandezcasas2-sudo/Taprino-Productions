import { startShowRoute, showViewer, showLimit, showRouteError, idFrom } from '../../../../lib/showRoute';
import { makeShowPublic } from '../../../../lib/showPage';

// POST → { ok, id, publicAt, released }: Make it public (decision 2) — the
// show's owner or a full admin, once an episode is approved
// (lib/showRules.js canMakePublic; 409 with its words otherwise, 403 for
// anyone else). One-way; it restarts the approved episodes' release clock.
export default async function handler(req, res) {
  if (!startShowRoute(req, res, ['POST'])) return;
  try {
    const viewer = await showViewer(req, res);
    if (!viewer) return;
    const id = idFrom(req);
    if (!id) return res.status(404).json({ error: 'That show isn’t there.' });
    if (!(await showLimit(req, res, viewer, 'show-public', 20))) return;
    return res.status(200).json(await makeShowPublic(id, { userId: viewer.userId, email: viewer.email, isAdmin: viewer.isAdmin }));
  } catch (err) {
    return showRouteError(res, err, 'show/[id]/public', 'Could not make it public.');
  }
}
