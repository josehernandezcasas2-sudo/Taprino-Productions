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
import { payeeAccountIds, payeeAtFor, readPayeeContext, studioAccountsAmong } from './payees';
import { insertLedgerLines } from './ledgerWrites';
import {
  buildLedgerLines, chooseBasis, cleanViaSlug, countWatched, invoiceChargeId, invoiceCustomerId, invoicePaymentIntentId, invoiceSubscriptionId,
  invoiceRetryVerdict, referralEarnsBonus, referralIsActive, restoreLinesFor, reversalLinesFor, stampLines, tierForInvoice, fitShareToPayment
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
  if (error || !data || data.length === 0) return {};
  const ids = [...new Set(data.map((r) => r.episode_id).filter(Boolean))];
  const eps = await supabase.from('episodes').select('id').in('id', ids).eq('status', 'approved').eq('moderation_hold', false);
  if (eps.error || !eps.data) return {};
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

// invoice.paid: record the payment and write the ledger lines. Idempotent
// on the invoice id (the stripe_events table guards the event id; this
// guards the invoice itself). `deps` lets tests inject the plans and the
// subscription instead of calling Stripe.
export async function recordMembershipInvoice(invoice, deps = {}) {
  if (!invoice || invoice.status !== 'paid') return { skipped: 'not a paid invoice' };
  const subscriptionId = invoiceSubscriptionId(invoice);
  if (!subscriptionId) return { skipped: 'not a subscription invoice' };
  const supabase = getSupabase();

  const seen = await supabase.from('member_payments').select('id').eq('stripe_invoice_id', invoice.id).maybeSingle();
  if (seen.error) {
    if (isMissingTable(seen.error)) return { skipped: 'migration 088 not run' };
    throw new Error(`member_payments read failed: ${seen.error.message}`);
  }
  if (seen.data) return { duplicate: true, paymentId: seen.data.id };

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

  // The makers (lib/artistSupport.js) are who the referral bonus, the
  // watched share and the pool may credit; a member's picks may also name
  // an account linked as a title's Studio or Producer (slice 6), read only
  // when a pick isn't a maker. Both reads throw when anything fails, so
  // this invoice fails and Stripe tries again — never a share sent past a
  // real pick for good.
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
  const amountCents = Math.max(0, Math.round(Number(invoice.amount_paid) || 0));
  // A proration top-up or a one-off invoice isn't a paid month: no share
  // (fitShareToPayment), so no basis to choose for it either.
  const monthly = fitShareToPayment({ amountCents, billingReason: invoice.billing_reason, shareCents: 1, bonusCents: 0 }).shareCents > 0;
  let shareCents = monthly ? shareCentsFor(settings.shareCents, tier) : 0;
  const bonusCents = amountCents > 0 ? shareCentsFor(settings.bonusCents, tier) : 0;
  const supportableIds = new Set(supportable.map((c) => c.userId));

  // Attribution first: a referred member's first renewal already goes to
  // their referrer through the auto-pick below.
  const referral = await lockReferralFromSubscription({ memberId, subscriptionId, subscription, supportableIds });

  let basis = 'none';
  let entries = [];
  if (shareCents > 0) {
    const [lineup, prefs] = await Promise.all([
      supabase.from('member_lineups').select('creator_id, weight, position').eq('user_id', memberId).order('position', { ascending: true }),
      supabase.from('user_profiles').select('lineup_mode').eq('user_id', memberId).maybeSingle()
    ]);
    // A lineup that can't be read is never read as "no picks".
    if (lineup.error && !isMissingTable(lineup.error)) throw new Error(`member_lineups read failed: ${lineup.error.message}`);
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
    ({ basis, entries } = chooseBasis({ picks, mode, watched, pool }));
  }

  const paidAt = unixToIso(invoice.status_transitions && invoice.status_transitions.paid_at) || new Date().toISOString();
  // A referrer who has since left earns no more bonus (Terms section 5).
  const referrerLeft = referral ? (await getLeavingIds({ strict: true })).has(referral.creator_id) : false;
  const bonusReferral = referrerLeft ? null : referral;
  const earnsBonus = referralEarnsBonus(bonusReferral, paidAt, settings.referralBonusMonths);
  let bonusPaid = monthly && earnsBonus ? bonusCents : 0;
  // Never credit creators more than this invoice actually collected.
  ({ shareCents, bonusCents: bonusPaid } = fitShareToPayment({ amountCents, billingReason: invoice.billing_reason, shareCents, bonusCents: bonusPaid }));
  // Who was the studio when this was earned (migration 122,
  // creator_ledger.studio): asked of Clerk by id for every account the lines
  // will credit, strictly and before anything is written — a role that
  // can't be read fails the invoice (Stripe tries again, then the daily
  // catch-up), never a line stamped on a guess.
  const studioAtPayment = await studioAccountsAmong([...entries.map((e) => e.id), ...(earnsBonus && bonusReferral ? [bonusReferral.creator_id] : [])], { strict: true });
  const payment = await supabase
    .from('member_payments')
    .insert({
      user_id: memberId,
      stripe_invoice_id: invoice.id,
      stripe_subscription_id: subscriptionId,
      stripe_customer_id: invoiceCustomerId(invoice),
      stripe_charge_id: invoiceChargeId(invoice) || invoicePaymentIntentId(invoice),
      tier,
      amount_cents: amountCents,
      share_cents: shareCents,
      bonus_cents: bonusPaid,
      basis,
      status: 'split',
      period_start: unixToIso(invoice.period_start),
      period_end: unixToIso(invoice.period_end),
      paid_at: paidAt
    })
    .select('*')
    .single();
  if (payment.error) {
    if (payment.error.code === '23505') return { duplicate: true };
    throw new Error(`member_payments insert failed: ${payment.error.message}`);
  }

  const lines = stampLines(buildLedgerLines({ memberId, paymentId: payment.data.id, shareCents, basis, entries, referral: bonusReferral, bonusCents: bonusPaid, paidAt, bonusMonths: settings.referralBonusMonths }), studioAtPayment);
  if (lines.length) {
    const ledger = await insertLedgerLines(lines, { supabase });
    if (ledger.error) {
      // Undo the payment row so Stripe's retry records this invoice again;
      // left in place, the retry would see it as done and these creator
      // lines would never be written.
      await supabase.from('member_payments').delete().eq('id', payment.data.id);
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
    lines: lines.length,
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

// charge.refunded (full) / charge.dispute.created on a membership charge:
// the payment's unpaid credits are taken back. Paid-out lines stay — the
// studio absorbs those, the same posture as Pitch Room refunds.
export async function reverseMembershipCharge(charge, reason = 'refunded') {
  const ids = [charge && charge.id, charge && (typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent && charge.payment_intent.id)].filter(Boolean);
  if (!ids.length) return { reversed: 0 };
  const supabase = getSupabase();
  const found = await supabase.from('member_payments').select('*').in('stripe_charge_id', ids).eq('status', 'split').limit(1).maybeSingle();
  if (found.error) {
    if (!isMissingTable(found.error)) console.error('reverseMembershipCharge read error:', found.error.message);
    return { reversed: 0 };
  }
  const payment = found.data;
  if (!payment) return { reversed: 0 };
  const lines = await supabase.from('creator_ledger').select('*').eq('payment_id', payment.id);
  if (lines.error) throw new Error(`creator_ledger read failed: ${lines.error.message}`);
  // A retry after the reversal lines went in but the status update below
  // didn't must not reverse the same credits a second time.
  const alreadyReversed = (lines.data || []).some((l) => l.kind === 'reversal');
  const reversals = alreadyReversed ? [] : reversalLinesFor(lines.data || [], `membership payment ${reason}`);
  if (reversals.length) {
    // Each reversal carries its credit's stamp (reversalLinesFor).
    const ins = await insertLedgerLines(reversals, { supabase });
    if (ins.error) throw new Error(`creator_ledger reversal failed: ${ins.error.message}`);
  }
  const upd = await supabase.from('member_payments').update({ status: 'reversed', reversed_at: new Date().toISOString(), reverse_reason: reason }).eq('id', payment.id);
  if (upd.error) throw new Error(`member_payments reverse failed: ${upd.error.message}`);
  return { reversed: reversals.length, paymentId: payment.id };
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
    if (!isMissingTable(found.error)) console.error('restoreMembershipCharge read error:', found.error.message);
    return { restored: 0 };
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
