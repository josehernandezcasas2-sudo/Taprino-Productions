import { getSupabase } from './supabase';
import { getStripe, isStripeConfigured } from './stripe';
import { getPayoutAccount, getPayoutAccounts, payoutState } from './creatorPayouts';
import { getShareSettings } from './artistSupport';
import { getPublicIdentities } from './userProfiles';
import { notifyCreator } from './notify';
import { dollars } from './artistSupportRules';
import { applyBalance, planPayouts } from './creatorShareRules';

// Creator Share's monthly payout batch (mockups/creator-share-v2.html §6–7)
// and the two money views built on the same ledger: the admin page's
// summary and the creator's "Member support" card.
//
// The ledger (creator_ledger, migration 088) holds every credit and debit;
// an earnings line with payout_id = null is owed. On the 1st (vercel.json
// cron → /api/cron/creator-payouts) or when an admin presses "Run now",
// every creator whose unpaid earnings reach the minimum and whose Stripe
// Express account can take money gets one Connect transfer from the
// platform's available balance: a creator_payouts row, the lines marked
// with its id, and a negative 'payout' line so the ledger still sums to
// what's left. Tips and backing never come through here — they settled
// at charge time.

const sumCents = (list) => (list || []).reduce((s, o) => s + (Number(o.cents) || 0), 0);

function isMissingTable(error) {
  return Boolean(error) && (error.code === 'PGRST205' || error.code === '42P01' || /relation .* does not exist|could not find the table/i.test(error.message || ''));
}

export function periodKey(date = new Date()) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

// The month a batch settles (creator_payouts.period, the transfer group):
// the month the credits were earned up to. The cron on the 1st pays the
// month that just ended, so it's the month of "yesterday"; a run by hand
// mid-month is that month's.
export function coveredPeriodKey(date = new Date()) {
  return periodKey(new Date(date.getTime() - 86400000));
}

export function periodLabel(key) {
  const [y, m] = String(key || '').split('-').map(Number);
  if (!y || !m) return key || '';
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

function monthStart(date = new Date()) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)).toISOString();
}

function nextMonthStart(date = new Date()) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1)).toISOString();
}

// Unpaid earnings per creator, oldest credit first. Read in pages: the
// API caps a query at 1,000 rows, and a month of invoices makes up to
// ten lines each; a silently cut page would pay someone short.
const PAGE = 1000;
export async function getOwedByCreator() {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await getSupabase()
      .from('creator_ledger')
      .select('id, creator_id, cents, created_at')
      .eq('lane', 'earnings')
      .is('payout_id', null)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) {
      if (isMissingTable(error)) return [];
      throw new Error(`creator_ledger read failed: ${error.message}`);
    }
    rows.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }
  const byCreator = new Map();
  for (const row of rows) {
    const entry = byCreator.get(row.creator_id) || { creatorId: row.creator_id, cents: 0, lineIds: [], oldestAt: row.created_at };
    entry.cents += Number(row.cents) || 0;
    entry.lineIds.push(row.id);
    if (row.created_at && row.created_at < entry.oldestAt) entry.oldestAt = row.created_at;
    byCreator.set(row.creator_id, entry);
  }
  return [...byCreator.values()];
}

// Who the next run would pay and who it would hold, with names.
export async function planPayoutBatch() {
  const [settings, owed] = await Promise.all([getShareSettings(), getOwedByCreator()]);
  const ids = owed.map((o) => o.creatorId);
  const [accounts, identities] = await Promise.all([getPayoutAccounts(ids), getPublicIdentities(ids)]);
  const plan = planPayouts({ owed, accounts, minimumCents: settings.payoutMinimumCents });
  const named = (o) => ({ ...o, displayName: identities[o.creatorId] ? identities[o.creatorId].displayName : 'A creator' });
  return {
    period: coveredPeriodKey(),
    minimumCents: settings.payoutMinimumCents,
    pay: plan.pay.map(named),
    held: plan.held.map(named),
    carry: plan.carry.map(named),
    payCents: plan.payCents,
    heldCents: plan.heldCents
  };
}

