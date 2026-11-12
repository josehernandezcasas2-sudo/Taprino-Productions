// What /admin/content's review queue lists, worked out once from the
// moderation state (lib/moderation.js getModerationState) so the nav's
// badge (/api/admin/queue-counts), the dashboard's "Flags & reports" card
// and the page itself count the same things. Pure and client-safe:
// imports nothing; tested by node scripts/test-moderation.mjs.
//
// An item ("type:id") is in the queue when it has an open admin flag or
// counted reports that aren't ignored — once, however many of both it has.
// Left out: tip notes (their reports are worked on /admin/tips) and items
// that no longer exist (`missing`: deleted since they were reported; the
// page lists them apart, to close their reports, and nothing counts them).

export const QUEUE_SKIP_TYPES = ['tip'];

export function typeOfKey(key) {
  const s = String(key || '');
  const i = s.indexOf(':');
  return i < 0 ? s : s.slice(0, i);
}

function missingSet(mod) {
  return new Set(((mod && mod.missing) || []).map((m) => m && m.key).filter(Boolean));
}

// The queue's items, in no particular order: ["episode:night-bus-e1", …].
export function reviewQueueKeys(moderation) {
  const mod = moderation || {};
  const missing = missingSet(mod);
  const keys = new Set();
  for (const f of mod.flags || []) if (f) keys.add(`${f.target_type}:${f.target_id}`);
  for (const [k, e] of Object.entries(mod.reportsByTarget || {})) if (e && e.counted > 0 && !e.ignored) keys.add(k);
  return [...keys].filter((k) => !QUEUE_SKIP_TYPES.includes(typeOfKey(k)) && !missing.has(k));
}

// The page's tiles: red / yellow / minor by counted reports, the items
// with an open admin flag, and apart from them the reported tip notes (a
// pointer to /admin/tips) and the items that are gone.
export function queueTileCounts(moderation) {
  const mod = moderation || {};
  const missing = missingSet(mod);
  const c = { red: 0, yellow: 0, minor: 0, flag: 0, tipNotes: 0, missing: missing.size };
  const flagged = new Set();
  for (const f of mod.flags || []) {
    if (!f) continue;
    const k = `${f.target_type}:${f.target_id}`;
    if (QUEUE_SKIP_TYPES.includes(f.target_type) || missing.has(k)) continue;
    flagged.add(k);
  }
  c.flag = flagged.size;
  for (const [k, e] of Object.entries(mod.reportsByTarget || {})) {
    if (!e) continue;
    if (typeOfKey(k) === 'tip') {
      if (e.total > 0) c.tipNotes += 1;
      continue;
    }
    if (missing.has(k)) continue;
    if (e.tier && Object.prototype.hasOwnProperty.call(c, e.tier)) c[e.tier] += 1;
  }
  return c;
}

// A reported account that has no public profile yet (no user_profiles
// row: it's written only once someone saves their profile) is named from
// its Clerk user: first and last name, else its username, else null (the
// caller says "A member"). Control characters and angle brackets go and
// the name is capped, since it is drawn on the admin page.
export function accountDisplayName(u) {
  if (!u || typeof u !== 'object') return null;
  const clean = (x) => (typeof x === 'string' ? x.replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim() : '');
  const full = [clean(u.firstName), clean(u.lastName)].filter(Boolean).join(' ');
  const name = full || clean(u.username);
  return name ? name.slice(0, 80) : null;
}
