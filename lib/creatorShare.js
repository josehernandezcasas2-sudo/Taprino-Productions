import { getSupabase } from './supabase';
import { getLeavingIds } from './creatorStanding';
import { getStripe, isStripeConfigured, stripeMode } from './stripe';
import { getMembershipPlans } from './membershipPlans';
import { getShareSettings, listMakerCreators, listSupportableCreators } from './artistSupport';
import { getOwnProfile, looksLikeUserId, resolveProfileUserId } from './userProfiles';
import { shareCentsFor } from './artistSupportRules';
import { getCreatorViewTotals } from './redis';
import { notifyCreator } from './notify';
import { dollars } from './donationMath';
import { SITE } from './siteConfig';
import { internalError } from './apiErrors';
import { invoiceTaxCents } from './salesTaxRules';
import { payeeAccountIds, payeeAtFor, readPayeeContext, studioAccountsAmong } from './payees';
import { insertLedgerLines } from './ledgerWrites';
import { withMembershipLineIds as withLineIds } from './ledgerIds';
import {
  buildLedgerLines, chargeReversalReason, chooseBasis, cleanViaSlug, countWatched, invoiceChargeId, invoiceCustomerId, invoicePaymentIntentId, invoiceSubscriptionId,
  invoiceRetryVerdict, membershipPaidCents, paymentPromisesLines, referralEarnsBonus, referralIsActive, restoreLinesFor, reversalLinesFor, stampLines, tierForInvoice, fitShareToPayment,
  INVOICE_RETRY_HOURS, YEARLY_MONTHS, YEARLY_MONTH1_COVERED, afterYearlyMonth, invoiceBilling, monthlyStopsYear,
  yearlyMonthDue, yearlyMonthDueNow, yearlyMonthNote, yearlyScheduleStart, yearlySharesAhead, yearlyStartsCredited, yearlySwitchStop
} from './creatorShareRules';

// Creator Share, the money side (migration 088; mockups/creator-share-v2.html
// §3, §6, §7). Every paid membership invoice becomes one member_payments
// row and a ledger line per creator: the member's share split by their
// lineup (else what they watched, else the pool), plus the referral bonus
// for the creator whose link brought the member. Refunds and disputes
// reverse the unpaid lines. Nothing here transfers money to creators yet —
// the monthly payout batch is the next piece; the ledger is what it will
// settle.
//
// How a renewal finds its member: Checkout stamps the Clerk id on the
// subscription (subscription_data.metadata.member) and the completed
// session writes member_customers, so invoice.paid can look the customer
// up without a Stripe call. Both links exist from this commit on; older
// subscriptions fall back to retrieving the subscription's metadata.

const WATCH_WINDOW_DAYS = 30;
const POOL_WINDOW_DAYS = 30;

function isMissingTable(error) {
  return Boolean(error) && (error.code === 'PGRST205' || error.code === '42P01' || /relation .* does not exist|could not find the table/i.test(error.message || ''));
}

// Yearly Stream plans (migration 127): the member_payments columns a
// yearly payment's schedule lives in. A database without them records a
// yearly invoice as a monthly one (month 1 credited, logged) and the daily
// step finds nothing to do.
const PAYMENT_127 = ['months', 'months_credited', 'next_month_at', 'stopped_at'];
function missing127(error) {
  return Boolean(error)
    && (error.code === 'PGRST204' || error.code === '42703' || /\bcolumn\b/i.test(error.message || ''))
    && PAYMENT_127.some((k) => new RegExp(`\\b${k}\\b`).test(error.message || ''));
}
const without127 = (row) => {
  const slim = { ...row };
  for (const k of PAYMENT_127) delete slim[k];
  return slim;
};

function unixToIso(seconds) {
  const n = Number(seconds);
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000).toISOString() : null;
}

// checkout.session.completed for a subscription: remember which member a
// Stripe customer is, so renewals need no Stripe call to find them.
export async function recordCheckoutCustomer(session) {
  if (!session || session.mode !== 'subscription') return false;
  const userId = session.client_reference_id || (session.metadata && session.metadata.member);
  const customerId = typeof session.customer === 'string' ? session.customer : session.customer && session.customer.id;
  if (!looksLikeUserId(userId) || !customerId) return false;
  const { error } = await getSupabase()
    .from('member_customers')
    .upsert({ stripe_customer_id: customerId, user_id: userId, mode: stripeMode() }, { onConflict: 'stripe_customer_id' });
  if (error && !isMissingTable(error)) console.error('recordCheckoutCustomer error:', error.message);
  return !error;
}

// The creator a ?via= / /@handle link points at, if they may be credited:
// a real profile, with released work, and not the member themselves. Only
// a maker (lib/artistSupport.js listMakerCreators): an account linked only
// as a title's Studio or Producer can be picked, not credited as a
// referrer (slice 6 left the referral bonus as it was). { strict } throws
// when a read fails instead of answering "not a creator".
export async function resolveReferrer(viaSlug, memberId, { strict = false } = {}) {
  const slug = cleanViaSlug(viaSlug);
  if (!slug) return null;
  const creatorId = await resolveProfileUserId(slug, { strict });
  if (!creatorId || creatorId === memberId) return null;
  const makers = await listMakerCreators({ strict });
  return makers.some((c) => c.userId === creatorId) ? creatorId : null;
}

// Checkout's referral (pages/api/create-checkout-session.js). The first
// paid invoice checks the stamped creator again, strictly
// (lockReferralFromSubscription), so when a read here fails the referral
// is stamped unchecked rather than dropped for good, and Checkout itself
// never fails over it:
//   { via }                   a maker, checked;
//   { via, unchecked: true }  the account was found, the makers' list couldn't be read;
//   { handle, unchecked: true } the handle couldn't even be looked up (the invoice resolves it);
//   {}                        nothing to stamp (no link, yourself, not a maker, no such handle).
export async function referrerForCheckout(viaSlug, memberId) {
  const slug = cleanViaSlug(viaSlug);
  if (!slug || !memberId) return {};
  let creatorId;
  try {
    creatorId = await resolveProfileUserId(slug, { strict: true });
  } catch (err) {
    console.error('referrerForCheckout: handle lookup failed, kept for the invoice:', err.message);
    return { handle: slug, unchecked: true };
  }
  if (!creatorId || creatorId === memberId) return {};
  try {
    const makers = await listMakerCreators({ strict: true });
    return makers.some((c) => c.userId === creatorId) ? { via: creatorId } : {};
  } catch (err) {
    console.error('referrerForCheckout: makers read failed, kept for the invoice:', err.message);
    return { via: creatorId, unchecked: true };
  }
}

// The subscription carries the member and the referral Checkout stamped.
// One Stripe no longer has (a 404) reads as none; any other failure throws,
// so the invoice fails and Stripe tries again — never an invoice recorded
// without the referral (its bonus lost for good) or skipped as "member
// unknown" over a hiccup.
async function loadSubscription(subscriptionId, deps) {
  if (!subscriptionId) return null;
  if (deps.retrieveSubscription) return deps.retrieveSubscription(subscriptionId);
  if (!isStripeConfigured()) return null;
  try {
    return await getStripe().subscriptions.retrieve(subscriptionId);
  } catch (err) {
    if (err && (Number(err.statusCode) === 404 || err.code === 'resource_missing')) return null;
    throw internalError(err, 'creatorShare loadSubscription');
  }
}

