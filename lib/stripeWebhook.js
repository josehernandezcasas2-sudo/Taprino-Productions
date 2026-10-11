import { getStripe } from './stripe';

// Two Stripe endpoints can point at /api/webhook, and each signs with its
// own secret:
//   * the account endpoint ("Events on your account"): checkout sessions,
//     refunds, subscriptions — STRIPE_WEBHOOK_SECRET;
//   * the Connect endpoint ("Events on Connected accounts"): what happens
//     on a creator's Express account, e.g. account.updated when their
//     onboarding clears — STRIPE_CONNECT_WEBHOOK_SECRET.
// Stripe never delivers a connected account's events to an account-level
// endpoint, so the second one isn't optional for payouts.
export function webhookSecrets() {
  return [process.env.STRIPE_WEBHOOK_SECRET, process.env.STRIPE_CONNECT_WEBHOOK_SECRET].filter(Boolean);
}

// Verifies the raw body against whichever secret signed it and returns
// the event. Throws (with Stripe's own message) when none matches.
export function verifyStripeEvent(rawBody, signatureHeader) {
  const secrets = webhookSecrets();
  if (secrets.length === 0) throw new Error('No webhook signing secret is configured (STRIPE_WEBHOOK_SECRET).');
  const stripe = getStripe();
  let lastError = null;
  for (const secret of secrets) {
    try {
      return stripe.webhooks.constructEvent(rawBody, signatureHeader, secret);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}
