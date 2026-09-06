// How long an episode counts as "new" after being added — global and
// absolute, the same for every visitor, not tied to anyone's individual
// watch history. Exported so the admin side (if a configurable window is
// ever wanted) and the display side always agree on the same number.
export const NEW_EPISODE_WINDOW_DAYS = 7;

// Note: based on when the row was created, not when it became visible via
// available_from. An episode created today but scheduled to appear next
// month wouldn't show as "new" until it's actually been created for a
// week — a reasonable simplification for now, since there's currently no
// simple way to tell "just became visible" from "was already visible
// and someone's just now loading the page."
export function isRecentlyAdded(createdAt, days = NEW_EPISODE_WINDOW_DAYS) {
  if (!createdAt) return false;
  const created = new Date(createdAt);
  if (Number.isNaN(created.getTime())) return false;
  const ageMs = Date.now() - created.getTime();
  // ageMs < 0 would mean created_at is in the future (clock skew, or a
  // manually-backdated/forward-dated row) — treated as not-new rather
  // than as "infinitely new", since a negative age isn't a meaningful
  // amount of "how long has this actually been up" at all.
  return ageMs >= 0 && ageMs <= days * 86400000;
}