// The member an invoice is for, in order: member_customers (written when
// the Checkout session completed), the member Checkout stamped on the
// subscription (every Checkout since Creator Share; sign-in is required,
// so a new subscription always carries it — invoice.paid arriving before
// checkout.session.completed is found here), then the Clerk id stamped on
// the Stripe customer itself (lib/clerkStripeLink.js; a subscription
// started before the stamp, or outside Checkout). A read that fails throws
// (Stripe tries again) when nothing else named the member — never "member
// unknown" over a hiccup; `late` (a day of retries) logs a Stripe customer
// read that still fails and goes on without it.
async function memberForInvoice(invoice, subscription, deps = {}, { late = false } = {}) {
  const supabase = getSupabase();
  const customerId = invoiceCustomerId(invoice);
  let readError = null;
  if (customerId) {
    const { data, error } = await supabase.from('member_customers').select('user_id').eq('stripe_customer_id', customerId).maybeSingle();
    if (error && !isMissingTable(error)) readError = internalError(error, 'member_customers read');
    if (data && looksLikeUserId(data.user_id)) return data.user_id;
  }
  const remember = async (userId) => {
    if (!customerId) return;
    const { error } = await supabase.from('member_customers').upsert({ stripe_customer_id: customerId, user_id: userId, mode: stripeMode() }, { onConflict: 'stripe_customer_id' });
    if (error && !isMissingTable(error)) console.error('memberForInvoice upsert error:', error.message);
  };
  const stamped = subscription && subscription.metadata && subscription.metadata.member;
  if (looksLikeUserId(stamped)) {
    await remember(stamped);
    return stamped;
  }
  let customer = null;
  try {
    customer = customerId ? await loadCustomer(customerId, deps) : null;
  } catch (err) {
    if (!late) throw err;
    console.error(`creatorShare: the Stripe customer for invoice ${invoice.id} still can’t be read after a day of retries:`, err && err.message);
  }
  const linked = customer && !customer.deleted && customer.metadata ? customer.metadata.clerkUserId : null;
  if (looksLikeUserId(linked)) {
    await remember(linked);
    return linked;
  }
  if (readError) throw readError;
  return null;
}

// The Stripe customer behind an invoice (its Clerk id stamp). One Stripe
// no longer has reads as none; any other failure throws.
async function loadCustomer(customerId, deps) {
  if (deps.retrieveCustomer) return deps.retrieveCustomer(customerId);
  if (!isStripeConfigured()) return null;
  try {
    return await getStripe().customers.retrieve(customerId);
  } catch (err) {
    if (err && (Number(err.statusCode) === 404 || err.code === 'resource_missing')) return null;
    throw internalError(err, 'creatorShare loadCustomer');
  }
}

// The paid accounts of the titles this member watched in the last 30 days,
// by plays (slice 3b): each watch counts for the account the title paid
// when it was watched (lib/payees.js; before the cut-over, the uploader).
// eligible(id) says who may be credited at all.
async function watchedCreators(memberId, eligible) {
  const supabase = getSupabase();
  const since = new Date(Date.now() - WATCH_WINDOW_DAYS * 86400000).toISOString();
  const { data, error } = await supabase.from('watch_history').select('episode_id, watched_at').eq('user_id', memberId).gte('watched_at', since).limit(500);
  // A read that fails throws (the invoice fails and Stripe tries again):
  // answering "watched nothing" would send the share to the pool for good.
  if (error) {
    if (isMissingTable(error)) return {};
    throw internalError(error, 'watch_history read');
  }
  if (!data || data.length === 0) return {};
  const ids = [...new Set(data.map((r) => r.episode_id).filter(Boolean))];
  const eps = await supabase.from('episodes').select('id').in('id', ids).eq('status', 'approved').eq('moderation_hold', false);
  if (eps.error) throw internalError(eps.error, 'episodes read');
  if (!eps.data) return {};
  const live = new Set(eps.data.map((e) => e.id));
  // Who each title paid when it was watched. A failed read throws: the
  // invoice isn't recorded and Stripe's retry records it later — never the
  // share sent to the pool, or to the old rule's account, by mistake.
  const ctx = await readPayeeContext([...live]);
  const rows = data.filter((r) => live.has(r.episode_id));
  return countWatched(rows, (r) => payeeAtFor(ctx, r.episode_id, r.watched_at), eligible, memberId);
}

// The site-wide pool: every supportable creator — and, since slice 3b,
// every title's paid account — by their views over the last 30 days
// (Redis; a view is counted under the account the title paid when it was
// seen, lib/episodePage.js); equal weights when nobody has views. Never
// the studio's own accounts (house), creators who left, or the member.
// Without `opts.payees` (the leavers' forfeit, lib/creatorShareBatch.js)
// it is the supportable creators as before, less `opts.house`.
// The views are read strictly: a Redis read that fails throws (the invoice
// fails and Stripe tries again; the forfeit waits for the next run) —
// never money split by a month with days missing. Redis not set up at all
// is no views: equal weights, as before. `opts.equalIfViewsFail` (an
// invoice Stripe has been retrying for a day, creatorShareRules
// invoiceRetryVerdict) takes equal weights instead of throwing again, so
// a Redis that stays down can't lose the whole payment.
export async function poolCreators(supportable, memberId, opts = null) {
  let views;
  try {
    views = (await getCreatorViewTotals(POOL_WINDOW_DAYS, { strict: true })) || {};
  } catch (err) {
    if (!(opts && opts.equalIfViewsFail)) throw err;
    console.error('poolCreators: the views still can’t be read after a day of retries; the pool is split by equal weights:', err && err.message);
    views = {};
  }
  const ids = new Set(supportable.map((c) => c.userId));
  if (opts && opts.payees) for (const id of opts.payees) ids.add(id);
  const house = (opts && opts.house) || new Set();
  const leaving = (opts && opts.leaving) || new Set();
  const eligible = [...ids].filter((id) => id && id !== memberId && !house.has(id) && !leaving.has(id));
  const anyViews = eligible.some((id) => Number(views[id]) > 0);
  const pool = {};
  for (const id of eligible) pool[id] = anyViews ? Math.max(0, Number(views[id]) || 0) : 1;
  return pool;
}

// The attribution for a subscription: the row if it exists, else a new
// one from the via the subscription was stamped with at Checkout. A
// referred member whose lineup is empty starts with their referrer as the
// first pick (removable on the Artist Support page).
// Every read and write here throws on a real failure (before 088 there is
// no table and nothing to lock): the invoice fails and Stripe tries again,
// never a referral bonus dropped for good over a hiccup. Checkout stamps
// the creator's id (`via`), or — when it couldn't look the handle up —
// the handle (`via_handle`), resolved here; either way the strict makers'
// list (`supportableIds`) decides.
export async function lockReferralFromSubscription({ memberId, subscriptionId, subscription, supportableIds }) {
  const supabase = getSupabase();
  const existing = await supabase.from('member_referrals').select('*').eq('stripe_subscription_id', subscriptionId).maybeSingle();
  if (existing.error) {
    if (isMissingTable(existing.error)) return null;
    throw internalError(existing.error, 'member_referrals read');
  }
  if (existing.data) return existing.data;
  const meta = (subscription && subscription.metadata) || {};
  let via = meta.via;
  if (!via && meta.via_handle) {
    const handle = cleanViaSlug(meta.via_handle);
    via = handle ? await resolveProfileUserId(handle, { strict: true }) : null;
  }
  if (!looksLikeUserId(via) || via === memberId || !supportableIds.has(via)) return null;
  const source = meta.via_source === 'code' ? 'code' : 'link';
  const code = source === 'code' && meta.via_code ? String(meta.via_code).slice(0, 40) : null;
  const inserted = await supabase
    .from('member_referrals')
    .insert({ user_id: memberId, creator_id: via, stripe_subscription_id: subscriptionId, source, code })
    .select('*')
    .single();
  if (inserted.error) {
    if (inserted.error.code === '23505') {
      const again = await supabase.from('member_referrals').select('*').eq('stripe_subscription_id', subscriptionId).maybeSingle();
      if (again.error) throw internalError(again.error, 'member_referrals read');
      return again.data || null;
    }
    throw internalError(inserted.error, 'member_referrals insert');
  }
  const lineup = await supabase.from('member_lineups').select('creator_id', { count: 'exact', head: true }).eq('user_id', memberId);
  if (!lineup.error && !lineup.count) {
    const pick = await supabase.from('member_lineups').insert({ user_id: memberId, creator_id: via, weight: 1, position: 0 });
    if (pick.error && pick.error.code !== '23505') console.error('lockReferral first pick error:', pick.error.message);
  }
  return inserted.data;
}

