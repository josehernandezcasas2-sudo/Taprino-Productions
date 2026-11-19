import { getRoleContext } from '../../../../lib/roles';
import { getProductionDashboard } from '../../../../lib/productionDashboard';
import { checkRateLimit } from '../../../../lib/rateLimit';
import { sendError } from '../../../../lib/apiErrors';
import { applyCors } from '../../../../lib/cors';

// The production dashboard's data (the website's page reads the same in
// getServerSideProps; the app's productions/[id]/dashboard screen reads
// this). The owner, a listed producer, or a full admin.
//   GET → { facts, bookedPlaces, dashboardHref }
//         facts: lib/productionDashRules.js documents its shape;
//         productionDashboard(facts) turns it into what the screen draws.
//   403 → { error, code: 'not-manager', productionHref }   (anyone else: show them the production page)
//   404 → not here (or removed)
export default async function handler(req, res) {
  applyCors(req, res);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const id = String(req.query.id || '');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return res.status(404).json({ error: 'That production isn’t here.' });
  try {
    const account = await getRoleContext(req).catch(() => ({ userId: null, isAdmin: false }));
    if (!account.userId) return res.status(401).json({ error: 'Sign in first.', code: 'not-manager', productionHref: `/productions/${id}` });
    if (!(await checkRateLimit(`production-dashboard:${account.userId}`, 120, 60))) return res.status(429).json({ error: 'Slow down a little.' });
    return res.status(200).json(await getProductionDashboard(id, { viewerId: account.userId, isAdmin: account.isAdmin }));
  } catch (err) {
    if (err && err.extra && err.extra.code === 'not-manager') return res.status(err.status || 403).json({ error: err.message, code: 'not-manager', productionHref: err.extra.productionHref });
    return sendError(res, err, 'productions/[id]/dashboard', 'Could not load the dashboard right now.');
  }
}
