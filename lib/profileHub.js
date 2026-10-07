import { getAccountContext } from './accountContext';
import { getPublicEpisodes } from './publicEpisodes';
import { getPublicProfile, getCreditedWork, placeholderProfile, resolveProfileUserId, profilePath } from './userProfiles';
import { getPitchesForCreator } from './pitches';
import { getBackedPitches } from './pitchDonations';
import { getPostsForUser, getLikedVideoPosts } from './posts';
import { getUserRole } from './roles';
import { getViewCounts, isRedisConfigured } from './redis';
import { getFollowCounts, isFollowing } from './follows';

const MAX_GENRE_TAGS = 4;

// Shared by pages/profile/[userId].js and the mobile app's GET
// /api/profile — same profile lookup, same credited-work/total-views/
// known-for-genres computation, same pitches-created/pitches-backed
// lists. Still computes posts/savedSnippets (the Snippets feature) since
// that's cheap and keeps this one function the single source of truth —
// mobile's API route just doesn't forward them in its response, since
// there's no mobile Snippets viewer to show them in yet.
//
// `slug` is whatever came after /profile/ — a Clerk user id or an
// @handle (migration 075); resolveProfileUserId sorts out which.
export async function getProfileHubData(slug, req) {
  const [account, userId] = await Promise.all([
    getAccountContext(req),
    resolveProfileUserId(slug)
  ]);
  if (!userId) return null;

  const [episodes, storedProfile] = await Promise.all([
    getPublicEpisodes(),
    getPublicProfile(userId)
  ]);
  const mainGenres = [...new Set(episodes.map((e) => e.mainGenre).filter(Boolean))];

  const isOwnProfile = Boolean(account.userId) && account.userId === userId;
  const needsViewCounts = isRedisConfigured();
  const [creditedWork, pitchRows, backedPitchRows, role, viewCounts, posts, savedSnippets, followCounts, viewerFollows] = await Promise.all([
    getCreditedWork(userId),
    getPitchesForCreator(userId),
    getBackedPitches(userId),
    getUserRole(userId),
    needsViewCounts ? getViewCounts() : Promise.resolve({}),
    getPostsForUser(userId, account.userId),
    isOwnProfile ? getLikedVideoPosts(account.userId) : Promise.resolve([]),
    getFollowCounts(userId),
    !isOwnProfile && account.userId ? isFollowing(account.userId, userId) : Promise.resolve(false)
  ]);
  const pitches = pitchRows.filter((p) => p.status === 'approved');

  // No profile row: this used to be a hard 404, which dead-ended the
  // author link under a creator's reels if they'd never saved a profile.
  // Now it's a placeholder ("A viewer") — but only when the id actually
  // has something attached (work, pitches, posts, a backed project, or
  // it's you looking at yourself), so a made-up id is still a 404.
  let profile = storedProfile;
  if (!profile) {
    const hasAnything = isOwnProfile || creditedWork.length > 0 || pitches.length > 0 || backedPitchRows.length > 0 || posts.length > 0 || followCounts.followers > 0;
    if (!hasAnything) return null;
    profile = placeholderProfile(userId);
  }

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
    // Where this profile should be linked/shared from — /profile/<handle>
    // when one is set, so a share from the raw-id URL still hands out
    // the nice one.
    canonicalPath: profilePath(profile),
    creditedWork,
    pitches,
    backedPitches: backedPitchRows,
    posts,
    savedSnippets,
    totalViews,
    knownForGenres,
    followerCount: followCounts.followers,
    followingCount: followCounts.following,
    viewerFollows,
    isOwnProfile,
    roleBadge: role === 'admin' ? 'Admin' : role === 'sub_admin' ? 'Sub-admin' : role === 'content_scheduler' ? 'Content Scheduler' : role === 'creator' ? 'Creator' : null,
    mainGenres,
    isSignedIn: account.isSignedIn,
    viewerId: account.userId,
    isSubscriber: account.isSubscriber,
    email: account.email,
    isAdmin: account.isAdmin,
    isCreator: account.isCreator
  };
}