// The charge behind an invoice: expanded on it, else one Stripe read (the
// charge, or the payment intent's latest charge). One Stripe no longer has
// reads as none; any other failure throws.
async function loadInvoiceCharge(invoice, deps) {
  if (invoice && invoice.charge && typeof invoice.charge === 'object') return invoice.charge;
  const chargeId = invoiceChargeId(invoice);
  const intentId = chargeId ? null : invoicePaymentIntentId(invoice);
  if (!chargeId && !intentId) return null;
  if (deps.retrieveCharge) return deps.retrieveCharge({ chargeId, paymentIntentId: intentId });
  if (!isStripeConfigured()) return null;
  try {
    if (chargeId) return await getStripe().charges.retrieve(chargeId);
    const intent = await getStripe().paymentIntents.retrieve(intentId, { expand: ['latest_charge'] });
    return intent && intent.latest_charge && typeof intent.latest_charge === 'object' ? intent.latest_charge : null;
  } catch (err) {
    if (err && (Number(err.statusCode) === 404 || err.code === 'resource_missing')) return null;
    throw internalError(err, 'creatorShare charge read');
  }
}

// Whether the invoice's charge was refunded in full or disputed before the
// invoice is recorded (creatorShareRules chargeReversalReason): a refund or
// a dispute that reached the webhook first found no payment to reverse
// (reverseMembershipCharge), so a late invoice.paid — Stripe's retry, the
// daily catch-up — would otherwise credit creators for money that went
// back. A read that fails throws while the invoice is young (Stripe tries
// again); past a day of retries it is logged and the invoice recorded as
// paid, as before.
async function chargeReversalFor(invoice, deps, { late }) {
  let charge = null;
  try {
    charge = await loadInvoiceCharge(invoice, deps);
  } catch (err) {
    if (!late) throw err;
    console.error(`creatorShare: the charge behind invoice ${invoice.id} still can’t be read after a day of retries; recorded as paid:`, err && err.message);
    return null;
  }
  return chargeReversalReason(charge);
}

// Who one month's share goes to (`shareCents` > 0): the member's picks
// (equal or their own weights), else the paid accounts of the titles they
// watched in the last 30 days, else the site-wide pool by views — read now,
// so a yearly member's later months follow the picks they have that day.
// The makers (lib/artistSupport.js) are who the watched share and the pool
// may credit; a pick may also name an account linked as a title's Studio or
// Producer (slice 6), read only when a pick isn't a maker. Every read
// throws when it fails (the invoice fails and Stripe tries again; a yearly
// month waits for the next run) — never a share sent past a real pick for
// good. `late` takes equal pool weights when the views still can't be
// read after a day.
async function shareEntriesFor({ memberId, supportable, supportableIds, late }) {
  const supabase = getSupabase();
  const [lineup, prefs] = await Promise.all([
    supabase.from('member_lineups').select('creator_id, weight, position').eq('user_id', memberId).order('position', { ascending: true }),
    supabase.from('user_profiles').select('lineup_mode').eq('user_id', memberId).maybeSingle()
  ]);
  // A lineup that can't be read is never read as "no picks", nor a mode
  // that can't be read as "equal shares" (both from migration 088, like
  // member_payments itself).
  if (lineup.error && !isMissingTable(lineup.error)) throw new Error(`member_lineups read failed: ${lineup.error.message}`);
  if (prefs.error && !isMissingTable(prefs.error)) throw internalError(prefs.error, 'user_profiles lineup_mode read');
  const lineupRows = lineup.data || [];
  const pickable = lineupRows.some((r) => !supportableIds.has(r.creator_id))
    ? new Set((await listSupportableCreators({ strict: true })).map((c) => c.userId))
    : supportableIds;
  const picks = lineupRows.filter((r) => pickable.has(r.creator_id)).map((r) => ({ creatorId: r.creator_id, weight: r.weight }));
  const mode = prefs.data && prefs.data.lineup_mode === 'custom' ? 'custom' : 'equal';
  // Who may be credited (slice 3b): a maker or a title's
  // paid account — never the studio's own accounts (a title paid to the
  // studio earns no members' share; the share goes to the other creators
  // the member watched, else the pool), never someone who left.
  // Each read throws when it fails (the invoice is tried again): never a
  // share sent to a leaver or a studio account because the list of them
  // couldn't be read. The studio's accounts are asked of Clerk by id
  // among everyone this invoice could credit (makers and paid accounts:
  // eligible() below takes no one else).
  let house = new Set();
  let payees = new Set();
  let leaving = new Set();
  if (!picks.length) {
    [payees, leaving] = await Promise.all([payeeAccountIds(), getLeavingIds({ strict: true })]);
    house = await studioAccountsAmong([...supportableIds, ...payees], { strict: true });
  }
  const eligible = (id) => !leaving.has(id) && !house.has(id) && (supportableIds.has(id) || payees.has(id));
  const watched = picks.length ? {} : await watchedCreators(memberId, eligible);
  const pool = picks.length || Object.keys(watched).length ? {} : await poolCreators(supportable, memberId, { house, payees, leaving, equalIfViewsFail: late });
  return chooseBasis({ picks, mode, watched, pool });
}

