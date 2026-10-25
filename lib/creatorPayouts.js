import { getStripe } from './stripe';
import { getSupabase } from './supabase';

// Stripe Connect for creators (migration 083): one Express account per
// creator, kept in creator_payout_accounts. Donations are destination
// charges to that account with Studio Tapa's cut as the application fee,
// so a creator must have charges_enabled before a pitch can take money.
//
// Flow: ensureStripeAccount creates the Express account on first click;
// createOnboardingLink sends the creator through Stripe's hosted
// onboarding and back to /creator/pitch/dashboard; Stripe's
// account.updated webhook (and a sync on return) keep the flags current.

function isMissingTable(error) {
  return error && (error.code === 'PGRST205' || error.code === '42P01');
}

function rowToAccount(row) {
  if (!row) return null;
  return {
    userId: row.user_id,
    stripeAccountId: row.stripe_account_id,
    detailsSubmitted: Boolean(row.details_submitted),
    chargesEnabled: Boolean(row.charges_enabled),
    payoutsEnabled: Boolean(row.payouts_enabled),
    requirementsDue: row.requirements_due || [],
    updatedAt: row.updated_at
  };
}

// 'none'       — never started
// 'incomplete' — Stripe account exists, onboarding not finished
// 'review'     — details in, Stripe still verifying (or asking for more)
// 'ready'      — can take donations (charges_enabled)
export function payoutState(account) {
  if (!account) return 'none';
  if (account.chargesEnabled) return 'ready';
  if (account.detailsSubmitted) return 'review';
  return 'incomplete';
}

export function isPayoutReady(account) {
  return payoutState(account) === 'ready';
}

function patchFromStripe(stripeAccount) {
  return {
    stripe_account_id: stripeAccount.id,
    details_submitted: Boolean(stripeAccount.details_submitted),
    charges_enabled: Boolean(stripeAccount.charges_enabled),
    payouts_enabled: Boolean(stripeAccount.payouts_enabled),
    requirements_due: (stripeAccount.requirements && stripeAccount.requirements.currently_due) || [],
    updated_at: new Date().toISOString()
  };
}

export async function getPayoutAccount(userId) {
  if (!userId) return null;
  const supabase = getSupabase();
  const { data, error } = await supabase.from('creator_payout_accounts').select('*').eq('user_id', userId).maybeSingle();
  if (error) {
    if (isMissingTable(error)) throw new Error('Payouts aren’t set up on this site yet (migration 083 has not been run).');
    throw new Error(error.message);
  }
  return rowToAccount(data);
}

// Several at once, for the admin pitch list. A missing table just means
// nobody is connected yet.
export async function getPayoutAccounts(userIds) {
  const ids = [...new Set((userIds || []).filter(Boolean))];
  if (ids.length === 0) return {};
  const supabase = getSupabase();
  const { data, error } = await supabase.from('creator_payout_accounts').select('*').in('user_id', ids);
  if (error) {
    if (isMissingTable(error)) return {};
    throw new Error(error.message);
  }
  return Object.fromEntries((data || []).map((row) => [row.user_id, rowToAccount(row)]));
}

// Creates the Express account on first use. The Clerk user id rides
// along in metadata so a webhook can always find its row.
export async function ensureStripeAccount({ userId, email }) {
  if (!userId) throw new Error('Sign in first.');
  const existing = await getPayoutAccount(userId);
  if (existing) return existing;

  const stripe = getStripe();
  const account = await stripe.accounts.create({
    type: 'express',
    email: email || undefined,
    capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
    business_profile: { product_description: 'Audience funding for film and series projects, and location bookings, on Studio Tapa TV' },
    metadata: { userId }
  });

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('creator_payout_accounts')
    .insert({ user_id: userId, ...patchFromStripe(account) })
    .select('*')
    .single();
  if (error) {
    // Two clicks at once: the other insert won; use its row.
    if (error.code === '23505') return getPayoutAccount(userId);
    throw new Error(error.message);
  }
  return rowToAccount(data);
}

// Stripe-hosted onboarding (ID, bank account, terms). The link is single
// use and short-lived, so one is minted per click. refresh_url is where
// Stripe sends them if the link expired mid-way; return_url when they
// finish or leave — neither means "done", the flags do.
export async function createOnboardingLink({ userId, email, origin, returnTo }) {
  const account = await ensureStripeAccount({ userId, email });
  const stripe = getStripe();
  const back = `${origin}${payoutReturnPath(returnTo)}`;
  const link = await stripe.accountLinks.create({
    account: account.stripeAccountId,
    refresh_url: `${back}?payouts=refresh`,
    return_url: `${back}?payouts=return`,
    type: 'account_onboarding'
  });
  return link.url;
}

// Express accounts get a Stripe-hosted dashboard (balance, payouts, tax
// forms). Login links are single use too.
export async function createDashboardLink(userId) {
  const account = await getPayoutAccount(userId);
  if (!account) throw new Error('No payout account yet.');
  const stripe = getStripe();
  const link = await stripe.accounts.createLoginLink(account.stripeAccountId);
  return link.url;
}

