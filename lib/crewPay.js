import { getStripe, isStripeConfigured } from './stripe';
import { getSupabase } from './supabase';
import { getPayoutAccount, isPayoutReady } from './creatorPayouts';
import { getPublicProfilesByIds } from './userProfiles';
import { getUserEmail } from './messages';
import { notifyCreator, sendEmail } from './notify';
import { accountAgeDays } from './accountAge';
import { updateCompat } from './dbCompat';
import { SITE } from './siteConfig';
import { crewPayQuote, payDollars, MIN_CREW_PAY_CENTS, MAX_CREW_PAY_CENTS, DEFAULT_CREW_PAY_CUT_PERCENT, CREW_PAY_STATUS, releaseHoldDays, holdUntilFrom, holdActive, holdLabel } from './crewPayRules';

// Crew pay through Stripe (migration 110): "pay secured" on a paid call.
//
// The poster funds one booked person at a time through Checkout. The
// charge lands in Studio Tapa's own balance (no destination on the
// payment), the row goes to `held`, and when the poster — or an admin
// settling a quiet poster — confirms the person worked, the rate is
// transferred to the worker's Connect account (creator_payout_accounts,
// the same one backers and hosts use). No account yet: the row waits
// with release_requested_at set and the account.updated webhook releases
// it the moment they're ready. "Didn't happen" refunds the poster in
// full; unbooking (or "cancelled") refunds everything but the card fee.
//
// Security round 2 (2026-10-28, migration 114): this was the one money
// path with no review on either side and a release the poster alone
// controlled — two fresh accounts could turn a stolen card into a Connect
// payout in two days and leave the chargeback with the studio. So:
//   - the Checkout asks for 3-D Secure (the bank authenticates the
//     cardholder; a fraud dispute on an authenticated payment is the
//     issuer's, not the studio's);
//   - a confirmed job between accounts new to the site, or a worker's
//     first payout through it, waits RELEASE_HOLD_DAYS (lib/crewPayRules.js)
//     before the transfer — the daily cron releases what is due;
//   - a release or a refund claims the row before calling Stripe, so the
//     two can't both move money when they race;
//   - a transfer is only ever tied to the poster's charge, never a plain
//     transfer out of the studio's own balance;
//   - a paid Checkout whose row was already cancelled is refunded, not
//     swallowed; a released transfer reversed in the Dashboard is recorded.
//
// Nothing here imports lib/crewCalls.js — it calls in here from
// setBooking / setOutcome — so this stays cycle-free.

export class CrewPayError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
const fail = (message, status = 400) => { throw new CrewPayError(message, status); };

export function isMissingPayTable(error) {
  if (!error) return false;
  if (error.code === 'PGRST205' || error.code === '42P01') return true;
  return /could not find the table|relation "?crew_payments|crew_pay_cut_percent|pay_secured|pay_rate_cents/i.test(error.message || '');
}

const esc = (s) => String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nowIso = () => new Date().toISOString();
const idOf = (v) => (typeof v === 'string' ? v : v && v.id ? v.id : null);

// The studio's service fee on crew pay (site_settings.crew_pay_cut_percent).
export async function getCrewPayCutPercent() {
  const { data, error } = await getSupabase().from('site_settings').select('crew_pay_cut_percent').eq('id', 1).maybeSingle();
  if (error || !data || data.crew_pay_cut_percent == null) return DEFAULT_CREW_PAY_CUT_PERCENT;
  const n = Number(data.crew_pay_cut_percent);
  return Number.isFinite(n) ? n : DEFAULT_CREW_PAY_CUT_PERCENT;
}

// A rate typed as dollars (or sent as cents) → cents within the limits.
export function cleanRateCents(input, { required = false } = {}) {
  const dollars = input && typeof input === 'object' ? null : input;
  let cents = null;
  if (input && typeof input === 'object' && input.cents != null) cents = Math.round(Number(input.cents));
  else if (dollars !== '' && dollars != null) cents = Math.round(Number(String(dollars).replace(/[$,\s]/g, '')) * 100);
  if (cents == null || !Number.isFinite(cents)) {
    if (required) fail('Say the rate per person for the job (dollars).');
    return null;
  }
  if (cents < MIN_CREW_PAY_CENTS) fail(`Secured pay starts at ${payDollars(MIN_CREW_PAY_CENTS)} per person.`);
  if (cents > MAX_CREW_PAY_CENTS) fail(`Secured pay tops out at ${payDollars(MAX_CREW_PAY_CENTS)} per person — for more, split the job into calls.`);
  return cents;
}

function toPayment(row) {
  if (!row) return null;
  return {
    id: row.id,
    callId: row.call_id,
    responseId: row.response_id,
    posterId: row.poster_id,
    workerId: row.worker_id,
    amountCents: row.amount_cents,
    cutPercent: Number(row.cut_percent) || 0,
    cutCents: row.platform_cut_cents || 0,
    feeCents: row.fee_cover_cents || 0,
    totalCents: row.total_charged_cents,
    status: row.status,
    statusLabel: CREW_PAY_STATUS[row.status] || row.status,
    paidAt: row.paid_at || null,
    releaseRequestedAt: row.release_requested_at || null,
    releasedAt: row.released_at || null,
    refundedAt: row.refunded_at || null,
    refundedCents: row.refunded_cents == null ? null : row.refunded_cents,
    refundReason: row.refund_reason || null,
    failedReason: row.failed_reason || null,
    // A chargeback from the poster's bank (migration 113): open / won / lost.
    disputeStatus: row.dispute_status || null,
    // The release hold (migration 114): when it lifts, and the chip's words.
    holdUntil: row.hold_until || null,
    holdLabel: holdActive(row.hold_until) ? holdLabel(row.hold_until) : null,
    // A released transfer reversed in the Dashboard (migration 114).
    reversedCents: row.reversed_cents == null ? null : row.reversed_cents,
    reversedAt: row.reversed_at || null,
    createdAt: row.created_at
  };
}

