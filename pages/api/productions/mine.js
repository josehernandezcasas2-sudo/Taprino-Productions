import { getAuth } from '@clerk/nextjs/server';
import { listMyProductions, bookedPlacesFor, ownReleaseOptions } from '../../../lib/productions';
import { getMyProductionsView } from '../../../lib/productionDashboard';
import { checkRateLimit } from '../../../lib/rateLimit';
import { sendError } from '../../../lib/apiErrors';
import { applyCors } from '../../../lib/cors';

// The signed-in person's productions: the ones they own and the ones
// they're on the crew of, plus the places they've paid to book (for the
// call sheet's "Where" picker) and their live titles (for linking a
// production's release).
//   GET → { owned, crewOn, bookedPlaces, releases,
//           items, readyPitches, today }
// `items` / `readyPitches` / `today` are Your productions (2026-11-19;
// /productions/mine and the app's productions/mine screen): every
// production they run or are crew on, one summary each, which
// lib/productionDashRules.js mineGroups / yoursCard turn into the tabs
// and cards; readyPitches are their approved pitches with no production
// yet ("Got a pitch?"). `today` is the Pacific day the summaries were read on.
export default async function handler(req, res) {
  applyCors(req, res);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: 'Sign in first.' });
  if (!(await checkRateLimit(`productions-mine:${userId}`, 60, 60))) return res.status(429).json({ error: 'Slow down a little.' });
  try {
    const [mine, bookedPlaces, releases, view] = await Promise.all([listMyProductions(userId), bookedPlacesFor(userId).catch(() => []), ownReleaseOptions(userId).catch(() => []), getMyProductionsView(userId)]);
    return res.status(200).json({ ...mine, bookedPlaces, releases, ...view });
  } catch (err) {
    return sendError(res, err, 'productions/mine', 'Could not load your productions right now.');
  }
}
