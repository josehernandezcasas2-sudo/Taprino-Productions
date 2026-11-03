import { startShowRoute, showViewer, showLimit, showRouteError, idFrom } from '../../../../lib/showRoute';
import { getShowPage, updateShow } from '../../../../lib/showPage';

// One show's control room (mockups/series-slice2-api.md).
//   GET   → the show page's payload (lib/showPage.js getShowPage): its
//           owner, someone with an episode in it (their own rows in full,
//           the show read-only) or the team; 404 for anyone else.
//   PATCH → Edit show: { name, description, releaseYear, fundingUrl,
//           channelOptIn, kind, defaults, seasons, credits, posterBase64,
//           thumbnailBase64, heroImageBase64, titleImageBase64,
//           removeTitleImage, trailerUid, resubmit } through
//           lib/showRules.js fieldPolicy (updateShow) → { ok, applied,
//           staged, notices, notSaved, unchanged, view }.

// Artwork arrives as data URLs.
export const config = { api: { bodyParser: { sizeLimit: '10mb' } } };

export default async function handler(req, res) {
  if (!startShowRoute(req, res, ['GET', 'PATCH'])) return;
  try {
    const viewer = await showViewer(req, res);
    if (!viewer) return;
    const id = idFrom(req);
    if (!id) return res.status(404).json({ error: 'That show isn’t there.' });
    if (req.method === 'GET') {
      if (!(await showLimit(req, res, viewer, 'show-page', 240))) return;
      const view = await getShowPage(id, viewer);
      if (!view) return res.status(404).json({ error: 'That show isn’t there.' });
      return res.status(200).json(view);
    }
    if (!(await showLimit(req, res, viewer, 'show-patch', 60))) return;
    const result = await updateShow(id, req.body || {}, viewer);
    const view = await getShowPage(id, viewer, { videoStates: false });
    return res.status(200).json({ ...result, view });
  } catch (err) {
    return showRouteError(res, err, 'show/[id]', 'Could not save the show.');
  }
}
