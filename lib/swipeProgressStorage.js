const STORAGE_KEY = 'studiotapa_pitch_swipe_progress';
// Abandoned, never-returned-to progress shouldn't linger forever and
// silently resume a deck from a long-gone browsing session — a week felt
// like a reasonable "still probably mid-session" window without being
// so short it defeats the point of persisting at all.
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export function readLocalProgress() {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    if (!parsed.savedAt || Date.now() - parsed.savedAt > MAX_AGE_MS) return null;
    if (!Array.isArray(parsed.deckIds) || !Array.isArray(parsed.secondChanceIds) || !Array.isArray(parsed.likedIds)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveLocalProgress(progress) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...progress, savedAt: Date.now() }));
  } catch {
    // Storage full, disabled, or private-browsing mode — losing the
    // ability to resume a swipe deck isn't worth surfacing an error over.
  }
}

export function clearLocalProgress() {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Same reasoning as saveLocalProgress — nothing worth surfacing.
  }
}

// Shared by both the signed-in (database) and signed-out (localStorage)
// paths: turns a saved { deckIds, secondChanceIds, round, likedIds }
// shape back into actual pitch objects, resolved against whatever's
// actually live right now. A pitch that's since been deleted, unapproved,
// or otherwise vanished from `pitches` (the fresh server-fetched list)
// just quietly drops out of the reconstructed deck instead of erroring —
// there's nothing to clean up on the storage side either way, since
// nothing here holds onto anything but IDs.
export function reconstructFromIds(pitches, saved) {
  const byId = new Map(pitches.map((p) => [p.id, p]));
  const resolve = (ids) => (ids || []).map((id) => byId.get(id)).filter(Boolean);
  return {
    deck: resolve(saved.deckIds),
    secondChance: resolve(saved.secondChanceIds),
    round: saved.round === 2 ? 2 : 1,
    likedPitches: resolve(saved.likedIds)
  };
}
