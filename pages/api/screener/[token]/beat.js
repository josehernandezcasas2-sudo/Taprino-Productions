import { beatLink, sendScreeningError } from '../../../../lib/screenings';
import { screeningViewerLimit, startScreeningRoute } from '../../../../lib/screeningRoute';

// The screening page's beat, every 20 seconds (migration 128): POST
// { session, episodeId, position, duration, playing } → { ok: true } or
// { stop: true, reason, error } (ended, stopped, screen, session,
// password_changed). Records how far it was watched and, while playing,
// that this visit holds the screen. Never touches watch history.
export default async function handler(req, res) {
  if (!startScreeningRoute(req, res, ['POST'], { noindex: true })) return;
  if (!(await screeningViewerLimit(req, res, 'beat', 900, 3600))) return;
  try {
    return res.status(200).json(await beatLink(String(req.query.token || ''), req.body, req));
  } catch (err) {
    return sendScreeningError(res, err, 'screener/beat');
  }
}
