import { useCallback, useEffect, useState } from 'react';

const LOCAL_KEY = 'taprino_watch_progress';

// Positions are keyed by episode id -> seconds watched. A position only
// counts as "worth resuming" once past 10 seconds and before 95% of the
// runtime — barely-started or basically-finished episodes just reset to the
// beginning next time, which is the expected behavior, not a bug.
export function useWatchProgress(isSignedIn, initialProgress) {
  const [progress, setProgress] = useState(initialProgress || {});

  useEffect(() => {
    if (isSignedIn) return; // server already gave us the real positions
    try {
      const raw = window.localStorage.getItem(LOCAL_KEY);
      setProgress(raw ? JSON.parse(raw) : {});
    } catch (e) {
      setProgress({});
    }
  }, [isSignedIn]);

  const getPosition = useCallback((episodeId) => progress[episodeId] || 0, [progress]);

  const savePosition = useCallback((episodeId, position, duration) => {
    const finished = duration && position >= duration * 0.95;
    const worthSaving = position >= 10 && !finished;

    const next = { ...progress };
    if (worthSaving) {
      next[episodeId] = Math.floor(position);
    } else {
      delete next[episodeId];
    }
    setProgress(next);

    if (isSignedIn) {
      // Throttled by the caller (VideoPlayer), not on every timeupdate tick —
      // this is a real API call against Stripe, not a free local write.
      fetch('/api/watch-progress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ episodeId, position: worthSaving ? Math.floor(position) : 0 })
      }).catch(() => {});

      // Finishing something used to just vanish from watch-progress with
      // nothing recorded anywhere — this is the one place that "crossing
      // 95%" actually gets written down, into a real Previously Watched
      // history instead of disappearing.
      if (finished) {
        fetch('/api/watch-history', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ episodeId })
        }).catch(() => {});
      }
    } else {
      try {
        window.localStorage.setItem(LOCAL_KEY, JSON.stringify(next));
      } catch (e) {
        // Non-fatal — private browsing etc. can block localStorage.
      }
    }
  }, [progress, isSignedIn]);

  return { getPosition, savePosition };
}