// The columns migration 114 added; a database without them keeps working
// (lib/dbCompat.js retries a write without them).
const COLUMNS_114 = ['hold_until', 'claim', 'claimed_at', 'reversed_cents', 'reversed_at'];
const mentions114 = (error) => Boolean(error && COLUMNS_114.some((c) => (error.message || '').includes(c)));

const LIVE = ['pending_payment', 'held', 'disputed', 'released'];

// { responseId: payment } for a call — the live row for each response,
// else its most recent one (so a refund still shows). Empty before the
// migration or when Stripe isn't configured.
export async function paymentsForCall(callId) {
  const { data, error } = await getSupabase().from('crew_payments').select('*').eq('call_id', callId).order('created_at', { ascending: false });
  if (error) {
    if (isMissingPayTable(error)) return {};
    throw new Error(error.message);
  }
  const out = {};
  for (const row of data || []) {
    const cur = out[row.response_id];
    if (!cur || (!LIVE.includes(cur.status) && LIVE.includes(row.status))) out[row.response_id] = toPayment(row);
  }
  return out;
}

export async function payoutReadyFor(userId) {
  try {
    return isPayoutReady(await getPayoutAccount(userId));
  } catch (err) {
    return false;
  }
}

async function loadCallAndResponse(callId, responseId) {
  const supabase = getSupabase();
  const [{ data: call, error: e1 }, { data: resp, error: e2 }] = await Promise.all([
    supabase.from('crew_calls').select('*').eq('id', callId).maybeSingle(),
    supabase.from('crew_responses').select('*').eq('id', responseId).eq('call_id', callId).maybeSingle()
  ]);
  if (e1) throw new Error(e1.message);
  if (e2) throw new Error(e2.message);
  if (!call) fail('That call isn’t here.', 404);
  if (!resp) fail('That response isn’t here.', 404);
  return { call, resp };
}

async function liveRowFor(responseId) {
  const { data, error } = await getSupabase().from('crew_payments').select('*').eq('response_id', responseId).in('status', LIVE).order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (error) {
    if (isMissingPayTable(error)) return null;
    throw new Error(error.message);
  }
  return data || null;
}

/* ---------- the poster funds a booked person ---------- */

export async function createCrewPayCheckout({ posterId, posterEmail, callId, responseId, origin }) {
  if (!posterId) fail('Sign in first.', 401);
  if (!isStripeConfigured()) fail('Payments aren’t switched on for this site yet.', 503);
  const { call, resp } = await loadCallAndResponse(callId, responseId);
  if (call.poster_id !== posterId) fail('Only the poster can fund this.', 403);
  if (!call.pay_secured || !call.pay_rate_cents) fail('This call was posted without secured pay — post a new call with it switched on to fund people through the site.');
  if (resp.status !== 'booked') fail('Book them first — pay is secured for booked people.');
  if (resp.outcome && resp.outcome !== 'worked') fail('That job is settled.');
  if (resp.user_id === posterId) fail('That’s you.');

  const existing = await liveRowFor(responseId);
  if (existing && existing.status === 'held') fail(`Already funded — ${payDollars(existing.amount_cents)} is held until you confirm the job.`, 409);
  if (existing && existing.status === 'released') fail('Already paid out.', 409);
  const stripe = getStripe();
  if (existing && existing.status === 'pending_payment') {
    // A Checkout they walked away from: close it so it can't pay twice.
    if (existing.stripe_checkout_session_id) await stripe.checkout.sessions.expire(existing.stripe_checkout_session_id).catch(() => null);
    await getSupabase().from('crew_payments').update({ status: 'cancelled', failed_reason: 'replaced by a new checkout', updated_at: nowIso() }).eq('id', existing.id);
  }

  const cutPercent = await getCrewPayCutPercent();
  const q = crewPayQuote(call.pay_rate_cents, cutPercent);
  const supabase = getSupabase();
  const { data: row, error } = await supabase.from('crew_payments').insert({
    call_id: call.id,
    response_id: resp.id,
    poster_id: posterId,
    worker_id: resp.user_id,
    amount_cents: q.amountCents,
    cut_percent: q.cutPercent,
    platform_cut_cents: q.cutCents,
    fee_cover_cents: q.feeCents,
    total_charged_cents: q.totalCents,
    status: 'pending_payment'
  }).select('*').single();
  if (error) {
    if (isMissingPayTable(error)) fail('Secured pay isn’t set up yet — the admin needs to run migration 110.', 503);
    if (error.code === '23505') fail('A payment for this person is already in progress.', 409);
    throw new Error(error.message);
  }

  const profiles = await getPublicProfilesByIds([resp.user_id]);
  const workerName = profiles[resp.user_id] ? profiles[resp.user_id].displayName : 'the crew member';
  const metadata = { type: 'crew_pay', payment_id: row.id, call_id: call.id, response_id: resp.id, poster_id: posterId, worker_id: resp.user_id, amount_cents: String(q.amountCents), cut_percent: String(q.cutPercent) };
  const back = `${origin}/crew/calls/${call.id}`;
  let session;
  try {
    session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      submit_type: 'pay',
      customer_email: posterEmail || undefined,
      line_items: [{
        quantity: 1,
        price_data: {
          currency: 'usd',
          unit_amount: q.totalCents,
          product_data: {
            name: `Pay secured: ${workerName} · ${call.role} on ${call.title}`.slice(0, 120),
            description: `${payDollars(q.amountCents)} to ${workerName} + ${payDollars(q.cutCents)} ${SITE.name} service fee + ${payDollars(q.feeCents)} card processing. Held until you confirm the job.`.slice(0, 300)
          }
        }
      }],
      payment_intent_data: {
        // No destination: the money sits in the studio's balance until the
        // job is confirmed, then goes out as a transfer (releaseRow).
        transfer_group: `crew-pay-${row.id}`,
        description: `Crew pay held for ${workerName} · ${call.title} · ${SITE.name}`.slice(0, 200),
        metadata
      },
      // The bank authenticates the cardholder wherever it can (security
      // round 2): up to $20,000 a job, held for days before it moves.
      payment_method_options: { card: { request_three_d_secure: 'any' } },
      metadata,
      success_url: `${back}?funded=${row.id}`,
      cancel_url: `${back}?funded=cancelled`
    });
  } catch (err) {
    await supabase.from('crew_payments').update({ status: 'failed', failed_reason: `checkout not created: ${err.message}`.slice(0, 300), updated_at: nowIso() }).eq('id', row.id);
    throw new Error(`Stripe couldn’t start the payment: ${err.message}`);
  }
  await supabase.from('crew_payments').update({ stripe_checkout_session_id: session.id, updated_at: nowIso() }).eq('id', row.id);
  return { url: session.url, paymentId: row.id, quote: q };
}

