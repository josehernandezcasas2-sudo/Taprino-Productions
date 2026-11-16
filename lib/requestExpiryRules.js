// Pure, no imports: when a location request runs out of time (2026-11-16).
//
// A request the host hasn't answered, or a counter-offer the producer
// hasn't taken, is over once its responds_by passes (48 hours,
// lib/locationRules.js RESPOND_HOURS). The sweep that writes `expired`
// and tells people (lib/locationRequests.js) used to run on every read of
// a request; it now runs at most once a minute across the site, and once
// a day from the cron. So nothing waits on it: a request past its time
// reads as expired at once (shownStatus), and every answer that depends
// on the time — accept, counter, decline, take the counter — checks it
// itself, and its write only lands while the time hasn't passed.
// Tested by scripts/test-round-nov16.mjs.

export const EXPIRY_EVERY_MS = 60 * 1000;
export const RESPONDING_STATUSES = Object.freeze(['requested', 'countered']);

const ms = (v) => {
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'number') return v;
  const t = Date.parse(v || '');
  return Number.isFinite(t) ? t : NaN;
};

// Whether a request waiting on an answer is past its time. A request
// without a responds_by (none is made that way) never runs out.
export function outOfTime(row, now = Date.now()) {
  if (!row || !RESPONDING_STATUSES.includes(row.status) || !row.responds_by) return false;
  const by = ms(row.responds_by);
  return Number.isFinite(by) && by < ms(now);
}

// The status to show and act on: `expired` for a request past its time
// that the sweep hasn't reached yet, else the row's own.
export function shownStatus(row, now = Date.now()) {
  if (!row) return null;
  return outOfTime(row, now) ? 'expired' : row.status;
}

// Whether a read may run the sweep again (this server's own clock; the
// site-wide minute is a separate check).
export function expiryDue(lastAt, now = Date.now()) {
  const last = Number(lastAt) || 0;
  return ms(now) - last >= EXPIRY_EVERY_MS;
}
