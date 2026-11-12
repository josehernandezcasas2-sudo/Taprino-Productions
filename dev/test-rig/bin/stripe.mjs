// The fake Stripe on :54322 — what lib/stripe.js's client reaches through
// STRIPE_API_HOST/PORT/PROTOCOL with the key sk_test_rig. In-memory state,
// Stripe-shaped objects, lists, search, expansion and errors.
//
// API (all under /v1, form-encoded like the real one):
//   products, prices (list/retrieve/create), customers (create/retrieve/
//   update/del/list/search), checkout/sessions (create/retrieve/list/
//   expire), billing_portal/sessions, accounts (create/retrieve/update/
//   list, GET /v1/account = the platform), account_links,
//   accounts/:id/login_links, subscriptions (list/retrieve/update/cancel),
//   balance, payouts (list/retrieve/create), transfers (create/retrieve/
//   list, reversals), refunds (create/retrieve/list), payment_intents,
//   charges, balance_transactions (list/retrieve), webhook_endpoints (list),
//   events (list by type / types[] / created, retrieve; a connected
//   account's only with its Stripe-Account header). Anything else: Stripe's
//   404 JSON error.
// Pages a browser opens:
//   /checkout/:id (Pay / Cancel), /portal/:id, /connect/onboard/:acct,
//   /connect/dashboard/:acct
// Hooks:
//   GET /__state, POST /__reset
//   POST /__checkout/:id/complete | /__checkout/:id/expire
//   POST /__accounts/:id/ready
//   POST /__payouts/:id/paid | /__payouts/:id/failed
//   POST /__dispute { charge, phase: created | won | lost }
//   POST /__event { type, object | objectId, account?, previous?,
//        ageMinutes?, deliver? } → signs with STRIPE_WEBHOOK_SECRET (or the
//        Connect secret with an account) and POSTs it to the app's
//        /api/webhook; answers the delivery. deliver: false only records it
//        (in the events list, never sent); ageMinutes dates it back.
//   POST /__subscriptions/:id/renew { deliver?, ageMinutes? } → a paid
//        renewal invoice (subscription_cycle) with its charge and
//        invoice.paid, sent unless deliver: false.
//   POST /__events/forget { ids? | invoices? | all? } → events leave the
//        events list (a check's cleanup).
import crypto from 'node:crypto';
import http from 'node:http';
import { PORTS, HOST, FAKE_KEYS, urls } from '../lib/config.mjs';
import { readBody, sendJson, sendText, parseForm, logLine, listen } from '../lib/http.mjs';

const WEBHOOK_URL = process.env.RIG_WEBHOOK_URL || `${urls().next}/api/webhook`;
const API_EVENTS = process.env.RIG_STRIPE_API_EVENTS !== '0';
const SELF = urls().stripe;
const PLATFORM = 'acct_rigPlatform';

const now = () => Math.floor(Date.now() / 1000);
const rand = (n = 24) => crypto.randomBytes(n).toString('base64').replace(/[^A-Za-z0-9]/g, '').slice(0, n).padEnd(n, '0');
const newId = (prefix) => `${prefix}_rig${rand(20)}`;
const clone = (o) => (o === undefined ? o : JSON.parse(JSON.stringify(o)));
const bool = (v) => v === true || v === 'true';
const int = (v, d = null) => (v === undefined || v === null || v === '' ? d : Number.parseInt(v, 10));

let objects = new Map();
let balances = new Map();
let idempotency = new Map();
let deliveries = [];

const NOUN = {
  cus: 'customer', prod: 'product', price: 'price', cs: 'checkout.session', sub: 'subscription', acct: 'account', pi: 'payment_intent', ch: 'charge',
  re: 'refund', tr: 'transfer', trr: 'transfer_reversal', po: 'payout', txn: 'balance_transaction', in: 'invoice', evt: 'event', bps: 'billing_portal.session', dp: 'dispute'
};

class StripeError extends Error {
  constructor(status, message, { type = 'invalid_request_error', code, param } = {}) {
    super(message);
    this.status = status;
    this.body = { error: { type, message, ...(code ? { code } : {}), ...(param ? { param } : {}), doc_url: code ? `https://stripe.com/docs/error-codes/${code.replace(/_/g, '-')}` : undefined } };
  }
}
const missing = (id, param = 'id') => new StripeError(404, `No such ${NOUN[String(id).split('_')[0]] || 'object'}: '${id}'`, { code: 'resource_missing', param });

function put(obj) {
  objects.set(obj.id, obj);
  return obj;
}
function get(id, type) {
  const o = objects.get(id);
  if (!o || (type && o.object !== type)) throw missing(id);
  return o;
}
const all = (type) => [...objects.values()].filter((o) => o.object === type);

function balanceOf(acct) {
  if (!balances.has(acct)) balances.set(acct, { available: 0, pending: 0 });
  return balances.get(acct);
}

function txn({ amount, fee = 0, type, source, account = PLATFORM, description = null }) {
  const b = balanceOf(account);
  b.available += amount - fee;
  return put({
    id: newId('txn'), object: 'balance_transaction', amount, fee, net: amount - fee, currency: 'usd', type, source, status: 'available', created: now(), available_on: now(),
    description, fee_details: fee ? [{ amount: fee, currency: 'usd', description: 'Stripe processing fees', type: 'stripe_fee' }] : [], reporting_category: type, exchange_rate: null, _account: account
  });
}

const cardFee = (amount) => Math.round(amount * 0.029) + 30;

// ---- seed --------------------------------------------------------------
function seed() {
  objects = new Map();
  balances = new Map();
  idempotency = new Map();
  deliveries = [];
  const created = now() - 90 * 86400;
  const plans = [
    ['standard', 'Studio Tapa + Standard', 799],
    ['premium', 'Studio Tapa + Premium', 1299],
    ['sponsor', 'Studio Tapa + Sponsor', 699]
  ];
  for (const [tier, name, amount] of plans) {
    const prod = put({ id: `prod_rig${tier[0].toUpperCase()}${tier.slice(1)}`, object: 'product', active: true, name, description: null, metadata: { tier }, created, updated: created, default_price: `price_rig${tier[0].toUpperCase()}${tier.slice(1)}`, images: [], livemode: false, type: 'service', tax_code: null, url: null });
    put({ id: `price_rig${tier[0].toUpperCase()}${tier.slice(1)}`, object: 'price', active: true, currency: 'usd', unit_amount: amount, unit_amount_decimal: String(amount), product: prod.id, recurring: { interval: 'month', interval_count: 1, usage_type: 'licensed', aggregate_usage: null, trial_period_days: null }, type: 'recurring', metadata: {}, nickname: null, created, livemode: false, lookup_key: null, billing_scheme: 'per_unit', tax_behavior: 'unspecified', tiers_mode: null, transform_quantity: null });
  }
  put(accountObj({ id: PLATFORM, email: 'studio@rig.example.com', ready: true, name: 'Studio Tapa TV (rig)', schedule: 'manual' }));
  put(accountObj({ id: 'acct_rigMara', email: 'mara@rig.example.com', ready: true, name: 'Mara Reyes', metadata: { userId: 'user_rigMara' } }));
  balanceOf(PLATFORM).available = 50000;
  balanceOf('acct_rigMara').available = 12345;
  balanceOf('acct_rigMara').pending = 2500;
}

