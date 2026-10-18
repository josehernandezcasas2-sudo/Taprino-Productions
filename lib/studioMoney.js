import { getSupabase } from './supabase';
import { getStripe, isStripeConfigured } from './stripe';
import { getOwedByCreator } from './creatorShareBatch';
import { recordAudit } from './auditLog';
import { sendEmail } from './notify';
import { SITE } from './siteConfig';
import {
  adsServedCents, canLeaveCents, dollars, groupTransactions, isSweepDay, nextSweepDate, normalizeSettings, reconcile,
  reserveCents, studioShare, sweepGate, taxThresholds, toleranceCents
} from './studioMoneyRules';

// Studio money (/admin/money, migration 089): the studio's own sweeps
// from the platform's Stripe balance to the bank. The rules are in
// lib/studioMoneyRules.js; this file reads Stripe and our tables, builds
// the page, and moves the money. `deps.stripe` lets a local run inject a
// fake Stripe client.

const DAY = 86400000;
const nowIso = () => new Date().toISOString();
const unix = (iso) => Math.floor(new Date(iso).getTime() / 1000);
const int = (n) => Math.round(Number(n) || 0);

export class StudioMoneyError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function isMissingTable(error) {
  return Boolean(error) && (error.code === 'PGRST205' || error.code === '42P01' || /could not find the table|relation .* does not exist/i.test(error.message || ''));
}
function isMissingColumn(error) {
  return Boolean(error) && (error.code === '42703' || error.code === 'PGRST204' || /column .* does not exist|could not find the .* column/i.test(error.message || ''));
}

// --- settings ------------------------------------------------------------

export async function getStudioSettings() {
  const { data, error } = await getSupabase()
    .from('site_settings')
    .select('studio_sweep_day, studio_sweep_mode, studio_reserve_percent, studio_reserve_days, studio_reserve_floor_cents, studio_tolerance_cents, studio_tolerance_percent')
    .eq('id', 1)
    .maybeSingle();
  if (error) {
    if (!isMissingColumn(error) && !isMissingTable(error)) console.error('getStudioSettings error:', error.message);
    return { ...normalizeSettings({}), migrated: false };
  }
  const d = data || {};
  return {
    ...normalizeSettings({
      sweepDay: d.studio_sweep_day,
      sweepMode: d.studio_sweep_mode,
      reservePercent: d.studio_reserve_percent,
      reserveDays: d.studio_reserve_days,
      reserveFloorCents: d.studio_reserve_floor_cents,
      toleranceCents: d.studio_tolerance_cents,
      tolerancePercent: d.studio_tolerance_percent
    }),
    migrated: true
  };
}

export async function saveStudioSettings(patch, { adminId, adminEmail } = {}) {
  const current = await getStudioSettings();
  const next = normalizeSettings({ ...current, ...(patch || {}) });
  const { error } = await getSupabase().from('site_settings').update({
    studio_sweep_day: next.sweepDay,
    studio_sweep_mode: next.sweepMode,
    studio_reserve_percent: next.reservePercent,
    studio_reserve_days: next.reserveDays,
    studio_reserve_floor_cents: next.reserveFloorCents,
    studio_tolerance_cents: next.toleranceCents,
    studio_tolerance_percent: next.tolerancePercent
  }).eq('id', 1);
  if (error) throw new StudioMoneyError(isMissingColumn(error) ? 'Run migration 089 first.' : error.message, 500);
  await recordAudit({ adminId, adminEmail, action: 'studio_money_settings', targetType: 'site_settings', targetId: '1', details: `sweep day ${next.sweepDay} · ${next.sweepMode} · reserve ${next.reservePercent}% of ${next.reserveDays} days, floor ${dollars(next.reserveFloorCents)} · tolerance ${dollars(next.toleranceCents)} / ${next.tolerancePercent}%` });
  return next;
}

// --- Stripe ----------------------------------------------------------------

function stripeClient(deps) {
  if (deps && deps.stripe) return deps.stripe;
  if (!isStripeConfigured()) return null;
  return getStripe();
}

const usd = (list) => (list || []).filter((x) => x.currency === 'usd').reduce((s, x) => s + int(x.amount), 0);
const dateOfUnix = (u) => (u ? new Date(u * 1000).toISOString().slice(0, 10) : null);

