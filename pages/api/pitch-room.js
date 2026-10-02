import { getPitchRoomData } from '../../lib/pitchRoom';

// The mobile app's equivalent of pages/pitches.js's getServerSideProps —
// same lib/pitchRoom.js, so the app's Pitch Room has the website's save
// counts, live funding totals, and this viewer's saved pitches (the old
// public /api/pitches/list has none of those). Personalized when a Bearer
// token is sent, so never shared-cached.
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');

  const data = await getPitchRoomData(req);
  if (data.disabled) return res.status(200).json({ disabled: true, pitches: [], savedIds: [] });

  return res.status(200).json({
    disabled: false,
    isSignedIn: data.account.isSignedIn,
    isCreator: data.account.isCreator,
    bypassingDisabled: data.bypassingDisabled,
    savedIds: data.savedIds,
    pitches: data.pitches
  });
}
