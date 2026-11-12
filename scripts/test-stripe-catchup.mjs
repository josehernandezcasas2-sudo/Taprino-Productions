// Run: node scripts/test-stripe-catchup.mjs
// The daily Stripe catch-up's rules (lib/stripeCatchupRules.js) and the
// compat writes the money paths use for migration 122 (lib/dbCompat.js
// insertManyCompat / selectCompat, against a stand-in client that answers
// the way PostgREST does for a column it doesn't know).
import assert from 'node:assert/strict';
import {
  CATCHUP_WINDOW_DAYS, REPLAY_AFTER_MINUTES, INVOICE_GRACE_MINUTES, UNREPLAYABLE_TYPES,
  replayWindow, replayCandidates, invoiceListRange, isMembershipInvoice, invoicesToRecord, catchupAuditLine, catchupNotice
} from '../lib/stripeCatchupRules.js';
import { insertManyCompat, selectCompat } from '../lib/dbCompat.js';

let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
  console.log(`ok — ${name}`);
}

const NOW = Date.parse('2026-11-12T09:30:00Z');
const iso = (minutesAgo) => new Date(NOW - minutesAgo * 60000).toISOString();
const unix = (minutesAgo) => Math.floor((NOW - minutesAgo * 60000) / 1000);

await test('the windows: ten minutes to 30 days for events, an hour to 30 days for invoices', () => {
  assert.equal(CATCHUP_WINDOW_DAYS, 30);
  assert.equal(REPLAY_AFTER_MINUTES, 10);
  assert.equal(INVOICE_GRACE_MINUTES, 60);
  assert.deepEqual(replayWindow(NOW), { olderThan: iso(10), newerThan: iso(30 * 1440) });
  assert.deepEqual(invoiceListRange(NOW), { gte: unix(30 * 1440), lte: unix(60) });
});

await test('replayCandidates: unfinished rows in the window, oldest first, connected-account events set apart', () => {
  const rows = [
    { id: 'evt_young', type: 'invoice.paid', received_at: iso(5) },
    { id: 'evt_b', type: 'checkout.session.completed', received_at: iso(60) },
    { id: 'evt_done', type: 'invoice.paid', received_at: iso(120), processed_at: iso(119) },
    { id: 'evt_a', type: 'invoice.paid', received_at: iso(600) },
    { id: 'evt_acct', type: 'account.updated', received_at: iso(300) },
    { id: 'evt_old', type: 'invoice.paid', received_at: iso(31 * 1440) },
    { id: 'evt_edge', type: 'charge.refunded', received_at: iso(10) },
    { id: 'evt_bad', type: 'invoice.paid', received_at: 'not a date' }
  ];
  const { replay, skipped } = replayCandidates(rows, { now: NOW });
  assert.deepEqual(replay.map((r) => r.id), ['evt_a', 'evt_b']);
  assert.deepEqual(skipped.map((r) => r.id), ['evt_acct']);
  assert.deepEqual(UNREPLAYABLE_TYPES, ['account.updated']);
  assert.deepEqual(replayCandidates(rows, { now: NOW, limit: 1 }).replay.map((r) => r.id), ['evt_a']);
  assert.deepEqual(replayCandidates(null, { now: NOW }), { replay: [], skipped: [] });
});

const inv = (id, extra = {}) => ({ id, object: 'invoice', status: 'paid', subscription: 'sub_1', ...extra });
const ev = (id, invoice, minutesAgo, type = 'invoice.paid') => ({ id, type, created: unix(minutesAgo), data: { object: invoice } });

await test('isMembershipInvoice: paid and a subscription’s (either API shape)', () => {
  assert.equal(isMembershipInvoice(inv('in_1')), true);
  assert.equal(isMembershipInvoice(inv('in_2', { subscription: null, parent: { subscription_details: { subscription: 'sub_2' } } })), true);
  assert.equal(isMembershipInvoice(inv('in_3', { subscription: null })), false);
  assert.equal(isMembershipInvoice(inv('in_4', { status: 'open' })), false);
  assert.equal(isMembershipInvoice(null), false);
});

await test('invoicesToRecord: the paid membership invoices member_payments doesn’t have, once each, oldest first', () => {
  const events = [
    ev('evt_1', inv('in_new'), 30), // still the webhook's (under an hour)
    ev('evt_2', inv('in_have'), 300),
    ev('evt_3', inv('in_b'), 200),
    ev('evt_4', inv('in_a'), 2000),
    ev('evt_5', inv('in_a'), 1500), // a resend: the oldest event wins
    ev('evt_6', inv('in_oneoff', { subscription: null }), 400),
    ev('evt_7', inv('in_old'), 31 * 1440),
    ev('evt_8', inv('in_c'), 100, 'invoice.payment_failed'),
    { id: 'evt_9', type: 'invoice.paid', created: unix(500) }
  ];
  const out = invoicesToRecord(events, new Set(['in_have']), { now: NOW });
  assert.deepEqual(out.map((o) => [o.invoice.id, o.eventId]), [['in_a', 'evt_4'], ['in_b', 'evt_3']]);
  assert.deepEqual(invoicesToRecord(events, ['in_have', 'in_a'], { now: NOW }).map((o) => o.invoice.id), ['in_b']);
  assert.deepEqual(invoicesToRecord(events, [], { now: NOW, limit: 1 }).map((o) => o.invoice.id), ['in_a']);
  assert.deepEqual(invoicesToRecord(null, null, { now: NOW }), []);
});

