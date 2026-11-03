import { startShowRoute, showViewer, showLimit, showRouteError, idFrom } from '../../../../../lib/showRoute';
import { getEpisodeEditor, updateEpisode } from '../../../../../lib/showPage';

// The episode editor (mockups/series-slice2-api.md).
//   GET   → its payload (lib/showPage.js getEpisodeEditor): the fields,
//           `policy` (what each change would do for this viewer), what it
//           borrows from the show, what waits for approval, its file, the
//           season's numbers, its extras, the shows it could move to.
//   PATCH → the save (updateEpisode), policy-driven: direct fields
//           written, staged ones into pending_* on a live title, locked ones
//           refused (403, code 'locked'); a taken number 409; `resubmit`
//           sends a "Not this time" title back → { ok, applied, staged,
//           notices, notSaved, renumbered?, message?, unchanged, view }.
// Its uploader, the show's owner (place, own page, credits, an extra's
// anchor) or the team.

// Artwork arrives as data URLs.
export const config = { api: { bodyParser: { sizeLimit: '10mb' } } };

export default async function handler(req, res) {
  if (!startShowRoute(req, res, ['GET', 'PATCH'])) return;
  try {
    const viewer = await showViewer(req, res);
    if (!viewer) return;
    const id = idFrom(req);
    if (!id) return res.status(404).json({ error: 'That episode isn’t there.' });
    if (req.method === 'GET') {
      if (!(await showLimit(req, res, viewer, 'show-episode-read', 240))) return;
      return res.status(200).json(await getEpisodeEditor(id, viewer));
    }
    if (!(await showLimit(req, res, viewer, 'show-episode-patch', 60))) return;
    const result = await updateEpisode(id, req.body || {}, viewer);
    const view = await getEpisodeEditor(id, viewer);
    return res.status(200).json({ ...result, view });
  } catch (err) {
    return showRouteError(res, err, 'show/episode/[id]', 'Could not save your changes.');
  }
}
