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

// Clerk's frontend host is inside the publishable key (pk_live_ + base64
// of "clerk.example.com$"), so the content policy below names the real
// one without another setting.
function clerkHost() {
  try {
    const key = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || '';
    const encoded = key.split('_')[2];
    const host = encoded ? Buffer.from(encoded, 'base64').toString('utf8').replace(/\$$/, '') : '';
    return /^[a-z0-9.-]+$/i.test(host) ? host : null;
  } catch (err) {
    return null;
  }
}

// The full content policy, sent as Report-Only (safety batch,
// 2026-10-26): browsers report what it would have blocked to
// /api/csp-report and block nothing, so the list can be corrected from
// real reports before it's switched to enforcing. Every host here is one
// the site actually loads from: Clerk (and its bot check), Google Fonts,
// Cloudflare Stream (playback, thumbnails, uploads), Supabase Storage
// (art, ad videos, podcast audio, signed uploads, University PDFs in a
// frame), Google's IMA ad SDK and
// its ad servers, and YouTube's privacy-mode player for YouTube-backed
// titles. Inline styles stay allowed (React style props, the theme tag).
function reportOnlyCsp() {
  const clerk = clerkHost();
  const clerkSrc = [clerk ? `https://${clerk}` : null, 'https://*.clerk.accounts.dev', 'https://challenges.cloudflare.com'].filter(Boolean).join(' ');
  const supabase = supabaseHost() ? `https://${supabaseHost()}` : 'https://*.supabase.co';
  const stream = 'https://*.cloudflarestream.com https://videodelivery.net https://*.videodelivery.net';
  const ads = 'https://imasdk.googleapis.com https://*.doubleclick.net https://*.googlesyndication.com https://*.googleadservices.com https://*.google.com https://*.gstatic.com';
  return [
    "default-src 'self'",
    `script-src 'self' ${clerkSrc} ${ads}`,
    `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`,
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data: blob: https:",
    `media-src 'self' blob: ${stream} ${supabase} ${ads}`,
    `connect-src 'self' ${clerkSrc} ${stream} ${supabase} ${ads}`,
    // University readings open in a frame from Storage (a signed PDF link).
    `frame-src 'self' ${clerkSrc} ${ads} ${supabase} https://www.youtube-nocookie.com`,
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'",
    'report-uri /api/csp-report'
  ].join('; ');
}

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
  // RFC 9116: where to report a security problem (pages/api/security-txt.js
  // keeps the Expires date moving, which a static file can't).
  async rewrites() {
    return [{ source: '/.well-known/security.txt', destination: '/api/security-txt' }];
  },
  // Baseline browser protections the site was serving none of (only
  // Vercel's HSTS): no MIME sniffing, no framing by other sites, referrers
  // trimmed on cross-origin requests, and the powerful device APIs this
  // site doesn't use switched off — geolocation stays on for the working
  // card's "use my location" (components/crew/PlaceSearch.js). No full CSP
  // yet (only the safe parts below): the inline theme <style>, Clerk,
  // Stripe, Cloudflare and the ad SDK would each need allow-listing for
  // scripts and styles, and a wrong CSP breaks playback.
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
          // Security round (2026-10-26): HTTPS remembered for two years
          // (Vercel sends this too; stating it keeps it if the host
          // changes), and the parts of a CSP that can't break playback,
          // Clerk, Stripe or the ad SDK: no plugins, no <base> hijack, no
          // framing by other sites. Script and style sources stay open
          // until a full CSP is worked out.
          { key: 'Strict-Transport-Security', value: 'max-age=63072000' },
          { key: 'Content-Security-Policy', value: "object-src 'none'; base-uri 'self'; frame-ancestors 'self'" },
          { key: 'Content-Security-Policy-Report-Only', value: reportOnlyCsp() },
          // Safety batch (2026-10-26): a page this site opens in a new tab
          // can't reach back into it (Clerk's and Stripe's popups still
          // work), and Flash/PDF-plugin cross-domain policy files are
          // refused outright.
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin-allow-popups' },
          { key: 'X-Permitted-Cross-Domain-Policies', value: 'none' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(self)' },
          { key: 'TDM-Reservation', value: '1' },
          { key: 'TDM-Policy', value: `${SITE_ORIGIN}/ai-policy` },
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