// How one invoice splits: the tier, the share and the bonus, and who they
// go to. Every read throws when it fails, so the invoice fails and Stripe
// tries again. `recorded` ({ shareCents, bonusCents }): the amounts a
// payment row already holds (writeMissingLines), split again rather than
// worked out again.
// Yearly Stream plans (migration 127): an invoice whose line bills a yearly
// price pays for 12 months of the share (invoiceBilling); its share and
// bonus here are one month's, fitted against a twelfth of what was paid,
// and are credited for month 1 now — the daily step credits the other 11.
// An invoice of prorations only (a plan switch inside its billing period)
// starts nothing and credits nothing new.
async function splitInvoice({ invoice, memberId, subscription, subscriptionId, late, deps, recorded = null }) {
  const [settings, plans, supportable] = await Promise.all([
    getShareSettings(),
    // Strict: a plans read that fails throws (Stripe tries again) rather
    // than falling back to the tier stamped at Checkout, which a member
    // who switched plans has since left — for a day; then the stamp.
    deps.plans ? Promise.resolve(deps.plans) : getMembershipPlans({ strict: true }).catch((err) => {
      if (!late) throw err;
      console.error(`creatorShare: plans still unreadable for invoice ${invoice.id} after a day of retries; the tier stamped at Checkout is used:`, err && err.message);
      return [];
    }),
    listMakerCreators({ strict: true })
  ]);
  const tier = tierForInvoice(invoice, plans, subscription && subscription.metadata);
  const billing = invoiceBilling(invoice, plans);
  const yearly = billing.yearly;
  const months = yearly ? YEARLY_MONTHS : 1;
  if (billing.prorationOnly) console.log(`creatorShare: invoice ${invoice.id} is prorations only (a plan switch inside its billing period); nothing new to credit`);
  const amountCents = Math.max(0, Math.round(Number(invoice.amount_paid) || 0));
  // What the member paid for the membership itself: amount_paid holds the
  // sales tax Stripe added on top (migration 122), which is never measured
  // as part of what creators may be credited.
  const paidCents = membershipPaidCents(amountCents, invoiceTaxCents(invoice));
  // A proration top-up or a one-off invoice isn't a paid month: no share
  // (fitShareToPayment), so no basis to choose for it either.
  const monthly = fitShareToPayment({ amountCents: paidCents, billingReason: invoice.billing_reason, shareCents: 1, bonusCents: 0, months, startsPeriod: yearly }).shareCents > 0;
  let shareCents = recorded ? Math.max(0, Math.round(Number(recorded.shareCents) || 0)) : monthly ? shareCentsFor(settings.shareCents, tier) : 0;
  const bonusCents = paidCents > 0 ? shareCentsFor(settings.bonusCents, tier) : 0;
  const supportableIds = new Set(supportable.map((c) => c.userId));

  // Attribution first: a referred member's first renewal already goes to
  // their referrer through the auto-pick below.
  const referral = await lockReferralFromSubscription({ memberId, subscriptionId, subscription, supportableIds });

  let basis = 'none';
  let entries = [];
  if (shareCents > 0) ({ basis, entries } = await shareEntriesFor({ memberId, supportable, supportableIds, late }));

  const paidAt = unixToIso(invoice.status_transitions && invoice.status_transitions.paid_at) || new Date().toISOString();
  // A referrer who has since left earns no more bonus (Terms section 5).
  const referrerLeft = referral ? (await getLeavingIds({ strict: true })).has(referral.creator_id) : false;
  const bonusReferral = referrerLeft ? null : referral;
  const earnsBonus = referralEarnsBonus(bonusReferral, paidAt, settings.referralBonusMonths);
  let bonusPaid;
  if (recorded) {
    bonusPaid = earnsBonus ? Math.max(0, Math.round(Number(recorded.bonusCents) || 0)) : 0;
  } else {
    bonusPaid = monthly && earnsBonus ? bonusCents : 0;
    // Never credit creators more than this invoice actually collected for
    // the membership (its tax left out) — a twelfth of it a month on a
    // yearly plan.
    ({ shareCents, bonusCents: bonusPaid } = fitShareToPayment({ amountCents: paidCents, billingReason: invoice.billing_reason, shareCents, bonusCents: bonusPaid, months, startsPeriod: yearly }));
  }
  // Who was the studio when this was earned (migration 122,
  // creator_ledger.studio): asked of Clerk by id for every account the lines
  // will credit, strictly and before anything is written — a role that
  // can't be read fails the invoice (Stripe tries again, then the daily
  // catch-up), never a line stamped on a guess.
  const studioAtPayment = await studioAccountsAmong([...entries.map((e) => e.id), ...(earnsBonus && bonusReferral ? [bonusReferral.creator_id] : [])], { strict: true });
  return { settings, tier, amountCents, shareCents, bonusPaid, basis, entries, referral, bonusReferral, earnsBonus, paidAt, studioAtPayment, yearly, prorationOnly: billing.prorationOnly };
}

// The ledger lines of one payment, stamped and with their stable ids. A
// yearly payment's lines say which month they are (month 1 here).
function paymentLines(split, { memberId, paymentId }) {
  const lines = stampLines(buildLedgerLines({
    memberId, paymentId, shareCents: split.shareCents, basis: split.basis, entries: split.entries, referral: split.bonusReferral, bonusCents: split.bonusPaid, paidAt: split.paidAt, bonusMonths: split.settings.referralBonusMonths
  }), split.studioAtPayment);
  return withLineIds(split.yearly ? lines.map((l) => ({ ...l, note: yearlyMonthNote(1) })) : lines);
}

// An invoice recorded before whose creator lines never went in: the run
// stopped between the payment row and its lines (a function killed, or the
// undo below failing), so every later delivery read it as done and the
// catch-up passed it by. On a repeat delivery a paid ('split') payment that
// promised a share or a bonus and has no line gets them now — split again
// over the amounts the row holds, with the same stable ids the first run
// would have used, so two runs at once can't both write them.
async function writeMissingLines(invoice, payment, deps) {
  const done = { duplicate: true, paymentId: payment.id };
  if (!paymentPromisesLines(payment)) return done;
  const supabase = getSupabase();
  const have = await supabase.from('creator_ledger').select('id').eq('payment_id', payment.id).limit(1);
  if (have.error) {
    if (isMissingTable(have.error)) return done;
    throw internalError(have.error, 'creator_ledger read');
  }
  if (have.data && have.data.length) return done;
  const subscriptionId = invoiceSubscriptionId(invoice);
  const late = !invoiceRetryVerdict(invoice).retry;
  const subscription = await loadSubscription(subscriptionId, deps);
  // A share the first run found nobody to give (basis 'none') stays ungiven.
  const recorded = { shareCents: payment.basis === 'none' ? 0 : payment.share_cents, bonusCents: payment.bonus_cents };
  const split = await splitInvoice({ invoice, memberId: payment.user_id, subscription, subscriptionId, late, deps, recorded });
  const lines = paymentLines(split, { memberId: payment.user_id, paymentId: payment.id });
  if (!lines.length) return done;
  const ins = await insertLedgerLines(lines, { supabase });
  if (ins.error) {
    // The same ids: another run wrote them a moment ago.
    if (ins.error.code === '23505') return done;
    throw new Error(`creator_ledger insert failed: ${ins.error.message}`);
  }
  if (split.basis !== payment.basis) {
    const upd = await supabase.from('member_payments').update({ basis: split.basis }).eq('id', payment.id);
    if (upd.error) console.error(`creatorShare: payment ${payment.id}'s basis not updated:`, upd.error.message);
  }
  console.warn(`creatorShare: invoice ${invoice.id} was recorded without its creator lines; ${lines.length} written now`);
  return { ...done, linesWritten: lines.length };
}

// The member's latest monthly payment that credited a month (still paid,
// with a share), paid no later than `paidAt`, and whether `paidAt` falls in
// the month it paid for (creatorShareRules yearlyStartsCredited). Before
// migration 127 there's no telling monthly from yearly: never covered (the
// yearly invoice then credits month 1 as a monthly one does). Any other
// read that fails throws (Stripe tries again).
//
// The monthly payment must be on the same subscription (2026-11-20 review:
// a member who cancelled a monthly plan at once and bought a year through
// Checkout paid for both, and the year's month 1 is owed).
async function monthOneAlreadyPaid(memberId, paidAt, subscriptionId) {
  let monthly = getSupabase()
    .from('member_payments')
    .select('paid_at')
    .eq('user_id', memberId)
    .eq('months', 1)
    .eq('status', 'split')
    .gt('share_cents', 0)
    .lte('paid_at', paidAt)
    .order('paid_at', { ascending: false })
    .limit(1);
  if (subscriptionId) monthly = monthly.eq('stripe_subscription_id', subscriptionId);
  const { data, error } = await monthly;
  if (error) {
    if (isMissingTable(error) || missing127(error)) return false;
    throw internalError(error, 'member_payments monthly read');
  }
  const last = (data || [])[0];
  return yearlyStartsCredited({ lastMonthlyPaidAt: last ? last.paid_at : null, paidAt });
}

