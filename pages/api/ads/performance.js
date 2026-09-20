import { getAuth } from '@clerk/nextjs/server';
import { getOwnAdAccount, getAdsForAccount } from '../../../lib/adAccounts';
import { getDailyAdImpressions, isRedisConfigured } from '../../../lib/redis';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { userId } = getAuth(req);
  if (!userId) {
    return res.status(401).json({ error: 'Not signed in.' });
  }

  const account = await getOwnAdAccount(userId);
  if (!account) {
    return res.status(403).json({ error: 'Create an ad account first.' });
  }

  if (!isRedisConfigured()) {
    return res.status(200).json({ configured: false });
  }

  // Own ad ids only — the daily buckets in Redis are keyed by ad id
  // across every advertiser on the site, so this narrows the response
  // down to just the ones belonging to whoever is asking, the same way
  // getAdsForAccount already scopes everything else on this dashboard.
  const ads = await getAdsForAccount(account.id);
  const ownAdIds = new Set(ads.map((a) => a.id));

  const daily = await getDailyAdImpressions(14);

  // Per ad: [{ date, count }] for the last 14 days, plus a simple
  // this-week-vs-last-week trend so "is this actually improving" has a
  // real answer instead of just a lifetime total with no direction.
  const byAd = {};
  for (const id of ownAdIds) {
    const series = daily.map((day) => ({ date: day.date, count: day.counts[id] || 0 }));
    const last7 = series.slice(-7).reduce((sum, d) => sum + d.count, 0);
    const prior7 = series.slice(0, 7).reduce((sum, d) => sum + d.count, 0);
    byAd[id] = { series, last7, prior7 };
  }

  return res.status(200).json({ configured: true, byAd });
}
