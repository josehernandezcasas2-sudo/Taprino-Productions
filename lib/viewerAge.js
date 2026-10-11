import { getOwnProfile } from './userProfiles';
import { getRatings } from './ratings';
import { filterByAgeRating, meetsAgeRequirement } from './ageGate';

// The one way to answer "may this viewer see this rating?" on a server
// route or page: the age on their account (null when signed out or not
// set — which fails closed, see lib/ageGate.js) plus the live ratings
// list. Admins pass everything. Used wherever a src or a feed leaves the
// server: episode pages, stream tokens, the vertical feeds, podcast shows.
export async function getViewerAgeContext(account) {
  const [profile, ratings] = await Promise.all([
    account.isSignedIn ? getOwnProfile(account.userId) : Promise.resolve(null),
    getRatings()
  ]);
  const viewerAge = profile && profile.age != null ? profile.age : null;
  const isAdmin = Boolean(account.isAdmin);
  return {
    viewerAge,
    ratings,
    isAdmin,
    allows: (rating) => isAdmin || meetsAgeRequirement(viewerAge, rating, ratings),
    filter: (items) => (isAdmin ? items : filterByAgeRating(items, viewerAge, ratings))
  };
}
