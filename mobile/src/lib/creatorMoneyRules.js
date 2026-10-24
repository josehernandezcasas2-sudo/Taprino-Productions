// The app's copy of the labels and money strings from the website's
// lib/creatorMoneyRules.js. The maths runs on the server
// (/api/creator/money); the screen renders what it sends.
export const LANES = {
  member_support: { label: 'Member support', short: 'Member support' },
  ad_share: { label: 'Ad share', short: 'Ads' },
  tips: { label: 'Tips', short: 'Tips' },
  sales: { label: 'Title sales', short: 'Sales' },
  backing: { label: 'Backing', short: 'Backing' },
  bookings: { label: 'Bookings', short: 'Bookings' },
  payouts: { label: 'Payouts', short: 'Payouts' }
};
export const LANE_ORDER = ['member_support', 'ad_share', 'tips', 'sales', 'backing', 'bookings', 'payouts'];

export function dollars(cents) {
  const v = (Number(cents) || 0) / 100;
  const s = `$${Math.abs(v).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
  return v < 0 ? `−${s}` : s;
}

// +$3.57 / −$2.26 / $22.80 for a payout.
export function signed(cents, lane) {
  if (lane === 'payouts' && cents > 0) return dollars(cents);
  return cents > 0 ? `+${dollars(cents)}` : dollars(cents);
}

export function periodLabel(key) {
  if (/^\d{4}$/.test(key)) return key;
  const [y, m] = String(key).split('-').map(Number);
  if (!y || !m) return String(key);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}
