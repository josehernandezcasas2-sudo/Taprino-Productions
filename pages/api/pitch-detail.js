import { getPitchDetailData } from '../../lib/pitchDetailHub';
import { limitPublicRead } from '../../lib/rateLimit';
import { applyCors } from '../../lib/cors';

// The mobile app's equivalent of pages/pitches/[id].js's
// getServerSideProps — same lib/pitchDetailHub.js, same shape minus the
// fields that only exist for the website's own HeaderNav (mainGenres,
// email, isAdmin, isCreator, isSubscriber aren't needed to render the
// mobile screen or gate anything on it).
export default async function handler(req, res) {
  // Browsers send an OPTIONS pre-check before any request carrying an
  // Authorization header (the app's web preview does); answer it.
  if (req.method === 'OPTIONS') {
    applyCors(req, res);
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    return res.status(204).end();
  }
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  applyCors(req, res);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (!(await limitPublicRead(req, res, 'pitch-detail'))) return undefined;
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');

  const { id } = req.query;
  if (!id) return res.status(400).json({ error: 'id is required.' });

  const data = await getPitchDetailData(id, req);
  if (!data) return res.status(404).json({ error: 'Not found' });

  return res.status(200).json({
    isSignedIn: data.isSignedIn,
    bypassingDisabled: data.bypassingDisabled,
    userId: data.userId,
    isPitchOwner: data.isPitchOwner,
    creatorPayoutState: data.creatorPayoutState,
    pitch: data.pitch,
    similar: data.similar,
    updates: data.updates,
    comments: data.comments,
    initialSaved: data.initialSaved,
    totalRaisedCents: data.totalRaisedCents,
    backerCount: data.backerCount,
    recentBackers: data.recentBackers,
    creatorAvatarUrl: data.creatorAvatarUrl,
    creatorAvatarPosition: data.creatorAvatarPosition,
    creatorAvatarZoom: data.creatorAvatarZoom,
    creatorDisplayName: data.creatorDisplayName
  });
}
