import { getStripe, isStripeConfigured, stripeMode } from './stripe';
import { getSupabase } from './supabase';

// Admin-side checklist of what Stripe needs for Pitch Room donations,
// answered from the live Stripe API rather than from memory of the
// dashboard (components/admin/StripeStatusPanel.js on /admin/pitch-room).
// Events the platform's own endpoint carries ("Events on your account").
export const ACCOUNT_WEBHOOK_EVENTS = [
  'checkout.session.completed', // subscriptions, ad credits, donations and location bookings paid
  'checkout.session.expired',   // a donation checkout nobody finished
  'charge.refunded',            // an admin refund settled
  'invoice.paid',               // a membership renewal: Creator Share records and splits it
  'payout.paid',                // a studio sweep reached the bank (lib/studioMoney.js)
  'payout.failed',              // ...or didn't
  'customer.subscription.deleted', // a membership ended: its referral attribution ends with it
  'charge.dispute.created',     // a chargeback: the payment's unpaid creator credits are reversed
  'transfer.reversed'           // a creator payout reversed in the dashboard: the credits are owed again
];
// Events that only reach a Connect endpoint ("Events on Connected
// accounts"): Stripe emits them on the creator's account, and an
// account-level endpoint never sees them.
export const CONNECT_WEBHOOK_EVENTS = [
  'account.updated'             // a creator's Connect onboarding changed
];
export const REQUIRED_WEBHOOK_EVENTS = [...ACCOUNT_WEBHOOK_EVENTS, ...CONNECT_WEBHOOK_EVENTS];

// Every endpoint pointing at /api/webhook, each with `connect`: true for
// one listening to connected accounts, false for the account's own, null
// when Stripe wouldn't say. The v1 webhook list never reports which is
// which (`connect` is accepted on create but not returned), so this asks
// the v2 event-destinations API, which does (`events_from`), and falls
// back to the v1 list with `connect: null` if that call isn't available.
async function listOurEndpoints(stripe) {
  const isOurs = (url) => /\/api\/webhook\/?$/.test(url || '');
  try {
    const res = await fetch('https://api.stripe.com/v2/core/event_destinations?limit=100', {
      headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`, 'Stripe-Version': '2025-03-31.basil' }
    });
    if (res.ok) {
      const body = await res.json();
      const list = (body.data || [])
        .filter((d) => d.type === 'webhook_endpoint' && d.webhook_endpoint && isOurs(d.webhook_endpoint.url))
        .map((d) => ({
          id: d.id,
          url: d.webhook_endpoint.url,
          enabled_events: d.enabled_events || [],
          status: d.status === 'disabled' ? 'disabled' : 'enabled',
          connect: (d.events_from || []).includes('other_accounts')
        }));
      if (list.length > 0) return list;
    }
  } catch (err) {
    console.error('stripe v2 event_destinations failed:', err.message);
  }
  const endpoints = await stripe.webhookEndpoints.list({ limit: 100 });
  return endpoints.data.filter((e) => isOurs(e.url)).map((e) => ({ id: e.id, url: e.url, enabled_events: e.enabled_events, status: e.status, connect: null }));
}

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
    const ours = await listOurEndpoints(stripe);
    const onHost = (e) => Boolean(host) && e.url.includes(host);
    const pick = (list) => list.find(onHost) || list[0] || null;
    const accountEp = pick(ours.filter((e) => e.connect === false));
    // When Stripe wouldn't say which endpoint is which (see
    // listOurEndpoints), two endpoints at our URL is the next best sign
    // that the Connect one exists.
    const unsure = ours.filter((e) => e.connect === null);
    const connectEp = pick(ours.filter((e) => e.connect === true)) || (unsure.length >= 2 ? unsure[1] : null);
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
        detail: d.detail
          + (offHost ? ` · points at ${hostOf(connectEp)}, not ${host} — change its URL to ${webhookUrl}` : '')
          + (connectEp.connect === null ? ' · two endpoints point here; Stripe wouldn’t say which listens to connected accounts, so check in the dashboard that one says “Connected accounts”' : ''),
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
  // A real row read, not a HEAD/count probe: PostgREST answers a HEAD on a
  // table it doesn't know with 200 and no error, which made this line go
  // green before the migration had been run.
  const { error: dbError } = await supabase.from('creator_payout_accounts').select('user_id').limit(1);
  checks.push({
    key: 'db',
    ok: !dbError,
    label: 'Database (migration 083)',
    detail: dbError ? 'creator_payout_accounts is missing — run supabase/migrations/083_pitch_stripe_connect.sql in the SQL Editor.' : 'Payout and donation tables present.'
  });

  return { configured: true, mode, platform, checks, ready: checks.every((c) => c.ok) };
}