async function readStripe(stripe) {
  if (!stripe) return { configured: false, ok: false, availableCents: 0, pendingCents: 0, scheduleInterval: null, recentPayouts: [] };
  try {
    const [balance, account, payouts] = await Promise.all([
      stripe.balance.retrieve(),
      stripe.accounts.retrieve().catch(() => null),
      stripe.payouts.list({ limit: 10 }).catch(() => ({ data: [] }))
    ]);
    const schedule = account && account.settings && account.settings.payouts && account.settings.payouts.schedule;
    return {
      configured: true,
      ok: true,
      availableCents: usd(balance.available),
      pendingCents: usd(balance.pending),
      scheduleInterval: schedule ? schedule.interval || null : null,
      recentPayouts: (payouts.data || []).map((p) => ({
        id: p.id, cents: int(p.amount), status: p.status, arrivalOn: dateOfUnix(p.arrival_date), createdAt: new Date((p.created || 0) * 1000).toISOString(), automatic: Boolean(p.automatic)
      }))
    };
  } catch (err) {
    console.error('studio money: Stripe read failed:', err.message);
    return { configured: true, ok: false, error: err.message, availableCents: 0, pendingCents: 0, scheduleInterval: null, recentPayouts: [] };
  }
}

// Every balance transaction in the window, with its source expanded so a
// charge can be matched to our rows. Paged; bounded so one page load
// can't run away.
const MAX_PAGES = 40;
async function listBalanceTransactions(stripe, sinceIso, untilIso) {
  const out = [];
  let startingAfter;
  let capped = false;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const params = { created: { gte: unix(sinceIso), lt: unix(untilIso) }, limit: 100, expand: ['data.source'] };
    if (startingAfter) params.starting_after = startingAfter;
    const res = await stripe.balanceTransactions.list(params);
    out.push(...(res.data || []));
    if (!res.has_more || !res.data || res.data.length === 0) break;
    startingAfter = res.data[res.data.length - 1].id;
    if (page === MAX_PAGES - 1) capped = true;
  }
  return { txns: out, capped };
}

// --- our tables -----------------------------------------------------------

async function rows(table, build) {
  let q = getSupabase().from(table);
  q = build(q);
  const { data, error } = await q;
  if (error) {
    if (isMissingTable(error) || isMissingColumn(error)) return [];
    throw new Error(`${table}: ${error.message}`);
  }
  return data || [];
}

const inWindow = (iso, since, until) => Boolean(iso) && iso >= since && iso < until;

