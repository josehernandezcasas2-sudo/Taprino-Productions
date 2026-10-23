import { createContext, useContext, useRef, useState, useEffect } from 'react';
import { useAuth } from '@clerk/nextjs';
import { useWatchProgress } from '../lib/useWatchProgress';

const PodcastPlayerContext = createContext(null);

// Progress saves (lib/useWatchProgress.js, the same store the video
// player resumes from): every SAVE_EVERY_MS of playback, on pause (at
// most once per PAUSE_GUARD_MS), at the end (finished), when the player
// is closed or switched to another episode, and when the tab goes away.
const SAVE_EVERY_MS = 15000;
const PAUSE_GUARD_MS = 3000;

// Same reasoning as contexts/UploadContext.js: this has to live above the
// page tree (see _app.js) rather than inside any one page component,
// because Next.js swaps out page content on in-app navigation without
// reloading the tab. Only something wrapping the whole app keeps running
// — and thus keeps the <audio> element alive and playing — while the
// person browses elsewhere. This is what makes "keep listening while you
// browse the rest of the site" possible at all.
//
// Deliberately audio-only. Video podcasts play through the normal
// VideoPlayer, full-attention, same as any other video on the site — this
// context and its persistent bar are specifically for the audio case,
// where continuing to listen while doing something else is the whole
// point.
export function PodcastPlayerProvider({ children }) {
  const [currentEpisode, setCurrentEpisode] = useState(null); // { id, title, showTitle, showArt, audioUrl, startAt }
  const [isPlaying, setIsPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackRate, setPlaybackRateState] = useState(1);
  const audioRef = useRef(null);

  // Where to pick up, and the saves. Signed-out listeners keep their spot
  // in localStorage (the podcast page reads it back); signed-in ones in
  // the account, like video.
  const { isSignedIn } = useAuth();
  const { savePosition } = useWatchProgress(Boolean(isSignedIn), {});
  const startAtRef = useRef(0);
  const lastSaveAtRef = useRef(0);
  const currentRef = useRef(null);
  currentRef.current = currentEpisode;
  const saveRef = useRef(null);

  function saveNow({ finished = false } = {}) {
    const el = audioRef.current;
    const ep = currentRef.current;
    if (!el || !ep) return;
    const total = el.duration || 0;
    const at = finished ? total || el.currentTime : el.currentTime;
    if (!(at > 0)) return;
    lastSaveAtRef.current = Date.now();
    savePosition(ep.id, at, total);
  }
  saveRef.current = saveNow;

  useEffect(() => {
    // The tab closing or leaving the site: one last save (keepalive fetch).
    function onHide() { if (saveRef.current) saveRef.current(); }
    window.addEventListener('pagehide', onHide);
    return () => window.removeEventListener('pagehide', onHide);
  }, []);

  function playEpisode(episode) {
    if (currentEpisode && currentEpisode.id === episode.id) {
      // Same episode already loaded — just resume rather than reloading
      // the audio element and losing position.
      audioRef.current?.play();
      setIsPlaying(true);
      return;
    }
    // Switching episodes: keep the spot in the one that was playing.
    if (currentEpisode) saveNow();
    startAtRef.current = Number(episode.startAt) > 0 ? Number(episode.startAt) : 0;
    lastSaveAtRef.current = Date.now();
    setCurrentEpisode(episode);
    setPosition(startAtRef.current);
    setIsPlaying(true);
    // The actual <audio src> swap happens via the effect below, keyed off
    // currentEpisode — .play() gets called once that new source is ready
    // (onLoadedMetadata), not here, since the element hasn't adopted the
    // new src yet at this point in the same render pass.
  }

  useEffect(() => {
    if (currentEpisode && audioRef.current) {
      audioRef.current.load();
    }
  }, [currentEpisode?.id]);

  function togglePlayPause() {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current.play();
      setIsPlaying(true);
    }
  }

  function seekTo(seconds) {
    if (!audioRef.current) return;
    audioRef.current.currentTime = seconds;
    setPosition(seconds);
  }

  function setPlaybackRate(rate) {
    if (audioRef.current) audioRef.current.playbackRate = rate;
    setPlaybackRateState(rate);
  }

  function closePlayer() {
    if (audioRef.current) {
      audioRef.current.pause();
      saveNow();
    }
    setCurrentEpisode(null);
    setIsPlaying(false);
    setPosition(0);
    setDuration(0);
  }

  return (
    <PodcastPlayerContext.Provider
      value={{ currentEpisode, isPlaying, position, duration, playbackRate, playEpisode, togglePlayPause, seekTo, setPlaybackRate, closePlayer }}
    >
      {children}
      {currentEpisode && (
        <audio
          ref={audioRef}
          src={currentEpisode.audioUrl}
          onLoadedMetadata={(e) => {
            const total = e.target.duration || 0;
            setDuration(total);
            // Pick up where they left off, unless that's the very end.
            const start = startAtRef.current;
            startAtRef.current = 0;
            if (start > 0 && (!total || start < total - 5)) {
              e.target.currentTime = start;
              setPosition(start);
            }
            // load() resets the element's rate to 1; keep the chosen speed.
            e.target.playbackRate = playbackRate;
            e.target.play();
          }}
          onTimeUpdate={(e) => {
            setPosition(e.target.currentTime);
            if (!e.target.paused && Date.now() - lastSaveAtRef.current >= SAVE_EVERY_MS) saveNow();
          }}
          // Media keys, headphones and other tabs pause/resume without us.
          onPlay={() => setIsPlaying(true)}
          onPause={(e) => {
            setIsPlaying(false);
            // The end fires pause too; onEnded records that one as finished.
            if (!e.target.ended && Date.now() - lastSaveAtRef.current >= PAUSE_GUARD_MS) saveNow();
          }}
          onEnded={() => {
            setIsPlaying(false);
            saveNow({ finished: true });
          }}
          style={{ display: 'none' }}
        />
      )}
    </PodcastPlayerContext.Provider>
  );
}

export function usePodcastPlayer() {
  return useContext(PodcastPlayerContext);
}