/* ---------- Stripe tells us it was paid ---------- */

async function chargeIdFor(stripe, paymentIntentId) {
  if (!paymentIntentId) return null;
  try {
    const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
    return idOf(pi.latest_charge) || (pi.charges && pi.charges.data && pi.charges.data[0] ? pi.charges.data[0].id : null);
  } catch (err) {
    return null;
  }
}

// A Checkout paid after its row had moved on (the poster opened a second
// one, or unbooked / settled the job while the page sat open): the money
// goes straight back rather than sitting in the balance with no row to
// claim it (security round 2; bookings do the same).
async function refundStrayCrewPayment(session, row) {
  const pi = idOf(session.payment_intent);
  if (pi) {
    await getStripe().refunds.create(
      { payment_intent: pi, metadata: { type: 'crew_pay', payment_id: row.id, reason: 'paid after the payment was cancelled or replaced' } },
      { idempotencyKey: `crew-pay-stray-${session.id}` }
    );
  }
  const amount = Number.isFinite(session.amount_total) ? payDollars(session.amount_total) : 'Your payment';
  await notifyCreator({ userId: row.poster_id, type: 'crew_pay_refunded', message: `${amount} was refunded in full: that payment went through after the booking had changed. Refunds take 5–10 business days to show.`, href: `/crew/calls/${row.call_id}` });
  console.warn(`crew pay ${row.id}: refunded stray payment ${pi} (row was ${row.status})`);
  return { refunded: true, stray: true, id: row.id };
}

