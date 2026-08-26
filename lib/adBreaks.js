// Shared between every form that edits ad break times (admin quick-add,
// admin edit modal, creator submission) and the player itself, so the
// MM:SS <-> seconds conversion and the "what counts as valid" rules live
// in exactly one place.

// "0:00, 10:00, 20:30" -> [0, 600, 1230], sorted, deduped, and with
// anything unparseable or negative silently dropped rather than
// rejecting the whole input over one typo'd entry.
export function parseAdBreaksInput(text) {
  if (!text || !text.trim()) return [0];
  const parts = text.split(',').map((p) => p.trim()).filter(Boolean);
  const seconds = [];
  for (const part of parts) {
    const match = part.match(/^(\d+):([0-5]?\d)$/);
    if (match) {
      seconds.push(Number(match[1]) * 60 + Number(match[2]));
    } else if (/^\d+$/.test(part)) {
      // Bare number - treat as whole seconds, for anyone who just types "600".
      seconds.push(Number(part));
    }
  }
  const unique = [...new Set(seconds)].sort((a, b) => a - b);
  return unique.length > 0 ? unique : [0];
}

// [0, 600, 1230] -> "0:00, 10:00, 20:30" for populating a form field with
// an episode's existing saved value.
export function formatAdBreaksForInput(seconds) {
  if (!Array.isArray(seconds) || seconds.length === 0) return '0:00';
  return seconds
    .slice()
    .sort((a, b) => a - b)
    .map((s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`)
    .join(', ');
}
