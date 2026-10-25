import { findEpisode } from '../../../lib/episodes';
import { findPost } from '../../../lib/posts';
import { getAccountContext } from '../../../lib/accountContext';
import { signedSrcForStoredUrl } from '../../../lib/videoSigning';
import { getViewerAgeContext } from '../../../lib/viewerAge';
import { limitPublicRead } from '../../../lib/rateLimit';

// Signs whatever stored src a deck item has (free, premium, or a user
// post). A video that doesn't demand signed URLs yet plays either way;
// one that does (lib/streamProtection.js) needs this. The stored URL is
// the answer only for self-hosted mp4s and local runs without Cloudflare.
async function playable(storedSrc) {
  const signed = await signedSrcForStoredUrl(storedSrc);
  return signed ? signed.src : storedSrc;
}

// Server-only playback source lookup for the vertical discover feed. The
// feed's own deck-building already filters premium episodes out for
// non-subscribers (see pages/vertical/discover.js), so this should rarely
// deny anything in practice — but the client could still directly request
// an episode ID that isn't actually in its own deck, so this replicates
// the same entitled-or-not check pages/episode/[id].js uses rather than
// trusting the client's own filtering.
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { episodeId } = req.query;
  if (!episodeId) return res.status(400).json({ error: 'episodeId is required.' });

  const account = await getAccountContext(req);
  // A reel swipe is a call, so the budget is wide for a person and still
  // far below a script walking the whole deck.
  if (!(await limitPublicRead(req, res, 'vertical-playback', { max: 600, windowSeconds: 3600, userId: account.userId }))) return undefined;

  // User-posted videos (lib/posts.js) are woven into the same deck as real
  // episodes (see pages/vertical/discover.js), prefixed "post:" so this
  // endpoint can tell them apart — they live in a separate table with no
  // tier/entitlement concept, always free.
  if (episodeId.startsWith('post:')) {
    const post = await findPost(episodeId.slice(5));
    if (!post || post.kind !== 'video') return res.status(404).json({ error: 'Not found.' });
    return res.status(200).json({ src: await playable(post.videoSrc) });
  }

  const episode = await findEpisode(episodeId);
  if (!episode) return res.status(404).json({ error: 'Not found.' });
  if (episode.contentType !== 'vertical') {
    // Defense in depth — this endpoint only exists for the vertical feed,
    // it shouldn't become a generic "get me any episode's src" backdoor.
    return res.status(400).json({ error: 'Not a vertical episode.' });
  }
  // Same age gate as stream-token: the feed filters by rating for the
  // viewer, but an id can be requested directly.
  const age = await getViewerAgeContext(account, req);
  if (!age.allows(episode.rating)) return res.status(403).json({ error: 'This title is age-restricted.', ageRestricted: true });
  const entitled = episode.tier === 'free' || account.isSubscriber || account.isAdmin;
  if (!entitled) return res.status(403).json({ error: 'Subscription required.' });

  if (!episode.src) return res.status(404).json({ error: 'No video attached.' });
  return res.status(200).json({ src: await playable(episode.src) });
}
