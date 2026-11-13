import { getSupabase } from './supabase';
import { getStripe, isStripeConfigured } from './stripe';
import { recordMembershipInvoice } from './creatorShare';
import { claimUnfinished, listUnfinished, markProcessed } from './stripeEvents';
import { internalError } from './apiErrors';
import { paymentPromisesLines } from './creatorShareRules';
import {
  CATCHUP_BUDGET_MS, EVENT_PAGES, INVOICE_LIMIT, REPLAY_LIMIT,
  invoiceListRange, invoicesToRecord, isMembershipInvoice, replayCandidates, replayWindow
} from './stripeCatchupRules';

// SERVER-ONLY. The daily Stripe catch-up (Jose, 2026-11-12: "lets fix the
// money edge cases"; the rules and why are in lib/stripeCatchupRules.js):
// runs from /api/cron/creator-reminders every day and from Admin → Creator
// Share payouts' "Retry now". Two steps, in order:
//   (a) stripe_events rows whose work never finished (no processed_at,
//       older than ten minutes, younger than 30 days) are fetched again
//       from Stripe and run through the webhook's own handler
//       (pages/api/webhook.js handleStripeEvent, passed in as
//       `handleEvent`), claimed first the way a delivery claims one
//       (lib/stripeEvents.js), so a delivery and the catch-up never run the
//       same event at once and a finished one never runs again;
//   (b) every paid membership invoice of the last 30 days that
//       member_payments doesn't have — its invoice.paid never got through —
//       is recorded through recordMembershipInvoice (idempotent on the
//       invoice id; its own 24-hour verdict applies as on the webhook).
// Bounded: so many of each per run and a clock, the rest the next day.
// Every read here that fails is reported, never guessed past; the money
// paths underneath fail closed as they do on the webhook.

const notFound = (err) => Boolean(err) && (Number(err.statusCode) === 404 || err.code === 'resource_missing');
const missingTable = (error) => Boolean(error) && (error.code === 'PGRST205' || error.code === '42P01' || /could not find the table|relation .* does not exist/i.test(error.message || ''));

function stripeFor(deps) {
  if (deps && deps.stripe) return deps.stripe;
  return isStripeConfigured() ? getStripe() : null;
}

// The last 30 days' invoice.paid events (but the last hour's, still the
// webhook's), newest first as Stripe lists them; at most `maxPages` pages.
async function listPaidInvoiceEvents(stripe, { now, maxPages = EVENT_PAGES }) {
  const created = invoiceListRange(now);
  const events = [];
  let after = null;
  let capped = false;
  for (let page = 0; ; page += 1) {
    if (page >= maxPages) {
      capped = true;
      break;
    }
    const res = await stripe.events.list({ type: 'invoice.paid', created, limit: 100, ...(after ? { starting_after: after } : {}) });
    const data = (res && res.data) || [];
    events.push(...data);
    if (!res || !res.has_more || data.length === 0) break;
    after = data[data.length - 1].id;
  }
  return { events, capped };
}

// Which of these invoice ids member_payments already has, whole. A payment
// that should have creator lines and has none (creatorShareRules
// paymentPromisesLines: a run stopped between the payment and its lines)
// isn't recorded yet: recordMembershipInvoice writes its lines. A read that
// fails throws; before 088 there is no table (null).
async function recordedInvoiceIds(ids) {
  const have = new Set();
  const list = [...new Set((ids || []).filter(Boolean))];
  const promised = new Map();
  for (let i = 0; i < list.length; i += 100) {
    const { data, error } = await getSupabase().from('member_payments').select('id, stripe_invoice_id, status, share_cents, bonus_cents, basis').in('stripe_invoice_id', list.slice(i, i + 100));
    if (error) {
      if (missingTable(error)) return null;
      throw internalError(error, 'member_payments read');
    }
    for (const r of data || []) {
      if (!r.stripe_invoice_id) continue;
      have.add(r.stripe_invoice_id);
      if (paymentPromisesLines(r)) promised.set(r.id, r.stripe_invoice_id);
    }
  }
  const paymentIds = [...promised.keys()];
  const withLines = new Set();
  for (let i = 0; i < paymentIds.length; i += 100) {
    const { data, error } = await getSupabase().from('creator_ledger').select('payment_id').in('payment_id', paymentIds.slice(i, i + 100));
    if (error) throw internalError(error, 'creator_ledger read');
    for (const r of data || []) if (r.payment_id) withLines.add(r.payment_id);
  }
  for (const [paymentId, invoiceId] of promised) if (!withLines.has(paymentId)) have.delete(invoiceId);
  return have;
}

