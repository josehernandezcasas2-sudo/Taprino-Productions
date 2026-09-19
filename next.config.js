/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    // The only external image host used anywhere in this app — every
    // poster, thumbnail, avatar, and title-card image is uploaded via
    // lib/artworkUpload.js to Supabase Storage (see the upload call
    // sites in pages/api/**/*.js). Confirmed no other external image
    // domain exists in the codebase before adding next/image anywhere
    // that touches an external URL. The wildcard subdomain covers any
    // Supabase project ref (https://<ref>.supabase.co/storage/v1/...)
    // rather than hardcoding one, since the ref varies by environment
    // (local/staging/production could each point at a different
    // Supabase project).
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.supabase.co',
        pathname: '/storage/v1/object/public/**'
      }
    ]
  }
};

module.exports = nextConfig;
