// The daily Stripe catch-up's rules, pure (lib/stripeCatchup.js does the
// reads and writes; tested by `node scripts/test-stripe-catchup.mjs`).
// Explicit .js so plain Node can load this file; webpack is fine with it.
import { invoiceSubscriptionId } from './creatorShareRules.js';

// Two things Stripe's own retries can't fix (Jose, 2026-11-12: "lets fix
// the money edge cases"):
//   * an event whose work died half-way (a function timeout: the
//     stripe_events row stays without processed_at). The next delivery
//     claims it once it is two minutes old — but if Stripe has stopped
//     delivering it, nothing does. The catch-up fetches it again from
//     Stripe and runs it through the webhook's own handler.
//   * a paid membership invoice whose invoice.paid never got through
//     (Stripe retries for about three days in live mode; an outage longer
//     than that loses it). The catch-up lists the last 30 days' invoice.paid
//     events and records every invoice member_payments doesn't have,
//     through the same recordMembershipInvoice (idempotent on the invoice
//     id).

// Stripe keeps events for 30 days: nothing older can be fetched again.
export const CATCHUP_WINDOW_DAYS = 30;
// An unfinished row younger than this may still be running.
export const REPLAY_AFTER_MINUTES = 10;
// A paid invoice younger than this is the webhook's: Stripe is still
// delivering (and retrying) it.
export const INVOICE_GRACE_MINUTES = 60;
// What one run takes on at most; the rest waits for the next run.
export const REPLAY_LIMIT = 20;
export const INVOICE_LIMIT = 25;
export const EVENT_PAGES = 10;
// How long one run keeps starting new work (a cron function has a clock).
export const CATCHUP_BUDGET_MS = 25000;
// Events on a creator's connected account (only account.updated is ever
// acted on) can't be fetched with the platform's key, and the account's
// next update — or its Payouts card, which reads Stripe — brings it back
// in step.
export const UNREPLAYABLE_TYPES = ['account.updated'];

const MIN = 60000;
const DAY = 86400000;
const ms = (iso) => {
  const t = Date.parse(iso || '');
  return Number.isFinite(t) ? t : null;
};

// The window an unfinished-row read covers: received at least
// REPLAY_AFTER_MINUTES ago and at most CATCHUP_WINDOW_DAYS ago.
export function replayWindow(now = Date.now()) {
  const t = Number(now);
  return { olderThan: new Date(t - REPLAY_AFTER_MINUTES * MIN).toISOString(), newerThan: new Date(t - CATCHUP_WINDOW_DAYS * DAY).toISOString() };
}

// The stripe_events rows to fetch again: no processed_at, in the window,
// a type that can be fetched with the platform's key; oldest first.
//   rows = [{ id, type, received_at, processed_at? }]
//   → { replay: rows, skipped: rows (a connected account's) }
export function replayCandidates(rows, { now = Date.now(), limit = REPLAY_LIMIT } = {}) {
  const { olderThan, newerThan } = replayWindow(now);
  const lo = ms(newerThan);
  const hi = ms(olderThan);
  const open = (rows || [])
    .filter((r) => r && r.id && !r.processed_at)
    .filter((r) => {
      const t = ms(r.received_at);
      return t !== null && t >= lo && t < hi;
    })
    .sort((a, b) => ms(a.received_at) - ms(b.received_at) || String(a.id).localeCompare(String(b.id)));
  const skipped = open.filter((r) => UNREPLAYABLE_TYPES.includes(r.type));
  const replay = open.filter((r) => !UNREPLAYABLE_TYPES.includes(r.type)).slice(0, Math.max(0, limit));
  return { replay, skipped };
}

// The created range (unix seconds) the invoice.paid listing asks Stripe for.
export function invoiceListRange(now = Date.now()) {
  const t = Number(now);
  return { gte: Math.floor((t - CATCHUP_WINDOW_DAYS * DAY) / 1000), lte: Math.floor((t - INVOICE_GRACE_MINUTES * MIN) / 1000) };
}