// The platform's own Stripe balance; transfers draw on `available`. Also
// how often Stripe sweeps that balance to the studio's bank: a daily
// sweep can leave nothing for the batch on the 1st, so the admin page
// says so.
export async function getPlatformBalance() {
  if (!isStripeConfigured()) return null;
  try {
    const stripe = getStripe();
    const b = await stripe.balance.retrieve();
    const usd = (list) => (list || []).filter((x) => x.currency === 'usd').reduce((s, x) => s + (Number(x.amount) || 0), 0);
    let payoutInterval = null;
    try {
      const me = await stripe.accounts.retrieve();
      payoutInterval = me && me.settings && me.settings.payouts && me.settings.payouts.schedule ? me.settings.payouts.schedule.interval || null : null;
    } catch (err) {
      // Not every key may read the platform account; the balance is what matters.
    }
    return { availableCents: usd(b.available), pendingCents: usd(b.pending), currency: 'usd', payoutInterval };
  } catch (err) {
    console.error('getPlatformBalance error:', err.message);
    return null;
  }
}

// The batch. `deps` lets a local run inject the balance and the transfer
// call instead of Stripe. Each creator is its own unit of work, in three
// steps: claim the lines (an update that only takes lines nobody else
// has claimed, so two runs at once — the cron and an admin's click —
// can't pay the same credit twice), transfer, then book it. A failed
// transfer releases the lines and is recorded on its payout row; a
// transfer that went through is never marked failed even if the
// bookkeeping after it hiccups (that's logged and surfaced instead).
export async function runPayoutBatch({ createdBy = 'cron', dryRun = false, deps = {} } = {}) {
  const plan = await planPayoutBatch();
  const balance = deps.balance !== undefined ? deps.balance : await getPlatformBalance();
  if (dryRun) return { dryRun: true, ...plan, balance };
  if (!deps.createTransfer) {
    if (!isStripeConfigured()) throw new Error('Stripe is not configured, so nothing can be transferred.');
    if (!balance) throw new Error('Could not read the platform balance from Stripe, so nothing was paid. Try again in a minute.');
  }

  const { pay, skippedForBalance } = applyBalance(plan.pay, balance ? balance.availableCents : Infinity);
  const supabase = getSupabase();
  const paid = [];
  const failed = [];
  const now = () => new Date().toISOString();

  for (const p of pay) {
    const created = await supabase
      .from('creator_payouts')
      .insert({ creator_id: p.creatorId, period: plan.period, cents: p.cents, status: 'pending', created_by: createdBy })
      .select('*')
      .single();
    if (created.error) {
      failed.push({ ...p, reason: `payout row: ${created.error.message}` });
      continue;
    }
    const payout = created.data;

    // Claim the lines. If another run got to any of them first, give
    // the rest back and leave this creator to that run.
    const claimed = await supabase.from('creator_ledger').update({ payout_id: payout.id }).in('id', p.lineIds).is('payout_id', null).select('id');
    const claimedIds = claimed.error ? [] : (claimed.data || []).map((r) => r.id);
    if (claimed.error || claimedIds.length !== p.lineIds.length) {
      const reason = claimed.error ? `claim failed: ${claimed.error.message}` : 'credits changed under the run (another run or a reversal); try again';
      if (claimedIds.length) await supabase.from('creator_ledger').update({ payout_id: null }).eq('payout_id', payout.id);
      await supabase.from('creator_payouts').update({ status: 'failed', failed_reason: reason }).eq('id', payout.id);
      failed.push({ ...p, payoutId: payout.id, reason });
      continue;
    }

    let transfer;
    try {
      transfer = deps.createTransfer
        ? await deps.createTransfer({ amount: p.cents, destination: p.stripeAccountId, payoutId: payout.id, creatorId: p.creatorId })
        : await getStripe().transfers.create(
          {
            amount: p.cents,
            currency: 'usd',
            destination: p.stripeAccountId,
            transfer_group: `creator-share-${plan.period}`,
            description: `Studio Tapa TV creator share · ${periodLabel(plan.period)}`,
            metadata: { payout_id: payout.id, creator_id: p.creatorId, period: plan.period, lines: String(p.lineIds.length) }
          },
          { idempotencyKey: `creator-payout-${payout.id}` }
        );
    } catch (err) {
      const reason = String(err && err.message ? err.message : err).slice(0, 300);
      await supabase.from('creator_ledger').update({ payout_id: null }).eq('payout_id', payout.id);
      await supabase.from('creator_payouts').update({ status: 'failed', failed_reason: reason }).eq('id', payout.id);
      failed.push({ ...p, payoutId: payout.id, reason });
      continue;
    }

    // Money moved. Bookkeeping errors from here on are logged, not
    // turned into a "failed" payout.
    let bookkeeping = null;
    const line = await supabase.from('creator_ledger').insert({
      creator_id: p.creatorId, lane: 'earnings', kind: 'payout', cents: -p.cents, moves_money: true, payout_id: payout.id, note: `transfer ${transfer.id}`, created_by: createdBy
    });
    if (line.error) bookkeeping = `${bookkeeping ? `${bookkeeping}; ` : ''}payout line not written: ${line.error.message}`;
    const done = await supabase
      .from('creator_payouts')
      .update({ status: 'paid', stripe_transfer_id: transfer.id, paid_at: now(), failed_reason: bookkeeping })
      .eq('id', payout.id);
    if (done.error) bookkeeping = `${bookkeeping ? `${bookkeeping}; ` : ''}payout row not updated: ${done.error.message}`;
    if (bookkeeping) console.error(`creator payout ${payout.id} (transfer ${transfer.id}) bookkeeping problem: ${bookkeeping}`);
    paid.push({ ...p, payoutId: payout.id, transferId: transfer.id, bookkeeping });
    notifyCreator({
      userId: p.creatorId,
      type: 'payout',
      message: `Your creator share for ${periodLabel(plan.period)}, ${dollars(p.cents)}, is on its way to your Stripe account.`,
      href: '/account'
    }).catch(() => {});
  }

  return {
    dryRun: false,
    period: plan.period,
    minimumCents: plan.minimumCents,
    balance,
    paid,
    failed,
    skippedForBalance,
    held: plan.held,
    carry: plan.carry,
    paidCents: sumCents(paid)
  };
}

