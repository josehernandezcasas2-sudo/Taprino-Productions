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
