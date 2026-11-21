import { runAgain, sendScreeningError } from '../../../../lib/screenings';
import { originOf, screeningCreator, startScreeningRoute } from '../../../../lib/screeningRoute';

// Run an ended private screening link again (migration 128): POST
// { …optional overrides } → 201 { link } — the old one's settings, a new
// address and a new password, from now for as long as the old one ran
// unless a window is sent. Counts toward the 40 new links a day.
export default async function handler(req, res) {
  if (!startScreeningRoute(req, res, ['POST'])) return;
  try {
    const rc = await screeningCreator(req, res, 'write', { max: 60, windowSeconds: 3600 });
    if (!rc) return;
    return res.status(201).json(await runAgain(rc, String(req.query.id || ''), req.body, { origin: originOf(req) }));
  } catch (err) {
    return sendScreeningError(res, err, 'screenings/[id]/again');
  }
}
