import { startShowRoute, showViewer, showLimit, showRouteError } from '../../../lib/showRoute';
import { isTitleId } from '../../../lib/titleIds';
import { MIGRATION_118_PAYEE_LINE, getPayeeBlock, payeesAvailable, pickPayee } from '../../../lib/payees';

// Who gets paid for a title (the series revamp, slice 3b:
// mockups/series-slice3b-contract.md §5.3). lib/payees.js does the work.
//
//   GET  ?type=series|episode&id=<titleId> → { payee: PayeeBlock }
//        (404 when the viewer may not see who is paid)
//   POST { action: 'pick' | 'self' | 'default' | 'step_down', type, id,
//          to?, grantCreator? } → { ok, kind: 'invite' | 'direct', words,
//          payee, invite? }
// Before migration 118 both answer 503 { code: 'migration-118' }.
const TYPES = ['series', 'episode'];

export default async function handler(req, res) {
  if (!startShowRoute(req, res, ['GET', 'POST'])) return;
  const viewer = await showViewer(req, res);
  if (!viewer) return;
  try {
    if (req.method === 'GET') {
      if (!(await showLimit(req, res, viewer, 'payees-read', 600))) return;
      const type = typeof req.query.type === 'string' ? req.query.type : '';
      const id = typeof req.query.id === 'string' ? req.query.id : '';
      if (!TYPES.includes(type) || !isTitleId(id)) return res.status(400).json({ error: 'Which title?' });
      if (!(await payeesAvailable())) return res.status(503).json({ error: MIGRATION_118_PAYEE_LINE, code: 'migration-118' });
      const payee = await getPayeeBlock(type, id, viewer);
      if (!payee) return res.status(404).json({ error: 'That title isn’t there.' });
      return res.status(200).json({ payee });
    }
    const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
    // 30 changes an hour; invites also have their 20-a-day ceiling
    // (lib/payees.js).
    if (!(await showLimit(req, res, viewer, 'payees-write', 30))) return;
    const type = typeof body.type === 'string' ? body.type : '';
    const id = typeof body.id === 'string' ? body.id : '';
    if (!TYPES.includes(type) || !isTitleId(id)) return res.status(400).json({ error: 'Which title?' });
    const action = typeof body.action === 'string' ? body.action : '';
    if (!['pick', 'self', 'default', 'step_down'].includes(action)) return res.status(400).json({ error: 'Unknown action.' });
    const out = await pickPayee(type, id, { action, to: typeof body.to === 'string' ? body.to : null, grantCreator: body.grantCreator === true }, viewer);
    return res.status(200).json(out);
  } catch (err) {
    return showRouteError(res, err, 'payees');
  }
}
