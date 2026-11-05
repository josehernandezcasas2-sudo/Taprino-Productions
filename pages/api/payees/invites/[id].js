import { startShowRoute, showViewer, showLimit, showRouteError } from '../../../../lib/showRoute';
import { answerInvite } from '../../../../lib/payees';

// One invite to be paid for a title (the series revamp, slice 3b:
// mockups/series-slice3b-contract.md §5.3):
//   POST { action: 'accept' | 'decline' | 'cancel' } → { ok, words,
//        payoutsReady?, payee? }
// accept / decline: the invitee; cancel: whoever sent it, the title's
// runner or a full admin. A non-uuid id answers 404.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function handler(req, res) {
  if (!startShowRoute(req, res, ['POST'])) return;
  const viewer = await showViewer(req, res);
  if (!viewer) return;
  const id = typeof req.query.id === 'string' ? req.query.id : '';
  if (!UUID.test(id)) return res.status(404).json({ error: 'That invite isn’t there any more.' });
  try {
    if (!(await showLimit(req, res, viewer, 'payees-answer', 60))) return;
    const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
    const action = typeof body.action === 'string' ? body.action : '';
    if (!['accept', 'decline', 'cancel'].includes(action)) return res.status(400).json({ error: 'Unknown action.' });
    return res.status(200).json(await answerInvite(id, action, viewer));
  } catch (err) {
    return showRouteError(res, err, 'payees/invites/[id]');
  }
}
