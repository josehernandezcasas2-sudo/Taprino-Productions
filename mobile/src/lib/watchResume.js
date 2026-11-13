// Where a title picks up when the player takes it back (mobile/src/lib/
// useWatchProgress.js): after the trailer, after a fresh link (Buy to own
// reloads the screen), or the first time it plays this visit. Pure, no
// imports; scripts/test-watch-resume.mjs.

// The second to restore: the visit's own last position wins (it is newer
// than anything the server said), else the server's resume point the
// first time the title plays, else nothing.
export function restoreTarget({ visitSeconds = 0, startAt = 0 } = {}) {
  if (Number(visitSeconds) > 0) return Number(visitSeconds);
  return Number(startAt) > 0 ? Number(startAt) : 0;
}

// Is the stream that just got ready this title's? Its length is known
// once the title has played this visit; a trailer still being swapped out
// has another. Unknown either side: a length that isn't in yet can't be
// told apart, so wait (false); a title never seen this visit, go (true).
export function sameTitleItem(knownDuration, duration, tolerance = 2) {
  if (!(Number(knownDuration) > 0)) return true;
  if (!(Number(duration) > 0)) return false;
  return Math.abs(Number(duration) - Number(knownDuration)) <= tolerance;
}

// Jump there? Not to nothing, not into the last five seconds (it would
// end at once; the title starts over instead), and not for a few seconds'
// difference (a stall that came back "ready" again is not a resume).
export function shouldSeek({ target, currentTime = 0, duration = 0 }) {
  if (!(Number(target) > 0)) return false;
  if (Number(duration) > 0 && Number(target) >= Number(duration) - 5) return false;
  return Math.abs((Number(currentTime) || 0) - Number(target)) > 3;
}
