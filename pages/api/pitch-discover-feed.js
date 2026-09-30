import { getAuth } from '@clerk/nextjs/server';
import { getAccountContext } from '../../lib/accountContext';
import { getApprovedPitches } from '../../lib/pitches';
import { getSiteSettings } from '../../lib/siteSettings';

// The mobile app's equivalent of pages/pitches/discover.js's
// getServerSideProps — same gate (elevatorPitchEnabled, with an admin
// bypass) and the same three signals the page uses to decide what to
// show (bypassingDisabled, requireSignIn, isSignedIn).
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');

  const account = await getAccountContext(req);
  const siteSettings = await getSiteSettings();
  const bypassingDisabled = !siteSettings.elevatorPitchEnabled && account.isAdmin;

  if (!siteSettings.elevatorPitchEnabled && !account.isAdmin) {
    return res.status(404).json({ error: 'Not found' });
  }

  const { userId } = getAuth(req);
  const pitches = await getApprovedPitches();

  return res.status(200).json({
    isSignedIn: account.isSignedIn,
    pitches,
    bypassingDisabled,
    requireSignIn: !userId
  });
}
