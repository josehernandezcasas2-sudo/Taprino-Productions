import { findEpisode, findEpisodeForOwner } from '../../lib/episodes';
import { getOwnership, ownsEpisode } from '../../lib/purchases';
import { getAccountContext } from '../../lib/accountContext';
import { signedSrcForStoredUrl } from '../../lib/videoSigning';
import { SITE } from '../../lib/siteConfig';
import { getOwnProfile } from '../../lib/userProfiles';
import { clearsGate, termsWouldClear } from '../../lib/ageGate';
import { termsAcceptedFrom } from '../../lib/viewerAge';
import { getRatings } from '../../lib/ratings';
import { earlyAccessState, formatOpensAt } from '../../lib/earlyAccess';

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

  const account = await getAccountContext(req);

  // Bought titles (lib/purchases.js) stay playable for their owners
  // after a creator-side takedown, so an owner's lookup skips the
  // catalogue's deletion/expiry filters; a moderation hold still hides it.
  let episode = await findEpisode(episodeId);
  const ownership = account.isSignedIn ? await getOwnership(account.userId) : null;
  let owned = Boolean(episode && ownership && ownsEpisode(ownership, episode));
  if (!episode && ownership && ownership.purchases.length) {
    const forOwner = await findEpisodeForOwner(episodeId);
    if (forOwner && ownsEpisode(ownership, forOwner)) {
      episode = forOwner;
      owned = true;
    }
  }
  if (!episode || episode.status === 'pending' || episode.status === 'rejected') {
    // Same response for "doesn't exist" and "not published" — no reason to
    // let anyone enumerate unreleased episode ids from this endpoint.
    return res.status(404).json({ error: 'Not found' });
  }

  // Same age gate as pages/episode/[id].js — without it, anything that asks
  // this endpoint for a src directly (the mobile app does) could play an
  // age-restricted title the website itself would refuse to show. Admins
  // bypass; no age on file clears titles under 17+ once the viewing terms
  // are taken (cookie, or `terms` in the body); 17+ needs an age.
  if (!account.isAdmin) {
    const profile = account.isSignedIn ? await getOwnProfile(account.userId) : null;
    const viewerAge = profile && profile.age != null ? profile.age : null;
    const ratings = await getRatings();
    if (!clearsGate({ viewerAge, termsAccepted: termsAcceptedFrom(req) }, episode.rating, ratings)) {
      const termsRequired = viewerAge == null && termsWouldClear(episode.rating, ratings);
      return res.status(403).json({ error: termsRequired ? 'Confirm the viewing terms to play this title.' : 'This title is age-restricted.', ageRestricted: true, termsRequired, rating: episode.rating || 'Not Rated' });
    }
  }

  // Every answer below is a credential or per-viewer; never let a shared
  // cache keep one.
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');

  // Early screenings (lib/earlyAccess.js): the same rule as the episode
  // page. The app matches "Early screening" in this message.
  const early = earlyAccessState(episode, {
    tier: account.tier || 'basic',
    isAdmin: account.isAdmin,
    isCreator: Boolean(account.userId && episode.submittedBy === account.userId),
    owned
  });
  if (early.locked) {
    return res.status(403).json({ error: `Early screening: Premium members are watching this now. It opens for your plan ${formatOpensAt(early.opensAt)}.`, earlyAccess: true, opensAt: early.opensAt });
  }

  const entitled = episode.tier === 'free' || account.isSubscriber || owned;
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
  return res.status(200).json({ src: signed.src, expiresAt: signed.expiresAt, signed: true, owned });
}
