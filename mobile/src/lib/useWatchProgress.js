import { useEffect, useRef, useState } from 'react';
import { apiPost } from './api';
import { restoreTarget, sameTitleItem, shouldSeek } from './watchResume';

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
//
// The title comes back where it was. The player swaps its source for the
// trailer and back, or for a fresh link after Buy, and the swapped-in
// title used to start at 0:00 — under a "Resumed from 20:00" toast — and
// 15 s later saved the viewer's progress back to 0:15. The last position
// seen this visit is kept; the title seeks back to it once its own stream
// is ready (lib/watchResume.js), and nothing is saved until it has.
// Returns { resumedFrom }: the second it really jumped to (0 when it
// didn't), which is what the player's resume toast says.
//
// `active`: the title (not a trailer) is the player's source — its
// position is kept and restored for anyone. `enabled`: progress is saved
// too and the server's `startAt` honoured (signed in, not a preview).
// Leaving `active` out makes it `enabled` (the podcast screen).
const GIVE_UP_MS = 15000;

export function useWatchProgress({ player, episodeId, enabled, active = enabled, startAt = 0, getToken }) {
  const lastSavedPos = useRef(0);
  const lastSaveAt = useRef(0);
  const seekedFor = useRef(null);
  const finishedFor = useRef(null);
  // { id, t, duration }: where the title was last seen playing this visit.
  const seen = useRef({ id: null, t: 0, duration: 0 });
  const tokenFn = useRef(getToken);
  tokenFn.current = getToken;
  const [resumedFrom, setResumedFrom] = useState(0);

  useEffect(() => {
    if (!player || !episodeId || !active) return undefined;
    lastSavedPos.current = 0;
    lastSaveAt.current = 0;
    // A second is enough here; the episode player asks for a finer tick
    // (its scrubber and captions), which is kept.
    const tick = Number(player.timeUpdateEventInterval);
    if (!(tick > 0 && tick <= 1)) player.timeUpdateEventInterval = 1;

    // Where this cycle starts: the visit's own last position, else the
    // server's resume point the first time this episode gets ready.
    const fromVisit = seen.current.id === episodeId ? seen.current : null;
    const knownDuration = fromVisit ? fromVisit.duration : 0;
    const serverStart = enabled && seekedFor.current !== episodeId ? startAt : 0;
    let pending = restoreTarget({ visitSeconds: fromVisit ? fromVisit.t : 0, startAt: serverStart });
    // Waiting for this title's stream to be ready (the restore, and the
    // server's start point being used up), until then nothing is saved.
    let waiting = true;
    const startedAt = Date.now();

    async function send(path, body) {
      try {
        const token = await tokenFn.current();
        if (token) await apiPost(path, body, token);
      } catch (err) {
        // Progress is best effort; the next save tries again.
      }
    }
    function save(position, duration, finished = false) {
      if (!enabled) return;
      lastSaveAt.current = Date.now();
      send('/api/watch-progress', { episodeId, position: Math.floor(position), finished });
      if (finished && finishedFor.current !== episodeId) {
        finishedFor.current = episodeId;
        send('/api/watch-history', { episodeId });
      }
    }
    function guardedSave(position, duration) {
      if (waiting || !(position > 0) || Date.now() - lastSaveAt.current < 3000) return;
      const finished = duration > 0 && position >= duration * 0.95;
      save(position, duration, finished);
    }
    // Once this title's stream is the one that's ready (a trailer's last
    // "ready" can still arrive while it is being swapped out; its length
    // gives it away): the seek back, if there is one to make.
    function ready() {
      if (!waiting) return;
      const duration = player.duration || 0;
      if (!sameTitleItem(knownDuration, duration)) return;
      waiting = false;
      if (enabled) seekedFor.current = episodeId;
      const target = pending;
      pending = 0;
      if (shouldSeek({ target, currentTime: player.currentTime || 0, duration })) {
        player.currentTime = target;
        lastSavedPos.current = target;
        setResumedFrom(target);
      }
    }

    const status = player.addListener('statusChange', ({ status: s }) => {
      if (s === 'readyToPlay') ready();
    });
    const time = player.addListener('timeUpdate', ({ currentTime }) => {
      if (waiting) {
        // The "ready" came before this listener did: the first tick does it.
        if (player.status === 'readyToPlay') ready();
        // A stream that never matches what played before: play on from
        // where it is rather than never saving again.
        if (waiting && Date.now() - startedAt > GIVE_UP_MS) { waiting = false; pending = 0; }
        return;
      }
      const duration = player.duration || 0;
      seen.current = { id: episodeId, t: currentTime || 0, duration };
      if (currentTime - lastSavedPos.current >= 15) {
        lastSavedPos.current = currentTime;
        save(currentTime, duration, duration > 0 && currentTime >= duration * 0.95);
      }
    });
    const playing = player.addListener('playingChange', ({ isPlaying }) => {
      if (!isPlaying) guardedSave(player.currentTime, player.duration || 0);
    });
    const end = player.addListener('playToEnd', () => {
      if (waiting) return;
      const duration = player.duration || player.currentTime || 0;
      // Played out: watching it again starts from the top.
      seen.current = { id: episodeId, t: 0, duration };
      save(duration, duration, true);
    });
    return () => {
      status.remove();
      time.remove();
      playing.remove();
      end.remove();
      setResumedFrom(0);
      try {
        guardedSave(player.currentTime, player.duration || 0);
      } catch (err) {
        // The player may already be released when the screen closes.
      }
    };
  }, [player, episodeId, active, enabled, startAt]);

  return { resumedFrom };
}