export async function completeCrewPayFromSession(session) {
  const supabase = getSupabase();
  const meta = session.metadata || {};
  let { data: row } = await supabase.from('crew_payments').select('*').eq('stripe_checkout_session_id', session.id).maybeSingle();
  if (!row && meta.payment_id) ({ data: row } = await supabase.from('crew_payments').select('*').eq('id', meta.payment_id).maybeSingle());
  if (!row) throw new Error(`crew pay session ${session.id} has no row`);
  const pi = idOf(session.payment_intent);
  if (row.status !== 'pending_payment') {
    // The same payment delivered twice: nothing to do. A different one
    // for a row that already moved on is a second charge: refund it.
    if (!pi || row.stripe_payment_intent_id === pi) return { duplicate: true, id: row.id };
    return refundStrayCrewPayment(session, row);
  }
  const chargeId = await chargeIdFor(getStripe(), pi);
  const patch = {
    status: 'held',
    paid_at: nowIso(),
    stripe_payment_intent_id: pi,
    stripe_charge_id: chargeId,
    stripe_checkout_session_id: session.id,
    total_charged_cents: Number.isFinite(session.amount_total) ? session.amount_total : row.total_charged_cents,
    updated_at: nowIso()
  };
  const { data: held, error } = await supabase.from('crew_payments').update(patch).eq('id', row.id).eq('status', 'pending_payment').select('*').maybeSingle();
  if (error) throw new Error(error.message);
  if (!held) return { duplicate: true, id: row.id };

  const { data: call } = await supabase.from('crew_calls').select('id, title, role').eq('id', held.call_id).maybeSingle();
  const { data: resp } = await supabase.from('crew_responses').select('outcome').eq('id', held.response_id).maybeSingle();
  const profiles = await getPublicProfilesByIds([held.poster_id, held.worker_id]);
  const posterName = profiles[held.poster_id] ? profiles[held.poster_id].displayName : 'The poster';
  const title = call ? call.title : 'the call';
  const ready = await payoutReadyFor(held.worker_id);

  // Funded after the job was already confirmed: pay out right away.
  if (resp && resp.outcome === 'worked') {
    await releaseRow(held, { call });
    return { id: held.id, released: true };
  }

  await notifyCreator({ userId: held.worker_id, type: 'crew_pay_held', message: `${posterName} secured your pay for ${title}: ${payDollars(held.amount_cents)} is held by ${SITE.name} and released to you when they confirm you worked.${ready ? '' : ' Set up payouts on your working card so it has somewhere to go.'}`, href: ready ? `/crew/calls/${held.call_id}` : '/crew/card' });
  const to = await getUserEmail(held.worker_id);
  if (to) {
    await sendEmail({
      to,
      subject: `Your pay is secured: ${title}`,
      html: `<p>${esc(posterName)} secured <b>${payDollars(held.amount_cents)}</b> for your work as <b>${esc(call ? call.role : '')}</b> on <b>${esc(title)}</b>. ${esc(SITE.name)} holds it and releases it to your payout account when they confirm you worked the job.</p>${ready ? '' : `<p>You don’t have a payout account yet — <a href="${SITE.productionDomain}/crew/card">set one up on your working card</a> (a few minutes with Stripe) so the money has somewhere to go.</p>`}<p><a href="${SITE.productionDomain}/crew/calls/${held.call_id}">Open the call</a></p>`
    }).catch((err) => console.error('crew pay email failed:', err.message));
  }
  return { id: held.id };
}

// A Checkout the poster walked away from (checkout.session.expired).
export async function failCrewPayFromSession(session, reason) {
  const supabase = getSupabase();
  const meta = session.metadata || {};
  let { data: row, error } = await supabase.from('crew_payments').select('id, status').eq('stripe_checkout_session_id', session.id).maybeSingle();
  if (error) {
    if (isMissingPayTable(error)) return { ignored: true };
    throw new Error(error.message);
  }
  if (!row && meta.payment_id) ({ data: row } = await supabase.from('crew_payments').select('id, status').eq('id', meta.payment_id).maybeSingle());
  if (!row || row.status !== 'pending_payment') return { ignored: true };
  await supabase.from('crew_payments').update({ status: 'cancelled', failed_reason: String(reason || 'checkout expired').slice(0, 300), updated_at: nowIso() }).eq('id', row.id).eq('status', 'pending_payment');
  return { id: row.id };
}

/* ---------- release to the worker ---------- */

// Claim a held row for one Stripe call (a release or a refund), so two
// of them racing can't both move money. A claim older than ten minutes
// belongs to a call that died and may be taken over. Before migration 114
// (no claim column) a compare-and-swap on updated_at does the same job.
const CLAIM_STALE_MS = 10 * 60 * 1000;
async function claimRow(row, kind) {
  const supabase = getSupabase();
  const stale = new Date(Date.now() - CLAIM_STALE_MS).toISOString();
  const { data, error } = await supabase.from('crew_payments')
    .update({ claim: kind, claimed_at: nowIso(), updated_at: nowIso() })
    .eq('id', row.id).eq('status', 'held')
    .or(`claim.is.null,claimed_at.lt.${stale}`)
    .select('*').maybeSingle();
  if (!error) return data || null;
  if (!mentions114(error)) throw new Error(error.message);
  const { data: swapped, error: e2 } = await supabase.from('crew_payments')
    .update({ updated_at: nowIso() })
    .eq('id', row.id).eq('status', 'held').eq('updated_at', row.updated_at)
    .select('*').maybeSingle();
  if (e2) throw new Error(e2.message);
  return swapped || null;
}

async function releaseClaim(id, patch = {}) {
  const res = await updateCompat(getSupabase(), 'crew_payments', { claim: null, claimed_at: null, updated_at: nowIso(), ...patch }, ['claim', 'claimed_at'], (q) => q.eq('id', id));
  if (res.error) console.error('crew pay: could not release the claim:', res.error.message);
}

// How long a confirmed job waits before the transfer (lib/crewPayRules.js).
async function holdDaysFor(row) {
  const [posterAgeDays, workerAgeDays, paidBefore] = await Promise.all([
    accountAgeDays(row.poster_id).catch(() => null),
    accountAgeDays(row.worker_id).catch(() => null),
    getSupabase().from('crew_payments').select('id', { count: 'exact', head: true }).eq('worker_id', row.worker_id).eq('status', 'released').then((r) => (r.error ? false : (r.count || 0) > 0), () => false)
  ]);
  return releaseHoldDays({ posterAgeDays, workerAgeDays, workerPaidBefore: paidBefore });
}

const fmtDay = (iso) => new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric' });

