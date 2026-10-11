import { getStripe, isStripeConfigured, stripeMode } from './stripe';
import { getSupabase } from './supabase';

// Admin-side checklist of what Stripe needs for Pitch Room donations,
// answered from the live Stripe API rather than from memory of the
// dashboard (components/admin/StripeStatusPanel.js on /admin/pitch-room).
export const REQUIRED_WEBHOOK_EVENTS = [
  'checkout.session.completed', // subscriptions, ad credits, donations paid
  'checkout.session.expired',   // a donation checkout nobody finished
  'account.updated',            // a creator's Connect onboarding changed
  'charge.refunded'             // an admin refund settled
];

export async function getStripeStatus({ host } = {}) {
  const checks = [];
  if (!isStripeConfigured()) {
    checks.push({ key: 'key', ok: false, label: 'Secret key', detail: 'STRIPE_SECRET_KEY is not set on the server, so nothing below can run.' });
    return { configured: false, mode: null, platform: null, checks, ready: false };
  }

  const stripe = getStripe();
  const mode = stripeMode();
  let platform = null;

  // 1. The platform's own Stripe account.
  try {
    const acct = await stripe.accounts.retrieve();
    const name = (acct.settings && acct.settings.dashboard && acct.settings.dashboard.display_name) || (acct.business_profile && acct.business_profile.name) || acct.id;
    platform = { id: acct.id, name, country: acct.country, chargesEnabled: Boolean(acct.charges_enabled), payoutsEnabled: Boolean(acct.payouts_enabled) };
    checks.push({
      key: 'account',
      ok: platform.chargesEnabled,
      label: 'Stripe account',
      detail: `${name} · ${acct.country} · ${mode} mode` + (platform.chargesEnabled ? '' : ' · this account can’t take payments yet (finish activating it in the Stripe dashboard)')
    });
  } catch (err) {
    checks.push({ key: 'account', ok: false, label: 'Stripe account', detail: `Stripe rejected the key: ${err.message}` });
    return { configured: true, mode, platform: null, checks, ready: false };
  }

  // 2. Connect. Listing connected accounts fails on an account that has
  //    never enabled Connect; on one that has, it's the count of creators
  //    who've started onboarding.
  try {
    const list = await stripe.accounts.list({ limit: 100 });
    const n = list.data.length;
    const ready = list.data.filter((a) => a.charges_enabled).length;
    checks.push({
      key: 'connect',
      ok: true,
      label: 'Stripe Connect',
      detail: n === 0 ? 'Reachable. No creator has started onboarding yet.' : `${n} creator account${n === 1 ? '' : 's'} started, ${ready} ready to take donations.`
    });
  } catch (err) {
    checks.push({
      key: 'connect',
      ok: false,
      label: 'Stripe Connect',
      detail: `Not enabled. In the Stripe dashboard open Connect → Get started, choose Express accounts, and fill in the platform profile. (${err.message})`
    });
  }

  // 3. The webhook endpoint and its events.
  try {
    const endpoints = await stripe.webhookEndpoints.list({ limit: 100 });
    const ours = endpoints.data.filter((e) => /\/api\/webhook\/?$/.test(e.url));
    const match = (host && ours.find((e) => e.url.includes(host))) || ours[0] || null;
    if (!match) {
      checks.push({
        key: 'webhook',
        ok: false,
        label: 'Webhook endpoint',
        detail: `No endpoint points at /api/webhook. In Developers → Webhooks add https://${host || 'studiotapatv.site'}/api/webhook with the events listed below.`,
        missing: REQUIRED_WEBHOOK_EVENTS
      });
    } else {
      const events = match.enabled_events || [];
      const all = events.includes('*');
      const missing = all ? [] : REQUIRED_WEBHOOK_EVENTS.filter((e) => !events.includes(e));
      const disabled = match.status !== 'enabled';
      checks.push({
        key: 'webhook',
        ok: !disabled && missing.length === 0,
        label: 'Webhook endpoint',
        detail: `${match.url}` + (disabled ? ' · disabled in Stripe' : '') + (missing.length ? ` · missing: ${missing.join(', ')}` : all ? ' · listening to all events' : ' · all needed events on'),
        missing,
        url: match.url
      });
      if (host && !match.url.includes(host)) {
        checks.push({ key: 'webhook-host', ok: false, label: 'Webhook host', detail: `That endpoint points at a different host than this site (${host}). Events from this deployment won’t reach it.` });
      }
    }
  } catch (err) {
    checks.push({ key: 'webhook', ok: false, label: 'Webhook endpoint', detail: `Couldn’t list webhooks: ${err.message}` });
  }

  // 4. The signing secret the webhook route verifies with.
  const hasSecret = Boolean(process.env.STRIPE_WEBHOOK_SECRET);
  checks.push({
    key: 'secret',
    ok: hasSecret,
    label: 'Webhook signing secret',
    detail: hasSecret ? 'STRIPE_WEBHOOK_SECRET is set.' : 'STRIPE_WEBHOOK_SECRET is not set — every event Stripe sends is being rejected.'
  });

  // 5. Our side: migration 083.
  const supabase = getSupabase();
  const { error: dbError } = await supabase.from('creator_payout_accounts').select('user_id', { head: true, count: 'exact' });
  checks.push({
    key: 'db',
    ok: !dbError,
    label: 'Database (migration 083)',
    detail: dbError ? 'creator_payout_accounts is missing — run supabase/migrations/083_pitch_stripe_connect.sql in the SQL Editor.' : 'Payout and donation tables present.'
  });

  return { configured: true, mode, platform, checks, ready: checks.every((c) => c.ok) };
}
