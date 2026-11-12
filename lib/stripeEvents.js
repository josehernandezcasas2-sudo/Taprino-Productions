import { getSupabase } from './supabase';
import { internalError } from './apiErrors';

// SERVER-ONLY. The claim rules for Stripe events (stripe_events, migration
// 083; processed_at, migration 112), shared by the webhook
// (pages/api/webhook.js) and the daily catch-up (lib/stripeCatchup.js), so
// both run an event's work at most once at a time and never twice once it
// finished.
//
// Stripe retries any delivery it didn't get a 2xx for, and a creator's
// payout or a donation must never be applied twice. Each event id is
// written once; a repeat is acknowledged and skipped. Before 083 the table
// is missing and every event is treated as new, which is what happened
// before anyway.
//
// Since 112 a finished event also gets processed_at. A row without it that
// is older than STALE_MS belongs to a delivery that died half-way (a
// function timeout, not a caught error, which would have removed the row),
// so the next delivery claims it and does the work again; every step is
// safe to run twice, ad credits included (apply_ad_credit_purchase). Before
// 112 the column is missing and a repeat is a duplicate, as it always was.
// When Stripe has stopped delivering, the catch-up claims such a row the
// same way (claimUnfinished).
export const STALE_MS = 2 * 60 * 1000;

export async function firstDelivery(event) {
  const supabase = getSupabase();
  const { error } = await supabase.from('stripe_events').insert({ id: event.id, type: event.type });
  if (!error) return true;
  if (error.code === 'PGRST205' || error.code === '42P01') return true;
  if (error.code !== '23505') {
    console.error('stripe_events insert failed:', error.message);
    return true;
  }
  const { data: row, error: readError } = await supabase.from('stripe_events').select('received_at, processed_at').eq('id', event.id).maybeSingle();
  if (readError || !row || row.processed_at) return false;
  if (Date.now() - Date.parse(row.received_at) < STALE_MS) return false;
  // Claim it: only the delivery whose update still finds the old time goes on.
  const { data: claimed } = await supabase.from('stripe_events').update({ received_at: new Date().toISOString() }).eq('id', event.id).eq('received_at', row.received_at).is('processed_at', null).select('id');
  return Boolean(claimed && claimed.length);
}

export async function markProcessed(event) {
  const { error } = await getSupabase().from('stripe_events').update({ processed_at: new Date().toISOString() }).eq('id', event.id);
  if (error && !/processed_at|schema cache|does not exist/i.test(error.message || '')) console.error('stripe_events processed_at:', error.message);
}

// The webhook's failure path: the row goes, so Stripe's retry gets through
// firstDelivery.
export async function releaseEvent(event) {
  await getSupabase().from('stripe_events').delete().eq('id', event.id);
}

const missing = (error) => Boolean(error) && (error.code === 'PGRST205' || error.code === '42P01' || error.code === '42703' || error.code === 'PGRST204'
  || /could not find|does not exist|processed_at/i.test(error.message || ''));

// Rows whose work never finished: no processed_at, received between
// `newerThan` and `olderThan` (ISO strings), oldest first. A read that
// fails throws; before 083/112 there is nothing to find.
//   → { available, rows: [{ id, type, received_at }] }
export async function listUnfinished({ olderThan, newerThan, limit = 50 }) {
  const { data, error } = await getSupabase()
    .from('stripe_events')
    .select('id, type, received_at')
    .is('processed_at', null)
    .lt('received_at', olderThan)
    .gte('received_at', newerThan)
    .order('received_at', { ascending: true })
    .limit(limit);
  if (error) {
    if (missing(error)) return { available: false, rows: [] };
    throw internalError(error, 'stripe_events read');
  }
  return { available: true, rows: data || [] };
}

// Claims an unfinished row the way firstDelivery claims a stale one: only
// the run whose update still finds the time it read goes on (a webhook
// delivery that claimed it meanwhile wins).
export async function claimUnfinished(row) {
  const { data, error } = await getSupabase()
    .from('stripe_events')
    .update({ received_at: new Date().toISOString() })
    .eq('id', row.id)
    .eq('received_at', row.received_at)
    .is('processed_at', null)
    .select('id');
  if (error) throw internalError(error, 'stripe_events claim');
  return Boolean(data && data.length);
}
