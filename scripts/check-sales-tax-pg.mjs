// Sales tax's writes and reads (lib/salesTax.js, lib/pitchDonations.js,
// lib/locationRequests.js, lib/creatorShare.js, lib/studioMoney.js) on a
// real Postgres, before and after migration 122: what the site sends
// PostgREST, as SQL, against the real schema (the stand-ins enforce no
// NOT NULL, CHECK or column-existence rule).
//   before 122: the settings row reads as every switch off; the 'fee'
//     writes (today's) go through; the Studio money reads with the tax
//     columns fail with 42703 and their fallbacks answer.
//   after 122: the settings save (validateTaxUpdate's patch) and the
//     database's own check on the booking code; a 'transfer' backing
//     (insert, completion with split + tax); a 'transfer' booking
//     (Checkout stamp, completion guarded on 'accepted', refunds); a
//     member payment with its tax; the audit line a refused membership
//     Checkout writes; the Studio money reads; and a 'fee' row reads as
//     split 'fee', tax 0.
// Needs PGlite (see scripts/pg-chain.mjs): node scripts/check-sales-tax-pg.mjs
import assert from 'node:assert/strict';
import path from 'node:path';
import { buildDb, runFile, migrationFiles, SUPABASE_DIR } from './pg-chain.mjs';
import { taxSettingsFromRow, validateTaxUpdate, chargedCents, bookingRefundCents } from '../lib/salesTaxRules.js';
import { splitDonation } from '../lib/donationMath.js';

let n = 0;
const ok = (name) => { n += 1; console.log('ok', name); };

function insertSql(table, row) {
  const cols = Object.keys(row);
  return { text: `insert into public.${table} (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')}) returning *`, values: cols.map((c) => (row[c] !== null && typeof row[c] === 'object' ? JSON.stringify(row[c]) : row[c])) };
}
async function insert(db, table, row) {
  const q = insertSql(table, row);
  return (await db.query(q.text, q.values)).rows[0];
}
async function update(db, table, patch, where, whereValues = []) {
  const cols = Object.keys(patch);
  const sets = cols.map((c, i) => `${c} = $${i + 1}`).join(', ');
  const w = where.replace(/\$(\d+)/g, (_, k) => `$${Number(k) + cols.length}`);
  return (await db.query(`update public.${table} set ${sets} where ${w} returning *`, [...cols.map((c) => patch[c]), ...whereValues])).rows;
}
async function refuses(promise, code, what) {
  try {
    await promise;
  } catch (err) {
    assert.equal(err.code, code, `${what}: expected ${code}, got ${err.code} ${err.message}`);
    return;
  }
  throw new Error(`${what}: expected ${code}, it went through`);
}

const STUDIO_MONEY_READS = [
  ['member_payments', 'id, amount_cents, tax_cents, stripe_charge_id, status, paid_at, reversed_at, reverse_reason', 'id, amount_cents, stripe_charge_id, status, paid_at, reversed_at, reverse_reason'],
  ['pitch_donations', 'id, amount_cents, platform_cut_cents, creator_payout_cents, fee_cover_cents, total_charged_cents, tax_cents, split, stripe_charge_id, status, completed_at, refunded_at', 'id, amount_cents, platform_cut_cents, creator_payout_cents, fee_cover_cents, total_charged_cents, stripe_charge_id, status, completed_at, refunded_at'],
  ['location_requests', 'id, platform_cut_cents, host_payout_cents, fee_cover_cents, total_charged_cents, tax_cents, split, subtotal_cents, cleaning_cents, stripe_payment_intent_id, status, paid_at, refunded_at, refund_cents', 'id, platform_cut_cents, host_payout_cents, fee_cover_cents, total_charged_cents, subtotal_cents, cleaning_cents, stripe_payment_intent_id, status, paid_at, refunded_at, refund_cents']
];

const db = await buildDb(121);
ok('schema.sql + migrations through 121');
await db.query('insert into public.site_settings (id) values (1) on conflict (id) do nothing');