// Transfer the rate to the worker's Connect account. Three things can
// make it wait: the release hold (a young account or a first payout),
// no payout account yet (mark it wanted and tell them; the
// account.updated webhook comes back here through releasePendingCrewPay),
// and a claim another call holds.
async function releaseRow(row, { call = null, actorId = null } = {}) {
  const supabase = getSupabase();
  if (row.status !== 'held') return { skipped: row.status };
  if (!call) ({ data: call } = await supabase.from('crew_calls').select('id, title, role').eq('id', row.call_id).maybeSingle());
  const title = call ? call.title : 'the call';

  // 1. The hold (migration 114).
  if (holdActive(row.hold_until)) return { waiting: true, holdUntil: row.hold_until, id: row.id };
  if (!row.hold_until) {
    const days = await holdDaysFor(row);
    if (days > 0) {
      const until = holdUntilFrom(new Date(), days);
      const { error } = await supabase.from('crew_payments').update({ hold_until: until, updated_at: nowIso() }).eq('id', row.id).eq('status', 'held');
      if (error && !mentions114(error)) throw new Error(error.message);
      if (!error) {
        await notifyCreator({ userId: row.worker_id, type: 'crew_pay_hold', message: `${payDollars(row.amount_cents)} for ${title} is yours and releases on ${fmtDay(until)}. Pay between accounts new to ${SITE.name}, or a first payout through the site, waits ${days} days before it moves — the same for everyone.`, href: '/crew/card' });
        if (actorId && actorId !== row.poster_id) {
          await notifyCreator({ userId: row.poster_id, type: 'crew_pay_hold', message: `The ${payDollars(row.amount_cents)} you secured for ${title} releases to the crew member on ${fmtDay(until)}.`, href: `/crew/calls/${row.call_id}` });
        }
        return { waiting: true, holdUntil: until, id: row.id };
      }
      // Before migration 114 there is no column to hold on: release as before.
    }
  }

  // 2. Somewhere for it to go.
  const account = await getPayoutAccount(row.worker_id).catch(() => null);
  if (!isPayoutReady(account)) {
    if (!row.release_requested_at) {
      await supabase.from('crew_payments').update({ release_requested_at: nowIso(), updated_at: nowIso() }).eq('id', row.id);
      await notifyCreator({ userId: row.worker_id, type: 'crew_pay_setup', message: `${payDollars(row.amount_cents)} for ${title} is yours — set up payouts on your working card and ${SITE.name} sends it the moment Stripe has your details.`, href: '/crew/card' });
      const to = await getUserEmail(row.worker_id);
      if (to) {
        await sendEmail({
          to,
          subject: `${payDollars(row.amount_cents)} is waiting for you: ${title}`,
          html: `<p>The job on <b>${esc(title)}</b> was confirmed and <b>${payDollars(row.amount_cents)}</b> is yours. It needs somewhere to go: <a href="${SITE.productionDomain}/crew/card">set up payouts on your working card</a> (Stripe, a few minutes) and ${esc(SITE.name)} sends it as soon as your account is ready.</p>`
        }).catch((err) => console.error('crew pay email failed:', err.message));
      }
    }
    return { waiting: true, id: row.id };
  }

  // 3. The claim, then the transfer — tied to the poster's charge so it
  // can go out before the funds settle and never out of the studio's own
  // money (the plain-transfer fallback is gone: a charge that has less
  // on it than the rate, after a partial Dashboard refund say, now fails
  // here and waits for an admin instead of being topped up).
  const claimed = await claimRow(row, 'release');
  if (!claimed) return { busy: true, id: row.id };
  if (!row.stripe_charge_id) {
    await releaseClaim(row.id, { release_requested_at: row.release_requested_at || nowIso(), failed_reason: 'transfer failed: the payment has no charge to draw on' });
    return { error: 'no charge to draw on', id: row.id };
  }
  const stripe = getStripe();
  let transfer;
  try {
    transfer = await stripe.transfers.create({
      amount: row.amount_cents,
      currency: 'usd',
      destination: account.stripeAccountId,
      source_transaction: row.stripe_charge_id,
      transfer_group: `crew-pay-${row.id}`,
      description: `Crew pay · ${title}`.slice(0, 200),
      metadata: { type: 'crew_pay', payment_id: row.id, call_id: row.call_id, response_id: row.response_id, worker_id: row.worker_id, poster_id: row.poster_id }
    }, { idempotencyKey: `crew-pay-release-${row.id}` });
  } catch (err) {
    await releaseClaim(row.id, { release_requested_at: row.release_requested_at || nowIso(), failed_reason: `transfer failed: ${err.message}`.slice(0, 300) });
    console.error('crew pay transfer failed:', err.message);
    return { error: err.message, id: row.id };
  }
  const { data: done, error } = await updateCompat(supabase, 'crew_payments', { status: 'released', released_at: nowIso(), stripe_transfer_id: transfer.id, failed_reason: null, claim: null, claimed_at: null, updated_at: nowIso() }, ['claim', 'claimed_at'], (q) => q.eq('id', row.id).eq('status', 'held').select('*').maybeSingle());
  if (error) throw new Error(error.message);
  if (done) {
    await notifyCreator({ userId: row.worker_id, type: 'crew_pay_released', message: `${payDollars(row.amount_cents)} for ${title} is on its way to your payout account. Payouts land on Stripe’s schedule (usually 2 business days).`, href: '/crew/card' });
    const to = await getUserEmail(row.worker_id);
    if (to) {
      await sendEmail({
        to,
        subject: `Paid: ${payDollars(row.amount_cents)} for ${title}`,
        html: `<p><b>${payDollars(row.amount_cents)}</b> for your work on <b>${esc(title)}</b> has been sent to your payout account. It arrives on your Stripe payout schedule — see <a href="${SITE.productionDomain}/crew/card">your working card</a> for the balance and the next payout.</p>`
      }).catch((err) => console.error('crew pay email failed:', err.message));
    }
    if (actorId && actorId !== row.poster_id) {
      await notifyCreator({ userId: row.poster_id, type: 'crew_pay_released', message: `The ${payDollars(row.amount_cents)} you secured for ${title} was released to the crew member.`, href: `/crew/calls/${row.call_id}` });
    }
  }
  return { id: row.id, released: Boolean(done), amountCents: row.amount_cents };
}

