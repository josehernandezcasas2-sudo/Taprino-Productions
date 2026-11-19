// Yearly Stream plans (2026-11-19): lib/yearlyPlanRules.js — the picker's
// Monthly / Yearly switch, the cards' words and maths, the plan row — and
// the app's mobile/src/lib/yearlyPlanRules.js word for word.
//   node scripts/test-yearly-plans.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as R from '../lib/yearlyPlanRules.js';
import { canLeaveCents, studioShare, yearlyAheadSub, YEARLY_AHEAD_LABEL } from '../lib/studioMoneyRules.js';

let n = 0;
const t = (name, fn) => { fn(); n += 1; console.log('ok', name); };

// The plans as lib/membershipPlans.js answers them on the rig (Jose's
// prices: ten months, rounded down to the dollar).
const plan = (tier, name, m, y) => ({ tier, name, priceId: `price_${tier}`, amountCents: m, currency: 'usd', interval: 'month', monthly: { priceId: `price_${tier}`, amountCents: m }, yearly: y ? { priceId: `price_${tier}_y`, amountCents: y } : null });
const PLANS = [plan('standard', 'Standard', 799, 7900), plan('premium', 'Premium', 1299, 12900), plan('sponsor', 'Sponsor', 699, 6900)];

t('the app copy is the website file word for word, with no imports', () => {
  const web = readFileSync(new URL('../lib/yearlyPlanRules.js', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../mobile/src/lib/yearlyPlanRules.js', import.meta.url), 'utf8');
  assert.equal(app, web);
  assert.equal(web.split('\n').filter((l) => /^import\s/.test(l)).length, 0);
});

t('billingInterval: month by default, year when asked, anything else refused', () => {
  assert.equal(R.billingInterval(undefined), 'month');
  assert.equal(R.billingInterval(''), 'month');
  assert.equal(R.billingInterval('month'), 'month');
  assert.equal(R.billingInterval('year'), 'year');
  assert.equal(R.billingInterval('week'), null);
  assert.equal(R.billingInterval('YEAR'), null);
  assert.equal(R.billingInterval({}), null);
});

t('planPriceFor: the monthly and yearly prices; an older plan sells its flat fields monthly', () => {
  assert.deepEqual(R.planPriceFor(PLANS[0], 'month'), { priceId: 'price_standard', amountCents: 799 });
  assert.deepEqual(R.planPriceFor(PLANS[0], 'year'), { priceId: 'price_standard_y', amountCents: 7900 });
  assert.equal(R.planPriceFor(plan('sponsor', 'Sponsor', 699, null), 'year'), null);
  const older = { tier: 'premium', priceId: 'price_old', amountCents: 1299, interval: 'month' };
  assert.deepEqual(R.planPriceFor(older, 'month'), { priceId: 'price_old', amountCents: 1299 });
  assert.equal(R.planPriceFor(older, 'year'), null);
  // A tier sold yearly only has no monthly price.
  assert.equal(R.planPriceFor({ ...plan('standard', 'Standard', 7900, null), interval: 'year', monthly: null, yearly: { priceId: 'p', amountCents: 7900 } }, 'month'), null);
  assert.equal(R.planPriceFor(null, 'month'), null);
});

t('money: whole dollars without cents, and two months free at Jose’s prices', () => {
  assert.equal(R.moneyText(7900), '$79');
  assert.equal(R.moneyText(658), '$6.58');
  assert.equal(R.moneyText(799), '$7.99');
  assert.equal(R.moneyText(1000), '$10');
  assert.equal(R.monthsFree(799, 7900), 2);
  assert.equal(R.monthsFree(1299, 12900), 2);
  assert.equal(R.monthsFree(699, 6900), 2);
  assert.equal(R.monthsFree(799, 9588), 0);
  assert.equal(R.monthsFree(0, 7900), 0);
});

t('the switch: only when a tier has a yearly price, and it promises the smallest saving', () => {
  assert.equal(R.billingSwitch([]), null);
  assert.equal(R.billingSwitch([plan('standard', 'Standard', 799, null)]), null);
  const sw = R.billingSwitch(PLANS);
  assert.deepEqual(sw, { label: 'Billing', options: [{ value: 'month', label: 'Monthly' }, { value: 'year', label: 'Yearly · 2 months free' }] });
  // One tier at a smaller saving: the switch says that one.
  const one = R.billingSwitch([plan('standard', 'Standard', 799, 8700), plan('premium', 'Premium', 1299, 12900)]);
  assert.equal(one.options[1].label, 'Yearly · 1 month free');
  // No saving at all: just "Yearly".
  assert.equal(R.billingSwitch([plan('standard', 'Standard', 799, 9588)]).options[1].label, 'Yearly');
});

t('a card on Monthly and on Yearly; a tier with no yearly price greyed with its line', () => {
  assert.deepEqual(R.planCardPrice(PLANS[0], 'month'), { available: true, price: '$7.99', per: '/ month', sub: null });
  assert.deepEqual(R.planCardPrice(PLANS[0], 'year'), { available: true, price: '$79', per: 'a year', sub: '$6.58 a month · 2 months free' });
  assert.deepEqual(R.planCardPrice(PLANS[1], 'year'), { available: true, price: '$129', per: 'a year', sub: '$10.75 a month · 2 months free' });
  assert.deepEqual(R.planCardPrice(PLANS[2], 'year'), { available: true, price: '$69', per: 'a year', sub: '$5.75 a month · 2 months free' });
  assert.deepEqual(R.planCardPrice(plan('sponsor', 'Sponsor', 699, null), 'year'), { available: false, price: '$6.99', per: '/ month', sub: 'Monthly only for now.' });
});

t('the join buttons say which billing they check out', () => {
  assert.equal(R.joinLabel('standard', 'Standard', 'month'), 'Join Standard');
  assert.equal(R.joinLabel('standard', 'Standard', 'year'), 'Join Standard · yearly');
  assert.equal(R.joinLabel('sponsor', 'Sponsor', 'month'), 'Become a Sponsor');
  assert.equal(R.joinLabel('sponsor', 'Sponsor', 'year'), 'Become a Sponsor · yearly');
});

t('a member’s plan row: the subscription’s own price, and "Renews … · yearly"', () => {
  assert.equal(R.memberPriceText(PLANS[0], { amount: 7900, interval: 'year', currency: 'usd' }), '$79 a year');
  assert.equal(R.memberPriceText(PLANS[0], { amount: 799, interval: 'month' }), '$7.99 a month');
  // No subscription details (team, or Stripe didn't answer): the plan's monthly price.
  assert.equal(R.memberPriceText(PLANS[0], null), '$7.99 a month');
  assert.equal(R.memberPriceText(null, null), null);
  assert.equal(R.renewLine({ cancelsAtPeriodEnd: false, interval: 'year' }, 'December 19, 2027'), 'Renews December 19, 2027 · yearly');
  assert.equal(R.renewLine({ cancelsAtPeriodEnd: true, interval: 'month' }, 'Dec 19'), 'Ends Dec 19 · monthly');
  assert.equal(R.renewLine({ cancelsAtPeriodEnd: false }, 'Dec 19'), 'Renews Dec 19');
  assert.equal(R.renewLine(null, 'Dec 19'), null);
});

t('the checkout’s lines, and the Artist Support note on a yearly plan only', () => {
  assert.equal(R.noYearlyLine('Sponsor'), 'Sponsor has no yearly price yet — pick monthly, or another plan.');
  assert.equal(R.noMonthlyLine('Standard'), 'Standard is sold yearly only right now.');
  assert.equal(R.BILLING_WORDS.unknownInterval, 'Pick monthly or yearly.');
  assert.equal(R.yearlyShareNote('year'), 'Your share goes out month by month. Change your picks any time; the next month follows them.');
  assert.equal(R.yearlyShareNote('month'), null);
  assert.equal(R.yearlyShareNote(null), null);
});

t('Studio money: the yearly share still to credit stays in Stripe', () => {
  const base = { availableCents: 50000, owedCents: 10000, adCreditsCents: 0, reserveCents: 30000, earmarkCents: 0 };
  assert.deepEqual(canLeaveCents(base), { cents: 10000, stayCents: 40000, shortfallCents: 0 });
  assert.deepEqual(canLeaveCents({ ...base, yearlySharesAheadCents: 2200 }), { cents: 7800, stayCents: 42200, shortfallCents: 0 });
  assert.deepEqual(canLeaveCents({ ...base, yearlySharesAheadCents: 15000 }), { cents: 0, stayCents: 55000, shortfallCents: 5000 });
  assert.equal(YEARLY_AHEAD_LABEL, 'Yearly plans’ share still to credit');
  assert.equal(yearlyAheadSub({ payments: 1, months: 11 }), '1 yearly membership · 11 months of creator share members have paid for, credited one month at a time');
  assert.equal(yearlyAheadSub({ payments: 2, months: 1 }), '2 yearly memberships · 1 month of creator share members have paid for, credited one month at a time');
});

t('Studio money: a year sold in the period doesn’t read as the studio’s margin', () => {
  const common = { membershipFeeCents: 259, reversedCreditCents: 0, refundedCents: 0, disputeCents: 0, backingKeptCents: 0, bookingsKeptCents: 0, adsServedCents: 0, unexplainedCents: 0 };
  // $79 paid, month 1 ($2) credited, 11 months ($22) still to credit.
  const sold = studioShare({ ...common, membershipGrossCents: 7900, creditedCents: 200, yearlyAheadChangeCents: 2200 });
  assert.equal(sold.membership.marginCents, 7900 - 259 - 200 - 2200);
  assert.equal(sold.membership.yearlyAheadChangeCents, 2200);
  // The next period: a month credited from it, the amount ahead down by as much — no loss.
  const next = studioShare({ ...common, membershipFeeCents: 0, membershipGrossCents: 0, creditedCents: 200, yearlyAheadChangeCents: -200 });
  assert.equal(next.membership.marginCents, 0);
  // Without yearly plans nothing changes.
  assert.equal(studioShare({ ...common, membershipGrossCents: 799, creditedCents: 200 }).membership.marginCents, 799 - 259 - 200);
});

console.log(`\n${n} passed`);
