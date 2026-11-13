// Where Google's display-ads script may load (security round 2,
// 2026-10-28). Until then pages/_document.js put adsbygoogle.js on every
// page, the admin area, the Money page, Messages and screeners included:
// a third-party script with the whole DOM in front of it, on exactly the
// pages that show payouts, conversations and watermarked screeners. It
// now loads only on the public side of the site. Pure: no imports, so the
// test suite and the document can both use it.
//
// `pathname` is the page's route as Next names it (/episode/[id],
// /admin/money), so a prefix covers every page under it.
const PRIVATE_PREFIXES = [
  // The error pages carry no content of ours (AdSense's own policy keeps
  // ads off them), and are built ahead of time with no viewer to ask.
  '/404', '/500', '/_error',
  '/admin', '/account', '/creator', '/messages', '/screener', '/schedule', '/ad-plan',
  '/artist-support', '/suspended', '/welcome', '/apply', '/advertise', '/wishlist', '/recs',
  '/notifications', '/locations/mine', '/locations/requests', '/locations/new', '/crew/card',
  '/crew/calls/new', '/productions/new', '/productions/[id]/day', '/productions/[id]/edit',
  '/productions/[id]/distribution'
];

export function adsenseAllowedOn(pathname) {
  const p = String(pathname || '');
  if (!p.startsWith('/')) return false;
  return !PRIVATE_PREFIXES.some((prefix) => p === prefix || p.startsWith(`${prefix}/`));
}

// Whether the script goes on this page for this viewer (Jose, 2026-11-13:
// "Premium members should not have the Google banner"): a public page, and
// a viewer whose plan has ads. `adFree` is the account's (lib/
// accountContext.js: Premium, Sponsor, the team, comped and promo access);
// signed out, Basic and Standard are not ad-free and keep it.
export function adsenseShown({ pathname, adFree = false } = {}) {
  return adsenseAllowedOn(pathname) && adFree !== true;
}
