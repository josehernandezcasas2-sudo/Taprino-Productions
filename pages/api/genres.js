import { getPublicEpisodes } from '../../lib/publicEpisodes';
import { applyCors } from '../../lib/cors';
import { limitPublicRead } from '../../lib/rateLimit';
import { sendError } from '../../lib/apiErrors';

// Public, read-only: the main genres the catalogue currently has, the
// list the website's header builds for its "Browse by genre" menu from
// each page's props. The app's top bar asks here instead (TopNav.js),
// once per app session. Cached at the edge like /api/ratings.
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  applyCors(req, res);
  if (!(await limitPublicRead(req, res, 'genres'))) return undefined;
  try {
    const episodes = await getPublicEpisodes();
    const genres = [...new Set(episodes.map((e) => e.mainGenre).filter(Boolean))];
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
    return res.status(200).json({ genres });
  } catch (err) {
    return sendError(res, err, 'genres');
  }
}
