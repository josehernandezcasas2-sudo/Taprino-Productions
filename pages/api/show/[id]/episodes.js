import { startShowRoute, showViewer, showLimit, showRouteError, idFrom } from '../../../../lib/showRoute';
import { addShowDrafts } from '../../../../lib/showPage';

// POST { season?, sortBy?: 'name' | 'date' | 'given', items: [{ videoName,
// videoBytes, runtimeSeconds, lastModified, title?, season?, seriesOrder?,
// videoUid?, uploadUrl?, audioUrl?, audioBytes? }] } (up to 30) → { ok,
// season, drafts, skipped }: "+ Add episode" / "+ Add several" — each file
// a draft at once, numbered next-free in file-name order (lib/showPage.js
// addShowDrafts). 503 before migration 116 (code 'migration-116', with the
// three-step submit page's address in submitHref).
export default async function handler(req, res) {
  if (!startShowRoute(req, res, ['POST'])) return;
  try {
    const viewer = await showViewer(req, res);
    if (!viewer) return;
    const id = idFrom(req);
    if (!id) return res.status(404).json({ error: 'That show isn’t there.' });
    // The drafts route's own key: 240 an hour per account.
    if (!(await showLimit(req, res, viewer, 'creator-drafts', 240))) return;
    return res.status(200).json(await addShowDrafts(id, req.body || {}, viewer));
  } catch (err) {
    return showRouteError(res, err, 'show/[id]/episodes', 'Could not add the episodes.');
  }
}
