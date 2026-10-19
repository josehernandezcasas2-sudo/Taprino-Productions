import { getPublicEpisodes } from '../lib/publicEpisodes';
import { meetsAgeRequirement } from '../lib/ageGate';
import { getRatings } from '../lib/ratings';
import { getAllSeries } from '../lib/series';
import { episodeHref } from '../lib/episodeLinks';

// Generated at request time rather than kept as a static file, so newly
// published episodes appear without anyone remembering to regenerate
// anything. Only genuinely public, crawlable pages go in — admin, creator
// tooling, and the account page are excluded here and in robots.txt.
function buildSitemap(origin, episodes, series, genres) {
  const podcastShowIds = new Set(episodes.filter((e) => e.contentType === 'podcast' && e.seriesId).map((e) => e.seriesId));
  const staticPages = [
    { path: '/', priority: '0.5', freq: 'monthly' },
    { path: '/stream', priority: '1.0', freq: 'daily' },
    { path: '/about', priority: '0.6', freq: 'monthly' },
    { path: '/contact', priority: '0.6', freq: 'monthly' },
    { path: '/apply', priority: '0.7', freq: 'monthly' },
    { path: '/live', priority: '0.6', freq: 'hourly' },
    { path: '/university', priority: '0.7', freq: 'weekly' },
    { path: '/terms', priority: '0.3', freq: 'yearly' },
    { path: '/privacy', priority: '0.3', freq: 'yearly' },
    { path: '/cookies', priority: '0.3', freq: 'yearly' }
  ];

  const urls = [
    ...staticPages.map((p) => ({ loc: `${origin}${p.path}`, priority: p.priority, freq: p.freq })),
    ...genres.map((g) => ({
      loc: `${origin}/genre/${encodeURIComponent(g)}`,
      priority: '0.6',
      freq: 'weekly'
    })),
    // Podcast shows live at /podcasts/<id>, not /series/<id>; podcast
    // episodes link to their show (the video page can't play audio) and
    // bonus clips aren't pages of their own.
    ...series.map((s) => ({
      loc: `${origin}${podcastShowIds.has(s.id) ? '/podcasts/' : '/series/'}${encodeURIComponent(s.id)}`,
      priority: '0.8',
      freq: 'weekly'
    })),
    ...episodes.filter((e) => e.contentType !== 'bonus' && e.contentType !== 'podcast').map((e) => ({
      loc: `${origin}${episodeHref(e)}`,
      priority: '0.8',
      freq: 'weekly'
    }))
  ];

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map(
    (u) => `  <url>
    <loc>${u.loc}</loc>
    <changefreq>${u.freq}</changefreq>
    <priority>${u.priority}</priority>
  </url>`
  )
  .join('\n')}
</urlset>
`;
}

export async function getServerSideProps({ req, res }) {
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const origin = `${proto}://${host}`;

  let episodes = [];
  let series = [];
  try {
    let ratings;
    [episodes, series, ratings] = await Promise.all([getPublicEpisodes(), getAllSeries(), getRatings().catch(() => null)]);
    // Only pages a signed-out visitor can open: an age-restricted episode
    // answers a crawler with the age gate (403), and half the sitemap
    // used to be exactly that.
    episodes = episodes.filter((e) => meetsAgeRequirement(null, e.rating, ratings));
  } catch (err) {
    // A sitemap that 500s is worse than a sparse one — crawlers back off
    // from a site that errors. Fall through with whatever we have.
    console.error('sitemap generation error:', err.message);
  }

  const genres = [...new Set(episodes.map((e) => e.mainGenre).filter(Boolean))];

  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');
  res.write(buildSitemap(origin, episodes, series || [], genres));
  res.end();

  return { props: {} };
}

// Never rendered — getServerSideProps writes the XML directly and ends the
// response. Next still requires a default export for the route to exist.
export default function Sitemap() {
  return null;
}