// Whether an invoice is one recordMembershipInvoice writes a row for: paid,
// and a subscription's (a membership). A one-off invoice is skipped there
// for good, so it is never counted as "not recorded".
export function isMembershipInvoice(invoice) {
  return Boolean(invoice && invoice.id && invoice.status === 'paid' && invoiceSubscriptionId(invoice));
}

// From invoice.paid events (any order, any repeats) and the invoice ids
// member_payments has: the invoices still to record, each once, oldest
// first — paid at least INVOICE_GRACE_MINUTES ago and within the window.
//   events = [{ id, type, created, data: { object: invoice } }]
//   → [{ eventId, created, invoice }]
export function invoicesToRecord(events, recordedIds, { now = Date.now(), limit = Infinity } = {}) {
  const have = recordedIds instanceof Set ? recordedIds : new Set(recordedIds || []);
  const { gte, lte } = invoiceListRange(now);
  const seen = new Map();
  for (const e of events || []) {
    if (!e || e.type !== 'invoice.paid' || !e.data || !e.data.object) continue;
    const created = Number(e.created) || 0;
    if (created < gte || created > lte) continue;
    const invoice = e.data.object;
    if (!isMembershipInvoice(invoice) || have.has(invoice.id)) continue;
    // One invoice can carry more than one event (a resend); the oldest wins.
    const prev = seen.get(invoice.id);
    if (!prev || created < prev.created) seen.set(invoice.id, { eventId: e.id, created, invoice });
  }
  return [...seen.values()].sort((a, b) => a.created - b.created || String(a.invoice.id).localeCompare(String(b.invoice.id))).slice(0, limit);
}

// The audit line (and the admin page's last run): what one catch-up did.
//   r = lib/stripeCatchup.js runStripeCatchup's answer
export function catchupAuditLine(r) {
  if (!r) return '';
  if (r.error) return `catch-up failed: ${r.error}`;
  const parts = [];
  const ev = r.events || {};
  if (ev.error) parts.push(`webhook events: ${ev.error}`);
  else if (ev.available === false) parts.push('webhook events: not checked (no Stripe, or no stripe_events table / migration 112 yet)');
  else parts.push(`webhook events: ${ev.found || 0} unfinished, ${ev.replayed || 0} run again${ev.failed ? `, ${ev.failed} failed again` : ''}${ev.gone ? `, ${ev.gone} gone from Stripe` : ''}${ev.taken ? `, ${ev.taken} taken by a delivery` : ''}${ev.connect ? `, ${ev.connect} connected-account (left)` : ''}`);
  const inv = r.invoices || {};
  if (inv.error) parts.push(`paid membership invoices: ${inv.error}`);
  else if (inv.available === false) parts.push(`paid membership invoices: not checked (${inv.reason || 'unavailable'})`);
  else parts.push(`paid membership invoices: ${inv.missing || 0} not recorded, ${inv.recorded || 0} recorded now${inv.duplicate ? `, ${inv.duplicate} already there` : ''}${inv.skipped ? `, ${inv.skipped} skipped` : ''}${inv.failed ? `, ${inv.failed} failed` : ''}${inv.capped ? ' (listing capped)' : ''}`);
  if (r.more) parts.push('more next run');
  return parts.join(' · ');
}

// The admin page's line (lib/stripeCatchup.js checkStripeCatchup's answer).
export function catchupNotice(c) {
  if (!c) return null;
  const bits = [];
  const n = Number(c.unrecordedInvoices) || 0;
  const e = Number(c.unfinishedEvents) || 0;
  if (n > 0) bits.push(`${n} paid membership invoice${n === 1 ? '' : 's'} not recorded yet`);
  if (e > 0) bits.push(`${e} webhook event${e === 1 ? '' : 's'} that didn’t finish`);
  return bits.length ? bits.join(' · ') : null;
}
