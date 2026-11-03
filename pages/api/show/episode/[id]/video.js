import { startShowRoute, showViewer, showLimit, showRouteError, idFrom } from '../../../../../lib/showRoute';
import { replaceEpisodeVideo } from '../../../../../lib/showPage';

// POST { videoUid } → { ok, episodeId, staged, resubmitted, renumbered?,
// message }: "Replace the file" (lib/showPage.js replaceEpisodeVideo) — on
// a live title the new file waits for an admin (pending_src) while the
// current one keeps playing; in review it simply replaces it; a "Not this
// time" title comes back into review with it. The uid has to be the
// uploader's own (lib/videoOwnership.js); the old file is orphaned after
// the save.
export default async function handler(req, res) {
  if (!startShowRoute(req, res, ['POST'])) return;
  try {
    const viewer = await showViewer(req, res);
    if (!viewer) return;
    const id = idFrom(req);
    if (!id) return res.status(404).json({ error: 'That episode isn’t there.' });
    if (!(await showLimit(req, res, viewer, 'show-episode-video', 30))) return;
    return res.status(200).json(await replaceEpisodeVideo(id, req.body || {}, viewer));
  } catch (err) {
    return showRouteError(res, err, 'show/episode/[id]/video', 'Could not save the new file.');
  }
}
