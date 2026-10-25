import { getVerticalSeriesBrowseData } from '../../lib/verticalSeriesBrowse';
import { limitPublicRead } from '../../lib/rateLimit';
import { applyCors } from '../../lib/cors';

// The mobile app's equivalent of pages/vertical/browse.js — same
// entitlement-filtered series list, shared via lib/verticalSeriesBrowse.js.
export default async function handler(req, res) {
  // Browsers send an OPTIONS pre-check before any request carrying an
  // Authorization header (the app's web preview does); answer it.
  if (req.method === 'OPTIONS') {
    applyCors(req, res);
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    return res.status(204).end();
  }
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  applyCors(req, res);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (!(await limitPublicRead(req, res, 'vertical-series'))) return undefined;
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');

  const { series } = await getVerticalSeriesBrowseData(req);
  return res.status(200).json({ series });
}
