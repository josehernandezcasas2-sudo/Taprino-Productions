import { getSeriesHubData } from '../../lib/seriesHub';
import { limitPublicRead } from '../../lib/rateLimit';
import { applyCors } from '../../lib/cors';
import { isTitleId } from '../../lib/titleIds';

// The mobile app's equivalent of pages/series/[id].js's getServerSideProps
// — same lib/seriesHub.js, same shape, minus the fields that only exist
// for the website's own HeaderNav (mainGenres, email, isAdmin, isCreator,
// isSubscriber — entitlement itself is still enforced server-side when an
// episode is actually opened, not on this hub).
//
// ?season=2 → `season`: the season to open (the one asked for when the
// show has it, else its first). A podcast show carries `redirect`
// ('/podcasts/<id>') and `kind`, alongside the usual answer, so an app
// build that doesn't follow it yet still renders (the website 302s).
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

  const id = typeof req.query.id === 'string' ? req.query.id : '';
  if (!id) return res.status(400).json({ error: 'id is required.' });
  // An id sweep counts against the limit before any work is done.
  if (!(await limitPublicRead(req, res, 'series-hub'))) return undefined;
  if (!isTitleId(id)) return res.status(404).json({ error: 'Not found' });

  const season = typeof req.query.season === 'string' ? req.query.season : null;
  const data = await getSeriesHubData(id, req, { season, followKind: false });
  if (!data) return res.status(404).json({ error: 'Not found' });

  const hasSession = Boolean(req.headers.cookie && /__session|__clerk/.test(req.headers.cookie)) || Boolean(req.headers.authorization);
  res.setHeader('Cache-Control', hasSession ? 'private, no-cache, no-store, must-revalidate' : 'public, s-maxage=300, stale-while-revalidate=600');

  return res.status(200).json({
    seriesInfo: data.seriesInfo,
    seriesEpisodes: data.seriesEpisodes,
    bonusContent: data.bonusContent,
    isSignedIn: data.isSignedIn,
    wishlist: data.wishlist,
    // Buy to own: the series bundle and each episode's price for this viewer.
    bundle: data.bundle,
    episodeOffers: data.episodeOffers,
    // The maker's "Not for AI training" seal (lib/aiPolicyRules.js).
    aiSeal: data.aiSeal !== false,
    // Where the Play button picks the show up for this viewer (lib/seriesResume.js).
    resume: data.resume || null,
    // The show's kind ('series' | 'podcast' | 'vertical'); a podcast's
    // page is /podcasts/<id> (`redirect`, null otherwise).
    kind: data.kind || 'series',
    redirect: data.redirect || null,
    // The season to open (?season=).
    season: data.season || 1
  });
}