// Everything our tables say happened in [since, until), shaped for the
// rules, plus the Stripe ids to match transactions by (looked up a little
// wider than the window so a charge that settled just before it still
// matches its row).
async function collectRecords(since, until, { excludeSweepId = null } = {}) {
  const wide = new Date(new Date(since).getTime() - 3 * DAY).toISOString();
  const [payments, donations, bookings, adBuys, payouts, sweeps, ledger] = await Promise.all([
    rows('member_payments', (q) => q.select('id, amount_cents, stripe_charge_id, status, paid_at, reversed_at, reverse_reason').gte('paid_at', wide).lt('paid_at', until).limit(5000)),
    rows('pitch_donations', (q) => q.select('id, amount_cents, platform_cut_cents, creator_payout_cents, fee_cover_cents, total_charged_cents, stripe_charge_id, status, completed_at, refunded_at').gte('completed_at', wide).lt('completed_at', until).limit(5000)),
    rows('location_requests', (q) => q.select('id, platform_cut_cents, host_payout_cents, fee_cover_cents, total_charged_cents, subtotal_cents, cleaning_cents, stripe_payment_intent_id, status, paid_at, refunded_at, refund_cents').gte('paid_at', wide).lt('paid_at', until).limit(5000)),
    rows('ad_credit_purchases', (q) => q.select('id, amount_cents, stripe_checkout_session_id, stripe_payment_intent_id, created_at').gte('created_at', wide).lt('created_at', until).limit(5000)),
    rows('creator_payouts', (q) => q.select('id, cents, status, stripe_transfer_id, paid_at, created_at').gte('created_at', wide).lt('created_at', until).limit(5000)),
    rows('studio_sweeps', (q) => q.select('id, cents, status, stripe_payout_id, created_at').gte('created_at', wide).lt('created_at', until).limit(500)),
    rows('creator_ledger', (q) => q.select('kind, cents, created_at').eq('lane', 'earnings').gte('created_at', since).lt('created_at', until).limit(10000))
  ]);
  // Reversals carry their own timestamp, so refunds of older payments
  // still land in this window.
  const reversedPayments = await rows('member_payments', (q) => q.select('id, amount_cents, reversed_at, reverse_reason').eq('status', 'reversed').gte('reversed_at', since).lt('reversed_at', until).limit(5000));
  const refundedDonations = await rows('pitch_donations', (q) => q.select('id, creator_payout_cents, total_charged_cents, refunded_at').eq('status', 'refunded').gte('refunded_at', since).lt('refunded_at', until).limit(5000));
  // Payouts reversed in this window, whenever they were made (migration
  // 092); before it the column doesn't exist and this reads nothing.
  const reversedPayouts = await rows('creator_payouts', (q) => q.select('id, reversed_cents, reversed_at, stripe_transfer_id').gt('reversed_cents', 0).gte('reversed_at', since).lt('reversed_at', until).limit(5000));
  const refundedBookings = await rows('location_requests', (q) => q.select('id, platform_cut_cents, fee_cover_cents, total_charged_cents, subtotal_cents, cleaning_cents, refund_cents, refunded_at').gte('refunded_at', since).lt('refunded_at', until).limit(5000));

  const ids = {
    membershipCharges: new Set(payments.map((p) => p.stripe_charge_id).filter(Boolean)),
    backingCharges: new Set(donations.map((d) => d.stripe_charge_id).filter(Boolean)),
    bookingIntents: new Set(bookings.map((b) => b.stripe_payment_intent_id).filter(Boolean)),
    adCreditIntents: new Set(adBuys.flatMap((a) => [a.stripe_payment_intent_id, a.stripe_checkout_session_id]).filter(Boolean)),
    creatorTransfers: new Set([...payouts, ...reversedPayouts].map((p) => p.stripe_transfer_id).filter(Boolean)),
    sweepPayouts: new Set(sweeps.map((s) => s.stripe_payout_id).filter(Boolean))
  };

  const memberIn = payments.filter((p) => inWindow(p.paid_at, since, until));
  const donationsIn = donations.filter((d) => inWindow(d.completed_at, since, until) && ['completed', 'refunded'].includes(d.status));
  const bookingsIn = bookings.filter((b) => inWindow(b.paid_at, since, until) && ['paid', 'done', 'refunded'].includes(b.status));
  const adBuysIn = adBuys.filter((a) => inWindow(a.created_at, since, until));
  const batchIn = payouts.filter((p) => p.status === 'paid' && inWindow(p.paid_at || p.created_at, since, until));
  // The sweep that opened this window was made a moment after its own
  // period closed, so it is excluded by id rather than by time.
  const sweepsIn = sweeps.filter((s) => s.id !== excludeSweepId && inWindow(s.created_at, since, until) && !['failed', 'canceled'].includes(s.status));

  const isDispute = (r) => /disput/i.test(r.reverse_reason || '');
  const refundedMembers = reversedPayments.filter((r) => !isDispute(r));
  const disputedMembers = reversedPayments.filter(isDispute);
  const DISPUTE_FEE = 1500;
  // A booking refund's cost to the studio: the whole cut and cover on a
  // full refund, otherwise the cut's share of what went back.
  const bookingLoss = (b) => {
    const base = int(b.subtotal_cents) + int(b.cleaning_cents);
    const refund = int(b.refund_cents);
    if (base <= 0 || refund <= 0) return 0;
    if (refund >= base) return int(b.platform_cut_cents) + int(b.fee_cover_cents);
    return Math.round(refund * int(b.platform_cut_cents) / base);
  };

  const records = {
    memberships: { count: memberIn.length, grossCents: memberIn.reduce((s, p) => s + int(p.amount_cents), 0), amounts: memberIn.map((p) => int(p.amount_cents)) },
    backing: {
      count: donationsIn.length,
      pledgeCents: donationsIn.reduce((s, d) => s + int(d.amount_cents), 0),
      cutCents: donationsIn.reduce((s, d) => s + int(d.platform_cut_cents), 0),
      coverCents: donationsIn.reduce((s, d) => s + int(d.fee_cover_cents), 0)
    },
    bookings: {
      count: bookingsIn.length,
      cutCents: bookingsIn.reduce((s, b) => s + int(b.platform_cut_cents), 0),
      coverCents: bookingsIn.reduce((s, b) => s + int(b.fee_cover_cents), 0)
    },
    adCredits: { count: adBuysIn.length, grossCents: adBuysIn.reduce((s, a) => s + int(a.amount_cents), 0), amounts: adBuysIn.map((a) => int(a.amount_cents)) },
    creatorBatch: { count: batchIn.length, cents: batchIn.reduce((s, p) => s + int(p.cents), 0) - reversedPayouts.reduce((s, p) => s + int(p.reversed_cents), 0) },
    refunds: {
      count: refundedMembers.length + refundedDonations.length + refundedBookings.length,
      cents: refundedMembers.reduce((s, r) => s + int(r.amount_cents), 0)
        + refundedDonations.reduce((s, d) => s + (int(d.total_charged_cents) - int(d.creator_payout_cents)), 0)
        + refundedBookings.reduce((s, b) => s + bookingLoss(b), 0)
    },
    disputes: { count: disputedMembers.length, cents: disputedMembers.reduce((s, r) => s + int(r.amount_cents) + DISPUTE_FEE, 0) },
    sweeps: { count: sweepsIn.length, cents: sweepsIn.reduce((s, x) => s + int(x.cents), 0) }
  };

  const credited = ledger.filter((l) => ['member_share', 'referral', 'ad_share', 'adjustment'].includes(l.kind) && int(l.cents) > 0).reduce((s, l) => s + int(l.cents), 0);
  const reversedCredit = -ledger.filter((l) => l.kind === 'reversal').reduce((s, l) => s + int(l.cents), 0);
  return {
    records,
    ids,
    creditedCents: credited,
    reversedCreditCents: Math.max(0, reversedCredit),
    membershipRefundedCents: refundedMembers.reduce((s, r) => s + int(r.amount_cents), 0),
    pendingCreatorPayouts: payouts.filter((p) => p.status === 'pending').length
  };
}