// Mirror Stripe's view of an account into our row. Called from the
// account.updated webhook and when a creator lands back from onboarding.
export async function syncAccountFromStripe(stripeAccount) {
  const supabase = getSupabase();
  const patch = patchFromStripe(stripeAccount);
  const { data, error } = await supabase
    .from('creator_payout_accounts')
    .update(patch)
    .eq('stripe_account_id', stripeAccount.id)
    .select('*')
    .maybeSingle();
  if (error) {
    if (isMissingTable(error)) return null;
    throw new Error(error.message);
  }
  if (data) return rowToAccount(data);

  // No row (made in the Stripe dashboard, or our insert failed after the
  // account was created): adopt it if it carries our user id.
  const userId = stripeAccount.metadata && stripeAccount.metadata.userId;
  if (!userId) return null;
  const { data: inserted, error: insertError } = await supabase
    .from('creator_payout_accounts')
    .upsert({ user_id: userId, ...patch }, { onConflict: 'user_id' })
    .select('*')
    .single();
  if (insertError) throw new Error(insertError.message);
  return rowToAccount(inserted);
}

// Where a creator lands after Stripe's onboarding pages. Only paths we
// own: the Payouts card sits on /account, the pitch dashboard, a host's
// listings and a crew member's working card (migration 110).
const RETURN_PATHS = ['/account', '/creator/pitch/dashboard', '/locations/mine', '/crew/card'];
export function payoutReturnPath(path) {
  return RETURN_PATHS.includes(path) ? path : RETURN_PATHS[1];
}

function unixToIsoDate(seconds) {
  return seconds ? new Date(seconds * 1000).toISOString().slice(0, 10) : null;
}

// Stripe's own numbers for a ready account, read live for the Payouts
// card (nothing is stored on our side): what's cleared, what's still
// clearing, the next payout and the last few. Null until the account
// can take charges — before that there's no money to describe.
export async function getPayoutSummary(userId) {
  const account = await getPayoutAccount(userId);
  if (!account || !account.chargesEnabled) return null;
  const stripe = getStripe();
  const onAccount = { stripeAccount: account.stripeAccountId };
  const [acct, balance, payouts] = await Promise.all([
    stripe.accounts.retrieve(account.stripeAccountId),
    stripe.balance.retrieve(onAccount),
    stripe.payouts.list({ limit: 6 }, onAccount)
  ]);

  const currency = (acct.default_currency || 'usd').toLowerCase();
  const sumFor = (list) => (list || []).filter((b) => b.currency === currency).reduce((n, b) => n + b.amount, 0);
  const availableCents = sumFor(balance.available);
  const pendingCents = sumFor(balance.pending);

  const schedule = (acct.settings && acct.settings.payouts && acct.settings.payouts.schedule) || {};
  const interval = schedule.interval || 'daily';

  const ext = ((acct.external_accounts && acct.external_accounts.data) || []).find((e) => e.default_for_currency) || (acct.external_accounts && acct.external_accounts.data && acct.external_accounts.data[0]) || null;
  const bank = ext ? { name: ext.bank_name || ext.brand || 'Bank', last4: ext.last4 } : null;

  // A payout Stripe has already lined up is the real "next"; failing
  // that, the available balance goes out on the schedule, which is an
  // estimate (Stripe may batch or hold it).
  const lined = payouts.data.find((p) => p.status === 'pending');
  let nextPayout = null;
  if (lined) {
    nextPayout = { amountCents: lined.amount, arrivalDate: unixToIsoDate(lined.arrival_date), estimate: false };
  } else if (availableCents > 0 && interval !== 'manual') {
    nextPayout = { amountCents: availableCents, arrivalDate: nextScheduledDate(schedule), estimate: true };
  }

  const recentPayouts = payouts.data
    .filter((p) => p.status !== 'pending')
    .slice(0, 3)
    .map((p) => ({ id: p.id, amountCents: p.amount, arrivalDate: unixToIsoDate(p.arrival_date), status: p.status, failureMessage: p.failure_message || null }));

  return {
    currency,
    availableCents,
    pendingCents,
    payoutsEnabled: Boolean(acct.payouts_enabled),
    schedule: { interval, delayDays: schedule.delay_days || null },
    bank,
    nextPayout,
    recentPayouts
  };
}

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

// The next day Stripe's schedule would send the available balance, as a
// YYYY-MM-DD. Daily = next business day; weekly/monthly = the anchor.
function nextScheduledDate(schedule) {
  const d = new Date();
  d.setUTCHours(12, 0, 0, 0);
  if (schedule.interval === 'weekly') {
    const target = WEEKDAYS.indexOf(schedule.weekly_anchor);
    let ahead = target < 0 ? 1 : (target - d.getUTCDay() + 7) % 7;
    if (ahead === 0) ahead = 7;
    d.setUTCDate(d.getUTCDate() + ahead);
    return d.toISOString().slice(0, 10);
  }
  if (schedule.interval === 'monthly') {
    const anchor = schedule.monthly_anchor || 1;
    const inMonth = (y, m) => new Date(Date.UTC(y, m, Math.min(anchor, new Date(Date.UTC(y, m + 1, 0)).getUTCDate()), 12));
    let next = inMonth(d.getUTCFullYear(), d.getUTCMonth());
    if (next <= d) next = inMonth(d.getUTCFullYear(), d.getUTCMonth() + 1);
    return next.toISOString().slice(0, 10);
  }
  do { d.setUTCDate(d.getUTCDate() + 1); } while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
  return d.toISOString().slice(0, 10);
}

export async function refreshPayoutAccount(userId) {
  const account = await getPayoutAccount(userId);
  if (!account) return null;
  const stripe = getStripe();
  const stripeAccount = await stripe.accounts.retrieve(account.stripeAccountId);
  return (await syncAccountFromStripe(stripeAccount)) || account;
}