// The admin page: this month's movement, what's owed now, the next run's
// plan, the platform balance and recent payouts.
export async function getAdminSummary() {
  const supabase = getSupabase();
  const since = monthStart();
  const [plan, balance, month, payments, payouts] = await Promise.all([
    planPayoutBatch(),
    getPlatformBalance(),
    supabase.from('creator_ledger').select('kind, cents').eq('lane', 'earnings').gte('created_at', since),
    supabase.from('member_payments').select('amount_cents, share_cents, bonus_cents, status').gte('paid_at', since),
    supabase.from('creator_payouts').select('*').order('created_at', { ascending: false }).limit(25)
  ]);
  const lines = month.error ? [] : month.data || [];
  const sumKind = (kinds) => lines.filter((l) => kinds.includes(l.kind)).reduce((s, l) => s + (Number(l.cents) || 0), 0);
  const rows = payouts.error ? [] : payouts.data || [];
  const identities = await getPublicIdentities(rows.map((r) => r.creator_id));
  const pays = payments.error ? [] : payments.data || [];
  return {
    period: periodKey(),
    periodLabel: periodLabel(periodKey()),
    minimumCents: plan.minimumCents,
    summary: {
      creditedCents: sumKind(['member_share', 'referral', 'ad_share', 'adjustment']),
      reversedCents: -sumKind(['reversal']),
      paidCents: -sumKind(['payout']),
      owedCents: plan.payCents + plan.heldCents,
      readyCents: plan.payCents,
      heldCents: plan.heldCents,
      paymentsCount: pays.length,
      paymentsCents: pays.reduce((s, p) => s + (Number(p.amount_cents) || 0), 0),
      paymentsShareCents: pays.reduce((s, p) => s + (Number(p.share_cents) || 0) + (Number(p.bonus_cents) || 0), 0)
    },
    plan,
    balance,
    recentPayouts: rows.map((r) => ({
      id: r.id,
      creatorId: r.creator_id,
      displayName: identities[r.creator_id] ? identities[r.creator_id].displayName : 'A creator',
      period: r.period,
      cents: Number(r.cents) || 0,
      status: r.status,
      transferId: r.stripe_transfer_id || null,
      failedReason: r.failed_reason || null,
      createdBy: r.created_by || null,
      createdAt: r.created_at,
      paidAt: r.paid_at || null
    }))
  };
}

