import { getSupabase } from './supabase';
import { notifyCreator } from './notify';
import { internalError } from './apiErrors';
import { dollars } from './artistSupportRules';
import { addDays, COLLECT_DAYS, HOLD_DAYS, LEAVING_REASONS } from './creatorShareRules';

// Payout holds and departures (creator_standing, migration 091; Terms
// section 5, Jose 2026-10-18). The admin's half lives on
// /admin/creator-money; the payout batch (lib/creatorShareBatch.js) reads
// the rows, and recordMembershipInvoice stops crediting creators who left.
//
// Before 091 is run every read returns nothing and every write says so.

function isMissingTable(error) {
  return Boolean(error) && (error.code === 'PGRST205' || error.code === '42P01' || /relation .* does not exist|could not find the table/i.test(error.message || ''));
}

function fail(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  throw err;
}

const MIGRATION_MSG = 'Run migration 091 (creator_standing) in Supabase first.';

// creator_id → row, for every creator with a row (or just `ids`, read
// 100 at a time so a long list never makes the request too long).
// { strict } is for every path that moves or credits money (the payout
// batch, the forfeit to the pool, ad share): a read that fails throws
// instead of answering "nobody is on hold" — a creator on hold would be
// paid — and the run stops, to be tried again. Display-only callers stay
// lenient. Before 091 there is no table and every mode answers {}.
export async function getStandingMap(ids = null, { strict = false } = {}) {
  if (Array.isArray(ids) && ids.length === 0) return {};
  const parts = Array.isArray(ids) ? [] : [null];
  if (Array.isArray(ids)) {
    const want = [...new Set(ids.filter(Boolean))];
    for (let i = 0; i < want.length; i += 100) parts.push(want.slice(i, i + 100));
  }
  const out = {};
  for (const part of parts) {
    let query = getSupabase().from('creator_standing').select('*');
    if (part) query = query.in('creator_id', part);
    const { data, error } = await query;
    if (error) {
      if (isMissingTable(error)) return {};
      if (strict) throw internalError(error, 'creator_standing read');
      console.error('creatorStanding read error:', error.message);
      return {};
    }
    for (const r of data || []) out[r.creator_id] = r;
  }
  return out;
}

// Creators who left: no new member share, picks or referral bonus.
// { strict } (the invoice webhook, the forfeit, anything that credits
// money): a read that fails throws instead of answering "nobody left" —
// a leaver would be credited — so the invoice fails and Stripe tries
// again. A missing table (before 091) is still nobody.
export async function getLeavingIds({ strict = false } = {}) {
  const { data, error } = await getSupabase().from('creator_standing').select('creator_id').not('left_at', 'is', null);
  if (error) {
    if (isMissingTable(error)) return new Set();
    if (strict) throw internalError(error, 'creator_standing leaving read');
    console.error('creatorStanding leaving read error:', error.message);
    return new Set();
  }
  return new Set((data || []).map((r) => r.creator_id));
}

function isMissingColumn(error) {
  return Boolean(error) && (error.code === '42703' || error.code === 'PGRST204' || /column .* does not exist|could not find the .* column/i.test(error.message || ''));
}

async function upsert(creatorId, patch) {
  const write = (p) => getSupabase()
    .from('creator_standing')
    .upsert({ creator_id: creatorId, ...p, updated_at: new Date().toISOString() }, { onConflict: 'creator_id' })
    .select('*')
    .single();
  let { data, error } = await write(patch);
  // reminders_sent arrives with migration 092; before that, save the rest.
  if (error && 'reminders_sent' in patch && isMissingColumn(error)) {
    const { reminders_sent: _unused, ...rest } = patch;
    ({ data, error } = await write(rest));
  }
  if (error) {
    if (isMissingTable(error)) fail(MIGRATION_MSG, 409);
    throw new Error(`creator_standing write failed: ${error.message}`);
  }
  return data;
}

// Before an admin's write: a read that fails stops the write (never a hold
// or a departure written over a row that couldn't be read).
async function current(creatorId) {
  const map = await getStandingMap([creatorId], { strict: true });
  return map[creatorId] || null;
}

const fmt = (iso) => new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

// Suspected fraud: stop payouts for up to 90 days while it's looked into.
// The creator is told (Terms section 5 promises it); the reason they see
// is general, the admin's note stays on the row.
export async function holdPayouts({ creatorId, reason, adminId }) {
  if (!creatorId) fail('Choose a creator.');
  const note = String(reason || '').trim().slice(0, 500);
  if (!note) fail('Say why (for the record; the creator sees a general message).');
  const now = new Date().toISOString();
  const row = await upsert(creatorId, { hold_reason: note, hold_started_at: now, hold_until: addDays(now, HOLD_DAYS), held_by: adminId });
  notifyCreator({
    userId: creatorId,
    type: 'payout',
    message: `We've paused your creator share payouts while we look into some activity on your account. Your credits are safe; this lasts until ${fmt(row.hold_until)} at most. Reply to any email from us if you have questions.`,
    href: '/account'
  }).catch(() => {});
  return row;
}

