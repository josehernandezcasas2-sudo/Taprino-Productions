import Link from 'next/link';
import { usePodcastPlayer } from '../contexts/PodcastPlayerContext';
import { PlayIcon, PauseIcon, SkipBackIcon, SkipForwardIcon, CloseIcon, usePlayerIconOverrides } from './PlayerIcons';

function formatTime(seconds) {
  if (!isFinite(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

const RATES = [1, 1.25, 1.5, 1.75, 2];

export default function PodcastMiniPlayer() {
  const player = usePodcastPlayer();
  const iconOverrides = usePlayerIconOverrides();
  if (!player || !player.currentEpisode) return null;

  const { currentEpisode, isPlaying, position, duration, playbackRate, togglePlayPause, seekTo, setPlaybackRate, closePlayer } = player;
  const pct = duration > 0 ? (position / duration) * 100 : 0;

  function handleTrackClick(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    seekTo(Math.max(0, Math.min(duration, ratio * duration)));
  }

  function cycleRate() {
    const idx = RATES.indexOf(playbackRate);
    setPlaybackRate(RATES[(idx + 1) % RATES.length]);
  }

  return (
    <div className="mini-player" role="region" aria-label="Podcast player">
      <Link href={`/podcasts/${currentEpisode.showId}`} className="mini-player-art-link">
        <div className="mini-player-art" style={currentEpisode.showArt ? { backgroundImage: `url(${currentEpisode.showArt})` } : {}} />
      </Link>
      <div className="mini-player-info">
        <div className="t">{currentEpisode.title}</div>
        <div className="s">{currentEpisode.showTitle}</div>
      </div>
      <div className="mini-player-controls">
        <button onClick={() => seekTo(Math.max(0, position - 15))} aria-label="Back 15 seconds"><SkipBackIcon size={17} src={iconOverrides.skip_back} /></button>
        <button onClick={togglePlayPause} aria-label={isPlaying ? 'Pause' : 'Play'}>
          {isPlaying ? <PauseIcon size={21} src={iconOverrides.pause} /> : <PlayIcon size={21} src={iconOverrides.play} />}
        </button>
        <button onClick={() => seekTo(Math.min(duration, position + 30))} aria-label="Forward 30 seconds"><SkipForwardIcon size={17} src={iconOverrides.skip_forward} /></button>
      </div>
      <div className="mini-player-scrub">
        <span className="mini-player-time">{formatTime(position)}</span>
        <div className="mini-player-track" onClick={handleTrackClick}>
          <div className="mini-player-fill" style={{ width: `${pct}%` }} />
        </div>
        <span className="mini-player-time">{formatTime(duration)}</span>
      </div>
      <button className="mini-player-speed" onClick={cycleRate}>{playbackRate}x</button>
      <button className="mini-player-close" onClick={closePlayer} aria-label="Close player"><CloseIcon size={16} src={iconOverrides.close} /></button>
    </div>
  );
}
