import { findEpisode, findEpisodeForOwner } from './episodes';
import { getOwnership, ownsEpisode } from './purchases';
import { getAccountContext } from './accountContext';
import { SITE } from './siteConfig';
import { getOwnProfile } from './userProfiles';
import { clearsGate, termsWouldClear } from './ageGate';
import { termsAcceptedFrom } from './viewerAge';
import { getRatings } from './ratings';
import { earlyAccessState, formatOpensAt } from './earlyAccess';

// The one decision behind every per-title credential: may this request
// have this episode's video, or its captions? Shared by /api/stream-token
// and /api/captions/<id> so the two can never drift (Jose, 2026-10-25).
// Entitlement is read from the session on every call and never from what
// the client sends; the request only says WHICH episode.
//
// Returns { episode, owned, account } when allowed, else { denied: { status, body } }
// with the exact status and message the stream-token route has always sent
// (the app matches on some of them).
export async function playbackGate(req, episodeId) {
  const account = await getAccountContext(req);

  // Bought titles (lib/purchases.js) stay playable for their owners after
  // a creator-side takedown, so an owner's lookup skips the catalogue's
  // deletion/expiry filters; a moderation hold still hides it.
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
    // Same answer for "doesn't exist" and "not published": no enumerating
    // unreleased ids from a credential route.
    return { denied: { status: 404, body: { error: 'Not found' } }, account };
  }

  // The age gate (lib/ageGate.js): admins bypass; no age on file clears
  // titles under 17+ once the viewing terms are taken (cookie, or `terms`
  // in the body); 17+ needs an age.
  if (!account.isAdmin) {
    const profile = account.isSignedIn ? await getOwnProfile(account.userId) : null;
    const viewerAge = profile && profile.age != null ? profile.age : null;
    const ratings = await getRatings();
    if (!clearsGate({ viewerAge, termsAccepted: termsAcceptedFrom(req) }, episode.rating, ratings)) {
      const termsRequired = viewerAge == null && termsWouldClear(episode.rating, ratings);
      return {
        denied: {
          status: 403,
          body: { error: termsRequired ? 'Confirm the viewing terms to play this title.' : 'This title is age-restricted.', ageRestricted: true, termsRequired, rating: episode.rating || 'Not Rated' }
        },
        account
      };
    }
  }

  // Early screenings (lib/earlyAccess.js). The app matches "Early screening".
  const early = earlyAccessState(episode, {
    tier: account.tier || 'basic',
    isAdmin: account.isAdmin,
    isCreator: Boolean(account.userId && episode.submittedBy === account.userId),
    owned
  });
  if (early.locked) {
    return { denied: { status: 403, body: { error: `Early screening: Premium members are watching this now. It opens for your plan ${formatOpensAt(early.opensAt)}.`, earlyAccess: true, opensAt: early.opensAt } }, account };
  }

  const entitled = episode.tier === 'free' || account.isSubscriber || owned;
  if (!entitled) {
    return { denied: { status: 403, body: { error: `This episode is for ${SITE.premiumTier} members.` } }, account };
  }

  return { episode, owned, account };
}
