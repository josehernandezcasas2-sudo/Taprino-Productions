import { generatePodcastRssFeed } from '../../../../lib/podcastRss';
import { SITE } from '../../../../lib/siteConfig';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const feed = await generatePodcastRssFeed(req.query.id, SITE.productionDomain);
  if (!feed) {
    return res.status(404).json({ error: 'No free-tier podcast episodes found for this show.' });
  }

  // Cached at the edge for an hour — this only changes when a new
  // episode is approved, so there's no need to regenerate the whole XML
  // document (including the HEAD-request fallback for any legacy
  // episodes) on every single poll from every subscribed podcast app.
  res.setHeader('Content-Type', 'application/rss+xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
  return res.status(200).send(feed);
}