function accountObj({ id, email = null, ready = false, name = null, schedule = 'daily', metadata = {} }) {
  return {
    id, object: 'account', type: 'express', email, country: 'US', default_currency: 'usd', created: now() - 60 * 86400,
    charges_enabled: ready, payouts_enabled: ready, details_submitted: ready,
    requirements: { currently_due: ready ? [] : ['external_account', 'individual.dob.day'], eventually_due: [], past_due: [], disabled_reason: ready ? null : 'requirements.past_due', pending_verification: [] },
    capabilities: ready ? { card_payments: 'active', transfers: 'active' } : { card_payments: 'inactive', transfers: 'inactive' },
    metadata,
    business_profile: { name, url: null },
    settings: { payouts: { schedule: { interval: schedule, delay_days: schedule === 'manual' ? 0 : 2 } }, dashboard: { display_name: name } },
    external_accounts: { object: 'list', data: ready ? [{ id: `ba_${id}`, object: 'bank_account', last4: '6789', bank_name: 'STRIPE TEST BANK', currency: 'usd', default_for_currency: true }] : [], has_more: false, url: `/v1/accounts/${id}/external_accounts` },
    livemode: false
  };
}

// ---- lists, expansion ---------------------------------------------------
function page(items, params, url) {
  const limit = Math.min(Math.max(int(params.limit, 10), 1), 100);
  let list = [...items].sort((a, b) => (b.created || 0) - (a.created || 0) || (a.id < b.id ? 1 : -1));
  if (params.starting_after) {
    const i = list.findIndex((o) => o.id === params.starting_after);
    list = i === -1 ? [] : list.slice(i + 1);
  } else if (params.ending_before) {
    const i = list.findIndex((o) => o.id === params.ending_before);
    list = i === -1 ? [] : list.slice(Math.max(0, i - limit), i);
  }
  return { object: 'list', data: list.slice(0, limit), has_more: list.length > limit, url };
}

function rangeOk(value, cond) {
  if (cond === undefined) return true;
  if (typeof cond !== 'object') return Number(value) === Number(cond);
  if (cond.gte !== undefined && !(value >= Number(cond.gte))) return false;
  if (cond.gt !== undefined && !(value > Number(cond.gt))) return false;
  if (cond.lte !== undefined && !(value <= Number(cond.lte))) return false;
  if (cond.lt !== undefined && !(value < Number(cond.lt))) return false;
  return true;
}

function virtual(obj, key) {
  if (obj.object === 'customer' && key === 'subscriptions') return { object: 'list', data: all('subscription').filter((s) => s.customer === obj.id && s.status !== 'canceled').map(clone), has_more: false, url: `/v1/customers/${obj.id}/subscriptions` };
  if (obj.object === 'checkout.session' && key === 'line_items') return { object: 'list', data: clone(obj._line_items || []), has_more: false, url: `/v1/checkout/sessions/${obj.id}/line_items` };
  return undefined;
}

function expandPath(target, segs) {
  if (target === null || target === undefined || segs.length === 0) return target;
  const [head, ...rest] = segs;
  if (Array.isArray(target)) return target.map((t) => expandPath(t, segs));
  if (typeof target !== 'object') return target;
  let value = target[head];
  if (value === undefined) {
    const v = virtual(target, head);
    if (v !== undefined) value = v;
  }
  if (typeof value === 'string' && objects.has(value)) value = clone(objects.get(value));
  target[head] = rest.length ? expandPath(value, rest) : value;
  return target;
}

function out(obj, expand) {
  if (!obj) return obj;
  const c = clone(obj);
  const strip = (o) => {
    if (o && typeof o === 'object') {
      for (const k of Object.keys(o)) {
        if (k.startsWith('_')) delete o[k];
        else strip(o[k]);
      }
    }
    return o;
  };
  const list = Array.isArray(expand) ? expand : expand ? [expand] : [];
  for (const p of list) expandPath(c, String(p).split('.'));
  return strip(c);
}

// ---- webhooks -------------------------------------------------------------
function makeEvent(type, object, { account = null, previous = null } = {}) {
  return put({
    id: newId('evt'), object: 'event', api_version: '2024-06-20', created: now(), type, livemode: false, pending_webhooks: 1,
    data: { object: clone(object), ...(previous ? { previous_attributes: previous } : {}) },
    request: { id: null, idempotency_key: null },
    ...(account ? { account } : {})
  });
}

