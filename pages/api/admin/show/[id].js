import { requireCapability } from '../../../../lib/adminAuth';
import { startShowRoute, showLimit, showRouteError, idFrom } from '../../../../lib/showRoute';
import { isTitleId } from '../../../../lib/titleIds';
import { SHOW_ADMIN_CAPS } from '../../../../lib/showAdminRules';
import { decideStaged } from '../../../../lib/stagedChanges';
import { tellSaversNow } from '../../../../lib/seriesDrop';
import {
  approveShowEpisodes, denyShowRemoval, fixNumbering, getAdminShow, grantOwnerCreator, holdShow, rejectShowEpisodes,
  removeShow, restoreShow, setShowOwner, takeDownShow
} from '../../../../lib/showAdmin';

// One show on Admin → Shows (the series revamp, slice 3a:
// mockups/series-slice3a-contract.md §4.4). Any of the five show
// capabilities opens it; each action checks its own in lib/showAdmin.js.
// Make it public stays POST /api/show/[id]/public; moving, renumbering and
// editing stay the /api/show/** routes.
//
//   GET → the admin cards' data (getAdminShow)
//   POST { action, … } → approve | reject | fix_numbering | staged | hold |
//     take_down | restore | owner | grant_creator | remove | deny_removal |
//     tell_savers
const STAGED_MAX = 50;

function hasOwn(o, k) {
  return Object.prototype.hasOwnProperty.call(o, k);
}

// "Waiting for approval": each item decided on its own (one title's fields
// of one group together), each answering for itself.
async function decideItems(body, rc) {
  const items = Array.isArray(body.items) ? body.items : null;
  if (!items || items.length === 0) return { status: 400, body: { error: 'Which change?' } };
  if (items.length > STAGED_MAX) return { status: 400, body: { error: `Up to ${STAGED_MAX} at a time.` } };
  if (body.decision !== 'approve' && body.decision !== 'deny') return { status: 400, body: { error: 'decision must be "approve" or "deny".' } };
  const groups = new Map();
  const results = [];
  for (const raw of items) {
    const it = raw && typeof raw === 'object' ? raw : {};
    const target = it.target === 'series' || it.target === 'episode' ? it.target : null;
    const id = typeof it.id === 'string' && isTitleId(it.id) ? it.id : null;
    const field = typeof it.field === 'string' ? it.field : null;
    const key = `${target}:${id}:${field}`;
    if (!target || !id || !field) {
      results.push({ key, ok: false, error: 'Which change?' });
      continue;
    }
    const groupKey = `${target}:${id}`;
    if (!groups.has(groupKey)) groups.set(groupKey, { target, id, fields: [], seen: null });
    const g = groups.get(groupKey);
    if (!g.fields.includes(field)) g.fields.push(field);
    // What the reviewer saw (lib/stagedChanges.js stagedSeen): a change
    // replaced since is refused, not put live unseen.
    if (typeof it.seen === 'string' && it.seen.length <= 64) g.seen = { ...(g.seen || {}), [field]: it.seen };
  }
  for (const g of groups.values()) {
    try {
      const out = await decideStaged({ target: g.target, id: g.id, fields: g.fields, decision: body.decision, note: body.note, ...(g.seen ? { seen: g.seen } : {}) }, rc);
      for (const f of g.fields) results.push({ key: `${g.target}:${g.id}:${f}`, ok: true, notices: out.notices || [] });
    } catch (err) {
      const known = err && !err.internal && Number(err.status) >= 400 && Number(err.status) < 500;
      if (!known) console.error('admin/show staged:', err && err.message ? err.message : err);
      for (const f of g.fields) results.push({ key: `${g.target}:${g.id}:${f}`, ok: false, error: known ? err.message : 'Something went wrong. Please try again.', ...(known && err.extra ? err.extra : {}) });
    }
  }
  return { status: 200, body: { ok: results.every((r) => r.ok), results } };
}

export default async function handler(req, res) {
  if (!startShowRoute(req, res, ['GET', 'POST'])) return;
  const rc = await requireCapability(req, res, SHOW_ADMIN_CAPS);
  if (!rc) return;
  const who = { userId: rc.userId };
  const id = idFrom(req);
  if (!id || !isTitleId(id)) return res.status(404).json({ error: 'That show isn’t there.' });
  try {
    if (req.method === 'GET') {
      if (!(await showLimit(req, res, who, 'admin-show', 600))) return;
      return res.status(200).json(await getAdminShow(id, rc));
    }
    const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
    const action = typeof body.action === 'string' ? body.action : '';
    const ACTIONS = ['approve', 'reject', 'fix_numbering', 'staged', 'hold', 'take_down', 'restore', 'owner', 'grant_creator', 'remove', 'deny_removal', 'tell_savers'];
    if (!ACTIONS.includes(action)) return res.status(400).json({ error: 'Which action?' });
    if (!(await showLimit(req, res, who, 'admin-show-write', 300))) return;
    if (action === 'tell_savers' && !(await showLimit(req, res, who, 'admin-show-tell', 10))) return;
    switch (action) {
      case 'approve':
        return res.status(200).json(await approveShowEpisodes(id, { episodeIds: body.episodeIds, tierOverride: hasOwn(body, 'tierOverride') ? body.tierOverride : 'keep', seen: body.seen }, rc));
      case 'reject':
        return res.status(200).json(await rejectShowEpisodes(id, { episodeIds: body.episodeIds, reason: body.reason }, rc));
      case 'fix_numbering':
        return res.status(200).json(await fixNumbering(id, { season: body.season }, rc));
      case 'staged': {
        const out = await decideItems(body, rc);
        return res.status(out.status).json(out.body);
      }
      case 'hold':
        return res.status(200).json(await holdShow(id, { reason: body.reason, note: body.note, emailOwner: body.emailOwner === true }, rc));
      case 'take_down':
        return res.status(200).json(await takeDownShow(id, { note: body.note }, rc));
      case 'restore':
        return res.status(200).json(await restoreShow(id, rc));
      case 'owner':
        return res.status(200).json(await setShowOwner(id, { email: typeof body.email === 'string' ? body.email : null }, rc));
      case 'grant_creator':
        return res.status(200).json(await grantOwnerCreator(id, rc));
      case 'remove':
        return res.status(200).json(await removeShow(id, { confirmName: body.confirmName, reason: body.reason }, rc));
      case 'deny_removal':
        return res.status(200).json(await denyShowRemoval(id, { note: body.note }, rc));
      case 'tell_savers':
      default:
        return res.status(200).json(await tellSaversNow(id, rc));
    }
  } catch (err) {
    return showRouteError(res, err, 'admin/show/[id]', 'Could not do that just now.');
  }
}
