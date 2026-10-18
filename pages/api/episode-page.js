import { getEpisodePageData } from '../../lib/episodePage';

// Trim an episode record down to what a card/sidebar needs — and never a
// playable URL. The app gets the real src from POST /api/stream-token,
// which re-checks entitlement (and the age gate) on every call.
function stripPlayable(e) {
  if (!e) return e;
  const { src, audioDescriptionSrc, audioUrl, ...rest } = e;
  return rest;
}

// The episode being viewed keeps its podcast audio URL only when the
// viewer is entitled to it (same rule as pages/episode/[id].js) — the
// audio lives in a public bucket, so the link is permanent once seen.
function stripForViewer(e, entitled) {
  if (!e) return e;
  const out = stripPlayable(e);
  if (entitled && e.audioUrl) out.audioUrl = e.audioUrl;
  return out;
}

// The mobile app's equivalent of pages/episode/[id].js's getServerSideProps
// — same lib/episodePage.js, so loading this records the view and applies
// the age gate exactly like opening the episode on the website.
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');

  const { id } = req.query;
  if (!id || typeof id !== 'string') return res.status(400).json({ error: 'id is required' });

  const data = await getEpisodePageData(id, req);
  if (data.notFound) return res.status(404).json({ error: 'Not found' });
  if (data.ageRestricted) {
    return res.status(200).json({ ageRestricted: true, requiredRating: data.requiredRating, requiredAge: data.requiredAge ?? null, isSignedIn: data.isSignedIn });
  }

  const entitled = data.episode.tier === 'free' || data.account.isSubscriber || data.account.isAdmin;
  return res.status(200).json({
    episode: stripForViewer(data.episode, entitled),
    isSignedIn: data.account.isSignedIn,
    isSubscriber: data.account.isSubscriber,
    adFree: data.account.adFree,
    // Where to pick up (seconds), from the same Stripe-held progress the
    // website resumes from; 0 when there's nothing worth resuming.
    resumeSeconds: (data.account.watchProgress && Number(data.account.watchProgress[data.episode.id])) || 0,
    parentSeriesName: data.parentSeriesName,
    nextEpisode: stripPlayable(data.nextEpisode),
    previousEpisode: stripPlayable(data.previousEpisode),
    previousEpisodeWatched: data.previousEpisodeWatched,
    watchNext: data.watchNext.map(stripPlayable),
    bonusContent: data.bonusContent.map(stripPlayable)
  });
}
