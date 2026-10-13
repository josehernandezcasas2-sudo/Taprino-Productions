import { getStripe, isStripeConfigured, stripeMode } from './stripe';
import { SITE } from './siteConfig';
import { PAID_TIERS, DISPLAY_ORDER, tierFromProductMetadata, highestTier } from './membershipTiers';

// The plans on sale, read from Stripe: every active recurring Price whose
// Product carries metadata `tier` (standard | premium | sponsor). Jose
// manages them in the Stripe dashboard — change a price or archive the
// Sponsor price when the launch window closes, and the picker follows
// with no code change. Cached a few minutes per server.
//
// Until the tiered products exist, the original single STRIPE_PRICE_ID
// is offered as "Premium" so the site keeps selling what it sells today.
const TTL_MS = 5 * 60 * 1000;
let cache = { at: 0, plans: null };

function toPlan(price, tier) {
  const product = typeof price.product === 'object' ? price.product : null;
  return {
    tier,
    priceId: price.id,
    productId: product ? product.id : price.product,
    name: product ? product.name : tier,
    amountCents: price.unit_amount,
    currency: price.currency,
    interval: price.recurring ? price.recurring.interval : 'month'
  };
}

async function loadPlans() {
  if (!isStripeConfigured()) return [];
  const stripe = getStripe();
  const prices = await stripe.prices.list({ active: true, type: 'recurring', expand: ['data.product'], limit: 100 });
  const byTier = {};
  for (const price of prices.data) {
    const product = typeof price.product === 'object' ? price.product : null;
    if (!product || product.active === false) continue;
    const tier = tierFromProductMetadata(product.metadata, { fallback: null });
    if (!tier) continue;
    // One price per tier: the cheapest monthly wins if several are live.
    if (!byTier[tier] || (price.recurring && price.recurring.interval === 'month' && price.unit_amount < byTier[tier].amountCents)) {
      byTier[tier] = toPlan(price, tier);
    }
  }
  let plans = PAID_TIERS.filter((t) => byTier[t]).map((t) => byTier[t]);

  if (plans.length === 0 && process.env.STRIPE_PRICE_ID) {
    try {
      const price = await stripe.prices.retrieve(process.env.STRIPE_PRICE_ID, { expand: ['product'] });
      plans = [{ ...toPlan(price, 'premium'), name: SITE.premiumTier, legacy: true }];
    } catch (err) {
      console.error('membership plans: STRIPE_PRICE_ID unusable:', err.message);
    }
  }
  return plans.sort((a, b) => DISPLAY_ORDER.indexOf(a.tier) - DISPLAY_ORDER.indexOf(b.tier));
}

export async function getMembershipPlans() {
  if (cache.plans && Date.now() - cache.at < TTL_MS) return cache.plans;
  try {
    const plans = await loadPlans();
    cache = { at: Date.now(), plans };
    return plans;
  } catch (err) {
    console.error('getMembershipPlans error:', err.message);
    return cache.plans || [];
  }
}

export async function getPlanForTier(tier) {
  const plans = await getMembershipPlans();
  return plans.find((p) => p.tier === tier) || null;
}

// Another person's paid tier, for the badge on their public profile. Only
// a real subscription counts (team/comped access isn't shown), and only
// for someone whose Stripe customer is already linked — a profile view
// never creates one.
export async function getPaidTierForUser(userId) {
  if (!userId || !isStripeConfigured()) return 'basic';
  try {
    const { clerkClient } = await import('@clerk/nextjs/server');
    const client = await clerkClient();
    const user = await client.users.getUser(userId);
    const meta = user.publicMetadata || {};
    const customerId = meta.stripeCustomerId;
    // A customer cached from the other Stripe mode isn't ours to read
    // (lib/clerkStripeLink.js re-links it on that person's next visit).
    if (!customerId || (meta.stripeCustomerMode && meta.stripeCustomerMode !== stripeMode())) return 'basic';
    const subs = await getStripe().subscriptions.list({ customer: customerId, status: 'active', limit: 5, expand: ['data.items.data.price.product'] });
    const tiers = subs.data.map((s) => {
      const item = s.items && s.items.data[0];
      const product = item && item.price && typeof item.price.product === 'object' ? item.price.product : null;
      return tierFromProductMetadata(product ? product.metadata : null);
    });
    return highestTier(tiers);
  } catch (err) {
    console.error('getPaidTierForUser error:', err.message);
    return 'basic';
  }
}

export function clearMembershipPlansCache() {
  cache = { at: 0, plans: null };
}
