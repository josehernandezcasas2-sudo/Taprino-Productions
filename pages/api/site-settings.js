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
  // playback screens (mobile/src/lib/captureBlock.js) while the switch on
  // Admin → Settings → Protection is on (site_settings.screen_capture_block,
  // migration 115; Jose, 2026-10-30, so he can screenshot the app for a
  // design round and turn it back on after). SCREEN_CAPTURE_BLOCK=off in
  // Vercel stays as a kill switch that keeps it off whatever the switch
  // says, for the day the block misbehaves on some phone, with no app
  // update needed. The app re-asks every half minute while something
  // plays, with a query string that steps round this route's CDN cache.
  return res.status(200).json({ ...settings, privateBeta: privateBetaOn(), captureBlock: process.env.SCREEN_CAPTURE_BLOCK !== 'off' && settings.screenCaptureBlock !== false });
}
