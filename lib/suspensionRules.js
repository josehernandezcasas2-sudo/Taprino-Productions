// Account suspensions (migration 102): the pure, client-safe part. The
// app mirrors what it needs in mobile/src/lib/suspensionRules.js. Tested
// by `node scripts/test-suspensions.mjs`.

export const SCOPES = {
  all: { label: 'Whole account', short: 'Account', blurb: 'Can sign in only to read why; every page and every action is off until it lifts.' },
  tips: { label: 'Tips only', short: 'Tips', blurb: 'Can use the site as usual but can’t tip anyone; the Tip button disappears for them.' }
};

// A row is in force until it is lifted or its end passes.
export function isActive(row, now = new Date()) {
  if (!row || row.lifted_at) return false;
  if (!row.until_at) return true;
  const until = new Date(row.until_at).getTime();
  return !Number.isFinite(until) || until > now.getTime();
}

// The rows in force, the widest scope first.
export function activeRows(rows, now = new Date()) {
  return (rows || []).filter((r) => isActive(r, now)).sort((a, b) => (a.scope === 'all' ? -1 : b.scope === 'all' ? 1 : 0));
}

// What a gate needs: null when nothing is in force, else the widest row
// as { scope, reason, until, cancelMembership, since }.
export function suspensionPayload(rows, now = new Date()) {
  const [top] = activeRows(rows, now);
  if (!top) return null;
  return {
    scope: top.scope === 'tips' ? 'tips' : 'all',
    reason: top.public_reason || '',
    until: top.until_at || null,
    cancelMembership: Boolean(top.cancel_membership),
    since: top.created_at || null
  };
}

// Does an in-force suspension block this `scope` ('all' blocks tips too)?
export function blocks(payload, scope) {
  if (!payload) return false;
  if (payload.scope === 'all') return true;
  return payload.scope === scope;
}

export function untilLabel(until, { timeZone = 'America/Los_Angeles' } = {}) {
  if (!until) return 'until we hear from you';
  const d = new Date(until);
  if (!Number.isFinite(d.getTime())) return 'until we hear from you';
  return `until ${d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone })}`;
}

// Validation for the admin form.
export function validateSuspension({ scope, publicReason, untilAt } = {}) {
  if (!SCOPES[scope]) return { ok: false, error: 'Pick a scope: the whole account, or tips only.' };
  const reason = String(publicReason || '').replace(/\s+/g, ' ').trim();
  if (reason.length < 8) return { ok: false, error: 'Write what they’ll see (at least a sentence).' };
  if (reason.length > 400) return { ok: false, error: 'Keep what they’ll see under 400 characters.' };
  let until = null;
  if (untilAt) {
    // A bare date from the form means that day in the studio's time
    // zone: noon Pacific keeps the card's "until November 23" on the 23rd.
    const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(String(untilAt)) ? `${untilAt}T12:00:00-08:00` : untilAt);
    if (!Number.isFinite(d.getTime())) return { ok: false, error: 'The end date isn’t a date.' };
    if (d.getTime() <= Date.now()) return { ok: false, error: 'The end date has to be in the future.' };
    until = d.toISOString();
  }
  return { ok: true, scope, publicReason: reason, untilAt: until };
}
