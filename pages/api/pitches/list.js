import { getApprovedPitches } from '../../../lib/pitches';
import { getSiteSettings } from '../../../lib/siteSettings';

// Public, read-only feed of approved pitches for external clients (the
// mobile app) — same data /pitches/discover shows a signed-out visitor,
// minus any per-viewer personalization (that stays server-rendered only).
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  // Public data with no auth/cookies involved, so it's safe to open up to
  // any origin — this route exists specifically for the mobile app (and
  // its web preview) to call cross-origin.
  res.setHeader('Access-Control-Allow-Origin', '*');
  const siteSettings = await getSiteSettings();
  if (!siteSettings.elevatorPitchEnabled) {
    return res.status(200).json({ pitches: [] });
  }
  res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
  const pitches = await getApprovedPitches();
  return res.status(200).json({ pitches });
}