// ---- before 122 ----
{
  const row = (await db.query('select * from public.site_settings where id = 1')).rows[0];
  assert.deepEqual(taxSettingsFromRow(row), { ready: false, memberships: false, backings: false, bookings: false, bookingsSwitch: false, bookingCode: null });
  ok('before 122: the settings row reads as every switch off (not ready)');

  for (const [t, withTax, without] of STUDIO_MONEY_READS) {
    await refuses(db.query(`select ${withTax} from public.${t} limit 1`), '42703', `${t} read with the tax columns before 122`);
    await db.query(`select ${without} from public.${t} limit 1`);
  }
  ok('before 122: the Studio money reads with tax columns fail with 42703 and the fallbacks answer');

  const pitch = await insert(db, 'pitches', { title: 'Fawns', logline: 'x', status: 'approved', funding_enabled: true, platform_cut_percent: 5 });
  const s = splitDonation(5000, 5);
  // createDonationCheckout's insert with the 'fee' split: no new columns
  const d = await insert(db, 'pitch_donations', { pitch_id: pitch.id, donor_user_id: 'user_b', donor_email: null, amount_cents: s.amountCents, platform_cut_cents: s.platformCutCents, creator_payout_cents: s.creatorPayoutCents, fee_cover_cents: s.feeCoverCents, total_charged_cents: s.totalChargedCents, status: 'pending' });
  const done = await update(db, 'pitch_donations', { status: 'completed', completed_at: new Date().toISOString(), total_charged_cents: s.totalChargedCents - 0, stripe_charge_id: 'pi_fee', stripe_checkout_session_id: 'cs_fee' }, 'id = $1', [d.id]);
  assert.equal(done.length, 1);
  // recordMembershipInvoice's insert with no tax: no tax column written
  await insert(db, 'member_payments', { user_id: 'user_m', stripe_invoice_id: 'in_pre', stripe_subscription_id: 'sub_1', tier: 'standard', amount_cents: 799, share_cents: 200, bonus_cents: 0, basis: 'none', status: 'split', paid_at: new Date().toISOString() });
  ok('before 122: a fee backing and an untaxed member payment are written exactly as today');
}

// ---- run 122 ----
const FILE = migrationFiles().find((f) => f.startsWith('122_'));
await runFile(db, path.join(SUPABASE_DIR, 'migrations', FILE));
ok(`ran ${FILE}`);

{
  const row = (await db.query('select * from public.site_settings where id = 1')).rows[0];
  const current = taxSettingsFromRow(row);
  assert.deepEqual(current, { ready: true, memberships: true, backings: true, bookings: false, bookingsSwitch: false, bookingCode: null });
  ok('after 122: memberships and backings on, bookings off with no code');

  // the settings card's save: validateTaxUpdate's patch + updated_at
  assert.match(validateTaxUpdate({ taxBookings: true }, current).error, /need a tax code/);
  const { patch } = validateTaxUpdate({ taxBookings: true, taxBookingCode: 'txcd_20030000', taxMemberships: false }, current);
  const saved = await update(db, 'site_settings', { ...patch, updated_at: new Date().toISOString() }, 'id = $1', [1]);
  assert.equal(saved.length, 1);
  const after = taxSettingsFromRow((await db.query('select * from public.site_settings where id = 1')).rows[0]);
  assert.deepEqual(after, { ready: true, memberships: false, backings: true, bookings: true, bookingsSwitch: true, bookingCode: 'txcd_20030000' });
  await refuses(update(db, 'site_settings', { tax_booking_code: 'txcd_123' }, 'id = $1', [1]), '23514', 'a malformed booking code');
  ok('the settings save writes the patch; the database refuses a malformed code too');
}

{
  const pitch = (await db.query("select id from public.pitches where title = 'Fawns'")).rows[0];
  const s = splitDonation(5000, 5);
  const d = await insert(db, 'pitch_donations', { pitch_id: pitch.id, donor_user_id: 'user_b', donor_email: null, amount_cents: s.amountCents, platform_cut_cents: s.platformCutCents, creator_payout_cents: s.creatorPayoutCents, fee_cover_cents: s.feeCoverCents, total_charged_cents: s.totalChargedCents, split: 'transfer', status: 'pending' });
  assert.equal(d.split, 'transfer');
  assert.equal(d.tax_cents, 0);
  const tax = 415;
  const amountTotal = s.totalChargedCents + tax;
  const done = await update(db, 'pitch_donations', { status: 'completed', completed_at: new Date().toISOString(), total_charged_cents: amountTotal - tax, stripe_charge_id: 'pi_tr', stripe_checkout_session_id: 'cs_tr', split: 'transfer', tax_cents: tax }, 'stripe_checkout_session_id is null and id = $1', [d.id]);
  assert.equal(done.length, 1);
  assert.equal(chargedCents(done[0]), amountTotal);
  await refuses(update(db, 'pitch_donations', { tax_cents: -1 }, 'id = $1', [d.id]), '23514', 'a negative tax');
  await refuses(update(db, 'pitch_donations', { split: 'other' }, 'id = $1', [d.id]), '23514', 'an unknown split');
  // the rebuild path (no row at all): an insert with the completion patch
  const rebuilt = await insert(db, 'pitch_donations', { pitch_id: pitch.id, donor_user_id: 'user_c', donor_email: null, amount_cents: s.amountCents, platform_cut_cents: s.platformCutCents, creator_payout_cents: s.creatorPayoutCents, fee_cover_cents: s.feeCoverCents, status: 'completed', completed_at: new Date().toISOString(), total_charged_cents: s.totalChargedCents, stripe_charge_id: 'pi_rb', stripe_checkout_session_id: 'cs_rb', split: 'transfer', tax_cents: 0 });
  assert.equal(rebuilt.split, 'transfer');
  const old = (await db.query("select split, tax_cents from public.pitch_donations where stripe_charge_id = 'pi_fee'")).rows[0];
  assert.deepEqual(old, { split: 'fee', tax_cents: 0 });
  ok('a transfer backing: inserted, completed with its tax; a backing from before 122 reads as fee, 0 tax');
}

