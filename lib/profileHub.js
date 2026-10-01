import { getAccountContext } from './accountContext';
import { getPublicEpisodes } from './publicEpisodes';
import { getPublicProfile, getCreditedWork } from './userProfiles';
import { getPitchesForCreator } from './pitches';
import { getBackedPitches } from './pitchDonations';
import { getPostsForUser, getLikedVideoPosts } from './posts';
import { getUserRole } from './roles';
import { getViewCounts, isRedisConfigured } from './redis';

const MAX_GENRE_TAGS = 4;

// Shared by pages/profile/[userId].js and the mobile app's GET
// /api/profile — same profile lookup, same credited-work/total-views/
// known-for-genres computation, same pitches-created/pitches-backed
// lists. Still computes posts/savedSnippets (the Snippets feature) since
// that's cheap and keeps this one function the single source of truth —
// mobile's API route just doesn't forward them in its response, since
// there's no mobile Snippets viewer to show them in yet.
export async function getProfileHubData(userId, req) {
  const account = await getAccountContext(req);
  const [episodes, profile] = await Promise.all([
    getPublicEpisodes(),
    getPublicProfile(userId)
  ]);
  const mainGenres = [...new Set(episodes.map((e) => e.mainGenre).filter(Boolean))];

  if (!profile) return null;

  const isOwnProfile = Boolean(account.userId) && account.userId === profile.userId;
  const needsViewCounts = isRedisConfigured();
  const [creditedWork, pitchRows, backedPitchRows, role, viewCounts, posts, savedSnippets] = await Promise.all([
    getCreditedWork(profile.userId),
    getPitchesForCreator(profile.userId),
    getBackedPitches(profile.userId),
    getUserRole(profile.userId),
    needsViewCounts ? getViewCounts() : Promise.resolve({}),
    getPostsForUser(profile.userId, account.userId),
    isOwnProfile ? getLikedVideoPosts(account.userId) : Promise.resolve([])
  ]);
  const pitches = pitchRows.filter((p) => p.status === 'approved');

  const totalViews = creditedWork.reduce((sum, item) => {
    if (item.type === 'episode') return sum + (viewCounts[item.id] || 0);
    const seriesViews = episodes
      .filter((e) => e.seriesId === item.id)
      .reduce((s, e) => s + (viewCounts[e.id] || 0), 0);
    return sum + seriesViews;
  }, 0);

  const genreCounts = {};
  for (const item of creditedWork) {
    if (item.mainGenre) genreCounts[item.mainGenre] = (genreCounts[item.mainGenre] || 0) + 1;
  }
  const knownForGenres = Object.keys(genreCounts)
    .sort((a, b) => genreCounts[b] - genreCounts[a])
    .slice(0, MAX_GENRE_TAGS);

  return {
    profile,
    creditedWork,
    pitches,
    backedPitches: backedPitchRows,
    posts,
    savedSnippets,
    totalViews,
    knownForGenres,
    roleBadge: role === 'admin' ? 'Admin' : role === 'sub_admin' ? 'Sub-admin' : role === 'creator' ? 'Creator' : null,
    mainGenres,
    isSignedIn: account.isSignedIn,
    viewerId: account.userId,
    isSubscriber: account.isSubscriber,
    email: account.email,
    isAdmin: account.isAdmin,
    isCreator: account.isCreator
  };
}
