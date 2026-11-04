// Partial saves of a Creator Studio draft (creator_drafts, migration 116):
// the app's copy of the website's lib/draftPatch.js, word for word below
// this header (checked by scripts/test-draft-patch.mjs). The upload queue
// (showUploadQueue.js), the draft editor and the submit screen each send
// only what they changed, as PATCH /api/creator/drafts
// { id, form?, video?, trailer? }, so the order their saves land in can't
// put back an older copy of the other's.

export const DRAFT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// creator_drafts.id is a uuid: any other shape names no draft.
export function isDraftId(id) {
  return DRAFT_ID.test(String(id || ''));
}

function sameValue(a, b) {
  return JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b);
}

// The keys of `after` whose values differ from `before`'s (compared as
// JSON): what a screen sends, so a key it didn't change is never put back.
export function changedFields(before, after) {
  const was = before && typeof before === 'object' ? before : {};
  const now = after && typeof after === 'object' ? after : {};
  const out = {};
  for (const key of Object.keys(now)) {
    if (now[key] === undefined) continue;
    if (!sameValue(was[key], now[key])) out[key] = now[key];
  }
  return out;
}

// Whether a screen's video or trailer ({ uid, state, name, … } or null)
// is not the one it last saved.
export function mediaChanged(before, after) {
  return !sameValue(before || null, after || null);
}

// The stored form with a change on top (the server's half): a key sent
// replaces that key, every other key stays. Keys that could reach an
// object's prototype are dropped.
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
export function mergeForm(stored, change) {
  const base = stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {};
  const out = { ...base };
  if (change && typeof change === 'object' && !Array.isArray(change)) {
    for (const key of Object.keys(change)) {
      if (UNSAFE_KEYS.has(key) || change[key] === undefined) continue;
      out[key] = change[key];
    }
  }
  return out;
}

// The updated_at a merged save writes: now, and always later than the
// stamp it read, so the guard of a save racing it can never match twice.
export function nextStamp(prev, now = Date.now()) {
  const was = prev ? Date.parse(prev) : NaN;
  const at = Number.isFinite(was) ? Math.max(now, was + 1) : now;
  return new Date(at).toISOString();
}
