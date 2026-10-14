// Membership tiers (Jose, 2026-10-12). Client-safe: no Stripe here. The
// paid tiers exist in Stripe as one Product each with metadata
// `tier` = standard | premium | sponsor (lib/membershipPlans.js reads
// them); Basic is simply an account with no subscription.
//
// What each unlocks — the code enforces `adFree` and `premiumContent`;
// the one-day early-access delay for Standard and the shop discount are
// decided but not built yet.
// Rank (what wins when an account somehow has two) vs. how the picker
// lays them out (the launch offer last, as in the mockup).
export const TIER_ORDER = ['basic', 'standard', 'sponsor', 'premium'];
export const DISPLAY_ORDER = ['basic', 'standard', 'premium', 'sponsor'];
export const PAID_TIERS = ['standard', 'premium', 'sponsor'];

export const TIER_INFO = {
  basic: {
    label: 'Basic',
    tagline: 'with ads',
    adFree: false,
    premiumContent: false,
    perks: ['The free library, with ads', 'Live TV'],
    missing: ['Premium titles', 'Early screenings']
  },
  standard: {
    label: 'Standard',
    tagline: 'with ads',
    adFree: false,
    premiumContent: true,
    perks: ['Everything in Basic', 'Premium titles and gated films', 'Early screenings, one day after Premium'],
    missing: ['Ad-free']
  },
  premium: {
    label: 'Premium',
    tagline: 'no ads',
    flag: 'Most complete',
    adFree: true,
    premiumContent: true,
    perks: ['Everything in Standard', 'Ad-free on-demand viewing', 'Same-day early screenings', '5% off the Studio Tapa shop (soon)'],
    missing: []
  },
  sponsor: {
    label: 'Sponsor',
    tagline: 'no ads · everything in Premium',
    flag: 'Launch offer · limited time',
    accent: 'brass',
    adFree: true,
    premiumContent: true,
    perks: ['Everything in Premium', 'Keep this price for as long as you stay', 'Sponsor badge on your profile', '5% off the Studio Tapa shop (soon)'],
    missing: []
  }
};

export function isPaidTier(tier) {
  return PAID_TIERS.includes(tier);
}

export function isAdFree(tier) {
  return Boolean(TIER_INFO[tier] && TIER_INFO[tier].adFree);
}

export function tierLabel(tier) {
  return (TIER_INFO[tier] || TIER_INFO.basic).label;
}

// The little badge next to a name: Sponsors get their own, every other
// paid tier reads as a Tapa + member (the tier name itself stays on the
// Membership card).
export function memberBadge(tier, premiumTierName = 'Tapa +') {
  if (tier === 'sponsor') return 'Sponsor';
  if (isPaidTier(tier)) return `${premiumTierName} member`;
  return null;
}

// Stripe product metadata → tier. A paid subscription whose product
// carries no tier (the original single Tapa + price, before tiers) is
// treated as Premium so nobody who already pays loses anything.
export function tierFromProductMetadata(metadata, { fallback = 'premium' } = {}) {
  // Stripe metadata keys are case-sensitive and typed by hand in the
  // dashboard, so "Tier" counts as much as "tier".
  const key = metadata ? Object.keys(metadata).find((k) => k.trim().toLowerCase() === 'tier') : null;
  const raw = key ? metadata[key] : null;
  const t = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  return isPaidTier(t) ? t : fallback;
}

// The best of several (an account with two subscriptions by accident).
export function highestTier(tiers) {
  return tiers.reduce((best, t) => (TIER_ORDER.indexOf(t) > TIER_ORDER.indexOf(best) ? t : best), 'basic');
}