// Stops the member's running yearly payments paid before this monthly
// invoice (a monthly invoice is about to credit a month): no further
// months, with the reason on the row unless it has one already — a year
// whose month 1 the monthly plan paid keeps that mark, or its month 1 would
// be credited again (creatorShareRules yearlySwitchStop). A monthly invoice
// older than the year (delivered late) leaves it alone. Before migration
// 127 there are none. Any other failure throws.
async function stopRunningYears(memberId, invoiceId, paidAt) {
  const supabase = getSupabase();
  const { data: running, error } = await supabase
    .from('member_payments')
    .select('id, months_credited, reverse_reason')
    .eq('user_id', memberId)
    .eq('months', YEARLY_MONTHS)
    .eq('status', 'split')
    .is('stopped_at', null)
    .not('next_month_at', 'is', null)
    .lt('paid_at', paidAt);
  if (error) {
    if (isMissingTable(error) || missing127(error)) return 0;
    throw internalError(error, 'member_payments switch stop');
  }
  let stopped = 0;
  for (const p of running || []) {
    // Still paid and not stopped (a refund or another invoice may have got
    // there first; then there is nothing left to stop).
    const upd = await supabase.from('member_payments').update(yearlySwitchStop(p, new Date().toISOString()))
      .eq('id', p.id).eq('status', 'split').is('stopped_at', null)
      .select('id');
    if (upd.error) throw internalError(upd.error, 'member_payments switch stop');
    if (!upd.data || upd.data.length === 0) continue;
    stopped += 1;
    console.log(`creatorShare: yearly payment ${p.id} stopped after month ${p.months_credited} of ${YEARLY_MONTHS} — the member switched to monthly (invoice ${invoiceId})`);
  }
  return stopped;
}

// invoice.paid: record the payment and write the ledger lines. Idempotent
// on the invoice id (the stripe_events table guards the event id; this
// guards the invoice itself). `deps` lets tests inject the plans, the
// subscription and the charge instead of calling Stripe.
export async function recordMembershipInvoice(invoice, deps = {}) {
  if (!invoice || invoice.status !== 'paid') return { skipped: 'not a paid invoice' };
  const subscriptionId = invoiceSubscriptionId(invoice);
  if (!subscriptionId) return { skipped: 'not a subscription invoice' };
  const supabase = getSupabase();

  const seen = await supabase.from('member_payments').select('id, user_id, status, share_cents, bonus_cents, basis, reverse_reason').eq('stripe_invoice_id', invoice.id).maybeSingle();
  if (seen.error) {
    if (isMissingTable(seen.error)) return { skipped: 'migration 088 not run' };
    throw new Error(`member_payments read failed: ${seen.error.message}`);
  }
  if (seen.data) return writeMissingLines(invoice, seen.data, deps);

  // Past a day of Stripe's retries, a read that keeps failing (the plans,
  // the views, the Stripe customer) takes the answer it gave before the
  // strict reads instead of failing again (creatorShareRules
  // invoiceRetryVerdict): the payment is recorded, never lost when Stripe
  // gives up.
  const late = !invoiceRetryVerdict(invoice).retry;
  const subscription = await loadSubscription(subscriptionId, deps);
  const memberId = await memberForInvoice(invoice, subscription, deps, { late });
  if (!memberId) {
    // Nothing names the member yet. While the invoice is young this throws,
    // so Stripe tries again (Stripe retries for days; the member may still
    // be on their way in); past the window it is skipped, with the reason
    // in the log. The invoice id is enough to find it in Stripe; customer
    // ids stay out of the logs (the security round's rule).
    const verdict = invoiceRetryVerdict(invoice);
    if (!late) {
      const err = new Error(`creatorShare: no member for invoice ${invoice.id} yet (${verdict.ageHours} h old) — Stripe tries again`);
      err.status = 503;
      throw err;
    }
    console.error(`creatorShare: no member for invoice ${invoice.id} after ${verdict.ageHours == null ? 'an unknown time' : `${verdict.ageHours} h`} (no member_customers row, no member on the subscription, no Clerk id on the customer) — not recorded`);
    return { skipped: 'member unknown' };
  }

  const split = await splitInvoice({ invoice, memberId, subscription, subscriptionId, late, deps });
  const { tier, amountCents, shareCents, bonusPaid, basis, earnsBonus, referral, paidAt } = split;
  // Refunded in full or disputed already (the refund or the dispute got to
  // the webhook first): recorded as reversed, the way reverseMembershipCharge
  // would have left it — read last, just before anything is written.
  const reversedAs = await chargeReversalFor(invoice, deps, { late });
  const nowIso = new Date().toISOString();
  // A yearly payment (migration 127) carries its schedule: 12 months, month
  // 1 credited now, month 2 due a calendar month after it was paid (none
  // when it was refunded or disputed before it got here). Only one with
  // something to credit has a schedule; a yearly invoice that paid nothing
  // toward the share is recorded like any other.
  const schedule = split.yearly && shareCents + bonusPaid > 0 ? yearlyScheduleStart(paidAt, { stoppedAt: reversedAs ? nowIso : null }) : {};
  // Monthly → yearly: the month this yearly payment starts in was already
  // credited by the member's monthly payment, so month 1 is recorded as
  // credited with no lines of its own and the cron credits the 11 after it
  // (creatorShareRules yearlyStartsCredited).
  const monthOneCovered = Object.keys(schedule).length > 0 && !reversedAs && (await monthOneAlreadyPaid(memberId, paidAt, subscriptionId));
  // Yearly → monthly: a monthly invoice that credits a month stops the
  // member's running year first, so the two never credit the same month
  // (creatorShareRules monthlyStopsYear). A failed stop throws (Stripe tries
  // again) before anything is credited.
  if (!reversedAs && monthlyStopsYear({ yearly: split.yearly, prorationOnly: split.prorationOnly, creditsMonth: shareCents + bonusPaid > 0 })) {
    await stopRunningYears(memberId, invoice.id, paidAt);
  }
  const row = {
    user_id: memberId,
    stripe_invoice_id: invoice.id,
    stripe_subscription_id: subscriptionId,
    stripe_customer_id: invoiceCustomerId(invoice),
    stripe_charge_id: invoiceChargeId(invoice) || invoicePaymentIntentId(invoice),
    tier,
    amount_cents: amountCents,
    // Sales tax Stripe added on top (migration 122), inside amount_cents;
    // never part of the share. Only an invoice with tax writes the
    // column, and only a database with 122 can produce one (Checkout adds
    // tax only while Admin → Settings → Sales tax reads on).
    ...(invoiceTaxCents(invoice) > 0 ? { tax_cents: invoiceTaxCents(invoice) } : {}),
    share_cents: shareCents,
    bonus_cents: bonusPaid,
    basis,
    status: reversedAs ? 'reversed' : 'split',
    ...(reversedAs ? { reversed_at: nowIso, reverse_reason: reversedAs } : {}),
    // The record that month 1's lines were never owed (paymentPromisesLines),
    // so neither a repeat delivery nor the daily catch-up writes them.
    ...(monthOneCovered ? { reverse_reason: YEARLY_MONTH1_COVERED } : {}),
    period_start: unixToIso(invoice.period_start),
    period_end: unixToIso(invoice.period_end),
    paid_at: paidAt,
    ...schedule
  };
  let payment = await supabase.from('member_payments').insert(row).select('*').single();
  if (payment.error && Object.keys(schedule).length && missing127(payment.error)) {
    // Before migration 127 a yearly invoice is recorded as a monthly one:
    // month 1 is credited below, the other 11 have nowhere to be scheduled.
    console.warn(`creatorShare: invoice ${invoice.id} is a yearly plan but migration 127 isn’t run — month 1 credited, the other 11 months aren’t scheduled`);
    payment = await supabase.from('member_payments').insert(without127(row)).select('*').single();
  }
  if (payment.error) {
    if (payment.error.code === '23505') return { duplicate: true };
    throw new Error(`member_payments insert failed: ${payment.error.message}`);
  }

  if (monthOneCovered) console.log(`creatorShare: yearly payment ${payment.data.id} starts in a month the member’s monthly plan already credited — month 1 recorded as credited, the other 11 by the daily step`);
  const credits = monthOneCovered ? [] : paymentLines(split, { memberId, paymentId: payment.data.id });
  // A reversed payment's credits go in with their reversals (one insert:
  // both or neither), each reversal with its own stable id.
  const lines = reversedAs ? [...credits, ...withLineIds(reversalLinesFor(credits, `membership payment ${reversedAs}`))] : credits;
  if (lines.length) {
    const ledger = await insertLedgerLines(lines, { supabase });
    if (ledger.error) {
      // The same ids: a repeat delivery wrote this payment's lines a moment
      // ago (writeMissingLines). Done; the payment row stays.
      if (ledger.error.code === '23505') return { duplicate: true, paymentId: payment.data.id };
      // Undo the payment row so Stripe's retry records this invoice again.
      // If the undo fails too, the retry finds the payment without its lines
      // and writes them (writeMissingLines).
      const undo = await supabase.from('member_payments').delete().eq('id', payment.data.id);
      if (undo.error) console.error(`creatorShare: payment ${payment.data.id} left without its lines (the undo failed: ${undo.error.message}); the next delivery writes them`);
      throw new Error(`creator_ledger insert failed: ${ledger.error.message}`);
    }
  }
  return {
    paymentId: payment.data.id,
    memberId,
    tier,
    amountCents,
    shareCents,
    bonusCents: bonusPaid,
    basis,
    lines: credits.length,
    ...(reversedAs ? { reversed: reversedAs } : {}),
    ...(split.yearly ? { yearly: true, scheduled: Boolean(payment.data && payment.data.next_month_at), ...(monthOneCovered ? { monthOneCovered: true } : {}) } : {}),
    referralCreatorId: earnsBonus ? referral.creator_id : null
  };
}

