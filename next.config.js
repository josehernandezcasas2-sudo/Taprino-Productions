// The Supabase project this deployment reads from, so the image optimizer
// only ever fetches from it (a wildcard would let anyone resize any
// Supabase project's files through this site). Falls back to the wildcard
// only when no URL is configured at build time (a local run without one).
function supabaseHost() {
  try {
    return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL).hostname;
  } catch (err) {
    return null;
  }
}
const SITE_ORIGIN = 'https://www.studiotapatv.site';

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Don't advertise the framework in every response.
  poweredByHeader: false,
  // A creator's short link (Creator Share referrals): studiotapatv.site/@handle
  // opens their profile carrying ?via=handle, which middleware.js remembers
  // in a cookie so a membership bought later is attributed to them.
  async redirects() {
    return [{ source: '/@:handle', destination: '/profile/:handle?via=:handle', permanent: false }];
  },
  // Baseline browser protections the site was serving none of (only
  // Vercel's HSTS): no MIME sniffing, no framing by other sites, referrers
  // trimmed on cross-origin requests, and the powerful device APIs this
  // site doesn't use switched off — geolocation stays on for the working
  // card's "use my location" (components/crew/PlaceSearch.js). No CSP yet:
  // the inline theme <style>, Clerk, Stripe, Cloudflare and the ad SDK
  // would each need allow-listing, and a wrong CSP breaks playback.
  //
  // The TDM-Reservation / TDM-Policy / Content-Usage trio (lib/robotsRules.js)
  // is the machine-readable "not for text-and-data mining or AI training"
  // reservation EU-regulated model providers are obliged to look for; it
  // blocks nothing by itself. X-Robots-Tag is set in middleware.js so the
  // beta door's noindex and the noai directive never overwrite each other.
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(self)' },
          { key: 'TDM-Reservation', value: '1' },
          { key: 'TDM-Policy', value: `${SITE_ORIGIN}/terms` },
          { key: 'Content-Usage', value: 'train-ai=n, ai-use=n' }
        ]
      }
    ];
  },
  images: {
    // The image optimizer is also a free resize service for whatever it
    // is allowed to fetch, and a way to pull a near-original copy of
    // every poster (?w=3840). Two limits (Jose, 2026-10-25): it only
    // fetches from this deployment's own Supabase project, and the widest
    // size it will produce is 1600px, the most any page draws (location
    // photos are already downsized to 1600 in the browser).
    deviceSizes: [320, 480, 640, 828, 1080, 1280, 1600],
    imageSizes: [48, 64, 96, 128, 160, 256],
    // Every poster, thumbnail, avatar, and title-card image is uploaded via
    // lib/artworkUpload.js to Supabase Storage. The host is pinned to the
    // configured project at build time; the wildcard only remains for a
    // build with no Supabase URL set.
    remotePatterns: [
      {
        protocol: 'https',
        hostname: supabaseHost() || '*.supabase.co',
        pathname: '/storage/v1/object/public/**'
      },
      // A video post's poster (components/ReelPlayer.js) falls back to
      // Cloudflare Stream's own auto-grabbed frame (lib/cloudflareUpload.js's
      // cloudflareThumbnailUrl) whenever no custom thumbnail was uploaded —
      // that URL lives on this host, not Supabase Storage, and next/image
      // throws on any src outside the allowlist above without this.
      {
        protocol: 'https',
        hostname: 'customer-*.cloudflarestream.com',
        pathname: '/**'
      }
    ]
  }
};

module.exports = nextConfig;
