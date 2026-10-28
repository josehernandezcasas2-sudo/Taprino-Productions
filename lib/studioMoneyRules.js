// Studio money: the pure arithmetic behind /admin/money (no imports from
// the server side, so pages can use it too). lib/studioMoney.js feeds it
// Stripe's balance transactions and our tables and acts on the answers.
//
// The idea in one line: available balance − what has to stay (creators'
// unpaid credits, advertisers' unserved credits, crew pay held for booked
// people, a refund reserve, the earmarks) = what can leave to the bank.
// Tested by node scripts/test-studio-money.mjs.

export const SWEEP_MODES = ['confirm', 'auto'];
// The most the reconciliation tolerance can be set to (security round 2,
// 2026-10-28): a bigger unexplained difference always stops the sweep.
export const MAX_TOLERANCE_CENTS = 100000;
export const MAX_TOLERANCE_PERCENT = 10;

// The lanes money moves in, in the order the page shows them.
export const LANES = [
  { key: 'memberships', label: 'Memberships' },
  { key: 'backing', label: 'Pitch Room backing' },
  { key: 'bookings', label: 'Location bookings' },
  { key: 'purchases', label: 'Title sales' },
  { key: 'tips', label: 'Tips' },
  { key: 'crewPay', label: 'Crew pay (held & released)' },
  { key: 'adCredits', label: 'Advertiser credits' },
  { key: 'creatorBatch', label: 'Creator Share batch' },
  { key: 'refunds', label: 'Refunds' },
  { key: 'disputes', label: 'Disputes' },
  { key: 'sweeps', label: 'To the bank' },
  { key: 'stripe', label: 'Stripe fees & adjustments' },
  { key: 'other', label: 'Other' }
];

export const DEFAULT_SETTINGS = {
  sweepDay: 5,
  sweepMode: 'confirm',
  reservePercent: 5,
  reserveDays: 90,
  reserveFloorCents: 30000,
  toleranceCents: 2500,
  tolerancePercent: 1
};

const int = (n) => Math.round(Number(n) || 0);
const sum = (list, pick) => (list || []).reduce((s, x) => s + int(pick ? pick(x) : x), 0);

