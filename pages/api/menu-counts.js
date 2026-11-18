import { listCalls } from '../../lib/crewCalls';
import { searchListings } from '../../lib/locations';
import { listProductions } from '../../lib/productions';
import { getApprovedPitches } from '../../lib/pitches';
import { getCurrentLiveStream } from '../../lib/liveStreams';
import { getSiteSettings } from '../../lib/siteSettings';
import { limitPublicRead } from '../../lib/rateLimit';
import { applyCors } from '../../lib/cors';

const NEW_PLACE_DAYS = 7;

// The live lines on the ☰ menu's tiles (lib/siteMenuRules.js, 2026-11-18):
// open and urgent calls, pitches raising money, new places this week, shoots
// under way and what is on air. The same public numbers the Notice Board
// shows anyone (lib/homeFeed.js `counts`), read for nobody in particular, so
// the answer is cached at the edge for a minute and costs these few reads at
// most once a minute however many menus open. A read that fails leaves its
// number out and the tile shows its plain line.
export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    applyCors(req, res);
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    return res.status(204).end();
  }
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  applyCors(req, res);
  if (!(await limitPublicRead(req, res, 'menu-counts'))) return undefined;
  const soft = (p) => p.catch((err) => { console.error('menu counts:', err.message); return null; });
  const [settings, calls, places, productions, pitches, live] = await Promise.all([
    soft(getSiteSettings()),
    soft(listCalls({}, {})),
    soft(searchListings({}, {})),
    soft(listProductions({}, {})),
    soft(getApprovedPitches()),
    soft(getCurrentLiveStream())
  ]);
  const weekAgo = Date.now() - NEW_PLACE_DAYS * 86400000;
  const listings = places && Array.isArray(places.listings) ? places.listings : null;
  const prods = productions && Array.isArray(productions.productions) ? productions.productions : null;
  const counts = {};
  if (calls) {
    counts.openCalls = calls.total || (calls.calls || []).length;
    counts.urgent = calls.urgentCount || 0;
  }
  if (pitches && (!settings || settings.elevatorPitchEnabled !== false)) counts.raising = pitches.length;
  if (listings) {
    counts.places = places.total || listings.length;
    counts.newPlaces = listings.filter((l) => l.updatedAt && Date.parse(l.updatedAt) > weekAgo).length;
  }
  if (prods) counts.shooting = prods.filter((p) => p.status === 'shooting').length;
  if (live && live.title && (!settings || settings.liveTvEnabled !== false)) counts.liveNow = { title: String(live.title).slice(0, 80) };
  res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
  return res.status(200).json({ counts });
}
