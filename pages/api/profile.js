import { getProfileHubData } from '../../lib/profileHub';

// The mobile app's equivalent of pages/profile/[userId].js's
// getServerSideProps — same lib/profileHub.js. Forwards posts/
// savedSnippets now that /snippets/discover exists as a mobile viewer
// for video posts specifically — a photo post tile still has nowhere to
// open (no PostViewerModal-equivalent built), so the mobile screen only
// makes a tile tappable when post.kind === 'video'. Leaves out the
// fields that only exist for the website's own HeaderNav (mainGenres,
// email, isAdmin, isCreator, isSubscriber).
export default async function handler(req, res) {
  // Browsers send an OPTIONS pre-check before any request carrying an
  // Authorization header (the app's web preview does); answer it.
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    return res.status(204).end();
  }
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');

  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: 'userId is required.' });

  const data = await getProfileHubData(userId, req);
  if (!data) return res.status(404).json({ error: 'Not found' });

  return res.status(200).json({
    profile: data.profile,
    canonicalPath: data.canonicalPath,
    followerCount: data.followerCount,
    followingCount: data.followingCount,
    viewerFollows: data.viewerFollows,
    isOwnProfile: data.isOwnProfile,
    creditedWork: data.creditedWork,
    pitches: data.pitches,
    backedPitches: data.backedPitches,
    crewCard: data.crewCard,
    crewRecord: data.crewRecord,
    totalViews: data.totalViews,
    knownForGenres: data.knownForGenres,
    roleBadge: data.roleBadge,
    posts: data.posts,
    savedSnippets: data.savedSnippets,
    isSignedIn: data.isSignedIn,
    viewerId: data.viewerId
  });
}
