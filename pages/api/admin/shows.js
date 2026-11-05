import { requireCapability } from '../../../lib/adminAuth';
import { startShowRoute, showLimit, showRouteError } from '../../../lib/showRoute';
import { SHOW_ADMIN_CAPS } from '../../../lib/showAdminRules';
import { createShowForCreator, listAdminShows } from '../../../lib/showAdmin';

// Admin → Shows (the series revamp, slice 3a: mockups/series-slice3a-
// contract.md §4.4). Any of the five show capabilities opens it; each
// action asks for its own inside lib/showAdmin.js.
//
//   GET ?filter=&q=  → { shows, counts, filter, q, migration: { shows118 } }
//   POST { action: 'create', ownerEmail, name, kind, description,
//          defaults: { tier, rating, mainGenre }, grantCreator }
//        → { ok, id, href, roleGranted }   (manage_episodes; Creator
//          Studio for someone without it: a full admin)
export default async function handler(req, res) {
  if (!startShowRoute(req, res, ['GET', 'POST'])) return;
  const rc = await requireCapability(req, res, SHOW_ADMIN_CAPS);
  if (!rc) return;
  const who = { userId: rc.userId };
  try {
    if (req.method === 'GET') {
      if (!(await showLimit(req, res, who, 'admin-shows', 300))) return;
      const q = typeof req.query.q === 'string' ? req.query.q : '';
      const filter = typeof req.query.filter === 'string' ? req.query.filter : 'all';
      return res.status(200).json(await listAdminShows(rc, { q, filter }));
    }
    const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
    if (body.action !== 'create') return res.status(400).json({ error: 'action must be "create".' });
    if (!(await showLimit(req, res, who, 'admin-shows-create', 30))) return;
    return res.status(200).json(await createShowForCreator(body, rc));
  } catch (err) {
    return showRouteError(res, err, 'admin/shows', 'Could not do that just now.');
  }
}