// The invoices step's reads: what Stripe says was paid, less what we have.
//   → { available, reason?, missing: [{ eventId, created, invoice }], capped }
async function findUnrecordedInvoices(stripe, now) {
  if (!stripe) return { available: false, reason: 'Stripe isn’t set up', missing: [], capped: false };
  const { events, capped } = await listPaidInvoiceEvents(stripe, { now });
  const ids = events.map((e) => e && e.data && e.data.object).filter(isMembershipInvoice).map((inv) => inv.id);
  const recorded = await recordedInvoiceIds(ids);
  if (recorded === null) return { available: false, reason: 'no member_payments table yet (migration 088)', missing: [], capped };
  return { available: true, missing: invoicesToRecord(events, recorded, { now }), capped };
}

// For the admin page: how many paid membership invoices aren't recorded and
// how many webhook events didn't finish, without changing anything. Each
// half answers on its own (a failed read says so instead of a number).
//   → { unrecordedInvoices, unfinishedEvents, capped, invoicesError, eventsError, checkedAt }
export async function checkStripeCatchup({ now = Date.now(), deps = {} } = {}) {
  const out = { unrecordedInvoices: null, unfinishedEvents: null, capped: false, invoicesError: null, eventsError: null, checkedAt: new Date(now).toISOString() };
  try {
    const { available, rows } = await listUnfinished({ ...replayWindow(now), limit: 200 });
    out.unfinishedEvents = available ? replayCandidates(rows, { now, limit: Infinity }).replay.length : 0;
  } catch (err) {
    console.error('checkStripeCatchup events:', err && err.message);
    out.eventsError = 'The webhook events couldn’t be read just now.';
  }
  try {
    const found = await findUnrecordedInvoices(stripeFor(deps), now);
    out.unrecordedInvoices = found.available ? found.missing.length : 0;
    out.capped = found.capped;
    if (!found.available) out.invoicesError = found.reason;
  } catch (err) {
    console.error('checkStripeCatchup invoices:', err && err.message);
    out.invoicesError = 'Stripe or the payments table couldn’t be read just now.';
  }
  return out;
}