// customer.subscription.deleted: the attribution ends with the subscription
// (a resubscribe is a new subscription and a new attribution).
export async function endReferralForSubscription(subscriptionId) {
  if (!subscriptionId) return 0;
  const { data, error } = await getSupabase()
    .from('member_referrals')
    .update({ ended_at: new Date().toISOString() })
    .eq('stripe_subscription_id', subscriptionId)
    .is('ended_at', null)
    .select('id');
  if (error) {
    if (!isMissingTable(error)) console.error('endReferralForSubscription error:', error.message);
    return 0;
  }
  return (data || []).length;
}

const chargeIdsOf = (charge) => [charge && charge.id, charge && (typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent && charge.payment_intent.id)].filter(Boolean);

// The reversals a payment still owes: one per credit not yet reversed (a
// reversal names its credit, reverses_id), each with its stable id
// (lib/ledgerIds.js), so a reversal written twice — a retry after the
// status update failed, or the daily yearly step reversing a month it
// wrote while this ran — is refused (23505) rather than taken twice; a
// collision reads the lines again. → how many went in.
async function reverseOutstandingLines(supabase, paymentId, reason) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const lines = await supabase.from('creator_ledger').select('*').eq('payment_id', paymentId);
    if (lines.error) throw new Error(`creator_ledger read failed: ${lines.error.message}`);
    const all = lines.data || [];
    const done = new Set(all.filter((l) => l.kind === 'reversal' && l.reverses_id).map((l) => l.reverses_id));
    // Each reversal carries its credit's stamp (reversalLinesFor).
    const reversals = withLineIds(reversalLinesFor(all.filter((l) => !done.has(l.id)), `membership payment ${reason}`));
    if (!reversals.length) return 0;
    const ins = await insertLedgerLines(reversals, { supabase });
    if (!ins.error) return reversals.length;
    if (ins.error.code !== '23505') throw new Error(`creator_ledger reversal failed: ${ins.error.message}`);
  }
  throw new Error('creator_ledger reversal: the lines kept changing while they were reversed');
}

// charge.refunded (full) / charge.dispute.created on a membership charge:
// the payment's unpaid credits are taken back. Paid-out lines stay — the
// studio absorbs those, the same posture as Pitch Room refunds. A yearly
// payment (migration 127) also stops: the months not yet credited never
// are (stopped_at, no next month); a dispute the studio later wins gives
// back what was taken (restoreMembershipCharge) and doesn't restart them.
export async function reverseMembershipCharge(charge, reason = 'refunded') {
  const ids = chargeIdsOf(charge);
  if (!ids.length) return { reversed: 0 };
  const supabase = getSupabase();
  const found = await supabase.from('member_payments').select('*').in('stripe_charge_id', ids).eq('status', 'split').limit(1).maybeSingle();
  if (found.error) {
    if (isMissingTable(found.error)) return { reversed: 0 };
    // Throws (the event fails and Stripe tries again): answering "no
    // payment" would leave the credits standing for money that went back.
    throw internalError(found.error, 'member_payments read');
  }
  const payment = found.data;
  if (!payment) return { reversed: 0 };
  // The reversals first, then the status: a retry after the reversals went
  // in but the status didn't finds the payment again and reverses only what
  // isn't reversed yet.
  const reversed = await reverseOutstandingLines(supabase, payment.id, reason);
  const nowIso = new Date().toISOString();
  const patch = { status: 'reversed', reversed_at: nowIso, reverse_reason: reason, ...(Number(payment.months) === YEARLY_MONTHS ? { stopped_at: payment.stopped_at || nowIso, next_month_at: null } : {}) };
  let upd = await supabase.from('member_payments').update(patch).eq('id', payment.id);
  if (upd.error && missing127(upd.error)) upd = await supabase.from('member_payments').update(without127(patch)).eq('id', payment.id);
  if (upd.error) throw new Error(`member_payments reverse failed: ${upd.error.message}`);
  // A yearly month the daily step credited while this ran (it claimed the
  // month before the status changed and wrote its lines after the read
  // above) is taken back too.
  const late = Number(payment.months) === YEARLY_MONTHS ? await reverseOutstandingLines(supabase, payment.id, reason) : 0;
  return { reversed: reversed + late, paymentId: payment.id };
}

// charge.refunded on a yearly membership payment (migration 127), in full
// or in part: the months not yet credited stop. A partial refund stops
// them and nothing else (the months already credited stand, as a partial
// refund of a monthly payment leaves its credits); a full refund also
// reverses the unpaid credits (reverseMembershipCharge). A monthly payment
// has nothing to stop. Before 127 there is nothing to stop either.
export async function stopMembershipMonths(charge, reason = 'refunded') {
  const ids = chargeIdsOf(charge);
  if (!ids.length) return { stopped: 0 };
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('member_payments')
    .update({ stopped_at: new Date().toISOString(), next_month_at: null })
    .in('stripe_charge_id', ids)
    .eq('months', YEARLY_MONTHS)
    .is('stopped_at', null)
    .select('id, months_credited');
  if (error) {
    if (isMissingTable(error) || missing127(error)) return { stopped: 0, skipped: 'migration 127 not run' };
    // Throws (Stripe tries again): never a refunded year left crediting.
    throw internalError(error, 'member_payments stop');
  }
  for (const p of data || []) console.log(`creatorShare: yearly payment ${p.id} ${reason} — stopped after month ${p.months_credited} of ${YEARLY_MONTHS}`);
  return { stopped: (data || []).length };
}