async function sumColumn(table, column, build) {
  const list = await rows(table, (q) => build(q.select(column)));
  return list.reduce((s, r) => s + int(r[column]), 0);
}

// Card volume over the reserve window, from our tables (every lane's
// gross as charged).
async function recentVolumeCents(days) {
  const since = new Date(Date.now() - days * DAY).toISOString();
  const [m, d, b, a] = await Promise.all([
    sumColumn('member_payments', 'amount_cents', (q) => q.gte('paid_at', since).limit(10000)),
    sumColumn('pitch_donations', 'total_charged_cents', (q) => q.in('status', ['completed', 'refunded']).gte('completed_at', since).limit(10000)),
    sumColumn('location_requests', 'total_charged_cents', (q) => q.in('status', ['paid', 'done', 'refunded']).gte('paid_at', since).limit(10000)),
    sumColumn('ad_credit_purchases', 'amount_cents', (q) => q.gte('created_at', since).limit(10000))
  ]);
  return m + d + b + a;
}

async function lastSweep() {
  const list = await rows('studio_sweeps', (q) => q.select('*').in('status', ['pending', 'in_transit', 'paid']).order('created_at', { ascending: false }).limit(1));
  return list[0] || null;
}

const sweepOut = (s) => ({
  id: s.id,
  cents: int(s.cents),
  status: s.status,
  payoutId: s.stripe_payout_id || null,
  failedReason: s.failed_reason || null,
  periodFrom: s.period_from || null,
  periodTo: s.period_to || null,
  discrepancyCents: int(s.discrepancy_cents),
  note: s.note || null,
  createdBy: s.created_by || null,
  createdAt: s.created_at,
  arrivalOn: s.arrival_on || null,
  paidAt: s.paid_at || null
});

// --- the page --------------------------------------------------------------

