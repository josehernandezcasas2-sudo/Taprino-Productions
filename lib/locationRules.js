// Locations vocabularies, limits and the booking math — the parts the
// browser and the app need too (lib/locations.js pulls in server-only
// modules, so the shared bits live here). Mockup: mockups/locations-v1.html.
import { feeCoverCents } from './donationMath';

export const LOCATION_TYPES = {
  home: 'Home',
  apartment: 'Apartment',
  warehouse: 'Warehouse',
  cafe: 'Café / bar',
  office: 'Office',
  studio: 'Studio',
  shop: 'Shop',
  outdoors: 'Outdoors / land',
  vehicle: 'Vehicle',
  other: 'Something else'
};

// Tick-box facts, grouped the way the listing form shows them. Keys are
// what locations.features stores and what the directory filters on.
export const FEATURE_GROUPS = [
  {
    label: 'Light, power, sound',
    items: [
      ['natural_light', 'Natural light'],
      ['blackout', 'Blackout possible'],
      ['power_tiein', 'Power tie-in'],
      ['household_power', 'Household circuits'],
      ['power_50a', '50A+ outlet'],
      ['quiet', 'Quiet street'],
      ['flight_path', 'Near a flight path'],
      ['soundproof', 'Soundproofed']
    ]
  },
  {
    label: 'Logistics',
    items: [
      ['driveway', 'Driveway parking'],
      ['street_parking', 'Street parking'],
      ['truck_access', 'Truck access'],
      ['ground_loadin', 'Ground-level load-in'],
      ['elevator', 'Elevator'],
      ['loading_dock', 'Loading dock'],
      ['bathrooms', 'Bathrooms crews may use'],
      ['kitchen', 'Kitchen use'],
      ['wifi', 'Wifi'],
      ['overnight', 'Overnight OK'],
      ['green_room', 'Green room'],
      ['makeup_area', 'Makeup area'],
      ['furniture_moves', 'Furniture may move']
    ]
  }
];
export const FEATURES = Object.fromEntries(FEATURE_GROUPS.flatMap((g) => g.items));

// The chips on the directory, each a feature key (or a special filter).
export const FILTER_CHIPS = [
  ['driveway', 'Parking'],
  ['quiet', 'Quiet'],
  ['natural_light', 'Natural light'],
  ['power_tiein', 'Power tie-in'],
  ['overnight', 'Overnight OK'],
  ['kitchen', 'Kitchen'],
  ['truck_access', 'Truck access']
];

export const CANCELLATION = {
  flexible: { label: 'Flexible', text: 'Full refund up to 48 hours before the first day.', fullBeforeDays: 2, halfBeforeDays: 0 },
  moderate: { label: 'Moderate', text: 'Full refund 7+ days out, half inside 7 days, none inside 48 hours.', fullBeforeDays: 7, halfBeforeDays: 2 },
  strict: { label: 'Strict', text: 'Full refund 14+ days out, half inside 14 days, none inside 7 days.', fullBeforeDays: 14, halfBeforeDays: 7 }
};

export const PERMIT_HELP = {
  host_handles: 'The host handles the film permit',
  host_helps: 'The host can help with the permit',
  you_handle: 'You handle any permit',
  none_needed: 'No permit needed here'
};

export const OWNERSHIP = {
  owner: 'I own this place',
  works_here: 'I work here and can book it',
  permission: 'I have the owner’s written permission'
};

export const REQUEST_STATUS = {
  requested: 'Waiting on the host',
  countered: 'Host countered',
  accepted: 'Accepted · pay to confirm',
  declined: 'Declined',
  expired: 'Expired',
  cancelled: 'Cancelled',
  paid: 'Confirmed · paid',
  done: 'Done',
  refunded: 'Refunded'
};

export const MAX_PHOTOS = 12;
export const MAX_LISTINGS = 10;
export const MAX_CREW = 200;
export const MAX_RATE_CENTS = 2000000; // $20,000
export const MIN_BOOKING_CENTS = 2500; // $25
export const MAX_BOOKING_CENTS = 5000000; // $50,000
export const RESPOND_HOURS = 48;
export const MAX_DAYS = 30;
export const MAX_ENDORSEMENT_CHARS = 200;
export const DEFAULT_CUT_PERCENT = 10;

/* ---------- money ---------- */

export function dollars(cents, { whole = false } = {}) {
  const n = (cents || 0) / 100;
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: whole && Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 })}`;
}

// How many calendar days a request covers (both ends inclusive).
export function dayCount(startsOn, endsOn) {
  if (!startsOn) return 0;
  const a = Date.parse(`${startsOn}T12:00:00Z`);
  const b = Date.parse(`${endsOn || startsOn}T12:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return 0;
  return Math.round((b - a) / 86400000) + 1;
}

export function isWeekend(iso) {
  const d = new Date(`${iso}T12:00:00Z`).getUTCDay();
  return d === 0 || d === 6;
}