// The creator's "Member support" card: this month, what's owed, who's
// behind it (names only where the member allowed it), payouts so far and
// when the next one lands.
export async function getCreatorMoney(creatorId) {
  const supabase = getSupabase();
  const since = monthStart();
  const [settings, account, ledger, payouts, lineups] = await Promise.all([
    getShareSettings(),
    getPayoutAccount(creatorId),
    supabase.from('creator_ledger').select('id, kind, cents, basis, member_id, payout_id, created_at').eq('creator_id', creatorId).eq('lane', 'earnings').order('created_at', { ascending: false }).limit(1000),
    supabase.from('creator_payouts').select('*').eq('creator_id', creatorId).order('created_at', { ascending: false }).limit(6),
    supabase.from('member_lineups').select('user_id', { count: 'exact', head: true }).eq('creator_id', creatorId)
  ]);
  const lines = ledger.error ? [] : ledger.data || [];
  const thisMonth = lines.filter((l) => l.created_at >= since);
  const credits = (list) => list.filter((l) => ['member_share', 'referral', 'ad_share', 'adjustment', 'reversal'].includes(l.kind)).reduce((s, l) => s + (Number(l.cents) || 0), 0);
  const monthCents = Math.max(0, credits(thisMonth));
  const monthShareCents = Math.max(0, thisMonth.filter((l) => l.kind === 'member_share').reduce((s, l) => s + Number(l.cents), 0));
  const monthReferralCents = Math.max(0, thisMonth.filter((l) => l.kind === 'referral').reduce((s, l) => s + Number(l.cents), 0));
  const owedCents = lines.filter((l) => l.payout_id == null).reduce((s, l) => s + (Number(l.cents) || 0), 0);

  // Supporters this month: who the share lines came from and how. A
  // member who picked nobody counts as "by watching", whether their share
  // followed what they watched or, having watched nothing, the site-wide
  // pool by views.
  const picked = new Set();
  const watching = new Set();
  const basisOf = new Map();
  for (const l of thisMonth) {
    if (l.kind !== 'member_share' || !l.member_id) continue;
    if (l.basis === 'picks') picked.add(l.member_id);
    else watching.add(l.member_id);
    if (!basisOf.has(l.member_id) || l.basis === 'picks') basisOf.set(l.member_id, l.basis);
  }
  const memberIds = [...new Set([...picked, ...watching])];
  let names = [];
  if (memberIds.length) {
    const profiles = await supabase.from('user_profiles').select('user_id, display_name, share_visible').in('user_id', memberIds);
    names = (profiles.data || [])
      .filter((p) => p.share_visible && p.display_name)
      .slice(0, 6)
      .map((p) => ({ displayName: p.display_name, how: picked.has(p.user_id) ? 'picked you' : basisOf.get(p.user_id) === 'pool' ? 'site-wide share' : 'by watching' }));
  }

  const state = payoutState(account);
  const minimum = settings.payoutMinimumCents;
  const rows = payouts.error ? [] : payouts.data || [];
  return {
    available: !ledger.error || !isMissingTable(ledger.error),
    periodLabel: periodLabel(periodKey()),
    monthCents,
    monthShareCents,
    monthReferralCents,
    owedCents: Math.max(0, owedCents),
    minimumCents: minimum,
    payoutState: state,
    nextPayout: {
      on: nextMonthStart(),
      cents: Math.max(0, owedCents),
      willPay: state === 'ready' && owedCents >= minimum,
      reason: state !== 'ready' ? 'set up payouts' : owedCents < minimum ? 'under the minimum, carries over' : null
    },
    supporters: { picked: picked.size, watching: watching.size, names },
    pickedBy: lineups.error ? 0 : lineups.count || 0,
    payouts: rows.map((r) => ({ id: r.id, period: r.period, periodLabel: periodLabel(r.period), cents: Number(r.cents) || 0, status: r.status, paidAt: r.paid_at || r.created_at }))
  };
}
