import { getAccountContext } from './accountContext';
import { getWatchHistory } from './watchHistory';

// What lib/seriesResume.js needs to say where a show picks up for this
// viewer: their in-progress positions and the episodes they finished.
// Null when signed out (the hero then plays the first episode). One
// watch_history read on top of the memoised account bundle.
export async function getViewerProgress(req, episodes) {
  const account = await getAccountContext(req);
  if (!account.isSignedIn) return null;
  const history = account.userId ? await getWatchHistory(account.userId, episodes).catch(() => []) : [];
  return { progress: account.watchProgress || {}, watched: history.map((e) => e.id) };
}

// Signed-in only, deliberately. Progress for anonymous viewers lives in
// their own browser's localStorage — real data, but only reachable from
// client-side JS after the page has already mounted, which doesn't fit
// this app's SSR-first pattern the way the signed-in path (server-readable
// Stripe metadata) does. A client-fetched version for anonymous viewers is
// a reasonable follow-up if it's wanted, but it's a genuinely different
// code path from this one, not a small extension of it.
//
// `episodes` is the same array the page already fetched — no extra query
// beyond the one Stripe customer lookup.
export async function getContinueWatching(req, episodes) {
  // The account bundle is memoised per request (lib/requestCache.js) and
  // already holds the parsed watch progress — this used to be a second
  // Stripe customer fetch on every library page.
  const account = await getAccountContext(req);
  if (!account.isSignedIn) return [];
  const progress = account.watchProgress || {};

  const episodeById = new Map(episodes.map((e) => [e.id, e]));

  // Object insertion order is recency here (see watch-progress.js's
  // delete-then-reinsert), oldest first — reverse for "most recent first."
  return Object.entries(progress)
    .reverse()
    .map(([episodeId, position]) => {
      const episode = episodeById.get(episodeId);
      // The episode may have been deleted, or expired into pending-deletion
      // and dropped from getPublicEpisodes(), since the position was saved.
      // Silently skipping it is correct — there's nothing to resume into.
      if (!episode) return null;
      return { ...episode, resumeSeconds: position };
    })
    .filter(Boolean);
}
