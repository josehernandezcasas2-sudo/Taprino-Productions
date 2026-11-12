import { getSupabase } from './supabase';
import { getStripe, isStripeConfigured } from './stripe';
import { recordAudit } from './auditLog';
import { internalError } from './apiErrors';
import { tierFromProductMetadata } from './membershipTiers';
import { clearMembershipPlansCache } from './membershipPlans';
import { MEMBERSHIP_TAX_CODE, membershipTaxPlan, skippedLine, stripeReason, taxSettingsFromRow, validateTaxUpdate, MIGRATION_122_LINE } from './salesTaxRules';

// Sales tax, server side (migration 122; the rules are lib/salesTaxRules.js).
// The switches live on site_settings; the membership products' tax codes
// and prices' tax behaviours live in Stripe and are read live for the
// settings card; a membership Checkout Stripe refused over tax is made
// again without it and noted in the audit log, which the card counts.

// A Checkout Stripe refused with tax and made again without it is noted
// per lane (membership_tax_skipped, backing_tax_skipped,
// booking_tax_skipped); the button's changes as membership_tax_codes.
const LANES = ['membership', 'backing', 'booking'];
const skippedAction = (lane) => `${lane}_tax_skipped`;
const FIXED_ACTION = 'membership_tax_codes';

function isMissingColumn(error) {
  return Boolean(error) && (error.code === '42703' || error.code === 'PGRST204' || /column .* does not exist|could not find the .* column/i.test(error.message || ''));
}

// The switches as the money paths obey them. Before 122 everything is off.
// { strict } (a backing's or a booking's Checkout): a read that fails
// throws, so the payment isn't started on a guess; without it (the
// membership Checkout, the pages) a failed read is "off" — the site as it
// was — and logged, so a signup never fails over it.
export async function getTaxSettings({ strict = false } = {}) {
  let data = null;
  let error = null;
  try {
    ({ data, error } = await getSupabase().from('site_settings').select('*').eq('id', 1).maybeSingle());
  } catch (err) {
    error = err;
  }
  if (error) {
    if (strict) throw internalError(error, 'tax settings read failed');
    console.error('getTaxSettings error:', error.message);
    return taxSettingsFromRow(null);
  }
  return taxSettingsFromRow(data);
}

// The settings card's save. Full admins only (the route checks); audited
// like every settings change.
export async function saveTaxSettings(body, { userId, email }) {
  const supabase = getSupabase();
  const current = await getTaxSettings({ strict: true });
  if (!current.ready) {
    const err = new Error(MIGRATION_122_LINE);
    err.status = 503;
    err.code = 'migration-122';
    throw err;
  }
  const { patch, error } = validateTaxUpdate(body, current);
  if (error) {
    const err = new Error(error);
    err.status = 400;
    throw err;
  }
  const { error: writeError } = await supabase.from('site_settings').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', 1);
  if (writeError) {
    if (isMissingColumn(writeError)) {
      const err = new Error(MIGRATION_122_LINE);
      err.status = 503;
      err.code = 'migration-122';
      throw err;
    }
    throw internalError(writeError, 'tax settings write failed');
  }
  await recordAudit({
    adminId: userId,
    adminEmail: email,
    action: 'update_site_settings',
    targetType: 'site_settings',
    details: Object.keys(patch).map((k) => `${k}=${patch[k]}`).join(', ')
  });
  return getTaxSettings();
}

// ---- memberships in Stripe ---------------------------------------------------

// Every active recurring price on a membership product (metadata `tier`),
// or the legacy STRIPE_PRICE_ID when no tier product exists yet (the same
// fallback lib/membershipPlans.js sells).
async function membershipPriceRows(stripe) {
  const prices = await stripe.prices.list({ active: true, type: 'recurring', expand: ['data.product'], limit: 100 });
  const rows = [];
  for (const price of prices.data || []) {
    const product = price.product && typeof price.product === 'object' ? price.product : null;
    if (!product || product.active === false) continue;
    const tier = tierFromProductMetadata(product.metadata, { fallback: null });
    if (!tier) continue;
    rows.push(toRow(price, product, tier));
  }
  if (rows.length === 0 && process.env.STRIPE_PRICE_ID) {
    const price = await stripe.prices.retrieve(process.env.STRIPE_PRICE_ID, { expand: ['product'] });
    const product = price.product && typeof price.product === 'object' ? price.product : null;
    if (product) rows.push(toRow(price, product, 'premium'));
  }
  return rows;
}

function toRow(price, product, tier) {
  return {
    tier,
    productId: product.id,
    productName: product.name,
    productTaxCode: typeof product.tax_code === 'string' ? product.tax_code : (product.tax_code && product.tax_code.id) || null,
    priceId: price.id,
    taxBehavior: price.tax_behavior || 'unspecified',
    amountCents: price.unit_amount,
    interval: price.recurring ? price.recurring.interval : 'month'
  };
}

// The checkouts of one lane made without tax in the last 90 days (for
// memberships, since the products were last set, if that's later), newest
// first, from the audit log.
async function skippedCheckouts(lane) {
  const supabase = getSupabase();
  const since90 = new Date(Date.now() - 90 * 86400000).toISOString();
  let since = since90;
  if (lane === 'membership') {
    const fixed = await supabase.from('audit_log').select('created_at').eq('action', FIXED_ACTION).order('created_at', { ascending: false }).limit(1);
    if (fixed.data && fixed.data[0] && fixed.data[0].created_at > since90) since = fixed.data[0].created_at;
  }
  const { data, error } = await supabase.from('audit_log').select('created_at, details').eq('action', skippedAction(lane)).gte('created_at', since).order('created_at', { ascending: false }).limit(500);
  if (error) {
    console.error('salesTax skipped read failed:', error.message);
    return [];
  }
  return (data || []).map((r) => ({ at: r.created_at, reason: r.details || null }));
}

