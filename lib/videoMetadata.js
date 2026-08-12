// Reads a video file's duration entirely client-side, using the browser's
// own video decoding — no upload, no server round-trip, and it works
// before Cloudflare has even seen the file. This is deliberately NOT
// sourced from Cloudflare's processing status: that would mean waiting on
// the video to finish uploading and processing before the runtime field
// could be filled in, which defeats the point of auto-filling it while
// the creator is still filling out the rest of the form.
//
// Resolves to seconds (a float). Rejects if the browser can't read it —
// callers should treat that as "fall back to letting the creator type it
// in manually" rather than a hard error.
export function readVideoDuration(file) {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'metadata';

    function cleanup() {
      URL.revokeObjectURL(video.src);
    }

    video.onloadedmetadata = () => {
      const duration = video.duration;
      cleanup();
      // Some malformed files report Infinity or NaN rather than throwing —
      // treat that the same as "couldn't read it."
      if (!isFinite(duration) || duration <= 0) {
        reject(new Error('Could not read a valid duration from this file.'));
        return;
      }
      resolve(duration);
    };
    video.onerror = () => {
      cleanup();
      reject(new Error('Could not read this video file.'));
    };

    video.src = URL.createObjectURL(file);
  });
}

// Formats seconds as this app's existing runtime convention (e.g. "05:30",
// or "1:02:15" for anything an hour or longer).
export function formatRuntime(totalSeconds) {
  const secs = Math.round(totalSeconds);
  const hours = Math.floor(secs / 3600);
  const minutes = Math.floor((secs % 3600) / 60);
  const seconds = secs % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

// The inverse of formatRuntime — parses this app's runtime convention
// ("05:30", "1:02:15") back into seconds. Runtime is free-typed text on
// every episode (auto-filled from the video where possible, but always
// editable), so this has to be tolerant rather than assume a clean format.
// Returns null — never throws — for anything it can't confidently parse;
// callers are expected to treat null as "ask a human" rather than silently
// guessing a duration, which for a channel schedule would desync
// everyone's sense of what should be playing.
export function parseRuntimeToSeconds(runtime) {
  if (!runtime || typeof runtime !== 'string') return null;
  const parts = runtime.trim().split(':').map((p) => p.trim());
  if (parts.length < 2 || parts.length > 3) return null;
  if (!parts.every((p) => /^\d+$/.test(p))) return null;

  const nums = parts.map(Number);
  let seconds;
  if (nums.length === 3) {
    const [h, m, s] = nums;
    if (m > 59 || s > 59) return null;
    seconds = h * 3600 + m * 60 + s;
  } else {
    const [m, s] = nums;
    if (s > 59) return null;
    seconds = m * 60 + s;
  }
  return seconds > 0 ? seconds : null;
}