export async function getMoneyPage({ deps = {}, now = new Date() } = {}) {
  const settings = await getStudioSettings();
  // The tables arrive with migration 089; before it the page says so.
  const probe = await getSupabase().from('studio_sweeps').select('id').limit(1);
  const available = !(probe.error && isMissingTable(probe.error));

  const stripe = stripeClient(deps);
  const last = available ? await lastSweep() : null;
  const since = last ? (last.period_to || last.created_at) : new Date(now.getTime() - 30 * DAY).toISOString();
  const until = now.toISOString();

  const [stripeState, collected, owedList, adCreditsCents, volumeCents, earmarkRows, explanationRows, historyRows, yearPayouts] = await Promise.all([
    readStripe(stripe),
    collectRecords(since, until, { excludeSweepId: last ? last.id : null }),
    getOwedByCreator(),
    sumColumn('ad_accounts', 'credit_balance_cents', (q) => q.limit(10000)),
    recentVolumeCents(settings.reserveDays),
    available ? rows('studio_earmarks', (q) => q.select('*').is('released_at', null).order('created_at', { ascending: true })) : [],
    available ? rows('studio_adjustments', (q) => q.select('*').is('sweep_id', null).order('created_at', { ascending: true })) : [],
    available ? rows('studio_sweeps', (q) => q.select('*').order('created_at', { ascending: false }).limit(24)) : [],
    rows('creator_payouts', (q) => q.select('creator_id, cents').eq('status', 'paid').gte('paid_at', `${now.getUTCFullYear()}-01-01T00:00:00Z`).limit(10000))
  ]);

  let txns = [];
  let capped = false;
  if (stripe && stripeState.ok) {
    try {
      ({ txns, capped } = await listBalanceTransactions(stripe, since, until));
      // The payout of the sweep that opened this window belongs to the
      // period before it.
      if (last && last.stripe_payout_id) txns = txns.filter((t) => (t.source && typeof t.source === 'object' ? t.source.id : t.source) !== last.stripe_payout_id);
    } catch (err) {
      console.error('studio money: balance transactions failed:', err.message);
      stripeState.ok = false;
      stripeState.error = err.message;
    }
  }

  const owedCents = owedList.reduce((s, o) => s + Math.max(0, int(o.cents)), 0);
  const reserve = reserveCents({ volumeCents, percent: settings.reservePercent, floorCents: settings.reserveFloorCents });
  const earmarks = earmarkRows.map((e) => ({ id: e.id, label: e.label, cents: int(e.cents), note: e.note || null, createdBy: e.created_by || null, createdAt: e.created_at }));
  const earmarkCents = earmarks.reduce((s, e) => s + e.cents, 0);
  const canLeave = canLeaveCents({ availableCents: stripeState.availableCents, owedCents, adCreditsCents, reserveCents: reserve, earmarkCents });

  const grouped = groupTransactions(txns, collected.ids);
  const explanations = explanationRows.map((x) => ({ id: x.id, cents: int(x.cents), explanation: x.explanation, createdBy: x.created_by || null, createdAt: x.created_at }));
  const explainedCents = explanations.reduce((s, x) => s + x.cents, 0);
  const tolerance = toleranceCents({ periodGrossCents: grouped.grossChargedCents, fixedCents: settings.toleranceCents, percent: settings.tolerancePercent });
  const rec = reconcile({ lanes: grouped.lanes, records: collected.records, explainedCents, toleranceCents: tolerance });

  const lastLiability = last && last.breakdown && last.breakdown.obligations ? int(last.breakdown.obligations.adCreditsCents) : 0;
  const share = studioShare({
    membershipGrossCents: collected.records.memberships.grossCents,
    membershipFeeCents: grouped.lanes.memberships.count > 0 ? grouped.lanes.memberships.feeCents : Math.round(collected.records.memberships.grossCents * 0.029 + 30 * collected.records.memberships.count),
    creditedCents: collected.creditedCents,
    reversedCreditCents: collected.reversedCreditCents,
    refundedCents: collected.membershipRefundedCents,
    disputeCents: collected.records.disputes.cents,
    backingKeptCents: grouped.lanes.backing.count > 0 ? grouped.lanes.backing.netCents : collected.records.backing.cutCents,
    bookingsKeptCents: grouped.lanes.bookings.count > 0 ? grouped.lanes.bookings.netCents : collected.records.bookings.cutCents,
    adsServedCents: adsServedCents({ purchasedCents: collected.records.adCredits.grossCents, liabilityAtLastSweepCents: lastLiability, liabilityNowCents: adCreditsCents }),
    unexplainedCents: stripeState.ok ? rec.unexplainedCents : 0
  });

  // A sweep still marked pending or in transit follows Stripe's current
  // status here too, so a missed payout.paid webhook never blocks the
  // next sweep.
  const history = historyRows.map(sweepOut);
  if (stripe && stripeState.ok) {
    for (const s of history) {
      if (!s.payoutId || !['pending', 'in_transit'].includes(s.status)) continue;
      try {
        const seen = stripeState.recentPayouts.find((p) => p.id === s.payoutId);
        const live = seen ? { id: seen.id, status: seen.status, arrival_date: seen.arrivalOn ? unix(`${seen.arrivalOn}T00:00:00Z`) : null } : await stripe.payouts.retrieve(s.payoutId);
        if (live && live.status && live.status !== s.status) {
          await syncSweepFromPayout(live);
          s.status = live.status;
          if (live.status === 'paid') s.paidAt = nowIso();
          if (live.failure_message) s.failedReason = live.failure_message;
        }
      } catch (err) {
        console.error(`studio money: payout ${s.payoutId} not refreshed: ${err.message}`);
      }
    }
  }
  const pendingSweeps = history.filter((s) => s.status === 'pending' || s.status === 'in_transit').length;
  const gate = sweepGate({
    scheduleInterval: stripeState.scheduleInterval,
    stripeOk: stripeState.ok,
    canLeave: canLeave.cents,
    unexplainedCents: stripeState.ok ? rec.unexplainedCents : 0,
    toleranceCents: tolerance,
    pendingCreatorPayouts: collected.pendingCreatorPayouts,
    pendingSweeps
  });
  if (!available) gate.ok = false;
  if (!available) gate.reasons.unshift('Run migration 089 first.');

  const totalsByCreator = {};
  for (const p of yearPayouts) totalsByCreator[p.creator_id] = (totalsByCreator[p.creator_id] || 0) + int(p.cents);
  const ourPayoutIds = new Set(history.map((h) => h.payoutId).filter(Boolean));

  return {
    available,
    now: until,
    settings: { ...settings },
    stripe: { ...stripeState, recentPayouts: stripeState.recentPayouts.map((p) => ({ ...p, ours: ourPayoutIds.has(p.id) })) },
    obligations: {
      owedCents,
      owedCreators: owedList.filter((o) => int(o.cents) > 0).length,
      adCreditsCents,
      reserve: { cents: reserve, volumeCents, percent: settings.reservePercent, days: settings.reserveDays, floorCents: settings.reserveFloorCents },
      earmarks,
      earmarkCents
    },
    canLeave,
    sweep: {
      day: settings.sweepDay,
      mode: settings.sweepMode,
      nextOn: nextSweepDate(settings.sweepDay, now),
      isToday: isSweepDay(settings.sweepDay, now),
      last: last ? sweepOut(last) : null,
      gate,
      history
    },
    reconciliation: {
      since,
      until,
      transactions: txns.length,
      capped,
      rows: rec.rows,
      stripeNetCents: rec.stripeNetCents,
      expectedCents: rec.expectedCents,
      differenceCents: rec.differenceCents,
      explainedCents: rec.explainedCents,
      unexplainedCents: rec.unexplainedCents,
      toleranceCents: rec.toleranceCents,
      withinTolerance: rec.withinTolerance,
      unmatched: grouped.unmatched.slice(0, 50),
      explanations
    },
    studioShare: share,
    tax: { year: now.getUTCFullYear(), ...taxThresholds(totalsByCreator), scheduleInterval: stripeState.scheduleInterval, stripeConfigured: stripeState.configured }
  };
}