// A worker's account just became ready (account.updated): send whatever
// confirmed jobs have been waiting on it.
export async function releasePendingCrewPay(userId) {
  if (!userId) return { released: 0 };
  const { data, error } = await getSupabase().from('crew_payments').select('*').eq('worker_id', userId).eq('status', 'held').not('release_requested_at', 'is', null);
  if (error) {
    if (isMissingPayTable(error)) return { released: 0 };
    throw new Error(error.message);
  }
  let released = 0;
  for (const row of data || []) {
    const r = await releaseRow(row);
    if (r.released) released += 1;
  }
  return { released };
}

// The daily cron (pages/api/cron/creator-reminders.js): every confirmed
// job whose hold has lifted. Before migration 114 there is nothing to do.
export async function releaseDueCrewPay({ now = new Date() } = {}) {
  const { data, error } = await getSupabase().from('crew_payments').select('*').eq('status', 'held').not('hold_until', 'is', null).lte('hold_until', now.toISOString()).limit(200);
  if (error) {
    if (isMissingPayTable(error) || mentions114(error)) return { released: 0, waiting: 0, skipped: 'migration 114 not run' };
    throw new Error(error.message);
  }
  let released = 0;
  let waiting = 0;
  for (const row of data || []) {
    const r = await releaseRow(row);
    if (r.released) released += 1;
    else waiting += 1;
  }
  return { released, waiting, due: (data || []).length };
}

/* ---------- refunds ---------- */

async function refundRow(row, { cents, reason, by }) {
  const supabase = getSupabase();
  if (row.status !== 'held') return { skipped: row.status };
  const amount = Math.max(0, Math.min(row.total_charged_cents, Math.round(cents)));
  if (amount > 0 && !row.stripe_payment_intent_id) fail('This payment has no Stripe charge to refund.');
  const claimed = await claimRow(row, 'refund');
  if (!claimed) fail('This payment is being settled right now — try again in a moment.', 409);
  let refund = null;
  if (amount > 0) {
    try {
      refund = await getStripe().refunds.create(
        { payment_intent: row.stripe_payment_intent_id, amount, metadata: { type: 'crew_pay', payment_id: row.id, reason: String(reason || '').slice(0, 200) } },
        { idempotencyKey: `crew-pay-refund-${row.id}` }
      );
    } catch (err) {
      await releaseClaim(row.id);
      throw err;
    }
  }
  const { data: done, error } = await updateCompat(supabase, 'crew_payments', { status: 'refunded', refunded_at: nowIso(), refunded_cents: amount, refund_reason: String(reason || '').slice(0, 300), stripe_refund_id: refund ? refund.id : null, claim: null, claimed_at: null, updated_at: nowIso() }, ['claim', 'claimed_at'], (q) => q.eq('id', row.id).eq('status', 'held').select('*').maybeSingle());
  if (error) throw new Error(error.message);
  if (done) {
    const { data: call } = await supabase.from('crew_calls').select('title').eq('id', row.call_id).maybeSingle();
    const title = call ? call.title : 'the call';
    await notifyCreator({ userId: row.poster_id, type: 'crew_pay_refunded', message: `${payDollars(amount)} of the pay you secured for ${title} is going back to your card (${reason}). Refunds take 5–10 business days to show.`, href: `/crew/calls/${row.call_id}` });
    await notifyCreator({ userId: row.worker_id, type: 'crew_pay_refunded', message: `The pay secured for you on ${title} was returned to the poster (${reason}).`, href: `/crew/calls/${row.call_id}` });
  }
  return { id: row.id, refundedCents: amount, by };
}

// setOutcome → here. worked: release · no_show: full refund · cancelled:
// refund minus the card fee (the poster called it off).
export async function settleCrewPay(responseId, outcome, { actorId = null } = {}) {
  const row = await liveRowFor(responseId);
  if (!row) return { none: true };
  if (row.status === 'pending_payment') {
    // Never paid; close the door on that checkout unless they can still pay (worked).
    if (outcome !== 'worked') {
      if (row.stripe_checkout_session_id) await getStripe().checkout.sessions.expire(row.stripe_checkout_session_id).catch(() => null);
      await getSupabase().from('crew_payments').update({ status: 'cancelled', failed_reason: `job ${outcome}`, updated_at: nowIso() }).eq('id', row.id).eq('status', 'pending_payment');
    }
    return { cancelled: outcome !== 'worked' };
  }
  if (row.status !== 'held') return { skipped: row.status };
  if (outcome === 'worked') return releaseRow(row, { actorId });
  if (outcome === 'no_show') return refundRow(row, { cents: row.total_charged_cents, reason: 'the job didn’t happen', by: actorId });
  return refundRow(row, { cents: row.total_charged_cents - row.fee_cover_cents, reason: 'the booking was cancelled', by: actorId });
}

