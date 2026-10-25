import { getRoleContext } from '../../../../lib/roles';
import { getListing, updateListing, setListingStatus } from '../../../../lib/locations';
import { limitPublicRead } from '../../../../lib/rateLimit';

// One place.
//   GET                      → { listing } (public shape unless host/admin)
//   PATCH { status }         → pause ('paused'), resume ('listed'), remove ('removed')
//   PATCH { ...fields }      → edit (host or admin); re-validates the whole listing
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PATCH, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (!(await limitPublicRead(req, res, 'location'))) return undefined;
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  const id = String(req.query.id || '');
  const rc = await getRoleContext(req);
  const viewerId = rc.userId || null;

  try {
    if (req.method === 'GET') {
      return res.status(200).json({ listing: await getListing(id, { viewerId, isAdmin: rc.isAdmin }) });
    }
    if (req.method === 'PATCH') {
      if (!viewerId) return res.status(401).json({ error: 'Sign in first.' });
      const body = req.body || {};
      if (body.status && Object.keys(body).length === 1) {
        return res.status(200).json(await setListingStatus(viewerId, id, body.status, { isAdmin: rc.isAdmin }));
      }
      return res.status(200).json({ listing: await updateListing(viewerId, id, body, { isAdmin: rc.isAdmin }) });
    }
    res.setHeader('Allow', 'GET, PATCH');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('locations/[id]:', err.message);
    return res.status(500).json({ error: 'Could not load that place right now.' });
  }
}
