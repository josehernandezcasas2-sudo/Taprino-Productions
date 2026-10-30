import { SITE } from './siteConfig';

// Client-safe helpers for the account hub's pages (option B, 2026-10-29).
// They live apart from lib/accountPage.js, whose accountPageProps pulls
// in the Clerk server client: a page that uses a helper in its render
// bundles the module it comes from, and that one can't be bundled.

export function formatLongDate(ms) {
  if (!ms) return null;
  return new Date(ms).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

export function formatShortDate(ms) {
  if (!ms) return null;
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// Team, comped and promo-code accounts have Premium without a
// subscription — the plan picker gives way to a note saying so.
export function freeAccessNoteFor({ isAdmin, isSubAdmin, isComped, promoAccessExpiresAt }) {
  if (isAdmin) return `You have ${SITE.premiumTier} as part of the Studio Tapa team — no payment needed, ever.`;
  if (isSubAdmin) return `You have ${SITE.premiumTier} as a sub-admin on the team — no payment needed, ever.`;
  if (isComped) return 'Your access was given to you by the team — it’s free, and no payment is needed.';
  if (promoAccessExpiresAt) return `You have ${SITE.premiumTier} from a redeemed code, through ${formatLongDate(promoAccessExpiresAt)}. Redeeming another code before then adds to this instead of replacing it.`;
  return null;
}

// The single highest-privilege badge: an admin is also a creator per
// lib/roles.js, and only one chip should describe the person.
export function roleBadgeFor({ isAdmin, isSubAdmin, isCreator }) {
  return isAdmin ? 'Admin' : isSubAdmin ? 'Sub-admin' : isCreator ? 'Creator' : null;
}
