import { getAuth } from '@clerk/nextjs/server';
import { getAccountContext } from '../../lib/accountContext';
import { getPublicEpisodes } from '../../lib/publicEpisodes';
import { getAllSeries } from '../../lib/series';
import { getSiteSettings } from '../../lib/siteSettings';
import { getRecommendations } from '../../lib/recommendations';
import { getWatchHistory } from '../../lib/watchHistory';
import { filterEntitledVertical, buildPersonalUnitKeys } from '../../lib/verticalFeed';

// The mobile app's equivalent of pages/vertical/discover.js's
// getServerSideProps — same entitlement filter, same personalization
// pass (recommendations scoped to vertical content, turned into unit
// keys for the 3-random/1-curated/3-personal picker). Deliberately
// leaves out user-posted videos (lib/posts.js, an admin test feature
// with no mobile equivalent yet) and house-ad slides (mobile ad
// integration is paused — see project_mobile_app_ads_paused memory):
// this feed is catalog-only. The unit-building/picker/slide-expansion
// logic itself (lib/verticalFeed.js) is pure and has no server-only
// deps, so it's ported as-is into mobile/src/lib/verticalFeed.js and
// runs client-side there too, same as it does on the website.
export default async function handler(req, res) {
  // Browsers send an OPTIONS pre-check before any request carrying an
  // Authorization header (the app's web preview does); answer it.
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    return res.status(204).end();
  }
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');

  const account = await getAccountContext(req);
  const { userId } = getAuth(req);
  const [episodes, allSeries, siteSettings] = await Promise.all([
    getPublicEpisodes(),
    getAllSeries(),
    getSiteSettings()
  ]);

  const entitled = account.isSubscriber || account.isAdmin;
  const verticalEpisodes = filterEntitledVertical(episodes, entitled);

  const seriesNameById = {};
  for (const s of allSeries) seriesNameById[s.id] = s.name;

  let personalUnitKeys = [];
  if (account.isSignedIn) {
    const watchHistory = userId ? await getWatchHistory(userId, verticalEpisodes) : [];
    const tasteIds = [...account.wishlist, ...watchHistory.map((e) => e.id)];
    const recommended = getRecommendations({
      episodes: verticalEpisodes,
      tasteIds,
      excludeIds: [],
      closeness: siteSettings.recommendationCloseness,
      count: verticalEpisodes.length
    });
    personalUnitKeys = [...buildPersonalUnitKeys(recommended)];
  }

  return res.status(200).json({
    verticalEpisodes,
    seriesNameById,
    isSignedIn: account.isSignedIn,
    viewerId: account.userId,
    wishlist: account.wishlist,
    personalUnitKeys
  });
}
