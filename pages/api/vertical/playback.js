import { findEpisode } from '../../../lib/episodes';
import { getAccountContext } from '../../../lib/accountContext';
import { signedSrcForStoredUrl } from '../../../lib/cloudflareUpload';

// Server-only playback source lookup for the vertical discover feed. The
// feed's own deck-building already filters premium episodes out for
// non-subscribers (see pages/vertical/discover.js), so this should rarely
// deny anything in practice — but the client could still directly request
// an episode ID that isn't actually in its own deck, so this replicates
// the same entitled-or-not check pages/episode/[id].js uses rather than
// trusting the client's own filtering.
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { episodeId } = req.query;
  if (!episodeId) return res.status(400).json({ error: 'episodeId is required.' });

  const episode = await findEpisode(episodeId);
  if (!episode) return res.status(404).json({ error: 'Not found.' });
  if (episode.contentType !== 'vertical') {
    // Defense in depth — this endpoint only exists for the vertical feed,
    // it shouldn't become a generic "get me any episode's src" backdoor.
    return res.status(400).json({ error: 'Not a vertical episode.' });
  }

  const account = await getAccountContext(req);
  const entitled = episode.tier === 'free' || account.isSubscriber || account.isAdmin;
  if (!entitled) return res.status(403).json({ error: 'Subscription required.' });

  let playbackSrc = episode.src;
  if (episode.tier === 'premium' && episode.src) {
    playbackSrc = await signedSrcForStoredUrl(episode.src);
  }

  return res.status(200).json({ src: playbackSrc });
}
