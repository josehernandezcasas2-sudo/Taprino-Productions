import { getOwnProfile } from './userProfiles';
import { getRatings } from './ratings';
import { clearsGate, filterForViewer, requiredAgeFor, termsWouldClear } from './ageGate';

// Did this request take the viewing terms? The browser keeps a cookie
// (lib/viewingTerms.js), the app sends `terms` in the query or body, and
// the live player's `liveTerms` means the same thing.
export function termsAcceptedFrom(req) {
  if (!req) return false;
  const cookies = req.cookies || {};
  if (cookies.tapa_terms === '1') return true;
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  if (body.terms === true || body.terms === 1 || body.terms === '1' || body.liveTerms) return true;
  const query = req.query || {};
  return query.terms === '1' || query.terms === 'true';
}

// The one way to answer "may this viewer see this rating?" on a server
// route or page: the age on their account (null when signed out or not
// set), whether they've taken the viewing terms, and the live ratings
// list. Admins pass everything; no age + terms clears anything under 17+;
// 17+ and unrated need an age on file (lib/ageGate.js). Used wherever a
// src or a feed leaves the server: episode pages, stream tokens, the
// vertical feeds, podcast shows.
export async function getViewerAgeContext(account, req = null) {
  const [profile, ratings] = await Promise.all([
    account.isSignedIn ? getOwnProfile(account.userId) : Promise.resolve(null),
    getRatings()
  ]);
  const viewerAge = profile && profile.age != null ? profile.age : null;
  const isAdmin = Boolean(account.isAdmin);
  const termsAccepted = termsAcceptedFrom(req);
  const viewer = { viewerAge, isAdmin, termsAccepted };
  return {
    viewerAge,
    ratings,
    isAdmin,
    termsAccepted,
    allows: (rating) => clearsGate(viewer, rating, ratings),
    filter: (items) => filterForViewer(items, viewer, ratings),
    requiredAgeFor: (rating) => requiredAgeFor(rating, ratings),
    termsWouldClear: (rating) => termsWouldClear(rating, ratings)
  };
}
