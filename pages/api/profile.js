import { getProfileHubData } from '../../lib/profileHub';

// The mobile app's equivalent of pages/profile/[userId].js's
// getServerSideProps — same lib/profileHub.js. Leaves out posts/
// savedSnippets (the Snippets feature — user-posted video/photos — has
// no mobile viewer built yet, same scope cut as Vertical Discover's
// catalog-only feed) and the fields that only exist for the website's
// own HeaderNav (mainGenres, email, isAdmin, isCreator, isSubscriber).
export default async function handler(req, res) {
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
    creditedWork: data.creditedWork,
    pitches: data.pitches,
    backedPitches: data.backedPitches,
    totalViews: data.totalViews,
    knownForGenres: data.knownForGenres,
    roleBadge: data.roleBadge,
    isSignedIn: data.isSignedIn,
    viewerId: data.viewerId
  });
}