// ---- yearly plans: the months after the first (migration 127) -------------
// Jose, 2026-11-19: "have the credit go month by month. this allows the
// user to change who they support after each month". The daily cron
// (/api/cron/creator-reminders) credits every yearly payment whose next
// month is due: one month's share, split by the member's picks — or their
// watching, or the pool — as they are that day, plus the referral bonus
// while its window lasts on that month's date.
//
// The order (review, 2026-11-19: a run killed between moving the counter
// and writing the lines lost the month for good):
//   1. a lease: next_month_at moves YEARLY_LEASE_MS ahead, only while the
//      month is still due, months_credited still reads k − 1 and the year
//      is still paid and not stopped — so two runs never work on the same
//      month at once (the other finds nothing to lease);
//   2. month k's lines, unless they are in already (found by their note: a
//      run that stopped after writing them and before step 3) — the lines
//      carry stable ids per payment and month (lib/ledgerIds.js), and a
//      second split is never written over a first, which may have gone to
//      other creators (the member's picks change between runs);
//   3. the counter: months_credited k − 1 → k and the next month's date,
//      still only while the year is paid and not stopped.
// A run killed after 1 leaves the month due again when the lease runs out;
// one killed after 2 has the next run find the lines and only move the
// counter. A run credits at most YEARLY_RUN_MAX months in about
// YEARLY_RUN_MS (the cron's other steps, the Stripe catch-up's 25 s among
// them, share one function's time); the rest wait for the next run. One
// payment that fails waits for the next run and never stops the others.
const YEARLY_RUN_MAX = 300;
const YEARLY_RUN_MS = 20000;
// Far longer than any run (a function is stopped long before), so a lease
// never runs out under a run still working on its month.
const YEARLY_LEASE_MS = 30 * 60000;

async function creditYearlyMonth(payment, k, ctx, now) {
  const supabase = getSupabase();
  const memberId = payment.user_id;
  const nowMs = new Date(now).getTime();
  // The month's own date, from when the year was paid (next_month_at may
  // hold an earlier run's lease that ran out).
  const due = yearlyMonthDue(payment.paid_at, k);
  const note = yearlyMonthNote(k);

  // 1. The lease.
  const leaseUntil = new Date(nowMs + YEARLY_LEASE_MS).toISOString();
  const lease = await supabase.from('member_payments').update({ next_month_at: leaseUntil })
    .eq('id', payment.id).eq('months_credited', k - 1).eq('status', 'split').is('stopped_at', null)
    .lte('next_month_at', new Date(nowMs).toISOString())
    .select('id');
  if (lease.error) throw internalError(lease.error, 'member_payments yearly claim');
  // Another run has this month, or a refund or dispute stopped the year.
  if (!lease.data || lease.data.length === 0) return { busy: true };
  // Gives the month back at once (rather than when the lease runs out) when
  // this run can't credit it.
  const handBack = async () => {
    const back = await supabase.from('member_payments').update({ next_month_at: due })
      .eq('id', payment.id).eq('months_credited', k - 1).eq('next_month_at', leaseUntil).select('id');
    if (back.error) console.error(`creatorShare: month ${k} of yearly payment ${payment.id} wasn’t handed back (${back.error.message}); it is due again in ${YEARLY_LEASE_MS / 60000} minutes`);
  };

  // 2. Month k's lines, unless a run that stopped before step 3 wrote them.
  let lines = [];
  let basis = null;
  try {
    const have = await supabase.from('creator_ledger').select('id').eq('payment_id', payment.id).eq('note', note).in('kind', ['member_share', 'referral']).limit(1);
    if (have.error) throw internalError(have.error, 'creator_ledger read');
    if (!(have.data && have.data.length)) {
      // A month a day overdue takes the invoice's late answers (equal pool
      // weights when the views still can't be read), so a Redis that stays
      // down can't hold the year back for good.
      const late = nowMs - new Date(due).getTime() > INVOICE_RETRY_HOURS * 3600000;
      const shareCents = Math.max(0, Math.round(Number(payment.share_cents) || 0));
      const split = shareCents > 0
        ? await shareEntriesFor({ memberId, supportable: ctx.supportable, supportableIds: ctx.supportableIds, late })
        : { basis: 'none', entries: [] };
      basis = split.basis;
      // The bonus, by that month's date: the referral read now (one that has
      // ended or been voided earns nothing more), never a referrer who left.
      let bonusReferral = null;
      let bonusCents = 0;
      const bonusAmount = Math.max(0, Math.round(Number(payment.bonus_cents) || 0));
      if (bonusAmount > 0 && payment.stripe_subscription_id) {
        const ref = await supabase.from('member_referrals').select('*').eq('stripe_subscription_id', payment.stripe_subscription_id).maybeSingle();
        if (ref.error && !isMissingTable(ref.error)) throw internalError(ref.error, 'member_referrals read');
        const referral = ref.data || null;
        if (referral && referralEarnsBonus(referral, due, ctx.settings.referralBonusMonths)) {
          const left = (await getLeavingIds({ strict: true })).has(referral.creator_id);
          if (!left) {
            bonusReferral = referral;
            bonusCents = bonusAmount;
          }
        }
      }
      const studio = await studioAccountsAmong([...split.entries.map((e) => e.id), ...(bonusReferral ? [bonusReferral.creator_id] : [])], { strict: true });
      const built = stampLines(buildLedgerLines({ memberId, paymentId: payment.id, shareCents, basis: split.basis, entries: split.entries, referral: bonusReferral, bonusCents, paidAt: due, bonusMonths: ctx.settings.referralBonusMonths }), studio);
      lines = withLineIds(built.map((l) => ({ ...l, note })), { month: k });
      if (lines.length) {
        const ins = await insertLedgerLines(lines, { supabase });
        // 23505: the same ids are already in — this month's lines exist.
        if (ins.error && ins.error.code !== '23505') throw new Error(`creator_ledger insert failed: ${ins.error.message}`);
      }
    }
  } catch (err) {
    await handBack();
    throw err;
  }

  // 3. The counter, while the year is still paid and not stopped.
  const after = afterYearlyMonth(payment.paid_at, k);
  const adv = await supabase.from('member_payments').update(after)
    .eq('id', payment.id).eq('months_credited', k - 1).eq('status', 'split').is('stopped_at', null)
    .select('id');
  // A failure here leaves the lines in and the lease running: the next run
  // finds the lines and moves the counter.
  if (adv.error) throw internalError(adv.error, 'member_payments yearly advance');
  if (adv.data && adv.data.length) return { lines: lines.length, basis, after };

  // Refunded, disputed or stopped while this ran.
  const nowRow = await supabase.from('member_payments').select('status, reverse_reason, stopped_at').eq('id', payment.id).maybeSingle();
  if (nowRow.error || !nowRow.data) throw internalError(nowRow.error || new Error('payment gone'), 'member_payments yearly read');
  if (nowRow.data.status === 'reversed') {
    // Reversed (reverseMembershipCharge read its lines before these were
    // in): they are taken back too, with the same stable reversal ids it
    // uses.
    await reverseOutstandingLines(supabase, payment.id, nowRow.data.reverse_reason || 'reversed');
  } else if (nowRow.data.stopped_at) {
    // Stopped (a partial refund, a switch to monthly) after the month was
    // due and leased: it was owed, and its lines are in — the counter says so.
    const mark = await supabase.from('member_payments').update({ months_credited: k }).eq('id', payment.id).eq('months_credited', k - 1).select('id');
    if (mark.error) console.error(`creatorShare: month ${k} of stopped yearly payment ${payment.id} is in but its counter wasn’t moved (${mark.error.message})`);
  }
  return { lines: lines.length, basis, stopped: true };
}

