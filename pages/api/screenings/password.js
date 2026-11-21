import { passwordSuggestion, sendScreeningError } from '../../../lib/screenings';
import { screeningCreator, startScreeningRoute } from '../../../lib/screeningRoute';

// A fresh password suggestion for a private screening link ("New one" in
// the New link dialog): GET → { password }. Signed in; nothing is stored.
export default async function handler(req, res) {
  if (!startScreeningRoute(req, res, ['GET'])) return;
  try {
    const rc = await screeningCreator(req, res, 'password', { max: 60, windowSeconds: 60 });
    if (!rc) return;
    return res.status(200).json(passwordSuggestion());
  } catch (err) {
    return sendScreeningError(res, err, 'screenings/password');
  }
}