// The catch-up itself. `handleEvent(event)` is the webhook's handler
// (→ { failed: [], error }). `deps.stripe` / `deps.recordInvoice` stand in
// for Stripe and recordMembershipInvoice in a local run.
//   → { events: { available, found, replayed, failed, gone, taken, connect, error? },
//       invoices: { available, missing, recorded, duplicate, skipped, failed, capped, error? },
//       more }
export async function runStripeCatchup({ handleEvent, now = Date.now(), deps = {}, replayLimit = REPLAY_LIMIT, invoiceLimit = INVOICE_LIMIT, budgetMs = CATCHUP_BUDGET_MS } = {}) {
  const started = Date.now();
  const timeLeft = () => Date.now() - started < budgetMs;
  const stripe = stripeFor(deps);
  const record = deps.recordInvoice || recordMembershipInvoice;
  let more = false;
  const triedInvoices = new Set();

  // (a) Events whose work never finished.
  const events = { available: true, found: 0, replayed: 0, failed: 0, gone: 0, taken: 0, connect: 0 };
  try {
    if (!stripe) {
      events.available = false;
    } else {
      const { available, rows } = await listUnfinished({ ...replayWindow(now), limit: 200 });
      if (!available) {
        events.available = false;
      } else {
        const { replay, skipped } = replayCandidates(rows, { now, limit: Infinity });
        events.found = replay.length;
        events.connect = skipped.length;
        if (replay.length > replayLimit) more = true;
        for (const row of replay.slice(0, replayLimit)) {
          if (!timeLeft()) {
            more = true;
            break;
          }
          let event;
          try {
            event = await stripe.events.retrieve(row.id);
          } catch (err) {
            // Gone (older than Stripe keeps): nothing to run, and the row
            // isn't touched, so it ages out of the window. Anything else:
            // tomorrow.
            if (notFound(err)) events.gone += 1;
            else {
              events.failed += 1;
              console.error(`stripe catch-up: event ${row.id} couldn’t be fetched:`, err && err.message);
            }
            continue;
          }
          if (!event || (event.account && event.type !== 'account.updated')) continue;
          if (!(await claimUnfinished(row))) {
            events.taken += 1;
            continue;
          }
          let outcome;
          try {
            outcome = await handleEvent(event);
          } catch (err) {
            outcome = { failed: ['handler'], error: err && err.message };
          }
          if (outcome && outcome.failed && outcome.failed.length) {
            // The row stays unfinished: the next delivery or the next run
            // claims it again.
            events.failed += 1;
            if (event.type === 'invoice.paid' && event.data && event.data.object && event.data.object.id) triedInvoices.add(event.data.object.id);
            console.error(`stripe catch-up: event ${event.id} (${event.type}) failed again: ${outcome.error || outcome.failed.join(', ')}`);
          } else {
            await markProcessed(event);
            events.replayed += 1;
          }
        }
      }
    }
  } catch (err) {
    console.error('stripe catch-up (events):', err && err.message);
    events.error = 'The webhook events couldn’t be read; the next run tries again.';
  }

  // (b) Paid membership invoices never recorded.
  const invoices = { available: true, missing: 0, recorded: 0, duplicate: 0, skipped: 0, failed: 0, capped: false };
  try {
    if (!timeLeft()) {
      more = true;
      invoices.available = false;
      invoices.reason = 'out of time this run';
    } else {
      const found = await findUnrecordedInvoices(stripe, now);
      invoices.available = found.available;
      invoices.capped = found.capped;
      if (!found.available) invoices.reason = found.reason;
      invoices.missing = found.missing.length;
      // Oldest first. `invoiceLimit` counts the invoices this run records or
      // fails on; one recordMembershipInvoice skips for good (no member can
      // be named after a day) takes only time, so a few of those can't
      // crowd out the rest for the 30 days they stay in the window.
      for (let i = 0; i < found.missing.length; i += 1) {
        const item = found.missing[i];
        if (invoices.recorded + invoices.failed >= invoiceLimit || !timeLeft()) {
          more = true;
          break;
        }
        // An invoice.paid just run again above (and failed) isn't tried twice.
        if (triedInvoices.has(item.invoice.id)) {
          invoices.failed += 1;
          continue;
        }
        try {
          const r = await record(item.invoice);
          // A payment found without its lines and given them now counts
          // as recorded (recordMembershipInvoice's linesWritten).
          if (r && r.duplicate && !r.linesWritten) invoices.duplicate += 1;
          else if (r && r.skipped) {
            invoices.skipped += 1;
            console.log(`stripe catch-up: invoice ${item.invoice.id} skipped (${r.skipped})`);
          } else invoices.recorded += 1;
        } catch (err) {
          // Not yet (the member not named yet, a read that failed): the
          // next run tries again, as Stripe's retry would have.
          invoices.failed += 1;
          console.error(`stripe catch-up: invoice ${item.invoice.id} not recorded:`, err && err.message);
        }
      }
    }
  } catch (err) {
    console.error('stripe catch-up (invoices):', err && err.message);
    invoices.error = 'Stripe or the payments table couldn’t be read; the next run tries again.';
  }

  return { events, invoices, more };
}
