import { startShowRoute, showViewer, showLimit, showRouteError, idFrom } from '../../../../lib/showRoute';
import { sendShowDrafts } from '../../../../lib/showPage';

// POST { draftIds } (up to 10; the page loops) → { ok, created, skipped }:
// "Send N for review" — every draft checked first, then sent one by one
// through submitDraft with the show's defaults (lib/showPage.js
// sendShowDrafts). One notice and one audit line per request.
export default async function handler(req, res) {
  if (!startShowRoute(req, res, ['POST'])) return;
  try {
    const viewer = await showViewer(req, res);
    if (!viewer) return;
    const id = idFrom(req);
    if (!id) return res.status(404).json({ error: 'That show isn’t there.' });
    // submit-episode's key: a batch counts as one submission.
    if (!(await showLimit(req, res, viewer, 'creator-submit', 20))) return;
    return res.status(200).json(await sendShowDrafts(id, req.body || {}, viewer));
  } catch (err) {
    return showRouteError(res, err, 'show/[id]/send', 'Could not send them for review.');
  }
}