{
  const loc = await insert(db, 'locations', { host_id: 'user_h', title: 'The Glass House', kind: 'house' });
  const total = 65000 + 1915;
  const r = await insert(db, 'location_requests', { location_id: loc.id, producer_id: 'user_p', host_id: 'user_h', starts_on: '2026-12-10', ends_on: '2026-12-10', status: 'accepted', subtotal_cents: 60000, cleaning_cents: 5000, platform_cut_cents: 6500, host_payout_cents: 58500, fee_cover_cents: 1915, total_charged_cents: total, cut_percent: 10 });
  // createBookingCheckout's stamp
  const stamped = await update(db, 'location_requests', { stripe_checkout_session_id: 'cs_b', updated_at: new Date().toISOString(), split: 'transfer' }, 'id = $1', [r.id]);
  assert.equal(stamped[0].split, 'transfer');
  // completeBookingFromSession, guarded on 'accepted'
  const tax = 5520;
  const paid = await update(db, 'location_requests', { status: 'paid', paid_at: new Date().toISOString(), updated_at: new Date().toISOString(), stripe_checkout_session_id: 'cs_b', stripe_payment_intent_id: 'pi_b', total_charged_cents: total + tax - tax, split: 'transfer', tax_cents: tax }, "id = $1 and status = 'accepted'", [r.id]);
  assert.equal(paid.length, 1);
  assert.equal(chargedCents(paid[0]), total + tax);
  // a second delivery finds it paid: the guard writes nothing
  assert.equal((await update(db, 'location_requests', { status: 'paid' }, "id = $1 and status = 'accepted'", [r.id])).length, 0);
  // the producer cancels at 50%: refund_cents is the share of booking + its tax
  const cents = bookingRefundCents(paid[0], { by: 'producer', percent: 50 });
  const refunded = await update(db, 'location_requests', { status: 'refunded', refunded_at: new Date().toISOString(), refund_cents: cents, refund_reason: 'Cancelled by the producer (50% under the cancellation policy)', refunded_by: 'user_p', cancelled_at: new Date().toISOString(), cancelled_by: 'user_p', updated_at: new Date().toISOString() }, 'id = $1', [r.id]);
  assert.equal(refunded[0].refund_cents, cents);
  // the dashboard mirror reads select('*') and records everything charged
  const all = (await db.query('select * from public.location_requests where stripe_payment_intent_id = $1', ['pi_b'])).rows[0];
  assert.equal(chargedCents(all), total + tax);
  ok('a transfer booking: stamped at Checkout, paid with its tax (guarded), refunded with its share of the tax');
}

{
  const p = await insert(db, 'member_payments', { user_id: 'user_m', stripe_invoice_id: 'in_tax', stripe_subscription_id: 'sub_1', tier: 'standard', amount_cents: 865, tax_cents: 66, share_cents: 200, bonus_cents: 0, basis: 'none', status: 'split', paid_at: new Date().toISOString() });
  assert.equal(p.tax_cents, 66);
  const pre = (await db.query("select tax_cents from public.member_payments where stripe_invoice_id = 'in_pre'")).rows[0];
  assert.equal(pre.tax_cents, 0);
  await refuses(insert(db, 'member_payments', { user_id: 'user_m', stripe_invoice_id: 'in_neg', tier: 'standard', amount_cents: 865, tax_cents: -5 }), '23514', 'a negative membership tax');
  ok('a member payment records its tax; one from before 122 reads 0');
}

{
  const a = await insert(db, 'audit_log', { admin_id: 'system', admin_email: null, action: 'membership_tax_skipped', target_type: 'checkout', target_id: 'cs_test_1', details: 'Price price_x has tax_behavior unspecified.' });
  assert.equal(a.admin_id, 'system');
  const counted = (await db.query("select created_at, details from public.audit_log where action = 'membership_tax_skipped' and created_at >= now() - interval '90 days' order by created_at desc limit 500")).rows;
  assert.equal(counted.length, 1);
  ok('a membership Checkout made without tax is noted in the audit log and counted');
}

{
  for (const [t, withTax] of STUDIO_MONEY_READS) await db.query(`select ${withTax} from public.${t} limit 1`);
  const sum = (await db.query("select coalesce(sum(tax_cents), 0)::int as s from public.location_requests where status in ('paid', 'done', 'refunded')")).rows[0].s;
  assert.equal(sum, 5520);
  ok('after 122: the Studio money reads with the tax columns answer');
}

console.log(`\n${n} checks passed`);