// setBooking('unbook') → here: a funded person dropped from the job.
export async function onUnbookCrewPay(responseId, { actorId = null } = {}) {
  return settleCrewPay(responseId, 'cancelled', { actorId });
}

// Admin: give it back (full by default), or push a waiting release again.
export async function adminRefundCrewPay(paymentId, { reason, adminId }) {
  const { data: row, error } = await getSupabase().from('crew_payments').select('*').eq('id', paymentId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!row) fail('That payment isn’t here.', 404);
  if (row.status !== 'held') fail(`Only held payments can be refunded here (this one is ${CREW_PAY_STATUS[row.status] || row.status}). A released one is reversed from the Stripe dashboard.`);
  return refundRow(row, { cents: row.total_charged_cents, reason: reason || 'refunded by the studio', by: adminId });
}

export async function adminReleaseCrewPay(paymentId, { adminId }) {
  const { data: row, error } = await getSupabase().from('crew_payments').select('*').eq('id', paymentId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!row) fail('That payment isn’t here.', 404);
  if (row.status !== 'held') fail(`This payment is ${CREW_PAY_STATUS[row.status] || row.status}.`);
  const { data: resp } = await getSupabase().from('crew_responses').select('outcome').eq('id', row.response_id).maybeSingle();
  if (!resp || resp.outcome !== 'worked') fail('Settle the job as "worked" first — releasing pays the worker.');
  return releaseRow(row, { actorId: adminId });
}

// A refund made from the Stripe dashboard (charge.refunded). A full one
// closes the row; a partial one on a held row is recorded and the studio
// told — the release will not top the difference up from the studio's
// balance (see releaseRow), so the admin settles it by hand.
export async function refundCrewPayFromCharge(charge) {
  const pi = idOf(charge.payment_intent);
  if (!pi) return { ignored: true };
  const partial = Number(charge.amount_refunded) || 0;
  if (!charge.refunded && partial <= 0) return { ignored: true };
  const supabase = getSupabase();
  const { data: row, error } = await supabase.from('crew_payments').select('id, status, call_id, poster_id, worker_id, amount_cents, total_charged_cents, refunded_cents').eq('stripe_payment_intent_id', pi).maybeSingle();
  if (error) {
    if (isMissingPayTable(error)) return { ignored: true };
    throw new Error(error.message);
  }
  if (!row) return { ignored: true };
  if (row.status !== 'held') return { duplicate: true, id: row.id };
  if (!charge.refunded) {
    if ((row.refunded_cents || 0) >= partial) return { duplicate: true, id: row.id };
    const { error: e3 } = await supabase.from('crew_payments').update({ refunded_cents: partial, refund_reason: 'partly refunded in Stripe', updated_at: nowIso() }).eq('id', row.id).eq('status', 'held');
    if (e3) throw new Error(e3.message);
    const title = await supabase.from('crew_calls').select('title').eq('id', row.call_id).maybeSingle().then((r) => (r.data ? r.data.title : 'a call'));
    await sendEmail({ to: process.env.STUDIO_MONEY_NOTIFY_EMAIL || SITE.contactEmail, subject: `Held crew pay partly refunded: ${payDollars(partial)} on “${title}”`, html: `<p>${payDollars(partial)} of the ${payDollars(row.total_charged_cents)} charge securing ${payDollars(row.amount_cents)} for a crew member on <strong>${esc(title)}</strong> was refunded from the Stripe Dashboard while the pay was still held. The release will not draw more than is left on the charge, so settle this one by hand on <a href="${SITE.productionDomain}/admin/crew">Crew admin</a> (refund the rest, or reverse the refund).</p>` }).catch(() => null);
    return { id: row.id, partial: true };
  }
  const { error: e2 } = await supabase.from('crew_payments').update({ status: 'refunded', refunded_at: nowIso(), refunded_cents: charge.amount_refunded || row.total_charged_cents, refund_reason: 'refunded in Stripe', updated_at: nowIso() }).eq('id', row.id).eq('status', 'held');
  if (e2) throw new Error(e2.message);
  return { id: row.id };
}