await test('the audit line and the admin page’s line', () => {
  assert.equal(
    catchupAuditLine({ events: { available: true, found: 2, replayed: 1, failed: 1, gone: 0, taken: 0, connect: 1 }, invoices: { available: true, missing: 3, recorded: 2, duplicate: 0, skipped: 1, failed: 0, capped: false }, more: false }),
    'webhook events: 2 unfinished, 1 run again, 1 failed again, 1 connected-account (left) · paid membership invoices: 3 not recorded, 2 recorded now, 1 skipped'
  );
  assert.equal(
    catchupAuditLine({ events: { available: false }, invoices: { available: false, reason: 'Stripe isn’t set up' }, more: true }),
    'webhook events: not checked (no Stripe, or no stripe_events table / migration 112 yet) · paid membership invoices: not checked (Stripe isn’t set up) · more next run'
  );
  assert.equal(catchupAuditLine({ events: { error: 'read failed' }, invoices: { error: 'list failed' } }), 'webhook events: read failed · paid membership invoices: list failed');
  assert.equal(catchupAuditLine({ error: 'it couldn’t run' }), 'catch-up failed: it couldn’t run');
  assert.equal(catchupAuditLine(null), '');
  assert.equal(catchupNotice({ unrecordedInvoices: 2, unfinishedEvents: 0 }), '2 paid membership invoices not recorded yet');
  assert.equal(catchupNotice({ unrecordedInvoices: 1, unfinishedEvents: 3 }), '1 paid membership invoice not recorded yet · 3 webhook events that didn’t finish');
  assert.equal(catchupNotice({ unrecordedInvoices: 0, unfinishedEvents: 0 }), null);
  assert.equal(catchupNotice(null), null);
});

// A stand-in for the few supabase-js calls dbCompat makes: one table that
// may or may not have the column `studio`, answering like PostgREST.
function standIn({ hasStudio, failWith = null }) {
  const rows = [];
  const calls = [];
  const known = (row) => Object.keys(row).filter((k) => k === 'studio' && !hasStudio);
  return {
    rows,
    calls,
    from(table) {
      return {
        async insert(list) {
          calls.push({ table, op: 'insert', keys: Object.keys(list[0] || {}) });
          if (failWith) return { error: failWith };
          const bad = list.flatMap(known);
          if (bad.length) return { error: { code: 'PGRST204', message: `Could not find the '${bad[0]}' column of '${table}' in the schema cache` } };
          rows.push(...list);
          return { error: null };
        },
        select(cols) {
          calls.push({ table, op: 'select', cols });
          const asked = cols.split(',').map((c) => c.trim());
          const result = asked.includes('studio') && !hasStudio
            ? { data: null, error: { code: '42703', message: `column ${table}.studio does not exist` } }
            : { data: rows.map((r) => Object.fromEntries(asked.map((c) => [c, r[c] ?? null]))), error: null };
          const q = { eq: () => q, then: (ok, ko) => Promise.resolve(result).then(ok, ko) };
          return q;
        }
      };
    }
  };
}

await test('insertManyCompat: with the column when it is there; without it (and nothing else) before 122', async () => {
  const lines = [{ creator_id: 'a', cents: 5, studio: true }, { creator_id: 'b', cents: 6, studio: false }];
  const after = standIn({ hasStudio: true });
  assert.equal((await insertManyCompat(after, 'creator_ledger', lines, ['studio'])).error, null);
  assert.deepEqual(after.rows.map((r) => r.studio), [true, false]);
  assert.equal(after.calls.length, 1);
  const before = standIn({ hasStudio: false });
  assert.equal((await insertManyCompat(before, 'creator_ledger', lines, ['studio'])).error, null);
  assert.deepEqual(before.rows, [{ creator_id: 'a', cents: 5 }, { creator_id: 'b', cents: 6 }]);
  assert.deepEqual(before.calls.map((c) => c.keys), [['creator_id', 'cents', 'studio'], ['creator_id', 'cents']]);
  // Another error that happens to name the word is never answered by dropping the field.
  const other = standIn({ hasStudio: true, failWith: { code: '23514', message: 'new row violates check constraint "studio_something"' } });
  const res = await insertManyCompat(other, 'creator_ledger', lines, ['studio']);
  assert.equal(res.error.code, '23514');
  assert.equal(other.calls.length, 1);
  // Nothing to write is no call at all.
  const none = standIn({ hasStudio: true });
  assert.equal((await insertManyCompat(none, 'creator_ledger', [], ['studio'])).error, null);
  assert.equal(none.calls.length, 0);
});

await test('selectCompat: names the column when it is there; reads without it before 122', async () => {
  const after = standIn({ hasStudio: true });
  after.rows.push({ id: 1, cents: 5, studio: true });
  const a = await selectCompat((cols) => after.from('creator_ledger').select(cols).eq('x', 1), 'id, cents', ['studio']);
  assert.deepEqual(a.data, [{ id: 1, cents: 5, studio: true }]);
  const before = standIn({ hasStudio: false });
  before.rows.push({ id: 1, cents: 5 });
  const b = await selectCompat((cols) => before.from('creator_ledger').select(cols).eq('x', 1), 'id, cents', ['studio']);
  assert.equal(b.error, null);
  assert.deepEqual(b.data, [{ id: 1, cents: 5 }]);
  assert.deepEqual(before.calls.map((c) => c.cols), ['id, cents, studio', 'id, cents']);
});

console.log(`\n${passed} passed`);
