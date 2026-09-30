import { getVerticalSeriesBrowseData } from '../../lib/verticalSeriesBrowse';

// The mobile app's equivalent of pages/vertical/browse.js — same
// entitlement-filtered series list, shared via lib/verticalSeriesBrowse.js.
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');

  const { series } = await getVerticalSeriesBrowseData(req);
  return res.status(200).json({ series });
}
