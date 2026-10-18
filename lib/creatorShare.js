import { getSupabase } from './supabase';
import { getStripe, isStripeConfigured, stripeMode } from './stripe';
import { getMembershipPlans } from './membershipPlans';
import { getShareSettings, listSupportableCreators } from './artistSupport';
import { getOwnProfile, looksLikeUserId, resolveProfileUserId } from './userProfiles';
import { shareCentsFor } from './artistSupportRules';
import { getCreatorViewTotals } from './redis';
import {
  buildLedgerLines, chooseBasis, cleanViaSlug, invoiceChargeId, invoiceCustomerId, invoicePaymentIntentId, invoiceSubscriptionId,
  referralEarnsBonus, referralIsActive, reversalLinesFor, tierForInvoice
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
// a real profile, with released work, and not the member themselves.
export async function resolveReferrer(viaSlug, memberId) {
  const slug = cleanViaSlug(viaSlug);
  if (!slug) return null;
  const creatorId = await resolveProfileUserId(slug);
  if (!creatorId || creatorId === memberId) return null;
  const supportable = await listSupportableCreators();
  return supportable.some((c) => c.userId === creatorId) ? creatorId : null;
}

async function loadSubscription(subscriptionId, deps) {
  if (!subscriptionId) return null;
  if (deps.retrieveSubscription) return deps.retrieveSubscription(subscriptionId);
  if (!isStripeConfigured()) return null;
  try {
    return await getStripe().subscriptions.retrieve(subscriptionId);
  } catch (err) {
    console.error('creatorShare loadSubscription error:', err.message);
    return null;
  }
}

async function memberForInvoice(invoice, subscription) {
  const supabase = getSupabase();
  const customerId = invoiceCustomerId(invoice);
  if (customerId) {
    const { data } = await supabase.from('member_customers').select('user_id').eq('stripe_customer_id', customerId).maybeSingle();
    if (data && looksLikeUserId(data.user_id)) return data.user_id;
  }
  const stamped = subscription && subscription.metadata && subscription.metadata.member;
  if (looksLikeUserId(stamped)) {
    if (customerId) {
      const { error } = await supabase.from('member_customers').upsert({ stripe_customer_id: customerId, user_id: stamped, mode: stripeMode() }, { onConflict: 'stripe_customer_id' });
      if (error && !isMissingTable(error)) console.error('memberForInvoice upsert error:', error.message);
    }
    return stamped;
  }
  return null;
}

// Creators of the titles this member watched in the last 30 days, by plays.
async function watchedCreators(memberId, supportableIds) {
  const supabase = getSupabase();
  const since = new Date(Date.now() - WATCH_WINDOW_DAYS * 86400000).toISOString();
  const { data, error } = await supabase.from('watch_history').select('episode_id, watched_at').eq('user_id', memberId).gte('watched_at', since).limit(500);
  if (error || !data || data.length === 0) return {};
  const ids = [...new Set(data.map((r) => r.episode_id).filter(Boolean))];
  const eps = await supabase.from('episodes').select('id, submitted_by').in('id', ids).eq('status', 'approved').eq('moderation_hold', false);
  if (eps.error || !eps.data) return {};
  const creatorOf = new Map(eps.data.map((e) => [e.id, e.submitted_by]));
  const counts = {};
  for (const row of data) {
    const creator = creatorOf.get(row.episode_id);
    if (!creator || creator === memberId || !supportableIds.has(creator)) continue;
    counts[creator] = (counts[creator] || 0) + 1;
  }
  return counts;
}

// The site-wide pool: every supportable creator by their views over the
// last 30 days (Redis); equal weights when there are no view counts at all.
async function poolCreators(supportable, memberId) {
  let views = {};
  try {
    views = (await getCreatorViewTotals(POOL_WINDOW_DAYS)) || {};
  } catch (err) {
    console.error('poolCreators views error:', err.message);
  }
  const eligible = supportable.filter((c) => c.userId !== memberId);
  const anyViews = eligible.some((c) => Number(views[c.userId]) > 0);
  const pool = {};
  for (const c of eligible) pool[c.userId] = anyViews ? Math.max(0, Number(views[c.userId]) || 0) : 1;
  return pool;
}

// The attribution for a subscription: the row if it exists, else a new
// one from the via the subscription was stamped with at Checkout. A
// referred member whose lineup is empty starts with their referrer as the
// first pick (removable on the Artist Support page).
export async function lockReferralFromSubscription({ memberId, subscriptionId, subscription, supportableIds }) {
  const supabase = getSupabase();
  const existing = await supabase.from('member_referrals').select('*').eq('stripe_subscription_id', subscriptionId).maybeSingle();
  if (existing.error) {
    if (!isMissingTable(existing.error)) console.error('lockReferral read error:', existing.error.message);
    return null;
  }
  if (existing.data) return existing.data;
  const via = subscription && subscription.metadata && subscription.metadata.via;
  if (!looksLikeUserId(via) || via === memberId || !supportableIds.has(via)) return null;
  const source = subscription.metadata.via_source === 'code' ? 'code' : 'link';
  const code = source === 'code' && subscription.metadata.via_code ? String(subscription.metadata.via_code).slice(0, 40) : null;
  const inserted = await supabase
    .from('member_referrals')
    .insert({ user_id: memberId, creator_id: via, stripe_subscription_id: subscriptionId, source, code })
    .select('*')
    .single();
  if (inserted.error) {
    if (inserted.error.code === '23505') {
      const again = await supabase.from('member_referrals').select('*').eq('stripe_subscription_id', subscriptionId).maybeSingle();
      return again.data || null;
    }
    console.error('lockReferral insert error:', inserted.error.message);
    return null;
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

  const subscription = await loadSubscription(subscriptionId, deps);
  const memberId = await memberForInvoice(invoice, subscription);
  if (!memberId) {
    console.error(`creatorShare: no member for invoice ${invoice.id} (customer ${invoiceCustomerId(invoice)}) — not recorded`);
    return { skipped: 'member unknown' };
  }

  const [settings, plans, supportable] = await Promise.all([
    getShareSettings(),
    deps.plans ? Promise.resolve(deps.plans) : getMembershipPlans().catch(() => []),
    listSupportableCreators()
  ]);
  const tier = tierForInvoice(invoice, plans, subscription && subscription.metadata);
  const amountCents = Math.max(0, Math.round(Number(invoice.amount_paid) || 0));
  const shareCents = amountCents > 0 ? shareCentsFor(settings.shareCents, tier) : 0;
  const bonusCents = amountCents > 0 ? shareCentsFor(settings.bonusCents, tier) : 0;
  const supportableIds = new Set(supportable.map((c) => c.userId));

  // Attribution first: a referred member's first renewal already goes to
  // their referrer through the auto-pick below.
  const referral = await lockReferralFromSubscription({ memberId, subscriptionId, subscription, supportableIds });

  let basis = 'none';
  let entries = [];
  if (shareCents > 0 && supportable.length) {
    const [lineup, prefs] = await Promise.all([
      supabase.from('member_lineups').select('creator_id, weight, position').eq('user_id', memberId).order('position', { ascending: true }),
      supabase.from('user_profiles').select('lineup_mode').eq('user_id', memberId).maybeSingle()
    ]);
    const picks = (lineup.data || []).filter((r) => supportableIds.has(r.creator_id)).map((r) => ({ creatorId: r.creator_id, weight: r.weight }));
    const mode = prefs.data && prefs.data.lineup_mode === 'custom' ? 'custom' : 'equal';
    const watched = picks.length ? {} : await watchedCreators(memberId, supportableIds);
    const pool = picks.length || Object.keys(watched).length ? {} : await poolCreators(supportable, memberId);
    ({ basis, entries } = chooseBasis({ picks, mode, watched, pool }));
  }

  const paidAt = unixToIso(invoice.status_transitions && invoice.status_transitions.paid_at) || new Date().toISOString();
  const earnsBonus = referralEarnsBonus(referral, paidAt, settings.referralBonusMonths);
  const bonusPaid = earnsBonus ? bonusCents : 0;
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

  const lines = buildLedgerLines({ memberId, paymentId: payment.data.id, shareCents, basis, entries, referral, bonusCents, paidAt, bonusMonths: settings.referralBonusMonths });
  if (lines.length) {
    const ledger = await supabase.from('creator_ledger').insert(lines);
    if (ledger.error) throw new Error(`creator_ledger insert failed: ${ledger.error.message}`);
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
  const reversals = reversalLinesFor(lines.data || [], `membership payment ${reason}`);
  if (reversals.length) {
    const ins = await supabase.from('creator_ledger').insert(reversals);
    if (ins.error) throw new Error(`creator_ledger reversal failed: ${ins.error.message}`);
  }
  const upd = await supabase.from('member_payments').update({ status: 'reversed', reversed_at: new Date().toISOString(), reverse_reason: reason }).eq('id', payment.id);
  if (upd.error) throw new Error(`member_payments reverse failed: ${upd.error.message}`);
  return { reversed: reversals.length, paymentId: payment.id };
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
