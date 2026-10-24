// The one place the app keeps "am I suspended" (migration 102). No
// imports, so lib/api.js (which reports a 403 { suspended }) and the
// hook in lib/suspension.js (which asks /api/my-role) can both use it
// without a cycle.
let state = null; // null | { scope, reason, until, cancelMembership, since }
let checkedAt = 0;
const listeners = new Set();

export function getSuspension() { return state; }
export function lastChecked() { return checkedAt; }
export function markChecked() { checkedAt = Date.now(); }

export function publishSuspension(next) {
  state = next && next.scope ? next : null;
  for (const fn of listeners) fn(state);
}

// An API write answered 403 { suspended }: believe it at once.
export function reportSuspension(payload) {
  if (payload && payload.scope) {
    checkedAt = Date.now();
    publishSuspension(payload);
  }
}

export function clearSuspension() {
  checkedAt = 0;
  publishSuspension(null);
}

export function subscribeSuspension(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
