import { playLink, sendScreeningError } from '../../../../lib/screenings';
import { screeningViewerLimit, startScreeningRoute } from '../../../../lib/screeningRoute';

// A fresh 30-minute video address for an open screening visit (migration
// 128): POST { session, episodeId } → { current: { id, src, signed,
// expiresAt } }. Moving between a show's episodes, and the player's
// refresh when an address runs out; no open is counted.
export default async function handler(req, res) {
  if (!startScreeningRoute(req, res, ['POST'], { noindex: true })) return;
  if (!(await screeningViewerLimit(req, res, 'play', 240, 3600))) return;
  try {
    return res.status(200).json(await playLink(String(req.query.token || ''), req.body, req));
  } catch (err) {
    return sendScreeningError(res, err, 'screener/play');
  }
}
