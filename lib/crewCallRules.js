// Crew Call board vocabularies and the track-record ladder — the parts
// the browser and the app need too (lib/crewCalls.js pulls in server-only
// modules, so the shared bits live here).

export const PAY_TYPES = { paid: 'Paid', union: 'Union', deferred: 'Deferred', unpaid: 'Unpaid', other: 'Other' };
export const PAY_HINT = {
  paid: '$350/day',
  union: 'SAG-AFTRA micro-budget, IATSE scale…',
  deferred: 'deferred + credit, points…',
  unpaid: 'meals + credit',
  other: 'say what the deal is'
};
export const MAX_SPOTS = 20;
export const MAX_OPEN_CALLS = 10;
export const AUTO_CLOSE_DAYS = 7;
export const MAX_ENDORSEMENT_CHARS = 200;

// The ladder (Jose, 2026-10-10): New crew for the first month on Studio
// Tapa, then Crew, and Veteran at three or more confirmed jobs / released
// titles — work beats the month if you get there faster. Hand-typed
// credits never count.
export const VETERAN_AT = 3;
export const NEW_DAYS = 30;
export const TIERS = {
  new: { label: 'New crew', rank: 0 },
  crew: { label: 'Crew', rank: 1 },
  veteran: { label: 'Veteran', rank: 2 }
};

export function tierFor({ done = 0, joinedAt = null, now = Date.now() }) {
  if (done >= VETERAN_AT) return 'veteran';
  if (!joinedAt || now - new Date(joinedAt).getTime() < NEW_DAYS * 86400000) return 'new';
  return 'crew';
}

export const tierLabel = (tier) => (TIERS[tier] || TIERS.new).label;

export function crewCallRules() {
  return { payTypes: PAY_TYPES, payHint: PAY_HINT, maxSpots: MAX_SPOTS, maxOpenCalls: MAX_OPEN_CALLS, tiers: TIERS, veteranAt: VETERAN_AT, newDays: NEW_DAYS, maxEndorsementChars: MAX_ENDORSEMENT_CHARS };
}
