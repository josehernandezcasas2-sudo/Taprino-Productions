import { getStripe, isStripeConfigured, stripeMode } from './stripe';
import { getSupabase } from './supabase';

// Admin-side checklist of what Stripe needs for Pitch Room donations,
// answered from the live Stripe API rather than from memory of the
// dashboard (components/admin/StripeStatusPanel.js on /admin/pitch-room).
// Events the platform's own endpoint carries ("Events on your account").
export const ACCOUNT_WEBHOOK_EVENTS = [
  'checkout.session.completed', // subscriptions, ad credits, donations paid
  'checkout.session.expired',   // a donation checkout nobody finished
  'charge.refunded'             // an admin refund settled
];
// Events that only reach a Connect endpoint ("Events on Connected
// accounts"): Stripe emits them on the creator's account, and an
// account-level endpoint never sees them.
export const CONNECT_WEBHOOK_EVENTS = [
  'account.updated'             // a creator's Connect onboarding changed
];
export const REQUIRED_WEBHOOK_EVENTS = [...ACCOUNT_WEBHOOK_EVENTS, ...CONNECT_WEBHOOK_EVENTS];

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

  // 3. The webhook endpoints. Two point at /api/webhook: the account one
  //    (checkout, refunds, subscriptions) and the Connect one, which
  //    Stripe creates separately ("Listen to events on Connected
  //    accounts") and signs with its own secret. The URL must be the
  //    host the site actually answers on: Stripe doesn't follow
  //    redirects, so an endpoint on a host that 308s to www fails
  //    every delivery.
  const webhookUrl = `https://${host || 'www.studiotapatv.site'}/api/webhook`;
  try {
    const endpoints = await stripe.webhookEndpoints.list({ limit: 100 });
    const ours = endpoints.data.filter((e) => /\/api\/webhook\/?$/.test(e.url));
    const onHost = (e) => Boolean(host) && e.url.includes(host);
    const pick = (list) => list.find(onHost) || list[0] || null;
    const accountEp = pick(ours.filter((e) => !e.connect));
    const connectEp = pick(ours.filter((e) => e.connect));
    const hostOf = (e) => { try { return new URL(e.url).host; } catch { return e.url; } };

    const describe = (ep, required) => {
      const events = ep.enabled_events || [];
      const all = events.includes('*');
      const missing = all ? [] : required.filter((e) => !events.includes(e));
      const disabled = ep.status !== 'enabled';
      return {
        missing,
        ok: !disabled && missing.length === 0,
        detail: ep.url + (disabled ? ' · disabled in Stripe' : '') + (missing.length ? ` · missing: ${missing.join(', ')}` : all ? ' · listening to all events' : ' · all needed events on')
      };
    };

    if (!accountEp) {
      checks.push({
        key: 'webhook',
        ok: false,
        label: 'Webhook endpoint',
        detail: `No endpoint points at /api/webhook. In Developers → Webhooks add ${webhookUrl} (“Events on your account”) with the events listed below.`,
        missing: ACCOUNT_WEBHOOK_EVENTS,
        url: webhookUrl
      });
    } else {
      const d = describe(accountEp, ACCOUNT_WEBHOOK_EVENTS);
      checks.push({ key: 'webhook', ok: d.ok, label: 'Webhook endpoint', detail: d.detail, missing: d.missing, url: accountEp.url });
      if (host && !onHost(accountEp)) {
        checks.push({
          key: 'webhook-host',
          ok: false,
          label: 'Webhook host',
          detail: `That endpoint points at ${hostOf(accountEp)}, not this site (${host}). Stripe doesn’t follow redirects, so its deliveries fail. Edit the endpoint and change its URL to ${webhookUrl} — the signing secret stays the same.`
        });
      }
    }

    if (!connectEp) {
      checks.push({
        key: 'webhook-connect',
        ok: false,
        label: 'Connect webhook endpoint',
        detail: `No endpoint listens to events on connected accounts, so a creator finishing Stripe onboarding never reaches this site. In Developers → Webhooks add a second endpoint at ${webhookUrl}, choose “Events on Connected accounts”, pick account.updated, then put its signing secret in STRIPE_CONNECT_WEBHOOK_SECRET.`,
        missing: CONNECT_WEBHOOK_EVENTS,
        url: webhookUrl
      });
    } else {
      const d = describe(connectEp, CONNECT_WEBHOOK_EVENTS);
      const offHost = Boolean(host) && !onHost(connectEp);
      checks.push({
        key: 'webhook-connect',
        ok: d.ok && !offHost,
        label: 'Connect webhook endpoint',
        detail: d.detail + (offHost ? ` · points at ${hostOf(connectEp)}, not ${host} — change its URL to ${webhookUrl}` : ''),
        missing: d.missing,
        url: connectEp.url
      });
    }
  } catch (err) {
    checks.push({ key: 'webhook', ok: false, label: 'Webhook endpoint', detail: `Couldn’t list webhooks: ${err.message}` });
  }

  // 4. The signing secrets the webhook route verifies with, one per endpoint.
  const hasSecret = Boolean(process.env.STRIPE_WEBHOOK_SECRET);
  checks.push({
    key: 'secret',
    ok: hasSecret,
    label: 'Webhook signing secret',
    detail: hasSecret ? 'STRIPE_WEBHOOK_SECRET is set.' : 'STRIPE_WEBHOOK_SECRET is not set — every event Stripe sends is being rejected.'
  });
  const hasConnectSecret = Boolean(process.env.STRIPE_CONNECT_WEBHOOK_SECRET);
  checks.push({
    key: 'connect-secret',
    ok: hasConnectSecret,
    label: 'Connect webhook signing secret',
    detail: hasConnectSecret
      ? 'STRIPE_CONNECT_WEBHOOK_SECRET is set.'
      : 'STRIPE_CONNECT_WEBHOOK_SECRET is not set — the Connect endpoint’s events are rejected. Copy that endpoint’s signing secret (Developers → Webhooks → the Connect endpoint → Reveal) into Vercel’s environment variables and redeploy.'
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
