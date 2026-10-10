import { geocode, reverseGeocode } from '../../../lib/geocode';

// GET ?q=long beach        → { places: [{ label, city, region, country, lat, lng }] }
// GET ?lat=33.77&lng=-118.19 → { places: [the one place that point is in] }
// Used by the working-card editor and the directory's "near" box, on the
// website and in the app. Answers are cached upstream (lib/geocode.js) and
// at the edge, so repeated lookups cost nothing.
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  res.setHeader('Access-Control-Allow-Origin', '*');
  try {
    const { q, lat, lng } = req.query;
    if (lat !== undefined || lng !== undefined) {
      const place = await reverseGeocode(lat, lng);
      res.setHeader('Cache-Control', 'public, s-maxage=86400');
      return res.status(200).json({ places: place ? [place] : [] });
    }
    const query = String(q || '').trim();
    if (query.length < 2) return res.status(200).json({ places: [] });
    if (query.length > 80) return res.status(400).json({ error: 'Keep the place name under 80 characters.' });
    const places = await geocode(query);
    res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=604800');
    return res.status(200).json({ places });
  } catch (err) {
    console.error('crew/geocode:', err.message);
    return res.status(502).json({ error: 'Could not look that place up right now. Try again in a moment.' });
  }
}