// A released transfer reversed in the Stripe Dashboard (transfer.reversed;
// the documented remedy when a bank rules for the poster after the worker
// was paid). Recorded on the row — nothing else moves — and both sides told.
export async function syncCrewPayReversal(transfer) {
  if (!transfer || !transfer.id) return { skipped: 'no transfer' };
  const supabase = getSupabase();
  const { data: row, error } = await supabase.from('crew_payments').select('id, status, call_id, poster_id, worker_id, amount_cents, reversed_cents').eq('stripe_transfer_id', transfer.id).maybeSingle();
  if (error) {
    if (isMissingPayTable(error) || mentions114(error)) return { skipped: 'migration 114 not run' };
    throw new Error(error.message);
  }
  if (!row) return { skipped: 'not a crew payment' };
  const reversed = Math.max(0, Math.round(Number(transfer.amount_reversed) || 0));
  const before = Math.max(0, Number(row.reversed_cents) || 0);
  const delta = reversed - before;
  if (delta <= 0) return { duplicate: true, id: row.id };
  // Claim the amount first, so a replayed event can't record it twice.
  const q = supabase.from('crew_payments').update({ reversed_cents: reversed, reversed_at: nowIso(), updated_at: nowIso() }).eq('id', row.id);
  const { data: claimed, error: e2 } = await (before > 0 ? q.eq('reversed_cents', before) : q.or('reversed_cents.is.null,reversed_cents.eq.0')).select('id');
  if (e2) throw new Error(e2.message);
  if (!claimed || claimed.length === 0) return { duplicate: true, id: row.id };
  const title = await supabase.from('crew_calls').select('title').eq('id', row.call_id).maybeSingle().then((r) => (r.data ? r.data.title : 'a call'));
  await notifyCreator({ userId: row.worker_id, type: 'crew_pay_reversed', message: `${payDollars(delta)} of the pay sent to you for ${title} was taken back by ${SITE.name} after the poster’s bank ruled for them. Write to ${SITE.contactEmail} if you think that’s wrong.`, href: '/crew/card' });
  await sendEmail({ to: process.env.STUDIO_MONEY_NOTIFY_EMAIL || SITE.contactEmail, subject: `Crew pay transfer reversed: ${payDollars(delta)} on “${title}”`, html: `<p>${payDollars(delta)} of the ${payDollars(row.amount_cents)} released for a crew member on <strong>${esc(title)}</strong> came back from their account (transfer ${esc(transfer.id)} reversed in the Stripe Dashboard). It is recorded on the payment and counted in Studio money’s crew-pay lane.</p>` }).catch(() => null);
  return { id: row.id, reversedCents: delta };
}

/* ---------- lists ---------- */

// Admin (/admin/crew): every payment that's live or recently closed, with
// who's who and the call.
export async function listCrewPaymentsForAdmin({ limit = 120 } = {}) {
  const supabase = getSupabase();
  const { data, error } = await supabase.from('crew_payments').select('*').order('created_at', { ascending: false }).limit(limit);
  if (error) {
    if (isMissingPayTable(error)) return { payments: [], ready: false };
    throw new Error(error.message);
  }
  const rows = data || [];
  const callIds = [...new Set(rows.map((r) => r.call_id))];
  const userIds = [...new Set(rows.flatMap((r) => [r.poster_id, r.worker_id]))];
  const [calls, profiles, responses] = await Promise.all([
    callIds.length ? supabase.from('crew_calls').select('id, title, role, ends_on').in('id', callIds) : Promise.resolve({ data: [] }),
    getPublicProfilesByIds(userIds),
    rows.length ? supabase.from('crew_responses').select('id, outcome').in('id', rows.map((r) => r.response_id)) : Promise.resolve({ data: [] })
  ]);
  const callBy = Object.fromEntries((calls.data || []).map((c) => [c.id, c]));
  const outcomeBy = Object.fromEntries((responses.data || []).map((r) => [r.id, r.outcome]));
  const who = (id) => ({ userId: id, displayName: profiles[id] ? profiles[id].displayName : 'Someone', profilePath: profiles[id] ? `/profile/${profiles[id].handle || id}` : `/profile/${id}` });
  const payments = rows.map((r) => ({ ...toPayment(r), call: callBy[r.call_id] ? { id: r.call_id, title: callBy[r.call_id].title, role: callBy[r.call_id].role, endsOn: callBy[r.call_id].ends_on } : { id: r.call_id, title: 'Removed call', role: '', endsOn: null }, outcome: outcomeBy[r.response_id] || null, poster: who(r.poster_id), worker: who(r.worker_id) }));
  const heldCents = payments.filter((p) => p.status === 'held').reduce((n, p) => n + p.amountCents, 0);
  const cutCents = payments.filter((p) => p.status === 'held' || p.status === 'released').reduce((n, p) => n + p.cutCents, 0);
  return { payments, ready: true, heldCents, cutCents, waiting: payments.filter((p) => p.status === 'held' && (p.releaseRequestedAt || p.holdLabel)).length };
}

// The worker's own secured pay, for the Get paid card on /crew/card.
export async function listMyCrewPay(userId) {
  if (!userId) return [];
  const supabase = getSupabase();
  const { data, error } = await supabase.from('crew_payments').select('*').eq('worker_id', userId).in('status', ['held', 'released']).order('created_at', { ascending: false }).limit(30);
  if (error) {
    if (isMissingPayTable(error)) return [];
    throw new Error(error.message);
  }
  const rows = data || [];
  const callIds = [...new Set(rows.map((r) => r.call_id))];
  const calls = callIds.length ? await supabase.from('crew_calls').select('id, title, role').in('id', callIds) : { data: [] };
  const callBy = Object.fromEntries((calls.data || []).map((c) => [c.id, c]));
  return rows.map((r) => ({ ...toPayment(r), call: callBy[r.call_id] ? { id: r.call_id, title: callBy[r.call_id].title, role: callBy[r.call_id].role } : { id: r.call_id, title: 'Removed call', role: '' } }));
}

// Does this person have any reason to see the Payouts card: a crew card,
// or secured pay with their name on it.
export async function hasCrewPayInterest(userId) {
  if (!userId) return false;
  const { count, error } = await getSupabase().from('crew_payments').select('id', { count: 'exact', head: true }).eq('worker_id', userId).in('status', ['held', 'released']);
  if (error) return false;
  return (count || 0) > 0;
}