export async function releaseHold({ creatorId }) {
  const row = await current(creatorId);
  if (!row || !row.hold_started_at) fail('That creator has no hold.');
  const saved = await upsert(creatorId, { hold_reason: null, hold_started_at: null, hold_until: null, held_by: null });
  notifyCreator({ userId: creatorId, type: 'payout', message: 'Your creator share payouts are back on. Anything owed goes out with the next payout on the 1st.', href: '/account' }).catch(() => {});
  return saved;
}

// Credits that weren't earned: a negative adjustment line. It comes off
// what's owed; if more than is owed, the balance goes negative and
// carries, so it's recovered from future credits (Terms section 5).
export async function cancelCredits({ creatorId, cents, note, adminId }) {
  if (!creatorId) fail('Choose a creator.');
  const amount = Math.round(Number(cents));
  if (!Number.isFinite(amount) || amount <= 0) fail('Enter an amount over $0.');
  if (amount > 10000000) fail('That amount is too large.');
  const why = String(note || '').trim().slice(0, 500);
  if (!why) fail('Say why the credits are cancelled (it goes on the ledger line).');
  const { error } = await getSupabase().from('creator_ledger').insert({
    creator_id: creatorId, lane: 'earnings', kind: 'adjustment', cents: -amount, moves_money: true, note: `cancelled: ${why}`, created_by: adminId
  });
  if (error) {
    if (isMissingTable(error)) fail('Run migration 088 (Creator Share tables) first.', 409);
    throw new Error(`creator_ledger insert failed: ${error.message}`);
  }
  notifyCreator({
    userId: creatorId,
    type: 'payout',
    message: `We cancelled ${dollars(amount)} of creator share credits that didn't meet our Terms (section 5). Reply to any email from us if you think this is wrong.`,
    href: '/account'
  }).catch(() => {});
  return { cents: -amount };
}

// A creator who withdrew their work, closed their account or was
// suspended: credits stop, what they earned waits 90 days to be collected.
export async function markLeaving({ creatorId, reason, note, adminId }) {
  if (!creatorId) fail('Choose a creator.');
  if (!LEAVING_REASONS[reason]) fail('Pick why they left.');
  const existing = await current(creatorId);
  if (existing && existing.left_at) fail('That creator is already marked as leaving.');
  const now = new Date().toISOString();
  const row = await upsert(creatorId, {
    leaving_reason: reason, left_at: now, collect_until: addDays(now, COLLECT_DAYS), left_by: adminId, forfeited_at: null, forfeited_cents: null, reminders_sent: [],
    note: note ? String(note).trim().slice(0, 500) : (existing && existing.note) || null
  });
  notifyCreator({
    userId: creatorId,
    type: 'payout',
    message: `Credits you earned on Studio Tapa TV are still yours. Set up payouts on your account page by ${fmt(row.collect_until)} and we'll pay the whole balance; after that it goes to the site-wide creator pool.`,
    href: '/account'
  }).catch(() => {});
  return row;
}

// "Unless otherwise stated": more time by agreement (e.g. a re-cut).
export async function extendCollect({ creatorId, until }) {
  const row = await current(creatorId);
  if (!row || !row.left_at) fail('That creator is not marked as leaving.');
  if (row.forfeited_at) fail('Their balance already went to the pool.');
  const date = new Date(until);
  if (!until || Number.isNaN(date.getTime())) fail('Pick a date.');
  if (date.getTime() <= Date.now()) fail('Pick a date in the future.');
  // A new date starts the reminders over.
  const saved = await upsert(creatorId, { collect_until: date.toISOString(), reminders_sent: [] });
  notifyCreator({ userId: creatorId, type: 'payout', message: `You now have until ${fmt(saved.collect_until)} to collect your creator share credits.`, href: '/account' }).catch(() => {});
  return saved;
}

// Back in good standing (reinstated, or marked by mistake): credits
// resume. A balance already moved to the pool stays there.
export async function clearLeaving({ creatorId }) {
  const row = await current(creatorId);
  if (!row || !row.left_at) fail('That creator is not marked as leaving.');
  return upsert(creatorId, { leaving_reason: null, left_at: null, collect_until: null, left_by: null });
}
