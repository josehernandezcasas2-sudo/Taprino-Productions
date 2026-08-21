import { createContext, useContext, useRef, useState, useEffect } from 'react';

const PodcastPlayerContext = createContext(null);

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
  const [currentEpisode, setCurrentEpisode] = useState(null); // { id, title, showTitle, showArt, audioUrl }
  const [isPlaying, setIsPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackRate, setPlaybackRateState] = useState(1);
  const audioRef = useRef(null);

  function playEpisode(episode) {
    if (currentEpisode && currentEpisode.id === episode.id) {
      // Same episode already loaded — just resume rather than reloading
      // the audio element and losing position.
      audioRef.current?.play();
      setIsPlaying(true);
      return;
    }
    setCurrentEpisode(episode);
    setPosition(0);
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
    if (audioRef.current) audioRef.current.pause();
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
            setDuration(e.target.duration || 0);
            e.target.play();
          }}
          onTimeUpdate={(e) => setPosition(e.target.currentTime)}
          onEnded={() => setIsPlaying(false)}
          style={{ display: 'none' }}
        />
      )}
    </PodcastPlayerContext.Provider>
  );
}

export function usePodcastPlayer() {
  return useContext(PodcastPlayerContext);
}
