import { useEffect, useRef } from 'react';
import { apiPost } from './api';

// The app's half of the website's lib/useWatchProgress.js + VideoPlayer
// progress effect: report where the viewer is to POST /api/watch-progress
// (the resume point and watch-time analytics), and record a finished
// title in POST /api/watch-history — which is also what Creator Share's
// "by watching" split reads for a member who hasn't picked creators.
// Signed-in viewers only, like the website's server-side path.
//
// Same cadence as the website: every 15 seconds of playback, straight
// away on pause and when the screen goes (guarded to once every 3 s), and
// once with finished = true at the end. `startAt` seeks once per episode
// when the stream is ready, unless it's within 5 s of the end.
export function useWatchProgress({ player, episodeId, enabled, startAt = 0, getToken }) {
  const lastSavedPos = useRef(0);
  const lastSaveAt = useRef(0);
  const seekedFor = useRef(null);
  const finishedFor = useRef(null);
  const tokenFn = useRef(getToken);
  tokenFn.current = getToken;

  useEffect(() => {
    if (!player || !episodeId || !enabled) return undefined;
    lastSavedPos.current = 0;
    lastSaveAt.current = 0;
    player.timeUpdateEventInterval = 1;

    async function send(path, body) {
      try {
        const token = await tokenFn.current();
        if (token) await apiPost(path, body, token);
      } catch (err) {
        // Progress is best effort; the next save tries again.
      }
    }
    function save(position, duration, finished = false) {
      lastSaveAt.current = Date.now();
      send('/api/watch-progress', { episodeId, position: Math.floor(position), finished });
      if (finished && finishedFor.current !== episodeId) {
        finishedFor.current = episodeId;
        send('/api/watch-history', { episodeId });
      }
    }
    function guardedSave(position, duration) {
      if (!(position > 0) || Date.now() - lastSaveAt.current < 3000) return;
      const finished = duration > 0 && position >= duration * 0.95;
      save(position, duration, finished);
    }

    const status = player.addListener('statusChange', ({ status: s }) => {
      if (s !== 'readyToPlay' || seekedFor.current === episodeId) return;
      seekedFor.current = episodeId;
      const duration = player.duration || 0;
      if (startAt > 0 && (!duration || startAt < duration - 5)) {
        player.currentTime = startAt;
        lastSavedPos.current = startAt;
      }
    });
    const time = player.addListener('timeUpdate', ({ currentTime }) => {
      if (currentTime - lastSavedPos.current >= 15) {
        lastSavedPos.current = currentTime;
        const duration = player.duration || 0;
        save(currentTime, duration, duration > 0 && currentTime >= duration * 0.95);
      }
    });
    const playing = player.addListener('playingChange', ({ isPlaying }) => {
      if (!isPlaying) guardedSave(player.currentTime, player.duration || 0);
    });
    const end = player.addListener('playToEnd', () => {
      const duration = player.duration || player.currentTime || 0;
      save(duration, duration, true);
    });
    return () => {
      status.remove();
      time.remove();
      playing.remove();
      end.remove();
      try {
        guardedSave(player.currentTime, player.duration || 0);
      } catch (err) {
        // The player may already be released when the screen closes.
      }
    };
  }, [player, episodeId, enabled, startAt]);
}
