import { getAuth } from '@clerk/nextjs/server';
import { startProductionFromPitch } from '../../../../lib/productions';
import { dashHref } from '../../../../lib/productionDashRules';
import { checkRateLimit, rateLimitKeyForRequest } from '../../../../lib/rateLimit';
import { sendError } from '../../../../lib/apiErrors';
import { applyCors } from '../../../../lib/cors';

// Start the production a pitch grows into (2026-11-19; part B of
// mockups/productions-yearly-contract.md). The pitch's creator only, an
// approved pitch, one production per pitch (migration 127). Backing on the
// pitch stays as it was.
//   POST { title, logline, kind, startsOn, endsOn, place, tellBackers }
//     201 → the production (as GET /api/productions/<id>) + { told, toldState, dashboardHref }
//           toldState: yes · later (the pitch had three updates today) · failed · off
//     409 → { error, code: 'exists', productionId, dashboardHref } when it already has one
//     403 not the pitch's creator · 404 no such pitch · 409 not approved · 429 ten a day
export default async function handler(req, res) {
  applyCors(req, res);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: 'Sign in to start a production.' });
  if (!(await checkRateLimit(rateLimitKeyForRequest(req, 'pitch-production'), 30, 3600))) return res.status(429).json({ error: 'Slow down a little.' });
  try {
    const result = await startProductionFromPitch(userId, String(req.query.id || ''), req.body || {});
    return res.status(201).json({ ...result, dashboardHref: dashHref(result.production.id) });
  } catch (err) {
    if (err && err.status === 409 && err.extra && err.extra.code === 'exists') {
      const productionId = err.extra.productionId || null;
      return res.status(409).json({ error: err.message, code: 'exists', productionId, dashboardHref: productionId ? dashHref(productionId) : null });
    }
    return sendError(res, err, 'pitches/[id]/production', 'Could not start the production right now.');
  }
}
