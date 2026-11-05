import { startShowRoute, showViewer, showLimit, showRouteError } from '../../../lib/showRoute';
import { listMine } from '../../../lib/payees';

// Creator Studio's "Get paid" card and "Paid to you" pile (the series
// revamp, slice 3b: mockups/series-slice3b-contract.md §5.3, §6.4):
//   GET → { available, ruleLive, ruleFrom, invites: [...], paidFor: [...] }
// Before migration 118 it answers 200 with available: false and empty
// lists, so the hub never breaks.
export default async function handler(req, res) {
  if (!startShowRoute(req, res, ['GET'])) return;
  const viewer = await showViewer(req, res);
  if (!viewer) return;
  try {
    if (!(await showLimit(req, res, viewer, 'payees-mine', 600))) return;
    return res.status(200).json(await listMine(viewer));
  } catch (err) {
    return showRouteError(res, err, 'payees/mine');
  }
}