async function deliver(event) {
  const payload = JSON.stringify(out(event));
  const t = now();
  const secret = event.account ? FAKE_KEYS.stripeConnectWebhookSecret : FAKE_KEYS.stripeWebhookSecret;
  const sig = crypto.createHmac('sha256', secret).update(`${t}.${payload}`).digest('hex');
  let status = 0;
  let body = '';
  try {
    const res = await fetch(WEBHOOK_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Stripe-Signature': `t=${t},v1=${sig}` }, body: payload });
    status = res.status;
    body = (await res.text()).slice(0, 2000);
  } catch (err) {
    body = `delivery failed: ${err.message}`;
  }
  const record = { event: event.id, type: event.type, status, body, at: new Date().toISOString() };
  deliveries.push(record);
  if (deliveries.length > 300) deliveries.splice(0, deliveries.length - 300);
  logLine('stripe', `webhook ${event.type} ${event.id} → ${status}`);
  return record;
}

const later = (fn) => {
  if (API_EVENTS) setTimeout(() => fn().catch((err) => console.error('fake stripe event:', err.message)), 50);
};

// ---- checkout -------------------------------------------------------------
function lineAmount(li) {
  const qty = int(li.quantity, 1);
  if (li.price) {
    const p = get(li.price, 'price');
    return { amount: p.unit_amount * qty, price: p, qty, recurring: Boolean(p.recurring) };
  }
  const pd = li.price_data || {};
  const unit = int(pd.unit_amount, 0);
  const price = {
    id: newId('price'), object: 'price', active: false, currency: pd.currency || 'usd', unit_amount: unit, product: pd.product || newId('prod'),
    recurring: pd.recurring ? { interval: pd.recurring.interval || 'month', interval_count: 1 } : null, type: pd.recurring ? 'recurring' : 'one_time',
    metadata: {}, created: now(), livemode: false, tax_behavior: pd.tax_behavior || 'unspecified', _name: pd.product_data && pd.product_data.name
  };
  return { amount: unit * qty, price, qty, recurring: Boolean(pd.recurring) };
}

function createSession(p) {
  const mode = p.mode || 'payment';
  if (!p.success_url && p.ui_mode !== 'embedded') throw new StripeError(400, 'Missing required param: success_url.', { code: 'parameter_missing', param: 'success_url' });
  const items = (p.line_items || []).map(lineAmount);
  if (mode !== 'setup' && items.length === 0) throw new StripeError(400, 'Missing required param: line_items.', { code: 'parameter_missing', param: 'line_items' });
  for (const li of p.line_items || []) {
    if (li.price_data && li.price_data.product_data && !String(li.price_data.product_data.name || '').trim()) {
      throw new StripeError(400, 'You must specify a name for the product.', { code: 'parameter_missing', param: 'line_items[0][price_data][product_data][name]' });
    }
  }
  if (p.customer) get(p.customer, 'customer');
  const amount = items.reduce((s, i) => s + i.amount, 0);
  const id = `cs_test_${rand(40)}`;
  return put({
    id, object: 'checkout.session', mode, status: 'open', payment_status: mode === 'setup' ? 'no_payment_required' : 'unpaid', livemode: false, created: now(), expires_at: now() + 24 * 3600,
    url: `${SELF}/checkout/${id}`, success_url: p.success_url || null, cancel_url: p.cancel_url || null, return_url: p.return_url || null,
    customer: p.customer || null, customer_email: p.customer_email || null, customer_details: null, client_reference_id: p.client_reference_id || null,
    metadata: p.metadata || {}, currency: 'usd', amount_subtotal: amount, amount_total: amount,
    total_details: { amount_discount: 0, amount_shipping: 0, amount_tax: 0 }, automatic_tax: { enabled: bool(p.automatic_tax && p.automatic_tax.enabled), status: null },
    payment_intent: null, subscription: null, invoice: null, setup_intent: null,
    payment_intent_data: undefined,
    _payment_intent_data: p.payment_intent_data || {}, _subscription_data: p.subscription_data || {},
    _line_items: items.map((i) => ({ id: newId('li'), object: 'item', amount_total: i.amount, amount_subtotal: i.amount, currency: 'usd', quantity: i.qty, price: i.price, description: i.price._name || null })),
    allow_promotion_codes: bool(p.allow_promotion_codes)
  });
}

function charge({ amount, customer, metadata = {}, pid = {}, email = null, description = null }) {
  const piId = newId('pi');
  const chId = newId('ch');
  const appFee = int(pid.application_fee_amount, null);
  const td = pid.transfer_data || null;
  if (td && td.destination) get(td.destination, 'account');
  const fee = cardFee(amount);
  const t = txn({ amount, fee, type: 'charge', source: chId });
  const ch = put({
    id: chId, object: 'charge', amount, amount_captured: amount, amount_refunded: 0, currency: 'usd', customer: customer || null, paid: true, captured: true, refunded: false, status: 'succeeded',
    payment_intent: piId, balance_transaction: t.id, transfer: null, transfer_data: td, application_fee_amount: appFee, metadata: pid.metadata || metadata, created: now(), description,
    refunds: { object: 'list', data: [], has_more: false, url: `/v1/charges/${chId}/refunds` }, disputed: false, livemode: false, billing_details: { email, name: null }, receipt_email: email,
    payment_method_details: { type: 'card', card: { brand: 'visa', last4: '4242' } }, transfer_group: pid.transfer_group || null
  });
  // A destination charge: the creator's share goes over at once, tied to
  // the charge (the amount after application_fee_amount, or transfer_data.amount).
  if (td && td.destination) {
    const trAmount = td.amount !== undefined ? int(td.amount) : amount - (appFee || 0);
    ch.transfer = makeTransfer({ amount: trAmount, destination: td.destination, source_transaction: chId, transfer_group: pid.transfer_group || null, metadata: {} }, { fromCharge: true }).id;
  }
  return put({
    id: piId, object: 'payment_intent', amount, amount_received: amount, currency: 'usd', customer: customer || null, status: 'succeeded', latest_charge: chId, metadata: pid.metadata || metadata,
    application_fee_amount: appFee, transfer_data: td, transfer_group: pid.transfer_group || null, created: now(), livemode: false, payment_method_types: ['card'], description
  });
}

function ensureCustomer(session) {
  if (session.customer) return session.customer;
  const c = put({ id: newId('cus'), object: 'customer', email: session.customer_email || null, name: null, metadata: {}, created: now(), livemode: false, balance: 0, delinquent: false, description: null, invoice_settings: { default_payment_method: null } });
  return c.id;
}

async function completeSession(id) {
  const s = get(id, 'checkout.session');
  if (s.status !== 'open') throw new StripeError(400, `This Checkout Session is ${s.status}.`, { code: 'checkout_session_not_open' });
  const events = [];
  const email = s.customer_email || (s.customer && objects.get(s.customer) ? objects.get(s.customer).email : null) || 'buyer@rig.example.com';
  if (s.mode === 'payment') {
    const pi = charge({ amount: s.amount_total, customer: s.customer, pid: s._payment_intent_data, email, metadata: s.metadata });
    s.payment_intent = pi.id;
  } else if (s.mode === 'subscription') {
    const customer = ensureCustomer(s);
    s.customer = customer;
    const sd = s._subscription_data || {};
    const first = s._line_items[0];
    const start = now();
    const subId = newId('sub');
    const pi = charge({ amount: s.amount_total, customer, email, description: 'Subscription creation' });
    const invId = newId('in');
    const ch = objects.get(pi.latest_charge);
    const sub = put({
      id: subId, object: 'subscription', customer, status: 'active', metadata: sd.metadata || {}, cancel_at_period_end: false, cancel_at: null, canceled_at: null, ended_at: null,
      current_period_start: start, current_period_end: start + 30 * 86400, start_date: start, created: start, latest_invoice: invId, livemode: false, collection_method: 'charge_automatically',
      items: { object: 'list', data: s._line_items.map((li) => ({ id: newId('si'), object: 'subscription_item', price: clone(li.price), quantity: li.quantity, created: start, subscription: subId, current_period_start: start, current_period_end: start + 30 * 86400 })), has_more: false, url: `/v1/subscription_items?subscription=${subId}` },
      plan: first ? { id: first.price.id, object: 'plan', amount: first.price.unit_amount, interval: 'month', product: first.price.product, active: true } : null
    });
    const inv = put({
      id: invId, object: 'invoice', customer, customer_email: email, subscription: subId, status: 'paid', paid: true, amount_due: s.amount_total, amount_paid: s.amount_total, amount_remaining: 0, currency: 'usd',
      billing_reason: 'subscription_create', charge: ch.id, payment_intent: pi.id, created: start, period_start: start, period_end: start, livemode: false,
      status_transitions: { paid_at: start, finalized_at: start },
      subscription_details: { metadata: sub.metadata },
      parent: { type: 'subscription_details', subscription_details: { subscription: subId, metadata: sub.metadata } },
      lines: { object: 'list', data: s._line_items.map((li) => ({ id: newId('il'), object: 'line_item', amount: li.amount_total, currency: 'usd', price: clone(li.price), quantity: li.quantity, period: { start, end: start + 30 * 86400 }, subscription: subId, type: 'subscription' })), has_more: false }
    });
    s.subscription = subId;
    s.invoice = invId;
    events.push(['customer.subscription.created', sub], ['invoice.paid', inv]);
  }
  s.status = 'complete';
  s.payment_status = s.mode === 'setup' ? 'no_payment_required' : 'paid';
  s.customer_details = { email, name: null };
  const results = [await deliver(makeEvent('checkout.session.completed', out(s)))];
  for (const [type, obj] of events) results.push(await deliver(makeEvent(type, out(obj))));
  return { session: out(s), deliveries: results };
}

async function expireSession(id, { fire = true } = {}) {
  const s = get(id, 'checkout.session');
  if (s.status !== 'open') throw new StripeError(400, `Only Checkout Sessions with a status of open can be expired. This Checkout Session has a status of ${s.status}.`, { code: 'checkout_session_not_open' });
  s.status = 'expired';
  const ev = makeEvent('checkout.session.expired', out(s));
  if (fire) later(() => deliver(ev));
  return s;
}

// ---- money movement ---------------------------------------------------------
function makeTransfer(p, { fromCharge = false } = {}) {
  const amount = int(p.amount);
  if (!(amount > 0)) throw new StripeError(400, 'Invalid positive integer', { param: 'amount' });
  const dest = get(p.destination, 'account');
  if (!dest.charges_enabled && !dest.payouts_enabled) throw new StripeError(400, 'Your destination account needs to have at least one of the following capabilities enabled: transfers, crypto_transfers, legacy_payments', { code: 'insufficient_capabilities_for_transfer' });
  if (p.source_transaction) {
    const ch = get(p.source_transaction, 'charge');
    if (!fromCharge && amount > ch.amount - ch.amount_refunded) throw new StripeError(400, 'The amount of the transfer exceeds the amount available from the source transaction.', { code: 'transfers_not_allowed' });
  } else if (balanceOf(PLATFORM).available < amount) {
    throw new StripeError(400, 'You have insufficient available funds in your Stripe account. Try adding funds directly to your available balance by creating Charges using the 4000000000000077 test card.', { code: 'balance_insufficient' });
  }
  const id = newId('tr');
  const t = txn({ amount: -amount, type: 'transfer', source: id });
  balanceOf(dest.id).available += amount;
  return put({
    id, object: 'transfer', amount, amount_reversed: 0, currency: 'usd', destination: dest.id, destination_payment: newId('py'), source_transaction: p.source_transaction || null, transfer_group: p.transfer_group || null,
    metadata: p.metadata || {}, reversed: false, reversals: { object: 'list', data: [], has_more: false, url: `/v1/transfers/${id}/reversals` }, created: now(), balance_transaction: t.id, livemode: false, description: p.description || null
  });
}

function reverseTransfer(trId, p = {}, { fire = true } = {}) {
  const tr = get(trId, 'transfer');
  const left = tr.amount - tr.amount_reversed;
  const amount = p.amount !== undefined ? int(p.amount) : left;
  if (amount > left) throw new StripeError(400, `Amount (${amount}) is greater than the amount of the transfer that can be reversed (${left}).`, { code: 'amount_too_large' });
  const id = newId('trr');
  const t = txn({ amount, type: 'transfer_refund', source: id });
  balanceOf(tr.destination).available -= amount;
  const rev = put({ id, object: 'transfer_reversal', amount, currency: 'usd', transfer: tr.id, metadata: p.metadata || {}, created: now(), balance_transaction: t.id, destination_payment_refund: null, source_refund: p._refund || null });
  tr.amount_reversed += amount;
  tr.reversed = tr.amount_reversed >= tr.amount;
  tr.reversals.data.unshift(clone(rev));
  if (fire) later(() => deliver(makeEvent('transfer.reversed', out(tr))));
  return rev;
}

function createRefund(p) {
  let ch;
  if (p.charge) ch = get(p.charge, 'charge');
  else if (p.payment_intent) {
    const pi = get(p.payment_intent, 'payment_intent');
    ch = get(pi.latest_charge, 'charge');
  } else throw new StripeError(400, 'One of the following params should be provided for this request: payment_intent or charge.', { code: 'parameter_missing' });
  const left = ch.amount - ch.amount_refunded;
  if (left <= 0) throw new StripeError(400, `Charge ${ch.id} has already been refunded.`, { code: 'charge_already_refunded' });
  const amount = p.amount !== undefined ? int(p.amount) : left;
  if (amount > left) throw new StripeError(400, `Refund amount ($${(amount / 100).toFixed(2)}) is greater than unrefunded amount on charge ($${(left / 100).toFixed(2)})`, { code: 'amount_too_large', param: 'amount' });
  const id = newId('re');
  const t = txn({ amount: -amount, type: 'refund', source: id });
  let reversalId = null;
  if (bool(p.reverse_transfer) && ch.transfer) {
    const tr = get(ch.transfer, 'transfer');
    const share = Math.min(tr.amount - tr.amount_reversed, Math.round(tr.amount * (amount / ch.amount)));
    if (share > 0) reversalId = reverseTransfer(tr.id, { amount: share, _refund: id }, { fire: false }).id;
  }
  const refund = put({ id, object: 'refund', amount, currency: 'usd', charge: ch.id, payment_intent: ch.payment_intent, status: 'succeeded', reason: p.reason || null, metadata: p.metadata || {}, created: now(), balance_transaction: t.id, transfer_reversal: reversalId });
  ch.amount_refunded += amount;
  ch.refunded = ch.amount_refunded >= ch.amount;
  ch.refunds.data.unshift(clone(refund));
  later(() => deliver(makeEvent('charge.refunded', out(ch))));
  return refund;
}

function createPayout(p, account) {
  const amount = int(p.amount);
  const b = balanceOf(account);
  if (!(amount > 0)) throw new StripeError(400, 'Invalid positive integer', { param: 'amount' });
  if (b.available < amount) throw new StripeError(400, 'You have insufficient funds in your Stripe account for this transfer. Your card balance is too low.', { code: 'balance_insufficient' });
  const id = newId('po');
  const t = txn({ amount: -amount, type: 'payout', source: id, account });
  return put({ id, object: 'payout', amount, currency: 'usd', arrival_date: now() + 2 * 86400, status: 'pending', method: p.method || 'standard', type: 'bank_account', destination: `ba_${account}`, metadata: p.metadata || {}, created: now(), balance_transaction: t.id, automatic: false, statement_descriptor: p.statement_descriptor || null, description: p.description || null, livemode: false, failure_code: null, failure_message: null, _account: account });
}

// ---- customers search ------------------------------------------------------
function matchesSearch(c, query) {
  const ors = String(query || '').split(/\s+OR\s+/i);
  return ors.some((clause) => clause.split(/\s+AND\s+/i).every((part) => {
    const m = /^\s*(metadata\[['"]([^'"]+)['"]\]|[a-z_]+)\s*(:|~)\s*['"]([^'"]*)['"]\s*$/i.exec(part);
    if (!m) return false;
    const value = m[2] ? (c.metadata || {})[m[2]] : c[m[1]];
    if (value === undefined || value === null) return false;
    return m[3] === '~' ? String(value).toLowerCase().includes(m[4].toLowerCase()) : String(value).toLowerCase() === m[4].toLowerCase();
  }));
}

// ---- router -----------------------------------------------------------------
function htmlPage(title, body) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>body{font-family:system-ui,sans-serif;background:#111;color:#eee;max-width:520px;margin:40px auto;padding:0 16px}button,a.btn{display:inline-block;background:#ff8c42;color:#111;border:0;padding:12px 18px;border-radius:8px;font-weight:700;text-decoration:none;margin:6px 6px 0 0;cursor:pointer}a.quiet{color:#aaa}code{color:#f2c14e}</style></head>
<body><p style="color:#ff8c42;font-family:monospace">FAKE STRIPE · STUDIO TAPA RIG</p>${body}</body></html>`;
}
const esc = (s) => String(s ?? '').replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
const redirect = (res, to) => {
  res.writeHead(303, { Location: to });
  res.end();
};
const fillSessionId = (url, id) => String(url || '').replace('{CHECKOUT_SESSION_ID}', id);

async function api(method, parts, params, ctx) {
  const [r0, r1, r2, r3] = parts;
  const account = ctx.account || PLATFORM;
  const ex = params.expand;

  // products / prices
  if (r0 === 'products') {
    if (!r1 && method === 'GET') return page(all('product').filter((p) => params.active === undefined || p.active === bool(params.active)), params, '/v1/products');
    if (!r1 && method === 'POST') return put({ id: newId('prod'), object: 'product', active: params.active === undefined ? true : bool(params.active), name: params.name, description: params.description || null, metadata: params.metadata || {}, created: now(), updated: now(), default_price: null, images: [], livemode: false, type: 'service', tax_code: params.tax_code || null });
    const p = get(r1, 'product');
    if (method === 'POST') Object.assign(p, { ...(params.name ? { name: params.name } : {}), ...(params.active !== undefined ? { active: bool(params.active) } : {}), metadata: { ...p.metadata, ...(params.metadata || {}) }, updated: now() });
    return out(p, ex);
  }
  if (r0 === 'prices') {
    if (!r1 && method === 'GET') {
      let list = all('price');
      if (params.active !== undefined) list = list.filter((p) => p.active === bool(params.active));
      if (params.type) list = list.filter((p) => p.type === params.type);
      if (params.product) list = list.filter((p) => p.product === params.product);
      if (params.currency) list = list.filter((p) => p.currency === params.currency);
      if (params.recurring && params.recurring.interval) list = list.filter((p) => p.recurring && p.recurring.interval === params.recurring.interval);
      const pg = page(list, params, '/v1/prices');
      return { ...pg, data: pg.data.map((p) => out(p, (ex || []).map((e) => e.replace(/^data\./, '')))) };
    }
    if (!r1 && method === 'POST') {
      const prod = params.product ? get(params.product, 'product') : null;
      return put({ id: newId('price'), object: 'price', active: true, currency: params.currency || 'usd', unit_amount: int(params.unit_amount, 0), product: prod ? prod.id : newId('prod'), recurring: params.recurring ? { interval: params.recurring.interval || 'month', interval_count: 1 } : null, type: params.recurring ? 'recurring' : 'one_time', metadata: params.metadata || {}, created: now(), livemode: false, lookup_key: params.lookup_key || null, billing_scheme: 'per_unit', tax_behavior: 'unspecified' });
    }
    return out(get(r1, 'price'), ex);
  }

  // customers
  if (r0 === 'customers') {
    if (r1 === 'search' && method === 'GET') {
      const data = all('customer').filter((c) => !c.deleted && matchesSearch(c, params.query)).slice(0, Math.min(int(params.limit, 10), 100));
      return { object: 'search_result', data: data.map((c) => out(c, (ex || []).map((e) => e.replace(/^data\./, '')))), has_more: false, next_page: null, url: '/v1/customers/search' };
    }
    if (!r1 && method === 'GET') {
      let list = all('customer').filter((c) => !c.deleted);
      if (params.email) list = list.filter((c) => (c.email || '').toLowerCase() === String(params.email).toLowerCase());
      if (params.created) list = list.filter((c) => rangeOk(c.created, params.created));
      const pg = page(list, params, '/v1/customers');
      return { ...pg, data: pg.data.map((c) => out(c, (ex || []).map((e) => e.replace(/^data\./, '')))) };
    }
    if (!r1 && method === 'POST') {
      return out(put({ id: newId('cus'), object: 'customer', email: params.email || null, name: params.name || null, description: params.description || null, metadata: params.metadata || {}, created: now(), livemode: false, balance: 0, currency: null, delinquent: false, default_source: null, invoice_settings: { default_payment_method: null }, address: null, phone: params.phone || null }), ex);
    }
    const c = objects.get(r1);
    if (!c || c.object !== 'customer') throw missing(r1);
    if (method === 'DELETE') {
      c.deleted = true;
      return { id: c.id, object: 'customer', deleted: true };
    }
    if (c.deleted) return { id: c.id, object: 'customer', deleted: true };
    if (method === 'POST' && !r2) {
      if (params.metadata !== undefined) {
        const m = { ...(c.metadata || {}) };
        for (const [k, v] of Object.entries(params.metadata || {})) {
          if (v === '' || v === null) delete m[k];
          else m[k] = String(v);
        }
        c.metadata = m;
      }
      for (const k of ['email', 'name', 'description', 'phone']) if (params[k] !== undefined) c[k] = params[k] === '' ? null : params[k];
    }
    if (r2 === 'subscriptions' && method === 'GET') return page(all('subscription').filter((s) => s.customer === c.id), params, `/v1/customers/${c.id}/subscriptions`);
    return out(c, ex);
  }

  // checkout sessions
  if (r0 === 'checkout' && r1 === 'sessions') {
    if (!r2 && method === 'POST') return out(createSession(params), ex);
    if (!r2 && method === 'GET') {
      let list = all('checkout.session');
      if (params.payment_intent) list = list.filter((s) => s.payment_intent === params.payment_intent);
      if (params.customer) list = list.filter((s) => s.customer === params.customer);
      if (params.subscription) list = list.filter((s) => s.subscription === params.subscription);
      if (params.status) list = list.filter((s) => s.status === params.status);
      const pg = page(list, params, '/v1/checkout/sessions');
      return { ...pg, data: pg.data.map((s) => out(s)) };
    }
    if (r3 === 'expire' && method === 'POST') return out(await expireSession(r2), ex);
    if (r3 === 'line_items' && method === 'GET') return virtual(get(r2, 'checkout.session'), 'line_items');
    return out(get(r2, 'checkout.session'), ex);
  }
  if (r0 === 'billing_portal' && r1 === 'sessions' && method === 'POST') {
    if (!params.customer) throw new StripeError(400, 'Missing required param: customer.', { code: 'parameter_missing', param: 'customer' });
    get(params.customer, 'customer');
    const id = newId('bps');
    return put({ id, object: 'billing_portal.session', customer: params.customer, return_url: params.return_url || null, url: `${SELF}/portal/${id}`, created: now(), livemode: false, configuration: 'bpc_rig', flow: null, locale: null });
  }

  // accounts
  if (r0 === 'account' && !r1 && method === 'GET') return out(get(account, 'account'), ex);
  if (r0 === 'account_links' && method === 'POST') {
    const acct = get(params.account, 'account');
    const q = new URLSearchParams({ return_url: params.return_url || '', refresh_url: params.refresh_url || '' });
    return { object: 'account_link', created: now(), expires_at: now() + 300, url: `${SELF}/connect/onboard/${acct.id}?${q}` };
  }
  if (r0 === 'accounts') {
    if (!r1 && method === 'GET') return page(all('account').filter((a) => a.id !== PLATFORM), params, '/v1/accounts');
    if (!r1 && method === 'POST') {
      const a = put(accountObj({ id: newId('acct'), email: params.email || null, ready: false, metadata: params.metadata || {} }));
      if (params.business_profile && params.business_profile.name) a.business_profile.name = params.business_profile.name;
      return out(a, ex);
    }
    const a = get(r1, 'account');
    if (r2 === 'login_links' && method === 'POST') return { object: 'login_link', created: now(), url: `${SELF}/connect/dashboard/${a.id}` };
    if (method === 'POST' && !r2) {
      if (params.metadata) a.metadata = { ...a.metadata, ...params.metadata };
      if (params.email !== undefined) a.email = params.email;
      if (params.settings && params.settings.payouts && params.settings.payouts.schedule) a.settings.payouts.schedule = { ...a.settings.payouts.schedule, ...params.settings.payouts.schedule };
      later(() => deliver(makeEvent('account.updated', out(a), { account: a.id })));
    }
    if (method === 'DELETE') {
      objects.delete(a.id);
      return { id: a.id, object: 'account', deleted: true };
    }
    return out(a, ex);
  }

  // subscriptions
  if (r0 === 'subscriptions') {
    if (!r1 && method === 'GET') {
      let list = all('subscription');
      if (params.customer) list = list.filter((s) => s.customer === params.customer);
      const status = params.status || 'default';
      if (status === 'default') list = list.filter((s) => s.status !== 'canceled' && s.status !== 'incomplete_expired');
      else if (status !== 'all') list = list.filter((s) => s.status === status);
      if (params.price) list = list.filter((s) => s.items.data.some((i) => i.price.id === params.price));
      const pg = page(list, params, '/v1/subscriptions');
      return { ...pg, data: pg.data.map((s) => out(s, (ex || []).map((e) => e.replace(/^data\./, '')))) };
    }
    const s = get(r1, 'subscription');
    if (method === 'POST') {
      const previous = {};
      if (params.cancel_at_period_end !== undefined) {
        previous.cancel_at_period_end = s.cancel_at_period_end;
        s.cancel_at_period_end = bool(params.cancel_at_period_end);
        s.cancel_at = s.cancel_at_period_end ? s.current_period_end : null;
      }
      if (params.metadata) {
        previous.metadata = clone(s.metadata);
        s.metadata = { ...s.metadata, ...params.metadata };
      }
      if (Array.isArray(params.items)) {
        previous.items = clone(s.items);
        for (const it of params.items) {
          const item = s.items.data.find((x) => x.id === it.id) || s.items.data[0];
          if (item && it.price) item.price = clone(get(it.price, 'price'));
        }
      }
      later(() => deliver(makeEvent('customer.subscription.updated', out(s), { previous })));
    }
    if (method === 'DELETE') {
      s.status = 'canceled';
      s.canceled_at = now();
      s.ended_at = now();
      later(() => deliver(makeEvent('customer.subscription.deleted', out(s))));
    }
    return out(s, ex);
  }

  // balance, payouts
  if (r0 === 'balance' && !r1) {
    const b = balanceOf(account);
    return { object: 'balance', livemode: false, available: [{ amount: b.available, currency: 'usd', source_types: { card: b.available } }], pending: [{ amount: b.pending, currency: 'usd', source_types: { card: b.pending } }], connect_reserved: [{ amount: 0, currency: 'usd' }] };
  }
  if (r0 === 'balance_transactions' || (r0 === 'balance' && r1 === 'history')) {
    const id = r0 === 'balance' ? r2 : r1;
    if (!id && method === 'GET') {
      let list = all('balance_transaction').filter((t) => (t._account || PLATFORM) === account);
      if (params.created) list = list.filter((t) => rangeOk(t.created, params.created));
      if (params.type) list = list.filter((t) => t.type === params.type);
      if (params.source) list = list.filter((t) => t.source === params.source);
      if (params.payout) {
        const po = objects.get(params.payout);
        list = po ? list.filter((t) => t.created <= po.created && t.type !== 'payout') : [];
      }
      const pg = page(list, params, '/v1/balance_transactions');
      return { ...pg, data: pg.data.map((t) => out(t, (ex || []).map((e) => e.replace(/^data\./, '')))) };
    }
    return out(get(id, 'balance_transaction'), ex);
  }
  if (r0 === 'payouts') {
    if (!r1 && method === 'GET') {
      let list = all('payout').filter((p) => (p._account || PLATFORM) === account);
      if (params.status) list = list.filter((p) => p.status === params.status);
      if (params.created) list = list.filter((p) => rangeOk(p.created, params.created));
      if (params.arrival_date) list = list.filter((p) => rangeOk(p.arrival_date, params.arrival_date));
      return page(list, params, '/v1/payouts');
    }
    if (!r1 && method === 'POST') return createPayout(params, account);
    const po = get(r1, 'payout');
    if (r2 === 'cancel' && method === 'POST') {
      po.status = 'canceled';
      later(() => deliver(makeEvent('payout.canceled', out(po))));
    }
    return out(po, ex);
  }

  // transfers, refunds, intents, charges
  if (r0 === 'transfers') {
    if (!r1 && method === 'GET') {
      let list = all('transfer');
      if (params.destination) list = list.filter((t) => t.destination === params.destination);
      if (params.transfer_group) list = list.filter((t) => t.transfer_group === params.transfer_group);
      return page(list, params, '/v1/transfers');
    }
    if (!r1 && method === 'POST') return out(makeTransfer(params), ex);
    if (r2 === 'reversals' && method === 'POST') return out(reverseTransfer(r1, params), ex);
    if (r2 === 'reversals' && method === 'GET') return page(get(r1, 'transfer').reversals.data, params, `/v1/transfers/${r1}/reversals`);
    const tr = get(r1, 'transfer');
    if (method === 'POST' && params.metadata) tr.metadata = { ...tr.metadata, ...params.metadata };
    return out(tr, ex);
  }
  if (r0 === 'refunds') {
    if (!r1 && method === 'POST') return out(createRefund(params), ex);
    if (!r1 && method === 'GET') {
      let list = all('refund');
      if (params.charge) list = list.filter((r) => r.charge === params.charge);
      if (params.payment_intent) list = list.filter((r) => r.payment_intent === params.payment_intent);
      return page(list, params, '/v1/refunds');
    }
    return out(get(r1, 'refund'), ex);
  }
  if (r0 === 'payment_intents') {
    if (!r1 && method === 'GET') return page(all('payment_intent').filter((p) => !params.customer || p.customer === params.customer), params, '/v1/payment_intents');
    return out(get(r1, 'payment_intent'), ex);
  }
  if (r0 === 'charges') {
    if (!r1 && method === 'GET') return page(all('charge').filter((c) => (!params.customer || c.customer === params.customer) && (!params.payment_intent || c.payment_intent === params.payment_intent)), params, '/v1/charges');
    return out(get(r1, 'charge'), ex);
  }
  if (r0 === 'invoices' && r1) return out(get(r1, 'invoice'), ex);
  // Events list, as the real one: newest first, `type` (exact, or a
  // wildcard like `invoice.*`), `types[]`, `created` ranges. The platform's
  // own events only, unless the Stripe-Account header names an account.
  if (r0 === 'events' && !r1 && method === 'GET') {
    const wanted = (t) => {
      if (params.type) return params.type.endsWith('.*') ? t.startsWith(params.type.slice(0, -1)) : t === params.type;
      if (Array.isArray(params.types)) return params.types.includes(t);
      return true;
    };
    const list = all('event').filter((e) => wanted(e.type) && rangeOk(e.created, params.created) && (ctx.account ? e.account === ctx.account : !e.account));
    const pg = page(list, params, '/v1/events');
    return { ...pg, data: pg.data.map((e) => out(e)) };
  }
  if (r0 === 'events' && r1) {
    const ev = get(r1, 'event');
    // A connected account's event is found with its Stripe-Account header only.
    if (ev.account && ev.account !== ctx.account) throw missing(r1);
    return out(ev, ex);
  }
  if (r0 === 'webhook_endpoints' && !r1 && method === 'GET') {
    return { object: 'list', has_more: false, url: '/v1/webhook_endpoints', data: [{ id: 'we_rig', object: 'webhook_endpoint', url: WEBHOOK_URL, enabled_events: ['*'], status: 'enabled', livemode: false, api_version: '2024-06-20', created: now() - 86400, description: 'The rig: every event, signed with whsec_rig' }] };
  }
  if (r0 === 'disputes' && r1) return out(get(r1, 'dispute'), ex);

  throw new StripeError(404, `Unrecognized request URL (${method}: /v1/${parts.join('/')}). The rig's fake Stripe does not implement it.`);
}

async function hooks(req, res, url, parts, body) {
  const [, a, b, c] = parts;
  if (a === 'state') return sendJson(res, 200, { objects: [...objects.values()].map((o) => out(o)), balances: Object.fromEntries(balances), deliveries });
  if (a === 'reset' && req.method === 'POST') {
    seed();
    return sendJson(res, 200, { ok: true });
  }
  if (a === 'checkout' && c === 'complete') return sendJson(res, 200, await completeSession(b));
  if (a === 'checkout' && c === 'expire') {
    const s = await expireSession(b, { fire: false });
    return sendJson(res, 200, { session: out(s), delivery: await deliver(makeEvent('checkout.session.expired', out(s))) });
  }
  if (a === 'accounts' && c === 'ready') {
    const acct = get(b, 'account');
    Object.assign(acct, accountObj({ id: acct.id, email: acct.email, ready: true, name: acct.business_profile.name, metadata: acct.metadata }));
    return sendJson(res, 200, { account: out(acct), delivery: await deliver(makeEvent('account.updated', out(acct), { account: acct.id })) });
  }
  if (a === 'payouts' && (c === 'paid' || c === 'failed')) {
    const po = get(b, 'payout');
    po.status = c;
    if (c === 'failed') {
      po.failure_code = 'account_closed';
      balanceOf(po._account || PLATFORM).available += po.amount;
    }
    return sendJson(res, 200, { payout: out(po), delivery: await deliver(makeEvent(`payout.${c}`, out(po), { account: po._account && po._account !== PLATFORM ? po._account : null })) });
  }
  if (a === 'dispute') {
    const ch = get(body.charge, 'charge');
    const phase = body.phase || 'created';
    let dp = all('dispute').find((d) => d.charge === ch.id);
    if (!dp) dp = put({ id: newId('dp'), object: 'dispute', amount: ch.amount - ch.amount_refunded, currency: 'usd', charge: ch.id, payment_intent: ch.payment_intent, reason: body.reason || 'fraudulent', status: 'needs_response', created: now(), livemode: false, metadata: {}, balance_transactions: [] });
    if (phase === 'created') {
      ch.disputed = true;
      txn({ amount: -dp.amount, fee: 1500, type: 'adjustment', source: dp.id, description: 'Chargeback withdrawal' });
      return sendJson(res, 200, { dispute: out(dp), delivery: await deliver(makeEvent('charge.dispute.created', out(dp))) });
    }
    dp.status = phase === 'won' ? 'won' : 'lost';
    if (phase === 'won') txn({ amount: dp.amount, type: 'adjustment', source: dp.id, description: 'Chargeback reversal' });
    return sendJson(res, 200, { dispute: out(dp), delivery: await deliver(makeEvent('charge.dispute.closed', out(dp))) });
  }
  if (a === 'event' && req.method === 'POST') {
    if (!body.type) return sendJson(res, 400, { error: 'type is required' });
    const obj = body.objectId ? out(get(body.objectId)) : body.object || (body.data && body.data.object) || {};
    const ev = makeEvent(body.type, obj, { account: body.account || null, previous: body.previous || null });
    // `ageMinutes` dates the event back (Stripe's `created`); `deliver: false`
    // keeps it in the events list without sending it — a delivery Stripe
    // never got through (the app's daily catch-up finds it there).
    if (Number(body.ageMinutes) > 0) ev.created = now() - Math.round(Number(body.ageMinutes) * 60);
    if (body.deliver === false || body.deliver === 'false') return sendJson(res, 200, { event: out(ev), delivery: null });
    return sendJson(res, 200, { event: out(ev), delivery: await deliver(ev) });
  }
  // A check's cleanup: its events leave the events list (the app's daily
  // catch-up would otherwise find, an hour later, invoices whose rows the
  // check deleted, and record them again). { ids: [...] } or { invoices:
  // [...] } (every event about those invoices) or { all: true }.
  if (a === 'events' && b === 'forget' && req.method === 'POST') {
    const ids = new Set(Array.isArray(body.ids) ? body.ids : []);
    const invs = new Set(Array.isArray(body.invoices) ? body.invoices : []);
    let forgotten = 0;
    for (const e of all('event')) {
      const about = e.data && e.data.object ? e.data.object.id : null;
      if (body.all === true || body.all === 'true' || ids.has(e.id) || (about && invs.has(about))) {
        objects.delete(e.id);
        forgotten += 1;
      }
    }
    return sendJson(res, 200, { ok: true, forgotten });
  }
  // A subscription renews: a paid invoice (billing_reason subscription_cycle)
  // with its charge, and invoice.paid. `deliver: false` leaves the event
  // undelivered; `ageMinutes` dates the invoice, its payment and the event
  // back.
  if (a === 'subscriptions' && c === 'renew' && req.method === 'POST') {
    const s = get(b, 'subscription');
    const ageSecs = Number(body.ageMinutes) > 0 ? Math.round(Number(body.ageMinutes) * 60) : 0;
    const at = now() - ageSecs;
    const item = s.items.data[0];
    const amount = item ? item.price.unit_amount * (item.quantity || 1) : 0;
    const cust = objects.get(s.customer);
    const pi = charge({ amount, customer: s.customer, email: cust ? cust.email : null, description: 'Subscription update' });
    const invId = newId('in');
    const inv = put({
      id: invId, object: 'invoice', customer: s.customer, customer_email: cust ? cust.email : null, subscription: s.id, status: 'paid', paid: true, amount_due: amount, amount_paid: amount, amount_remaining: 0, currency: 'usd',
      billing_reason: 'subscription_cycle', charge: pi.latest_charge, payment_intent: pi.id, created: at, period_start: at, period_end: at, livemode: false,
      status_transitions: { paid_at: at, finalized_at: at },
      subscription_details: { metadata: s.metadata },
      parent: { type: 'subscription_details', subscription_details: { subscription: s.id, metadata: s.metadata } },
      lines: { object: 'list', data: s.items.data.map((it) => ({ id: newId('il'), object: 'line_item', amount: it.price.unit_amount * (it.quantity || 1), currency: 'usd', price: clone(it.price), quantity: it.quantity, period: { start: at, end: at + 30 * 86400 }, subscription: s.id, type: 'subscription' })), has_more: false }
    });
    s.latest_invoice = invId;
    const ev = makeEvent('invoice.paid', out(inv));
    ev.created = at;
    const send = !(body.deliver === false || body.deliver === 'false');
    return sendJson(res, 200, { invoice: out(inv), event: out(ev), delivery: send ? await deliver(ev) : null });
  }
  return sendJson(res, 404, { error: `no hook ${url.pathname}` });
}

async function pages(req, res, url, parts) {
  const [kind, id, action] = parts;
  if (kind === 'checkout') {
    const s = objects.get(id);
    if (!s || s.object !== 'checkout.session') return sendText(res, 404, htmlPage('Not found', '<h1>No such Checkout Session</h1>'), 'text/html; charset=utf-8');
    if (action === 'pay' && req.method === 'POST') {
      if (s.status === 'open') await completeSession(id);
      return redirect(res, fillSessionId(s.success_url, id));
    }
    if (action === 'cancel') return redirect(res, fillSessionId(s.cancel_url || s.success_url, id));
    const lines = (s._line_items || []).map((li) => `<li>${esc(li.description || li.price.id)} × ${li.quantity} — $${(li.amount_total / 100).toFixed(2)}</li>`).join('');
    return sendText(res, 200, htmlPage('Checkout', `<h1>Checkout (${esc(s.mode)})</h1><p>Status: <code>${esc(s.status)}</code> · metadata.type: <code>${esc(s.metadata.type || '—')}</code></p><ul>${lines}</ul>
<p><strong>Total $${(s.amount_total / 100).toFixed(2)}</strong></p>
${s.status === 'open' ? `<form method="post" action="/checkout/${esc(id)}/pay"><button type="submit" id="pay">Pay</button><a class="btn quiet" href="/checkout/${esc(id)}/cancel" id="cancel">Cancel</a></form>` : `<p><a class="btn" href="${esc(fillSessionId(s.success_url, id))}">Back to the site</a></p>`}`), 'text/html; charset=utf-8');
  }
  if (kind === 'portal') {
    const ps = objects.get(id);
    if (!ps) return sendText(res, 404, htmlPage('Not found', '<h1>No such portal session</h1>'), 'text/html; charset=utf-8');
    const subs = all('subscription').filter((s) => s.customer === ps.customer && s.status !== 'canceled');
    if (action === 'cancel' && req.method === 'POST') {
      for (const s of subs) {
        s.cancel_at_period_end = true;
        s.cancel_at = s.current_period_end;
        await deliver(makeEvent('customer.subscription.updated', out(s), { previous: { cancel_at_period_end: false } }));
      }
      return redirect(res, ps.return_url || '/');
    }
    return sendText(res, 200, htmlPage('Billing portal', `<h1>Billing portal</h1><p>Customer <code>${esc(ps.customer)}</code> · ${subs.length} subscription(s)</p>
<form method="post" action="/portal/${esc(id)}/cancel"><button type="submit">Cancel at period end</button></form><p><a class="btn" href="${esc(ps.return_url || '/')}">Return to the site</a></p>`), 'text/html; charset=utf-8');
  }
  if (kind === 'connect' && id === 'onboard') {
    const acctId = action;
    const acct = objects.get(acctId);
    if (!acct) return sendText(res, 404, htmlPage('Not found', '<h1>No such account</h1>'), 'text/html; charset=utf-8');
    if (req.method === 'POST') {
      Object.assign(acct, accountObj({ id: acct.id, email: acct.email, ready: true, name: acct.business_profile.name, metadata: acct.metadata }));
      await deliver(makeEvent('account.updated', out(acct), { account: acct.id }));
      return redirect(res, url.searchParams.get('return_url') || '/');
    }
    return sendText(res, 200, htmlPage('Payouts onboarding', `<h1>Express onboarding</h1><p>Account <code>${esc(acctId)}</code>, ${acct.charges_enabled ? 'ready' : 'not ready yet'}.</p>
<form method="post" action="/connect/onboard/${esc(acctId)}?${esc(url.searchParams.toString())}"><button type="submit">Finish onboarding</button></form>
<p><a class="quiet" href="${esc(url.searchParams.get('refresh_url') || '/')}">Leave</a></p>`), 'text/html; charset=utf-8');
  }
  if (kind === 'connect' && id === 'dashboard') return sendText(res, 200, htmlPage('Express dashboard', `<h1>Express dashboard</h1><p>Account <code>${esc(action)}</code>. Nothing to do here in the rig.</p>`), 'text/html; charset=utf-8');
  return sendText(res, 404, htmlPage('Not found', '<h1>Not found</h1>'), 'text/html; charset=utf-8');
}

seed();

const server = http.createServer(async (req, res) => {
  const started = Date.now();
  res.on('finish', () => logLine('stripe', `${req.method} ${req.url.slice(0, 300)} ${res.statusCode} ${Date.now() - started}ms`));
  try {
    const url = new URL(req.url, 'http://local');
    const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    const raw = req.method === 'GET' || req.method === 'HEAD' ? '' : (await readBody(req)).toString('utf8');
    if (url.pathname === '/__health') return sendJson(res, 200, { ok: true });
    if (parts[0] && parts[0].startsWith('__')) {
      parts[0] = parts[0].slice(2);
      let body = {};
      try { body = raw ? JSON.parse(raw) : {}; } catch (e) { body = parseForm(raw); }
      return await hooks(req, res, url, ['', ...parts], body);
    }
    if (parts[0] !== 'v1') return await pages(req, res, url, parts);

    const auth = String(req.headers.authorization || '');
    const key = auth.startsWith('Bearer ') ? auth.slice(7) : auth.startsWith('Basic ') ? Buffer.from(auth.slice(6), 'base64').toString('utf8').split(':')[0] : '';
    if (key !== FAKE_KEYS.stripeSecret) {
      throw new StripeError(401, `Invalid API Key provided: ${key ? `${key.slice(0, 8)}…` : '(none)'} — the rig's fake Stripe takes ${FAKE_KEYS.stripeSecret}.`, { type: 'invalid_request_error' });
    }
    const params = req.method === 'GET' || req.method === 'DELETE' ? parseForm(url.search.slice(1)) : parseForm(raw);
    const idem = req.headers['idempotency-key'];
    const idemKey = idem && req.method === 'POST' ? `${url.pathname} ${idem}` : null;
    if (idemKey && idempotency.has(idemKey)) {
      const hit = idempotency.get(idemKey);
      return sendJson(res, hit.status, hit.body, { 'Idempotent-Replayed': 'true', 'Request-Id': `req_${rand(14)}` });
    }
    const ctx = { account: req.headers['stripe-account'] || null };
    let status = 200;
    let body;
    try {
      body = await api(req.method, parts.slice(1), params, ctx);
    } catch (err) {
      if (!(err instanceof StripeError)) throw err;
      status = err.status;
      body = err.body;
    }
    if (idemKey && status < 500) idempotency.set(idemKey, { status, body });
    return sendJson(res, status, body, { 'Request-Id': `req_${rand(14)}`, 'Stripe-Version': '2024-06-20' });
  } catch (err) {
    if (err instanceof StripeError) return sendJson(res, err.status, err.body);
    console.error('fake stripe error:', err);
    return sendJson(res, 500, { error: { type: 'api_error', message: err.message } });
  }
});

await listen(server, PORTS.stripe, HOST, 'fake Stripe');
