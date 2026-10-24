// Mirror of lib/suspensionRules.js (the part the app shows). The server
// decides; the app only reads the payload /api/my-role carries and the
// 403 { suspended } an API write answers with.

export const CONTACT_EMAIL = 'info@studiotapa.com';

export function untilLabel(until) {
  if (!until) return 'until we hear from you';
  const d = new Date(until);
  if (!Number.isFinite(d.getTime())) return 'until we hear from you';
  return `until ${d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/Los_Angeles' })}`;
}

// A whole-account suspension shows the gate; tips-only only hides the
// Tip button (the server already answers that).
export function gateShows(payload) {
  return Boolean(payload && payload.scope === 'all');
}
