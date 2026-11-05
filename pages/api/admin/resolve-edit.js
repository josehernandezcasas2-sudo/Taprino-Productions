import { requireCapability } from '../../../lib/adminAuth';
import { isTitleId } from '../../../lib/titleIds';
import { applyCors } from '../../../lib/cors';
import { showRouteError } from '../../../lib/showRoute';
import { STAGED_FIELDS, decideStaged, waitingFields } from '../../../lib/stagedChanges';
// What the Library's list showed waiting ({ field: mark }, from
// pending-artwork / pending-edits): only those fields are decided, and a
// change replaced since the list was read is refused (lib/stagedChanges.js).
// Without it (an older page) every field waiting now is decided.
function seenFields(target, raw, group) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const map = STAGED_FIELDS[target] || {};
  const seen = {};
  for (const [f, mark] of Object.entries(raw)) {
    if (Object.prototype.hasOwnProperty.call(map, f) && map[f] === group && typeof mark === 'string' && mark.length <= 64) seen[f] = mark;
  }
  return seen;
}


// The approve/deny of a staged text change (a live title's new title or
// name, and its description), the Library's queue. The logic lives in
// lib/stagedChanges.js decideStaged; this route keeps its request and
// answer shapes and decides every text field waiting on the row at once.
//
//   POST { type: 'episode' | 'series', id, decision: 'approve' | 'deny', note? }
//
// Who is told: the uploader of an episode, and the show's owner when
// that's someone else; a show's own new name or description goes to its
// owner. The admin's note rides along. The catalogue caches are cleared.
export default async function handler(req, res) {
  applyCors(req, res);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Full admins pass; a sub-admin needs the capability the page that
  // calls this route is gated on (lib/adminAuth.js).
  const roleContext = await requireCapability(req, res, 'manage_episodes');
  if (!roleContext) return undefined;

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const { type, decision } = body;
  const id = body.id === undefined || body.id === null ? '' : String(body.id);
  if (!['episode', 'series'].includes(type)) {
    return res.status(400).json({ error: 'type must be "episode" or "series".' });
  }
  if (!id || !isTitleId(id)) {
    return res.status(400).json({ error: 'id is required.' });
  }
  if (!['approve', 'deny'].includes(decision)) {
    return res.status(400).json({ error: 'decision must be "approve" or "deny".' });
  }

  try {
    const waiting = await waitingFields(type, id, 'text');
    if (waiting === null) return res.status(404).json({ error: 'Not found.' });
    const seen = seenFields(type, body.seen, 'text');
    const fields = seen ? Object.keys(seen) : waiting;
    if (fields.length === 0 || waiting.length === 0) return res.status(409).json({ error: 'Nothing is waiting on this one any more. Reload the list.' });
    await decideStaged({ target: type, id, fields, decision, note: body.note, ...(seen ? { seen } : {}) }, roleContext);
    return res.status(200).json({ ok: true, type, id, decision });
  } catch (err) {
    return showRouteError(res, err, 'admin/resolve-edit', 'Could not resolve this change.');
  }
}
