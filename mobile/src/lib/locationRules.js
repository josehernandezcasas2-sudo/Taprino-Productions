// Mirror of lib/locationRules.js on the website: the money math the
// request form needs for its live estimate, and a few labels. The
// vocabularies (types, feature groups, policies) come from the API's
// `rules` object so the two never drift. Keep the numbers in sync by hand.
export const STRIPE_FEE_PERCENT = 2.9;
export const STRIPE_FEE_FIXED_CENTS = 30;
export const DEFAULT_CUT_PERCENT = 10;
export const MIN_BOOKING_CENTS = 2500;
export const MAX_BOOKING_CENTS = 5000000;
export const MAX_DAYS = 30;
export const MAX_PHOTOS = 12;

export function dollars(cents, { whole = false } = {}) {
  const n = (cents || 0) / 100;
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: whole && Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 })}`;
}

export function feeCoverCents(amountCents) {
  const total = Math.ceil((amountCents + STRIPE_FEE_FIXED_CENTS) / (1 - STRIPE_FEE_PERCENT / 100));
  return Math.max(0, total - amountCents);
}

// A chargeback on a booking (migration 096, lib/paymentDisputes.js), in
// one line for both sides of the request page.
export function disputeLine(d) {
  if (!d) return '';
  const state = d.status === 'won' ? 'Disputed by the producer’s bank; it ruled for us' : d.status === 'lost' ? 'Disputed by the producer’s bank; it ruled for the producer' : 'The producer’s bank is disputing this payment';
  const decision = d.decision === 'clawback'
    ? ` · ${dollars(d.clawbackCents)} taken back from the host${d.returnedCents ? `, ${dollars(d.returnedCents)} paid back` : ''}`
    : d.decision === 'absorb' ? ' · Studio Tapa covered it' : '';
  return state + decision;
}

export function dayCount(startsOn, endsOn) {
  if (!startsOn) return 0;
  const a = Date.parse(`${startsOn}T12:00:00Z`);
  const b = Date.parse(`${endsOn || startsOn}T12:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return 0;
  return Math.round((b - a) / 86400000) + 1;
}

export function daysBetween(a, b) {
  const n = dayCount(a, b);
  const out = [];
  for (let i = 0; i < n; i += 1) out.push(new Date(Date.parse(`${a}T12:00:00Z`) + i * 86400000).toISOString().slice(0, 10));
  return out;
}

export function isWeekend(iso) {
  const d = new Date(`${iso}T12:00:00Z`).getUTCDay();
  return d === 0 || d === 6;
}

// Same rule as the server: day rate when the hours reach day_hours (or
// there's no hourly rate), else hours × hourly never under min_hours,
// weekends uplifted.
// `studio`: the host's Studio Tapa day rate (migration 107), for a request
// linked to a production on Studio Tapa.
export function quoteFor(listing, { startsOn, endsOn, hoursPerDay, studio = false }) {
  const days = dayCount(startsOn, endsOn);
  if (!days) return null;
  const studioDay = studio && listing.studioRateCents ? listing.studioRateCents : 0;
  const hourly = studioDay ? 0 : listing.hourlyCents || 0;
  const day = studioDay || listing.dayCents || 0;
  if (!hourly && !day) return null;
  const hours = Math.max(1, Math.round(Number(hoursPerDay) || listing.dayHours || 10));
  let subtotal = 0;
  let allDay = true;
  for (const iso of daysBetween(startsOn, endsOn)) {
    let base;
    if (day && (!hourly || hours >= (listing.dayHours || 10))) base = day;
    else { base = Math.max(hours, listing.minHours || 1) * hourly; allDay = false; }
    const uplift = isWeekend(iso) && listing.weekendPct ? Math.round((base * listing.weekendPct) / 100) : 0;
    subtotal += base + uplift;
  }
  return { days, hours, subtotalCents: subtotal, allDay, studio: Boolean(studioDay) };
}

export function splitBooking({ subtotalCents, cleaningCents = 0, cutPercent = DEFAULT_CUT_PERCENT }) {
  const base = Math.max(0, Math.round(subtotalCents || 0)) + Math.max(0, Math.round(cleaningCents || 0));
  const platformCutCents = Math.floor((base * cutPercent) / 100);
  const fee = feeCoverCents(base);
  return { bookingCents: base, cleaningCents: Math.max(0, Math.round(cleaningCents || 0)), platformCutCents, hostPayoutCents: base - platformCutCents, feeCoverCents: fee, totalChargedCents: base + fee };
}

export function hoursBetween(from, to) {
  if (!/^\d{2}:\d{2}$/.test(from || '') || !/^\d{2}:\d{2}$/.test(to || '')) return null;
  const [fh, fm] = from.split(':').map(Number);
  const [th, tm] = to.split(':').map(Number);
  let h = (th + tm / 60) - (fh + fm / 60);
  if (h <= 0) h += 24;
  // Whole hours, the way the server prices a request (lib/locationRules.js).
  return Math.max(1, Math.round(h));
}

export const STATUS_LABEL = { pending: 'In review', listed: 'Listed', paused: 'Paused', rejected: 'Not approved', removed: 'Removed' };

export function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function thisMonth() {
  return todayIso().slice(0, 7);
}
export function fmtDay(iso, opts = { month: 'short', day: 'numeric' }) {
  return new Date(`${iso}T12:00:00`).toLocaleDateString('en-US', opts);
}
export function fmtRange(a, b) {
  if (!a) return '';
  return !b || b === a ? fmtDay(a) : `${fmtDay(a)}–${fmtDay(b)}`;
}
export function hoursLabel(from, to) {
  const f = (t) => {
    if (!t) return '';
    const [h, m] = t.split(':').map(Number);
    const ampm = h >= 12 ? 'pm' : 'am';
    const hh = h % 12 === 0 ? 12 : h % 12;
    return m ? `${hh}:${String(m).padStart(2, '0')}${ampm}` : `${hh}${ampm}`;
  };
  if (!from && !to) return 'Any hours';
  return `${f(from) || '…'} – ${f(to) || '…'}`;
}