// --- actions ---------------------------------------------------------------

// The sweep: freeze the calculation, ask Stripe for one payout to the
// bank, close the period's explanations. `payout.paid` / `payout.failed`
// on the webhook keep the row current afterwards.
export async function createSweep({ createdBy, adminEmail = null, note = null, deps = {} } = {}) {
  const page = await getMoneyPage({ deps });
  if (!page.available) throw new StudioMoneyError('Run migration 089 first.');
  if (!page.sweep.gate.ok) throw new StudioMoneyError(page.sweep.gate.reasons.join(' '));
  const stripe = stripeClient(deps);
  if (!stripe) throw new StudioMoneyError('Stripe is not configured.');
  const cents = page.canLeave.cents;
  const supabase = getSupabase();

  const breakdown = {
    stripe: { availableCents: page.stripe.availableCents, pendingCents: page.stripe.pendingCents, scheduleInterval: page.stripe.scheduleInterval },
    obligations: {
      owedCents: page.obligations.owedCents,
      adCreditsCents: page.obligations.adCreditsCents,
      reserveCents: page.obligations.reserve.cents,
      reserve: page.obligations.reserve,
      earmarks: page.obligations.earmarks,
      earmarkCents: page.obligations.earmarkCents
    },
    canLeave: page.canLeave,
    reconciliation: {
      since: page.reconciliation.since,
      until: page.reconciliation.until,
      rows: page.reconciliation.rows,
      stripeNetCents: page.reconciliation.stripeNetCents,
      expectedCents: page.reconciliation.expectedCents,
      differenceCents: page.reconciliation.differenceCents,
      explainedCents: page.reconciliation.explainedCents,
      unexplainedCents: page.reconciliation.unexplainedCents,
      explanations: page.reconciliation.explanations,
      unmatched: page.reconciliation.unmatched
    },
    studioShare: page.studioShare
  };
  const created = await supabase
    .from('studio_sweeps')
    .insert({
      cents,
      status: 'pending',
      period_from: page.reconciliation.since,
      period_to: page.reconciliation.until,
      breakdown,
      discrepancy_cents: page.reconciliation.differenceCents,
      note: note ? String(note).slice(0, 500) : null,
      created_by: createdBy || null
    })
    .select('*')
    .single();
  if (created.error) throw new StudioMoneyError(`Could not record the sweep: ${created.error.message}`, 500);
  const sweep = created.data;
  const period = page.reconciliation.until.slice(0, 7);

  let payout;
  try {
    payout = await stripe.payouts.create(
      {
        amount: cents,
        currency: 'usd',
        description: `${SITE.name} studio sweep ${period}`,
        metadata: { sweep_id: sweep.id, period_from: page.reconciliation.since, period_to: page.reconciliation.until }
      },
      { idempotencyKey: `studio-sweep-${sweep.id}` }
    );
  } catch (err) {
    const reason = String(err && err.message ? err.message : err).slice(0, 300);
    await supabase.from('studio_sweeps').update({ status: 'failed', failed_reason: reason }).eq('id', sweep.id);
    throw new StudioMoneyError(`Stripe refused the payout: ${reason}`, 502);
  }

  const status = ['pending', 'in_transit', 'paid', 'failed', 'canceled'].includes(payout.status) ? payout.status : 'pending';
  const patch = { stripe_payout_id: payout.id, status, arrival_on: dateOfUnix(payout.arrival_date), paid_at: status === 'paid' ? nowIso() : null, failed_reason: payout.failure_message || null };
  const done = await supabase.from('studio_sweeps').update(patch).eq('id', sweep.id);
  if (done.error) console.error(`studio sweep ${sweep.id} (payout ${payout.id}) row not updated: ${done.error.message}`);
  const closed = await supabase.from('studio_adjustments').update({ sweep_id: sweep.id }).is('sweep_id', null);
  if (closed.error) console.error('studio sweep: explanations not closed:', closed.error.message);

  await recordAudit({
    adminId: createdBy || 'cron',
    adminEmail,
    action: 'studio_sweep',
    targetType: 'studio_sweep',
    targetId: sweep.id,
    details: `${dollars(cents)} to the bank · payout ${payout.id} · period ${page.reconciliation.since.slice(0, 10)} → ${page.reconciliation.until.slice(0, 10)} · difference ${dollars(page.reconciliation.differenceCents)} (${dollars(page.reconciliation.unexplainedCents)} unexplained)`
  });
  return sweepOut({ ...sweep, ...patch });
}

