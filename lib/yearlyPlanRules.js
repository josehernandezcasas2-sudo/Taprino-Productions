// Yearly Stream plans (2026-11-19; Jose: "yearly should be 10 months plan
// for price. Lets add the yearly versions for all the subscriptions we
// have"). Every word and number the plan picker, the plan row and the
// Artist Support page show about monthly and yearly billing, pure and with
// no imports. The app's mobile/src/lib/yearlyPlanRules.js is this file word
// for word (node scripts/test-yearly-plans.mjs checks both).
//
// A plan (lib/membershipPlans.js) carries `monthly` and `yearly` — each
// { priceId, amountCents } or null — beside the flat fields older app
// builds read, which stay the monthly price. Jose adds the yearly prices in
// Stripe ($79 / $129 / $69: ten months, rounded down to the dollar);
// nothing is created by code, and a tier without one is simply monthly.

export const INTERVALS = ['month', 'year'];

export const BILLING_WORDS = {
  group: 'Billing',
  monthly: 'Monthly',
  yearly: 'Yearly',
  aYear: 'a year',
  aMonth: 'a month',
  perMonth: '/ month',
  noYearly: 'Monthly only for now.',
  yearlyFine: 'Yearly plans are billed once a year and renew each year. Switch or cancel in Manage subscription.',
  shareNote: 'Your share goes out month by month. Change your picks any time; the next month follows them.',
  picksApply: 'changes apply from your next renewal',
  picksApplyYearly: 'changes apply from next month',
  unknownInterval: 'Pick monthly or yearly.'
};

// What a checkout asks for: 'month' (also when nothing is said) or 'year';
// anything else is null (refused).
export function billingInterval(value) {
  if (value === undefined || value === null || value === '' || value === 'month') return 'month';
  if (value === 'year') return 'year';
  return null;
}

// The price a plan sells at for one interval → { priceId, amountCents } or
// null. A plan read before yearly plans existed (no `monthly` key) sells its
// flat fields monthly.
export function planPriceFor(plan, interval = 'month') {
  if (!plan) return null;
  if (interval === 'year') return plan.yearly && plan.yearly.priceId ? plan.yearly : null;
  if (plan.monthly && plan.monthly.priceId) return plan.monthly;
  if (plan.monthly === undefined && plan.priceId && (plan.interval || 'month') === 'month') return { priceId: plan.priceId, amountCents: plan.amountCents };
  return null;
}

export function hasYearly(plans) {
  return (plans || []).some((p) => Boolean(planPriceFor(p, 'year')));
}

// Money as the picker writes it: "$79" for whole dollars, "$6.58" otherwise.
export function moneyText(cents, currency = 'usd') {
  const n = Math.max(0, Math.round(Number(cents) || 0));
  const amount = n % 100 === 0 ? String(n / 100) : (n / 100).toFixed(2);
  return String(currency || 'usd').toLowerCase() === 'usd' ? `$${amount}` : `${amount} ${String(currency).toUpperCase()}`;
}

// How many months a yearly price leaves out of twelve monthly ones,
// rounded ($79 against $7.99 → 2).
export function monthsFree(monthlyCents, yearlyCents) {
  const m = Math.round(Number(monthlyCents) || 0);
  const y = Math.round(Number(yearlyCents) || 0);
  if (m <= 0 || y <= 0) return 0;
  return Math.max(0, Math.round((12 * m - y) / m));
}

const freeWords = (n) => `${n} month${n === 1 ? '' : 's'} free`;

// The Monthly / Yearly switch above the plans, or null when no tier has a
// yearly price (the picker then looks as it always has). The yearly
// option says the smallest saving any tier offers, so it never promises
// more than every card gives.
export function billingSwitch(plans) {
  if (!hasYearly(plans)) return null;
  const savings = (plans || [])
    .map((p) => {
      const m = planPriceFor(p, 'month');
      const y = planPriceFor(p, 'year');
      return m && y ? monthsFree(m.amountCents, y.amountCents) : null;
    })
    .filter((n) => n !== null);
  const least = savings.length ? Math.min(...savings) : 0;
  return {
    label: BILLING_WORDS.group,
    options: [
      { value: 'month', label: BILLING_WORDS.monthly },
      { value: 'year', label: least > 0 ? `${BILLING_WORDS.yearly} · ${freeWords(least)}` : BILLING_WORDS.yearly }
    ]
  };
}

// What one plan's card shows for the chosen billing:
//   { available, price, per, sub }
// Monthly: "$7.99" "/ month". Yearly: "$79" "a year" and "$6.58 a month ·
// 2 months free"; a tier with no yearly price is not available, keeps its
// monthly price and says so.
export function planCardPrice(plan, interval = 'month') {
  const currency = plan && plan.currency;
  const monthly = planPriceFor(plan, 'month');
  if (interval === 'year') {
    const yearly = planPriceFor(plan, 'year');
    if (!yearly) {
      return { available: false, price: monthly ? moneyText(monthly.amountCents, currency) : '—', per: monthly ? BILLING_WORDS.perMonth : '', sub: BILLING_WORDS.noYearly };
    }
    const free = monthly ? monthsFree(monthly.amountCents, yearly.amountCents) : 0;
    const each = `${moneyText(Math.round(yearly.amountCents / 12), currency)} ${BILLING_WORDS.aMonth}`;
    return { available: true, price: moneyText(yearly.amountCents, currency), per: BILLING_WORDS.aYear, sub: free > 0 ? `${each} · ${freeWords(free)}` : each };
  }
  if (!monthly) return { available: false, price: '—', per: '', sub: null };
  return { available: true, price: moneyText(monthly.amountCents, currency), per: BILLING_WORDS.perMonth, sub: null };
}

// The join button on a card a free account sees.
export function joinLabel(tier, label, interval = 'month') {
  const base = tier === 'sponsor' ? 'Become a Sponsor' : `Join ${label}`;
  return interval === 'year' ? `${base} · yearly` : base;
}

// A member's plan as their plan row and the hub's tile say it: the price
// of the subscription they have (Stripe's own amount and interval), else
// the plan's monthly price. → "$79 a year" | "$7.99 a month" | null
export function memberPriceText(plan, sub = null) {
  if (sub && Number(sub.amount) > 0) {
    const per = sub.interval === 'year' ? BILLING_WORDS.aYear : BILLING_WORDS.aMonth;
    return `${moneyText(sub.amount, sub.currency || (plan && plan.currency))} ${per}`;
  }
  const monthly = planPriceFor(plan, 'month');
  return monthly ? `${moneyText(monthly.amountCents, plan && plan.currency)} ${BILLING_WORDS.aMonth}` : null;
}

// "Renews Dec 19, 2027 · yearly" / "Ends Jan 3 · monthly" (the date is
// formatted by the caller, long on the website's row, short in the app).
export function renewLine(sub, dateText) {
  if (!sub) return null;
  const when = `${sub.cancelsAtPeriodEnd ? 'Ends' : 'Renews'} ${dateText}`;
  if (sub.interval === 'year') return `${when} · yearly`;
  if (sub.interval === 'month') return `${when} · monthly`;
  return when;
}

// The 400 lines when a tier has no price for the billing asked for.
export function noYearlyLine(label) {
  return `${label} has no yearly price yet — pick monthly, or another plan.`;
}
export function noMonthlyLine(label) {
  return `${label} is sold yearly only right now.`;
}

// The Artist Support page on a yearly plan (null on a monthly one).
export function yearlyShareNote(interval) {
  return interval === 'year' ? BILLING_WORDS.shareNote : null;
}
