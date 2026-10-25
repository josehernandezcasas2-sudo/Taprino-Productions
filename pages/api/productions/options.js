import { productionRules } from '../../../lib/productionRules';

// Public: kinds, statuses, visibility choices and limits for productions,
// for the app (the website imports lib/productionRules.js directly).
export default function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
  return res.status(200).json(productionRules());
}
