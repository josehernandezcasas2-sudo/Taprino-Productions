import { findEpisode } from '../../lib/episodes';
import { getAccountContext } from '../../lib/accountContext';
import { signedSrcForStoredUrl } from '../../lib/videoSigning';
import { SITE } from '../../lib/siteConfig';
import { getOwnProfile } from '../../lib/userProfiles';
import { meetsAgeRequirement } from '../../lib/ageGate';
import { getRatings } from '../../lib/ratings';

// Mints a fresh Cloudflare Stream playback token for a single episode.
//
// The episode page already ships a signed URL in its props, so this exists
// for one specific case: the token expiring while someone is still on the
// page (a long episode, or a long pause). The player calls this on a fatal
// network error and resumes from the same spot.
//
// SECURITY: this is the one endpoint that can hand out access to premium
// video, so entitlement is re-checked here from the session on every call.
// It is never inferred from what the client sends — the request body only
// says WHICH episode, never whether the caller is allowed to watch it.
export default async function handler(req, res) {
  // Open to any origin — this is an external client endpoint (the mobile
  // app, and its web preview) by design; entitlement is what actually
  // gates access, not the origin. The Authorization header lets the app
  // pass a Clerk session token the same way it would a cookie on web.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { episodeId } = req.body || {};
  if (!episodeId || typeof episodeId !== 'string') {
    return res.status(400).json({ error: 'episodeId is required' });
  }

  const episode = await findEpisode(episodeId);
  if (!episode || episode.status === 'pending' || episode.status === 'rejected') {
    // Same response for "doesn't exist" and "not published" — no reason to
    // let anyone enumerate unreleased episode ids from this endpoint.
    return res.status(404).json({ error: 'Not found' });
  }

  const account = await getAccountContext(req);

  // Same age gate as pages/episode/[id].js — without it, anything that asks
  // this endpoint for a src directly (the mobile app does) could play an
  // age-restricted title the website itself would refuse to show. Admins
  // bypass; unknown age fails closed (see lib/ageGate.js).
  if (!account.isAdmin) {
    const profile = account.isSignedIn ? await getOwnProfile(account.userId) : null;
    const viewerAge = profile && profile.age != null ? profile.age : null;
    if (!meetsAgeRequirement(viewerAge, episode.rating, await getRatings())) {
      return res.status(403).json({ error: 'This title is age-restricted.', ageRestricted: true, rating: episode.rating || 'Not Rated' });
    }
  }

  const entitled = episode.tier === 'free' || account.isSubscriber;
  if (!entitled) {
    return res.status(403).json({ error: `This episode is for ${SITE.premiumTier} members.` });
  }

  if (!episode.src) {
    return res.status(404).json({ error: 'No video attached to this episode.' });
  }

  const signed = await signedSrcForStoredUrl(episode.src);
  if (!signed) {
    // Not a Cloudflare Stream URL (a self-hosted mp4, say), or Cloudflare
    // isn't configured in this environment. The stored URL is the answer.
    return res.status(200).json({ src: episode.src, signed: false });
  }

  // Never let this response sit in a shared cache — it's a credential.
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  return res.status(200).json({ src: signed.src, expiresAt: signed.expiresAt, signed: true });
}
