import { getSiteSettings } from '../../lib/siteSettings';
import { SITE } from '../../lib/siteConfig';

// Was a static /public/manifest.json before this — meaning the "app icon"
// shown when someone adds the site to their home screen could never be
// changed without a code push. This generates the same shape on every
// request instead, pulling the icon from site_settings so an admin
// upload at /admin/site-icons takes effect immediately.
export default async function handler(req, res) {
  const settings = await getSiteSettings();
  const iconSrc = settings.appIconUrl || '/icon.svg';
  // SVG is the only type this project ever serves for icons — an
  // uploaded PNG would need "image/png" here instead, but every upload
  // path (uploadArtworkImage) re-encodes to a fixed type, so this stays
  // accurate rather than needing to sniff the actual file.
  const iconType = iconSrc.endsWith('.svg') ? 'image/svg+xml' : 'image/png';

  const manifest = {
    name: 'Studio Tapa TV',
    short_name: 'Tapa TV',
    description: `Studio Tapa\u2019s screening room \u2014 free episodes, ad-supported, with a ${SITE.premiumTier} membership tier.`,
    start_url: '/',
    display: 'standalone',
    background_color: '#11110b',
    theme_color: '#11110b',
    orientation: 'portrait-primary',
    icons: [
      { src: iconSrc, sizes: 'any', type: iconType, purpose: 'any' },
      { src: iconSrc, sizes: 'any', type: iconType, purpose: 'maskable' }
    ]
  };

  res.setHeader('Content-Type', 'application/manifest+json');
  // Short cache — an admin changing the app icon should show up on the
  // next install attempt within minutes, not be stuck behind a long-lived
  // cache the way a build-time static file effectively was before.
  res.setHeader('Cache-Control', 'public, max-age=300');
  return res.status(200).json(manifest);
}