export async function addEarmark({ label, cents, note, createdBy, adminEmail = null }) {
  const clean = String(label || '').trim().slice(0, 120);
  const amount = int(cents);
  if (!clean) throw new StudioMoneyError('Give the earmark a name.');
  if (amount <= 0) throw new StudioMoneyError('The amount must be more than $0.');
  const { data, error } = await getSupabase().from('studio_earmarks').insert({ label: clean, cents: amount, note: note ? String(note).trim().slice(0, 500) : null, created_by: createdBy || null }).select('*').single();
  if (error) throw new StudioMoneyError(isMissingTable(error) ? 'Run migration 089 first.' : error.message, 500);
  await recordAudit({ adminId: createdBy, adminEmail, action: 'studio_earmark_added', targetType: 'studio_earmark', targetId: data.id, details: `${clean} · ${dollars(amount)}` });
  return data;
}

export async function releaseEarmark({ id, releasedBy, adminEmail = null }) {
  const { data, error } = await getSupabase().from('studio_earmarks').update({ released_at: nowIso(), released_by: releasedBy || null }).eq('id', id).is('released_at', null).select('*');
  if (error) throw new StudioMoneyError(error.message, 500);
  if (!data || data.length === 0) throw new StudioMoneyError('That earmark is already released.', 404);
  await recordAudit({ adminId: releasedBy, adminEmail, action: 'studio_earmark_released', targetType: 'studio_earmark', targetId: id, details: `${data[0].label} · ${dollars(data[0].cents)}` });
  return data[0];
}

export async function addExplanation({ cents, explanation, createdBy, adminEmail = null }) {
  const amount = int(cents);
  const text = String(explanation || '').trim().slice(0, 1000);
  if (!text) throw new StudioMoneyError('Say what the difference is.');
  if (amount === 0) throw new StudioMoneyError('Give the amount the explanation covers (negative when Stripe has less than expected).');
  const { data, error } = await getSupabase().from('studio_adjustments').insert({ cents: amount, explanation: text, created_by: createdBy || null }).select('*').single();
  if (error) throw new StudioMoneyError(isMissingTable(error) ? 'Run migration 089 first.' : error.message, 500);
  await recordAudit({ adminId: createdBy, adminEmail, action: 'studio_difference_explained', targetType: 'studio_adjustment', targetId: data.id, details: `${dollars(amount)} · ${text.slice(0, 120)}` });
  return data;
}

