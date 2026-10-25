import { getSiteSettings } from '../../lib/siteSettings';
import { privateBetaOn } from '../../lib/privateBetaRules';
import { applyCors } from '../../lib/cors';

// Deliberately public and read-only — this is how HeaderNav (used on
// every page) learns whether to show the Shop link, without needing every
// single page's getServerSideProps to fetch and pass it down. Only ever
// returns the couple of fields that are safe to expose publicly; never
// wire admin-only data through this route.
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  applyCors(req, res);
  res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
  const settings = await getSiteSettings();
  // Private beta: the app reads this before anything else and shows its
  // own door while it's on (mobile/src/components/PrivateBetaGate.js).
  // captureBlock: the app keeps screenshots and screen recording off its
  // playback screens (mobile/src/lib/captureBlock.js) unless
  // SCREEN_CAPTURE_BLOCK=off is set in Vercel — a kill switch for the day
  // the block misbehaves on some phone, with no app update needed.
  return res.status(200).json({ ...settings, privateBeta: privateBetaOn(), captureBlock: process.env.SCREEN_CAPTURE_BLOCK !== 'off' });
}