export async function creditYearlyMonths({ now = new Date(), maxMonths = YEARLY_RUN_MAX, budgetMs = YEARLY_RUN_MS } = {}) {
  const supabase = getSupabase();
  const started = Date.now();
  const out = { due: 0, credited: 0, lines: 0, finished: 0, busy: 0, failed: 0, waiting: 0 };
  const { data, error } = await supabase
    .from('member_payments')
    .select('*')
    .eq('months', YEARLY_MONTHS)
    .eq('status', 'split')
    .is('stopped_at', null)
    .not('next_month_at', 'is', null)
    .lte('next_month_at', new Date(now).toISOString())
    .order('next_month_at', { ascending: true })
    .limit(maxMonths);
  if (error) {
    if (isMissingTable(error) || missing127(error)) return { ...out, skipped: 'migration 127 not run' };
    throw internalError(error, 'member_payments yearly read');
  }
  const rows = data || [];
  out.due = rows.length;
  if (!rows.length) return out;
  // Read once a run: the share numbers and who the makers are (strict: a
  // read that fails throws, and every month waits for the next run).
  const [settings, supportable] = await Promise.all([getShareSettings(), listMakerCreators({ strict: true })]);
  const ctx = { settings, supportable, supportableIds: new Set(supportable.map((c) => c.userId)) };
  for (const row of rows) {
    let payment = row;
    // A run that fell behind (the cron down for a while) catches a payment
    // up month by month, each split as things are today.
    for (;;) {
      const k = yearlyMonthDueNow(payment, now);
      if (!k) break;
      if (out.credited >= maxMonths || Date.now() - started > budgetMs) {
        out.waiting += 1;
        break;
      }
      try {
        const r = await creditYearlyMonth(payment, k, ctx, now);
        if (r.busy) {
          out.busy += 1;
          break;
        }
        out.credited += 1;
        out.lines += r.lines;
        // Refunded, disputed or stopped while it ran: no month after it.
        if (r.stopped) break;
        if (k === YEARLY_MONTHS) out.finished += 1;
        payment = { ...payment, ...r.after };
      } catch (err) {
        out.failed += 1;
        console.error(`creditYearlyMonths: month ${k} of payment ${payment.id} not credited (the next run tries again):`, err && err.message);
        break;
      }
    }
  }
  return out;
}

// What the running yearly payments will still credit (Studio money's "has
// to stay", lib/studioMoneyRules.js canLeaveCents): the months not yet
// credited × each one's monthly share, plus the bonus months still inside
// their referral's window (creatorShareRules yearlySharesAhead). Before
// migration 127 there are none. A read that fails throws (the page says it
// couldn't load) — never less kept in Stripe than is owed.
//   → { cents, payments, months, available }
export async function getYearlySharesAhead() {
  const supabase = getSupabase();
  // Paged: Supabase answers 1,000 rows at most however high the limit, and
  // a count that stopped there would let a sweep take creators' months
  // still to come (2026-11-20 review).
  const PAGE = 1000;
  const payments = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('member_payments')
      .select('id, stripe_subscription_id, share_cents, bonus_cents, months, months_credited, next_month_at, stopped_at, status, paid_at')
      .eq('months', YEARLY_MONTHS)
      .eq('status', 'split')
      .is('stopped_at', null)
      .not('next_month_at', 'is', null)
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) {
      if (isMissingTable(error) || missing127(error)) return { cents: 0, payments: 0, months: 0, available: false };
      throw internalError(error, 'member_payments yearly read');
    }
    payments.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }
  const subs = [...new Set(payments.filter((p) => Number(p.bonus_cents) > 0).map((p) => p.stripe_subscription_id).filter(Boolean))];
  const referrals = {};
  for (let i = 0; i < subs.length; i += 100) {
    const r = await supabase.from('member_referrals').select('*').in('stripe_subscription_id', subs.slice(i, i + 100));
    if (r.error) {
      if (isMissingTable(r.error)) break;
      throw internalError(r.error, 'member_referrals read');
    }
    for (const ref of r.data || []) referrals[ref.stripe_subscription_id] = ref;
  }
  const settings = await getShareSettings();
  return { ...yearlySharesAhead(payments, { referrals, bonusMonths: settings.referralBonusMonths }), available: true };
}

// charge.dispute.closed, won: the money is back in the balance, so the
// credits reverseMembershipCharge took back are given back — one positive
// 'adjustment' line per reversal line (security round 2, 2026-10-28;
// migration 114's restored_at claims the payment first, so a replayed
// event credits nothing twice). The payment stays 'reversed' with its
// reason, so Studio money still sees the dispute; before 114 this logs
// and does nothing.
export async function restoreMembershipCharge(charge) {
  const ids = [charge && charge.id, charge && (typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent && charge.payment_intent.id)].filter(Boolean);
  if (!ids.length) return { restored: 0 };
  const supabase = getSupabase();
  const found = await supabase.from('member_payments').select('*').in('stripe_charge_id', ids).eq('status', 'reversed').limit(1).maybeSingle();
  if (found.error) {
    if (isMissingTable(found.error)) return { restored: 0 };
    // Throws (Stripe tries again): never a won dispute's credits left
    // reversed over a hiccup.
    throw internalError(found.error, 'member_payments read');
  }
  const payment = found.data;
  if (!payment || !/disput/i.test(payment.reverse_reason || '')) return { restored: 0 };
  const now = new Date().toISOString();
  const claimed = await supabase.from('member_payments').update({ restored_at: now }).eq('id', payment.id).is('restored_at', null).select('id');
  if (claimed.error) {
    if (/restored_at/.test(claimed.error.message || '')) {
      console.error('restoreMembershipCharge: migration 114 not run — reversed credits not given back for payment', payment.id);
      return { skipped: 'migration 114 not run' };
    }
    throw new Error(`member_payments restore failed: ${claimed.error.message}`);
  }
  if (!claimed.data || claimed.data.length === 0) return { duplicate: true, paymentId: payment.id };
  const lines = await supabase.from('creator_ledger').select('*').eq('payment_id', payment.id).eq('kind', 'reversal');
  if (lines.error) throw new Error(`creator_ledger read failed: ${lines.error.message}`);
  // One positive line per reversal, in the reversal's place (its stamp).
  const restores = restoreLinesFor(lines.data || []);
  if (restores.length) {
    const ins = await insertLedgerLines(restores, { supabase });
    if (ins.error) throw new Error(`creator_ledger restore failed: ${ins.error.message}`);
  }
  for (const creatorId of new Set(restores.map((l) => l.creator_id))) {
    const cents = restores.filter((l) => l.creator_id === creatorId).reduce((s, l) => s + l.cents, 0);
    notifyCreator({ userId: creatorId, type: 'payout', message: `The bank ruled for ${SITE.name} on a disputed membership payment, so ${dollars(cents)} of creator share is yours again.`, href: '/creator/money' }).catch(() => {});
  }
  return { restored: restores.length, paymentId: payment.id };
}

// The creator's referral card: their link and what it has done.
export async function getReferralStats(creatorId) {
  const supabase = getSupabase();
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const [profile, settings, referrals, ledger, lineups] = await Promise.all([
    getOwnProfile(creatorId),
    getShareSettings(),
    supabase.from('member_referrals').select('id, ended_at, voided_at, locked_at').eq('creator_id', creatorId),
    supabase.from('creator_ledger').select('cents, created_at, referral_id, kind').eq('creator_id', creatorId).not('referral_id', 'is', null),
    supabase.from('member_lineups').select('user_id', { count: 'exact', head: true }).eq('creator_id', creatorId)
  ]);
  const refs = referrals.data || [];
  // Referral lines only (credits and their reversals); filtered here too,
  // not just in the query, so the sums can't drift with the backend.
  const lines = (ledger.data || []).filter((l) => l.referral_id);
  const month = lines.filter((l) => l.created_at && l.created_at >= monthStart.toISOString()).reduce((s, l) => s + Number(l.cents), 0);
  const total = lines.reduce((s, l) => s + Number(l.cents), 0);
  const handle = profile && profile.handle ? profile.handle : null;
  return {
    handle,
    linkPath: `/@${handle || creatorId}`,
    bonusTable: settings.bonusCents,
    shareTable: settings.shareCents,
    bonusMonths: settings.referralBonusMonths,
    joined: refs.length,
    active: refs.filter(referralIsActive).length,
    bonusMonthCents: Math.max(0, month),
    bonusTotalCents: Math.max(0, total),
    pickedBy: lineups.error ? 0 : lineups.count || 0,
    available: !referrals.error || !isMissingTable(referrals.error)
  };
}