// --- webhook + cron --------------------------------------------------------

// payout.paid / payout.failed / payout.canceled on the account endpoint:
// keep our sweep row current. Stripe's own automatic payouts match no row
// and are ignored.
export async function syncSweepFromPayout(payout) {
  if (!payout || !payout.id) return;
  const status = ['pending', 'in_transit', 'paid', 'failed', 'canceled'].includes(payout.status) ? payout.status : null;
  if (!status) return;
  const patch = { status, failed_reason: payout.failure_message || null, arrival_on: dateOfUnix(payout.arrival_date) };
  if (status === 'paid') patch.paid_at = nowIso();
  const { error } = await getSupabase().from('studio_sweeps').update(patch).eq('stripe_payout_id', payout.id);
  if (error && !isMissingTable(error)) console.error('syncSweepFromPayout error:', error.message);
}

// checkout.session.completed for an ad-credits top-up: a row the
// reconciliation can match the charge to.
export async function recordAdCreditPurchase(session) {
  if (!session || !session.id) return;
  const row = {
    ad_account_id: session.metadata && session.metadata.adAccountId,
    stripe_checkout_session_id: session.id,
    stripe_payment_intent_id: typeof session.payment_intent === 'string' ? session.payment_intent : (session.payment_intent && session.payment_intent.id) || null,
    amount_cents: int(session.amount_total)
  };
  if (!row.ad_account_id) return;
  const { error } = await getSupabase().from('ad_credit_purchases').insert(row);
  if (error && error.code !== '23505' && !isMissingTable(error)) console.error('recordAdCreditPurchase error:', error.message);
}

// The sweep day (daily cron at 10:00 UTC, acts only on the day): in auto
// mode the sweep goes; in confirm mode, or when the gate says no, an
// email says what's ready or what's in the way.
export async function runSweepDay({ deps = {}, now = new Date(), force = false } = {}) {
  const settings = await getStudioSettings();
  if (!force && !isSweepDay(settings.sweepDay, now)) return { skipped: 'not the sweep day', sweepDay: settings.sweepDay };
  const page = await getMoneyPage({ deps, now });
  const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
  if (page.sweep.history.some((s) => s.createdAt >= todayStart && s.status !== 'failed')) return { skipped: 'a sweep was already made today' };

  const to = process.env.STUDIO_MONEY_NOTIFY_EMAIL || SITE.contactEmail;
  const link = `${SITE.productionDomain || 'https://www.studiotapatv.site'}/admin/money`;
  if (settings.sweepMode === 'auto' && page.sweep.gate.ok) {
    const sweep = await createSweep({ createdBy: 'cron', deps });
    await sendEmail({ to, subject: `Studio sweep sent: ${dollars(sweep.cents)}`, html: `<p>${dollars(sweep.cents)} is on its way to the bank (Stripe payout ${sweep.payoutId}, arriving ${sweep.arrivalOn || 'in a couple of business days'}).</p><p>Stays in Stripe: ${dollars(page.canLeave.stayCents)} — creators ${dollars(page.obligations.owedCents)}, advertisers ${dollars(page.obligations.adCreditsCents)}, reserve ${dollars(page.obligations.reserve.cents)}, earmarks ${dollars(page.obligations.earmarkCents)}.</p><p><a href="${link}">Studio money</a></p>` });
    return { swept: true, sweep };
  }
  const ready = page.sweep.gate.ok;
  const subject = ready ? `Studio sweep ready: ${dollars(page.canLeave.cents)}` : 'Studio sweep held';
  const html = ready
    ? `<p>${dollars(page.canLeave.cents)} can leave Stripe for the bank today. Available ${dollars(page.stripe.availableCents)}; staying for creators ${dollars(page.obligations.owedCents)}, advertisers ${dollars(page.obligations.adCreditsCents)}, reserve ${dollars(page.obligations.reserve.cents)}, earmarks ${dollars(page.obligations.earmarkCents)}.</p><p><a href="${link}">Review and send it</a>.</p>`
    : `<p>Today is the sweep day, but the sweep can't go:</p><ul>${page.sweep.gate.reasons.map((r) => `<li>${r}</li>`).join('')}</ul><p><a href="${link}">Studio money</a></p>`;
  const sent = await sendEmail({ to, subject, html });
  return { swept: false, ready, emailed: Boolean(sent && sent.sent), reasons: page.sweep.gate.reasons, canLeaveCents: page.canLeave.cents };
}
