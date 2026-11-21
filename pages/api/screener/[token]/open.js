import { openLink, sendScreeningError } from '../../../../lib/screenings';
import { screeningViewerLimit, startScreeningRoute } from '../../../../lib/screeningRoute';

// Opening a private screening (migration 128): POST { password } → 200
// { session, viewer, watermark, link, episodes, current }, or 4xx
// { error, reason, retryAt?, triesLeft? }. Counts one open (guarded on the
// link's views), writes the visit, sets the guest cookie `tapa_scr`, tells
// the owner as the link says. No sign-in needed; nothing goes in watch
// history. The checks and their order are lib/screenings.js openLink.
export default async function handler(req, res) {
  if (!startScreeningRoute(req, res, ['POST'], { noindex: true })) return;
  if (!(await screeningViewerLimit(req, res, 'open', 30, 600))) return;
  try {
    const { body, setCookie } = await openLink(String(req.query.token || ''), req.body, req);
    if (setCookie) res.setHeader('Set-Cookie', setCookie);
    return res.status(200).json(body);
  } catch (err) {
    if (err && err.setCookie) res.setHeader('Set-Cookie', err.setCookie);
    return sendScreeningError(res, err, 'screener/open');
  }
}