export function dollars(cents) {
  const n = int(cents);
  const s = `$${(Math.abs(n) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return n < 0 ? `−${s}` : s;
}

// The card fee Stripe charges on one payment at the published rate; our
// fee covers (lib/donationMath.js) assume the same. The reconciliation
// uses it as the planned fee so that a card that cost more shows up as a
// difference instead of vanishing.
export function assumedFeeCents(amountCents) {
  const a = int(amountCents);
  if (a <= 0) return 0;
  return Math.round(a * 0.029 + 30);
}

// Refund & dispute reserve: a share of recent card volume with a floor.
export function reserveCents({ volumeCents, percent, floorCents }) {
  const pct = Math.max(0, Number(percent) || 0);
  return Math.max(int(floorCents), Math.round(int(volumeCents) * pct / 100));
}

// The calculation at the top of the page. `crewPayHeldCents` (migration
// 110) is every crew payment still held: the whole charge, since a held
// payment either goes out to the worker or back to the poster, and the
// studio's fee on it is only kept once the job is confirmed.
export function canLeaveCents({ availableCents, owedCents, adCreditsCents, reserveCents: reserve, earmarkCents, crewPayHeldCents = 0 }) {
  const stay = Math.max(0, int(owedCents)) + Math.max(0, int(adCreditsCents)) + Math.max(0, int(crewPayHeldCents)) + Math.max(0, int(reserve)) + Math.max(0, int(earmarkCents));
  const cents = int(availableCents) - stay;
  return { cents: Math.max(0, cents), stayCents: stay, shortfallCents: cents < 0 ? -cents : 0 };
}

// Unexplained differences are tolerated up to a fixed amount or a share of
// the period's gross, whichever is larger.
export function toleranceCents({ periodGrossCents, fixedCents, percent }) {
  return Math.max(int(fixedCents), Math.round(Math.max(0, int(periodGrossCents)) * (Math.max(0, Number(percent) || 0)) / 100));
}

// The next sweep day at 10:00 UTC: this month if still ahead, else next.
export function nextSweepDate(day, now = new Date()) {
  const d = Math.min(28, Math.max(1, int(day) || 1));
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const thisMonth = new Date(Date.UTC(y, m, d, 10));
  if (thisMonth.getTime() > now.getTime()) return thisMonth.toISOString();
  return new Date(Date.UTC(y, m + 1, d, 10)).toISOString();
}

export function isSweepDay(day, now = new Date()) {
  return now.getUTCDate() === Math.min(28, Math.max(1, int(day) || 1));
}

// May the sweep run? Every reason it can't, in words the page shows.
export function sweepGate({ scheduleInterval, stripeOk = true, canLeave, unexplainedCents, toleranceCents: tol, pendingCreatorPayouts = 0, pendingSweeps = 0 }) {
  const reasons = [];
  if (!stripeOk) reasons.push('Stripe could not be read; try again in a minute.');
  if (scheduleInterval && scheduleInterval !== 'manual') reasons.push(`Stripe still pays the balance out ${scheduleInterval}; set the platform account to manual payouts (Dashboard → Settings → Payouts).`);
  if (!scheduleInterval && stripeOk) reasons.push('Stripe did not report the payout schedule; it must be manual.');
  if (int(canLeave) <= 0) reasons.push('Nothing can leave: the balance is spoken for.');
  if (Math.abs(int(unexplainedCents)) > int(tol)) reasons.push(`${dollars(unexplainedCents)} is unexplained, over the ${dollars(tol)} tolerance. Explain it below first.`);
  if (int(pendingCreatorPayouts) > 0) reasons.push(`${int(pendingCreatorPayouts)} creator payout${int(pendingCreatorPayouts) === 1 ? ' is' : 's are'} still pending from the batch.`);
  if (int(pendingSweeps) > 0) reasons.push('A sweep is already on its way to the bank.');
  return { ok: reasons.length === 0, reasons };
}

// --- Stripe balance transactions → lanes --------------------------------

const idOf = (x) => (x && typeof x === 'object' ? x.id : x) || null;
const has = (set, ...keys) => keys.some((k) => k && set && set.has(k));

// Which lane one balance transaction belongs to. `ids` holds the Stripe
// ids our tables know: membershipCharges, backingCharges, bookingIntents,
// purchaseIntents (Buy to own), tipIntents (tips), crewPayIntents (crew
// pay: payment-intent and charge ids) + crewPayTransfers (its releases),
// adCreditIntents (charge or payment-intent ids), creatorTransfers,
// sweepPayouts. `source` may be the expanded object or just its id.
export function classifyTransaction(txn, ids = {}) {
  const cat = txn.reporting_category || txn.type || '';
  const src = txn.source && typeof txn.source === 'object' ? txn.source : null;
  const srcId = idOf(txn.source);
  const unmatched = (lane, why) => ({ lane, matched: false, why });
  const matched = (lane) => ({ lane, matched: true });

  const laneOfCharge = (charge, chargeId) => {
    const pi = charge ? idOf(charge.payment_intent) : null;
    if (has(ids.membershipCharges, chargeId, pi)) return matched('memberships');
    if (has(ids.backingCharges, chargeId, pi)) return matched('backing');
    if (has(ids.bookingIntents, pi, chargeId)) return matched('bookings');
    if (has(ids.purchaseIntents, pi, chargeId)) return matched('purchases');
    if (has(ids.tipIntents, pi, chargeId)) return matched('tips');
    if (has(ids.crewPayIntents, pi, chargeId)) return matched('crewPay');
    if (has(ids.adCreditIntents, pi, chargeId)) return matched('adCredits');
    if (charge && charge.invoice) return unmatched('memberships', 'invoice charge with no member_payments row');
    if (charge && (charge.transfer_data || charge.transfer || charge.destination)) return unmatched('backing', 'destination charge with no backing or booking row');
    return unmatched('other', 'charge not in our tables');
  };

  switch (cat) {
    case 'charge':
    case 'payment':
      return laneOfCharge(src, srcId);
    case 'refund':
    case 'payment_refund':
    case 'refund_failure':
    case 'payment_failure_refund':
    case 'transfer_reversal':
    case 'transfer_cancel':
    case 'transfer_refund':
      // A Creator Share payout reversed in the dashboard comes back into
      // the batch's lane (it was owed again); anything else is a refund.
      if (src && has(ids.creatorTransfers, idOf(src.transfer))) return matched('creatorBatch');
      return matched('refunds');
    case 'dispute':
    case 'dispute_reversal':
      return matched('disputes');
    case 'transfer': {
      const tid = srcId;
      if (has(ids.creatorTransfers, tid)) return matched('creatorBatch');
      // Crew pay released to a worker (migration 110): a plain transfer
      // from the studio's balance, tied to the poster's charge.
      if (has(ids.crewPayTransfers, tid)) return matched('crewPay');
      // A destination charge's transfer names its charge; the charge's own
      // lane (worked out from the charges first, see groupTransactions)
      // decides, since bookings only know their payment intent.
      const sourceTxn = src ? idOf(src.source_transaction) : null;
      if (sourceTxn) {
        const known = ids.chargeLanes && ids.chargeLanes.get(sourceTxn);
        if (known) return matched(known);
        if (has(ids.backingCharges, sourceTxn)) return matched('backing');
        if (has(ids.bookingIntents, sourceTxn)) return matched('bookings');
        if (has(ids.purchaseIntents, sourceTxn)) return matched('purchases');
        if (has(ids.tipIntents, sourceTxn)) return matched('tips');
        if (has(ids.crewPayIntents, sourceTxn)) return matched('crewPay');
        return unmatched('backing', 'transfer for a charge not in our tables');
      }
      return unmatched('other', 'transfer not made by the Creator Share batch');
    }
    case 'payout':
    case 'payout_reversal':
    case 'payout_cancel':
    case 'payout_failure':
      return has(ids.sweepPayouts, srcId) ? matched('sweeps') : unmatched('sweeps', 'payout not made from this page');
    case 'fee':
    case 'stripe_fee':
    case 'adjustment':
    case 'other_adjustment':
    case 'tax':
    case 'tax_fee':
    case 'network_cost':
    case 'stripe_fx_fee':
      return unmatched('stripe', cat.replace(/_/g, ' '));
    default:
      return unmatched('other', cat.replace(/_/g, ' ') || 'unknown');
  }
}

// Lanes with counts, gross, fees and net, plus a list of what didn't match.
export function groupTransactions(txns, ids = {}) {
  const lanes = {};
  for (const l of LANES) lanes[l.key] = { count: 0, grossCents: 0, feeCents: 0, netCents: 0, unmatchedCount: 0, unmatchedCents: 0 };
  const unmatched = [];
  let grossChargedCents = 0;
  // Charges first, so a transfer can follow its charge's lane.
  const chargeLanes = new Map();
  for (const t of txns || []) {
    const cat = t.reporting_category || t.type;
    if ((cat === 'charge' || cat === 'payment') && t.source) {
      const c = classifyTransaction(t, ids);
      if (c.matched) chargeLanes.set(idOf(t.source), c.lane);
    }
  }
  const withLanes = { ...ids, chargeLanes };
  for (const t of txns || []) {
    const c = classifyTransaction(t, withLanes);
    const lane = lanes[c.lane];
    lane.count += 1;
    lane.grossCents += int(t.amount);
    lane.feeCents += int(t.fee);
    lane.netCents += int(t.net);
    if ((t.reporting_category || t.type) === 'charge' || (t.reporting_category || t.type) === 'payment') grossChargedCents += Math.max(0, int(t.amount));
    if (!c.matched) {
      lane.unmatchedCount += 1;
      lane.unmatchedCents += int(t.net);
      unmatched.push({ id: t.id, lane: c.lane, why: c.why, cents: int(t.net), created: t.created || null, description: t.description || null });
    }
  }
  return { lanes, unmatched, totalNetCents: sum(Object.values(lanes), (l) => l.netCents), grossChargedCents };
}

// --- our records → what we expected each lane to net ---------------------

// `records` (lib/studioMoney.js builds it from our tables for the window):
//   memberships { count, grossCents }
//   backing     { count, pledgeCents, cutCents, coverCents }
//   bookings    { count, cutCents, coverCents }
//   purchases   { count, grossCents, cutCents, taxCents }   cut = the studio's share after Stripe; tax = Stripe Tax collected on top (in the balance, owed to the state)
//   tips        { count, grossCents, cutCents, coverCents }   like backing: gross = the tips themselves; the cut is what stays after the creator's transfer and the fan's fee cover
//   crewPay     { count, grossCents, amounts, cutCents, coverCents, releasedCents }   gross = what posters were charged (rate + fee + cover) for payments that went held in the window; released = transfers out to workers in the window (whenever they were funded)
//   adCredits   { count, grossCents }
//   creatorBatch{ count, cents }        paid out less what came back
//   refunds     { count, cents }        the platform's loss, positive
//   disputes    { count, cents }        amounts + fees, positive
//   sweeps      { count, cents }        positive
export function expectedByLane(records = {}) {
  const r = (k) => records[k] || {};
  return {
    memberships: int(r('memberships').grossCents) - assumedFeeTotal(r('memberships')),
    backing: int(r('backing').cutCents),
    bookings: int(r('bookings').cutCents),
    purchases: int(r('purchases').cutCents) + int(r('purchases').taxCents),
    tips: int(r('tips').cutCents),
    // Crew pay: the charges land whole (less the card fee), the releases
    // leave whole; what's in between is held, not kept.
    crewPay: int(r('crewPay').grossCents) - assumedFeeTotal(r('crewPay')) - int(r('crewPay').releasedCents),
    adCredits: int(r('adCredits').grossCents) - assumedFeeTotal(r('adCredits')),
    creatorBatch: -int(r('creatorBatch').cents),
    refunds: -int(r('refunds').cents),
    disputes: -int(r('disputes').cents),
    sweeps: -int(r('sweeps').cents),
    stripe: 0,
    other: 0
  };
}

// The planned fee for a lane of records: per payment when the list of
// amounts is known, else on the average.
function assumedFeeTotal(rec) {
  if (Array.isArray(rec.amounts)) return sum(rec.amounts, (a) => assumedFeeCents(a));
  const count = int(rec.count);
  const gross = int(rec.grossCents);
  if (count <= 0 || gross <= 0) return 0;
  return Math.round(gross * 0.029 + 30 * count);
}

// Stripe vs our records, lane by lane, with the difference.
export function reconcile({ lanes, records, explainedCents = 0, toleranceCents: tol = 0 }) {
  const expected = expectedByLane(records);
  const rows = LANES.map((l) => {
    const s = (lanes && lanes[l.key]) || { count: 0, grossCents: 0, feeCents: 0, netCents: 0, unmatchedCount: 0, unmatchedCents: 0 };
    const rec = (records && records[l.key]) || {};
    return {
      key: l.key,
      label: l.label,
      stripe: { count: s.count, grossCents: s.grossCents, feeCents: s.feeCents, netCents: s.netCents, unmatchedCount: s.unmatchedCount, unmatchedCents: s.unmatchedCents },
      records: { count: int(rec.count), cents: int(rec.grossCents || rec.pledgeCents || rec.cents || 0), cutCents: int(rec.cutCents), coverCents: int(rec.coverCents) },
      expectedCents: int(expected[l.key]),
      differenceCents: s.netCents - int(expected[l.key])
    };
  }).filter((row) => row.stripe.count > 0 || row.records.count > 0 || row.expectedCents !== 0);
  const stripeNetCents = sum(rows, (r) => r.stripe.netCents);
  const expectedCents = sum(rows, (r) => r.expectedCents);
  const differenceCents = stripeNetCents - expectedCents;
  const unexplainedCents = differenceCents - int(explainedCents);
  return {
    rows,
    stripeNetCents,
    expectedCents,
    differenceCents,
    explainedCents: int(explainedCents),
    unexplainedCents,
    toleranceCents: int(tol),
    withinTolerance: Math.abs(unexplainedCents) <= int(tol)
  };
}

// What the studio kept this period, from the same figures.
//   membership: gross, Stripe fees (actual), credited to creators, the
//   loss on refunds and disputes after their credits were reversed.
//   together: + what the other lanes kept, − unexplained differences.
// Ad share (migration 103): `adShareCents` is what the month's ad plays
// credited to creators, so "ads kept" is what was served less that.
export function studioShare({ membershipGrossCents, membershipFeeCents, creditedCents, reversedCreditCents, refundedCents, disputeCents, backingKeptCents, bookingsKeptCents, purchasesKeptCents = 0, tipsKeptCents = 0, crewPayKeptCents = 0, adsServedCents, adShareCents = 0, unexplainedCents }) {
  const lossCents = Math.max(0, int(refundedCents) + int(disputeCents) - int(reversedCreditCents));
  const marginCents = int(membershipGrossCents) - int(membershipFeeCents) - int(creditedCents) - lossCents;
  const adsKeptCents = int(adsServedCents) - int(adShareCents);
  const shareCents = marginCents + int(backingKeptCents) + int(bookingsKeptCents) + int(purchasesKeptCents) + int(tipsKeptCents) + int(crewPayKeptCents) + adsKeptCents - Math.max(0, -int(unexplainedCents)) + Math.min(0, 0);
  const pct = (c) => (int(membershipGrossCents) > 0 ? Math.round((int(c) / int(membershipGrossCents)) * 1000) / 10 : 0);
  return {
    membership: {
      grossCents: int(membershipGrossCents),
      feeCents: int(membershipFeeCents),
      creditedCents: int(creditedCents),
      lossCents,
      marginCents,
      split: { fees: pct(membershipFeeCents), creators: pct(creditedCents), loss: pct(lossCents), studio: pct(marginCents) }
    },
    together: {
      marginCents,
      backingKeptCents: int(backingKeptCents),
      bookingsKeptCents: int(bookingsKeptCents),
      purchasesKeptCents: int(purchasesKeptCents),
      tipsKeptCents: int(tipsKeptCents),
      crewPayKeptCents: int(crewPayKeptCents),
      adsServedCents: int(adsServedCents),
      adShareCents: int(adShareCents),
      adsKeptCents,
      unexplainedCents: int(unexplainedCents),
      shareCents
    }
  };
}

// Advertiser credits served in the period: what was bought, plus the
// liability the last sweep froze, minus the liability now.
export function adsServedCents({ purchasedCents, liabilityAtLastSweepCents, liabilityNowCents }) {
  return Math.max(0, int(purchasedCents) + int(liabilityAtLastSweepCents) - int(liabilityNowCents));
}

// Tax-season counts from creators' paid totals for the year.
export function taxThresholds(totalsByCreator) {
  const totals = Object.values(totalsByCreator || {}).map(int);
  return {
    paid: totals.filter((t) => t > 0).length,
    over10: totals.filter((t) => t >= 1000).length,
    over600: totals.filter((t) => t >= 60000).length,
    over2000: totals.filter((t) => t >= 200000).length
  };
}

export function normalizeSettings(raw = {}) {
  const n = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
  const day = Math.min(28, Math.max(1, Math.round(n(raw.sweepDay, DEFAULT_SETTINGS.sweepDay))));
  return {
    sweepDay: day,
    sweepMode: SWEEP_MODES.includes(raw.sweepMode) ? raw.sweepMode : DEFAULT_SETTINGS.sweepMode,
    reservePercent: Math.min(100, Math.max(0, n(raw.reservePercent, DEFAULT_SETTINGS.reservePercent))),
    reserveDays: Math.min(365, Math.max(1, Math.round(n(raw.reserveDays, DEFAULT_SETTINGS.reserveDays)))),
    reserveFloorCents: Math.max(0, Math.round(n(raw.reserveFloorCents, DEFAULT_SETTINGS.reserveFloorCents))),
    // The tolerance has a ceiling (security round 2, 2026-10-28): an
    // unexplained difference above $1,000 or 10% of the period's gross
    // is never something the sweep gate waves through, whatever is typed.
    toleranceCents: Math.min(MAX_TOLERANCE_CENTS, Math.max(0, Math.round(n(raw.toleranceCents, DEFAULT_SETTINGS.toleranceCents)))),
    tolerancePercent: Math.min(MAX_TOLERANCE_PERCENT, Math.max(0, n(raw.tolerancePercent, DEFAULT_SETTINGS.tolerancePercent)))
  };
}