// The host's posted rates applied to a request. Each day is priced on its
// own: the day rate when the hours reach day_hours (or no hourly rate is
// set), otherwise hours × hourly (never under min_hours); weekends get
// the host's uplift. Null when the listing has no rates (deal only).
// Hours a day from the times on a request: whole hours (at least one),
// an overnight shoot wrapping past midnight. The one rule the server
// prices with and every estimate shows (the app keeps a copy in
// mobile/src/lib/locationRules.js); estimates used to round to the half
// hour and could come out an hour off, or flip day rate vs hourly.
export function hoursBetween(from, to) {
  if (!/^d{2}:d{2}$/.test(from || '') || !/^d{2}:d{2}$/.test(to || '')) return null;
  const [fh, fm] = from.split(':').map(Number);
  const [th, tm] = to.split(':').map(Number);
  let h = (th + tm / 60) - (fh + fm / 60);
  if (h <= 0) h += 24;
  return Math.max(1, Math.round(h));
}

export function quoteFor(listing, { startsOn, endsOn, hoursPerDay }) {
  const days = dayCount(startsOn, endsOn);
  if (!days) return null;
  const hourly = listing.hourlyCents || 0;
  const day = listing.dayCents || 0;
  if (!hourly && !day) return null;
  const hours = Math.max(1, Math.round(Number(hoursPerDay) || listing.dayHours || 10));
  const lines = [];
  let subtotal = 0;
  for (let i = 0; i < days; i += 1) {
    const iso = new Date(Date.parse(`${startsOn}T12:00:00Z`) + i * 86400000).toISOString().slice(0, 10);
    let base;
    let how;
    if (day && (!hourly || hours >= (listing.dayHours || 10))) {
      base = day;
      how = 'day';
    } else {
      const billed = Math.max(hours, listing.minHours || 1);
      base = billed * hourly;
      how = `${billed} hr`;
    }
    const uplift = isWeekend(iso) && listing.weekendPct ? Math.round((base * listing.weekendPct) / 100) : 0;
    lines.push({ day: iso, cents: base + uplift, how, weekend: uplift > 0 });
    subtotal += base + uplift;
  }
  return { days, hours, lines, subtotalCents: subtotal };
}

// The full split of a booking: what the producer pays and what the host
// receives. The cut comes off the place + cleaning; the producer covers
// the card fee on top (same shape as backing, lib/donationMath.js).
export function splitBooking({ subtotalCents, cleaningCents = 0, cutPercent = DEFAULT_CUT_PERCENT }) {
  const base = Math.max(0, Math.round(subtotalCents || 0)) + Math.max(0, Math.round(cleaningCents || 0));
  const cut = Number.isFinite(Number(cutPercent)) ? Number(cutPercent) : DEFAULT_CUT_PERCENT;
  const platformCutCents = Math.floor((base * cut) / 100);
  const hostPayoutCents = base - platformCutCents;
  const fee = feeCoverCents(base);
  return {
    subtotalCents: Math.max(0, Math.round(subtotalCents || 0)),
    cleaningCents: Math.max(0, Math.round(cleaningCents || 0)),
    bookingCents: base,
    platformCutCents,
    hostPayoutCents,
    feeCoverCents: fee,
    totalChargedCents: base + fee,
    cutPercent: cut
  };
}

// The refund a cancellation earns under the listing's policy, given how
// many whole days remain before the first day.
export function refundPercentFor(policy, daysBefore) {
  const p = CANCELLATION[policy] || CANCELLATION.moderate;
  if (daysBefore >= p.fullBeforeDays) return 100;
  if (p.halfBeforeDays > 0 && daysBefore >= p.halfBeforeDays) return 50;
  return 0;
}

// A one-line rate for a card: "$85/hr · $600/day", "$450/day", or
// "Make a deal".
export function rateLine(listing) {
  const parts = [];
  if (listing.hourlyCents) parts.push(`${dollars(listing.hourlyCents, { whole: true })}/hr`);
  if (listing.dayCents) parts.push(`${dollars(listing.dayCents, { whole: true })}/day`);
  if (!parts.length) return 'Make a deal';
  return parts.join(' · ');
}

export function locationRules() {
  return {
    types: LOCATION_TYPES, featureGroups: FEATURE_GROUPS, filterChips: FILTER_CHIPS, cancellation: CANCELLATION, permitHelp: PERMIT_HELP, ownership: OWNERSHIP,
    requestStatus: REQUEST_STATUS, maxPhotos: MAX_PHOTOS, maxListings: MAX_LISTINGS, minBookingCents: MIN_BOOKING_CENTS, maxBookingCents: MAX_BOOKING_CENTS,
    respondHours: RESPOND_HOURS, maxDays: MAX_DAYS, maxEndorsementChars: MAX_ENDORSEMENT_CHARS
  };
}
