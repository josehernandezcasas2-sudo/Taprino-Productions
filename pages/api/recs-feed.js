import { getAuth } from '@clerk/nextjs/server';
import { getAccountContext } from '../../lib/accountContext';
import { getPublicEpisodes } from '../../lib/publicEpisodes';
import { getWatchHistory } from '../../lib/watchHistory';
import { getSiteSettings } from '../../lib/siteSettings';
import { getRecommendations } from '../../lib/recommendations';
import { applyCors } from '../../lib/cors';

// The app's My Recs screen (mobile/src/app/recs.js): the same recipe as
// pages/recs.js getServerSideProps — taste from the wishlist and watch
// history, the site's closeness setting, 24 picks — trimmed to card
// fields. Personal, so never cached.
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

  try {
    const account = await getAccountContext(req);
    if (!account.isSignedIn) return res.status(200).json({ isSignedIn: false, recommendations: [] });
    const { userId } = getAuth(req);
    const [episodesWithBonus, siteSettings] = await Promise.all([getPublicEpisodes(), getSiteSettings()]);
    const episodes = episodesWithBonus.filter((e) => e.contentType !== 'bonus');
    const watchHistory = userId ? await getWatchHistory(userId, episodes) : [];
    const tasteIds = [...account.wishlist, ...watchHistory.map((e) => e.id)];
    const recommendations = getRecommendations({
      episodes,
      tasteIds,
      excludeIds: tasteIds,
      closeness: siteSettings.recommendationCloseness,
      count: 24
    }).map((e) => ({
      id: e.id,
      title: e.title,
      poster: e.poster || null,
      thumbnail: e.thumbnail || null,
      tier: e.tier,
      adsEnabled: e.adsEnabled,
      contentType: e.contentType,
      seriesId: e.seriesId || null,
      seriesOrder: e.seriesOrder || null,
      mainGenre: e.mainGenre || null,
      runtime: e.runtime || null
    }));
    return res.status(200).json({ isSignedIn: true, recommendations });
  } catch (err) {
    console.error('recs-feed error:', err.message);
    return res.status(500).json({ error: 'Could not load recommendations right now.' });
  }
}
