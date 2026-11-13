import { showViewer, showLimit, showRouteError } from '../../../lib/showRoute';
import { replaceEpisodeVideo } from '../../../lib/showPage';

// POST { episodeId, videoUid } → { ok, episodeId, staged, resubmitted,
// renumbered?, message }: a new video file for a title (Your work's
// "Replace video").
//
// The same rule as the show editor's "Replace the file" (decision 9 of
// the series revamp; lib/showPage.js replaceEpisodeVideo, which
// /api/show/episode/[id]/video calls too): on a live title the new file
// waits in `pending_src` for an admin while the current one keeps playing
// (the Library's "Pending artwork changes", or the show's admin page);
// in review it simply replaces the old one; a "Not this time" title comes
// back into review with it, its number re-checked (the next free one when
// its own was taken while it was declined: `renumbered` + `message`). The
// team's change applies at once. The uid has to be the uploader's own
// (lib/videoOwnership.js); the old file is orphaned only after the save.
//
// Until 2026-11-13 this route sent a live title straight back to review
// and swapped its file at once: the title left the site, its buyers lost
// it, and the approved master was orphaned before anyone had looked at
// the new one.
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  res.setHeader('Cache-Control', 'private, no-store');

  try {
    const viewer = await showViewer(req, res);
    if (!viewer) return undefined;
    const { episodeId, videoUid } = req.body || {};
    if (!episodeId || !videoUid) {
      return res.status(400).json({ error: 'episodeId and videoUid are required.' });
    }
    // One budget with the show editor's route.
    if (!(await showLimit(req, res, viewer, 'show-episode-video', 30))) return undefined;
    return res.status(200).json(await replaceEpisodeVideo(String(episodeId), { videoUid: String(videoUid) }, viewer));
  } catch (err) {
    return showRouteError(res, err, 'creator/replace-video', 'Could not save the replacement video.');
  }
}