// Stripe Tax's own state (Dashboard → Tax): whether it's set up, the
// account's default tax behaviour and code, and the registrations — where
// tax is actually added. Each read on its own, best effort: a restricted
// key without the Tax permission just leaves that part unknown.
async function stripeTaxState(stripe) {
  const out = { status: null, missing: [], defaultBehavior: null, defaultCode: null, registrations: null };
  try {
    const s = await stripe.tax.settings.retrieve();
    out.status = s.status || null;
    out.missing = (s.status_details && s.status_details.pending && s.status_details.pending.missing_fields) || [];
    out.defaultBehavior = (s.defaults && s.defaults.tax_behavior) || null;
    out.defaultCode = (s.defaults && s.defaults.tax_code) || null;
  } catch (err) {
    console.error('salesTax: Stripe Tax settings not read:', err.message);
  }
  try {
    const regs = await stripe.tax.registrations.list({ status: 'active', limit: 100 });
    out.registrations = (regs.data || []).map(registrationPlace);
  } catch (err) {
    console.error('salesTax: Stripe Tax registrations not read:', err.message);
  }
  return out;
}

// "CA", "US", "GB": the state for a US registration, else the country.
function registrationPlace(r) {
  const opts = r && r.country_options && typeof r.country_options === 'object' ? r.country_options : {};
  const us = opts.us && opts.us.state;
  return us ? `${String(us).toUpperCase()}` : String((r && r.country) || '?').toUpperCase();
}

// The settings card: the switches, Stripe Tax's own state, the membership
// products and prices as Stripe has them now, and the checkouts that went
// without tax.
export async function getSalesTaxStatus() {
  const settings = await getTaxSettings();
  const out = { settings, stripe: { configured: isStripeConfigured(), error: null, plan: null, tax: null }, skipped: {} };
  const [skipped] = await Promise.all([
    Promise.all(LANES.map((lane) => skippedCheckouts(lane))),
    (async () => {
      if (!out.stripe.configured) return;
      const stripe = getStripe();
      const [plan, tax] = await Promise.all([
        membershipPriceRows(stripe).then(membershipTaxPlan).catch((err) => {
          console.error('salesTax: Stripe read failed:', err.message);
          out.stripe.error = 'Stripe couldn’t be read just now. Try again in a minute.';
          return null;
        }),
        stripeTaxState(stripe)
      ]);
      out.stripe.plan = plan;
      out.stripe.tax = tax;
    })()
  ]);
  // Per lane: { count, line, latest } — the line in the card's words.
  LANES.forEach((lane, i) => {
    const list = skipped[i] || [];
    out.skipped[lane] = { count: list.length, line: skippedLine(list), latest: list.slice(0, 5) };
  });
  return out;
}

// The one button: txcd_10402200 on every membership product, and
// tax-on-top on every price that has no tax behaviour yet. Prices already
// inclusive or exclusive are left alone (Stripe won't change them).
// Audited; the plans cache is cleared so the picker reads them fresh.
export async function setMembershipProductsTax({ userId, email }) {
  if (!isStripeConfigured()) {
    const err = new Error('Stripe isn’t set up on this site.');
    err.status = 409;
    throw err;
  }
  const stripe = getStripe();
  const plan = membershipTaxPlan(await membershipPriceRows(stripe));
  if (plan.products.length === 0) {
    const err = new Error('No membership products in Stripe yet (a product with metadata tier = standard, premium or sponsor).');
    err.status = 409;
    throw err;
  }
  // Every change that went through is audited, even when a later one
  // fails; a press that changed nothing writes nothing (the card's count of
  // checkouts made without tax starts again only after a real change).
  const done = [];
  try {
    for (const p of plan.products.filter((x) => x.action === 'set_code')) {
      await stripe.products.update(p.productId, { tax_code: MEMBERSHIP_TAX_CODE });
      done.push(`${p.productId} tax_code ${p.taxCode || 'none'}→${MEMBERSHIP_TAX_CODE}`);
    }
    for (const p of plan.prices.filter((x) => x.action === 'set_exclusive')) {
      await stripe.prices.update(p.priceId, { tax_behavior: 'exclusive' });
      done.push(`${p.priceId} tax_behavior unspecified→exclusive`);
    }
  } catch (err) {
    // Admin-only: Stripe's own line helps (it names the price or product).
    console.error('setMembershipProductsTax:', err.message);
    const e = new Error(`Stripe refused a change${done.length ? ` after ${done.length} went through` : ''}: ${stripeReason(err)}`);
    e.status = 502;
    throw e;
  } finally {
    clearMembershipPlansCache();
    if (done.length) {
      await recordAudit({ adminId: userId, adminEmail: email, action: FIXED_ACTION, targetType: 'stripe', details: done.join('; ').slice(0, 1000) });
    }
  }
  return { changed: done.length, after: membershipTaxPlan(await membershipPriceRows(stripe)) };
}

// A Checkout Stripe refused with tax and made again without it (lane:
// membership, backing or booking), for the settings card's count.
export async function recordSkippedTax({ lane, sessionId, reason }) {
  if (!LANES.includes(lane)) return;
  await recordAudit({ adminId: 'system', adminEmail: null, action: skippedAction(lane), targetType: 'checkout', targetId: sessionId || null, details: String(reason || '').slice(0, 300) || null });
}
