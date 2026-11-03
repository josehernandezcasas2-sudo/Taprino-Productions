import { useCallback, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { tierBadge } from '../lib/tierBadge';
import { formatRuntimeLong } from '../lib/videoMetadata';
import { seriesPlayLabel } from '../lib/seriesResume';
import { PlayIcon, PauseIcon, VolumeIcon, InfoIcon, usePlayerIconOverrides } from './PlayerIcons';

const ROTATE_MS = 9000;
// One fresh link per trailer per five minutes: a trailer that fails again
// inside that won't play, and the hero shows the artwork instead.
const TRAILER_RETRY_GAP_MS = 5 * 60 * 1000;

/* ------------------------------------------------------------------ *
 * Trailers play through signed links like the films, never their
 * stored address (decision 12 of the series revamp, 2026-11-02). A link
 * expires (the server mints 60 minutes), so a hero carries a `ref`
 * ({ episodeId } | { seriesId }) and asks /api/stream-token (part
 * 'trailer') for a fresh one when the one it has runs out, fails, or was
 * never given (a page that didn't sign its hero pool). When there is no
 * playable trailer the hero shows its artwork. Shared with SeriesHero.
 * ------------------------------------------------------------------ */

// One trailer's identity, for the per-trailer state below.
export function trailerKeyOf(ref) {
  if (!ref) return null;
  if (ref.seriesId) return `s:${ref.seriesId}`;
  if (ref.episodeId) return `e:${ref.episodeId}`;
  return null;
}

// A signed link that is gone or about to go (a minute's margin);
// expiresAt is unix seconds, null for a link that doesn't expire.
export function trailerExpired(expiresAt) {
  return Boolean(expiresAt) && Number(expiresAt) * 1000 < Date.now() + 60 * 1000;
}

// → { src, expiresAt } | null (not public any more, rate limited, or
// Cloudflare wouldn't sign it).
export async function fetchTrailerSrc(ref) {
  const body = ref && ref.seriesId
    ? { seriesId: ref.seriesId, part: 'trailer' }
    : ref && ref.episodeId ? { episodeId: ref.episodeId, part: 'trailer' } : null;
  if (!body) return null;
  try {
    const res = await fetch('/api/stream-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data && data.src ? { src: data.src, expiresAt: data.expiresAt || null } : null;
  } catch (err) {
    return null;
  }
}

// Plays a muted, looping hero trailer in `video`: hls.js where the browser
// needs it (Cloudflare serves HLS, which only Safari plays from a plain
// src), the plain src otherwise. `onFatal` runs once when the stream
// can't play — an expired token looks exactly like a network error.
// Returns the cleanup.
export function attachHeroTrailer(video, src, { muted, paused, onFatal }) {
  let cancelled = false;
  let hls = null;
  let reported = false;
  const fail = () => {
    if (cancelled || reported) return;
    reported = true;
    if (onFatal) onFatal();
  };
  // Native HLS (Safari) and plain files have no hls.js error hook.
  const onNativeError = () => { if (!hls) fail(); };
  video.addEventListener('error', onNativeError);

  function startPlayback() {
    video.currentTime = 0;
    video.muted = muted;
    if (!paused) video.play().catch(() => {});
  }

  if (src.includes('.m3u8')) {
    import('hls.js').then(({ default: Hls }) => {
      if (cancelled) return;
      if (Hls.isSupported()) {
        hls = new Hls();
        hls.on(Hls.Events.ERROR, (_e, data) => { if (data && data.fatal) fail(); });
        hls.loadSource(src);
        hls.attachMedia(video);
      } else {
        video.src = src;
      }
      startPlayback();
    }).catch(fail);
  } else {
    video.src = src;
    startPlayback();
  }

  return () => {
    cancelled = true;
    video.removeEventListener('error', onNativeError);
    if (hls) { hls.destroy(); hls = null; }
  };
}

// Which link a hero should play for one trailer, kept per trailer so a
// rotating hero remembers what it already fetched or found broken.
//   trailerKey  trailerKeyOf(ref), or any stable string for a src without a ref
//   src, expiresAt  the link the page came with (null when it has none)
//   ref         what to ask /api/stream-token for; null = no refresh
//   active      false while the hero shows an image instead (nothing fetched)
// → { hasTrailer, src, gen, onFatal }: hasTrailer is false once the trailer
// can't play (show the artwork); src is the link to attach (null while one
// is being fetched); gen changes when a fresh link replaces it (attach
// again even if the address came back the same); onFatal goes to
// attachHeroTrailer.
export function useHeroTrailer({ trailerKey, src = null, expiresAt = null, ref = null, active = true }) {
  const [fresh, setFresh] = useState({}); // trailerKey → { src, expiresAt, gen }
  const [failed, setFailed] = useState({}); // trailerKey → true
  const inflight = useRef({});
  const fetchedAt = useRef({});

  const request = useCallback((k, r) => {
    if (!k || !r || inflight.current[k]) return;
    inflight.current[k] = true;
    fetchedAt.current[k] = Date.now();
    fetchTrailerSrc(r).then((got) => {
      inflight.current[k] = false;
      if (got) setFresh((m) => ({ ...m, [k]: { src: got.src, expiresAt: got.expiresAt, gen: ((m[k] && m[k].gen) || 0) + 1 } }));
      else setFailed((m) => ({ ...m, [k]: true }));
    });
  }, []);

  const hasTrailer = Boolean(trailerKey && (src || ref) && !failed[trailerKey]);
  const current = trailerKey && fresh[trailerKey] ? fresh[trailerKey] : (src ? { src, expiresAt, gen: 0 } : null);
  // A link that has run out is replaced before it's attached — unless one
  // was fetched moments ago: a device clock that disagrees with the
  // server's must not turn into a loop of requests, so that link plays and
  // the stream decides (onFatal below).
  const justFetched = Boolean(trailerKey && fetchedAt.current[trailerKey] && Date.now() - fetchedAt.current[trailerKey] < TRAILER_RETRY_GAP_MS);
  const playable = hasTrailer && current && (!trailerExpired(current.expiresAt) || justFetched) ? current : null;

  // No usable link yet (none given, or the one given has run out): ask for
  // one, or give up on the trailer when there's nothing to ask with.
  useEffect(() => {
    if (!active || !hasTrailer || playable) return;
    if (ref) request(trailerKey, ref);
    else setFailed((m) => ({ ...m, [trailerKey]: true }));
  }, [active, hasTrailer, Boolean(playable), trailerKey]);

  const onFatal = useCallback(() => {
    if (!trailerKey) return;
    const last = fetchedAt.current[trailerKey] || 0;
    if (ref && Date.now() - last > TRAILER_RETRY_GAP_MS) request(trailerKey, ref);
    else setFailed((m) => ({ ...m, [trailerKey]: true }));
  }, [trailerKey, ref, request]);

  return { hasTrailer, src: playable ? playable.src : null, gen: playable ? playable.gen : 0, onFatal };
}

// `pool` is a pre-built array of hero candidates from lib/heroCandidates.js —
// a mix of standalone movies/shorts and whole series (aggregated by total
// views across their episodes). This component doesn't know or care which is
// which beyond the `isSeries` flag, used to label it and route Play/Trailer
// correctly. A series' Play plays the first episode before the viewer has
// started the show and continues where they are once they have (`resume`
// from lib/seriesResume.js, stamped on the candidate by the page).
//
// Each candidate can use EITHER a video background (its trailer, signed:
// trailerSrc / trailerRef, see above) OR a static image (heroImage) — set
// `heroImage` on an episode/series to use a still instead of forcing
// video. If both are present the image wins; the poster/thumbnail is the
// fallback for content without a playable trailer.
export default function HeroSpotlight({ pool, onPlay, onTrailer, fullBleed }) {
  const iconOverrides = usePlayerIconOverrides();
  const [index, setIndex] = useState(Math.max(pool.length - 1, 0));
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(true);
  const videoRef = useRef(null);
  const timerRef = useRef(null);

  // No early return here: the hooks follow, and returning before them
  // crashed React ("Rendered more hooks") when a page went from an empty
  // pool to a full one. The bail-out is just before the JSX instead.
  const ep = pool.length > 0 ? pool[index % pool.length] : null;
  // Candidates never carry the real `src` — only the trailer, signed (see
  // lib/heroCandidates.js).
  const trailer = useHeroTrailer({
    trailerKey: ep ? (trailerKeyOf(ep.trailerRef) || (ep.trailerSrc ? `${ep.isSeries ? 's' : 'e'}:${ep.id}` : null)) : null,
    src: ep ? ep.trailerSrc || null : null,
    expiresAt: ep ? ep.trailerExpiresAt || null : null,
    ref: ep ? ep.trailerRef || null : null,
    active: Boolean(ep && !ep.heroImage)
  });
  // Priority: a purpose-built hero image, then an autoplaying trailer, then
  // falling back to whatever regular poster/thumbnail the card already has
  // rather than showing nothing. Before this fallback existed, any title
  // with neither a hero image nor a trailer set (true of most freshly
  // submitted or test content) rendered a plain solid-black box — the
  // <video> tag had nothing to play and there was no image to show
  // instead, so .hero-carousel's own CSS background (#000, meant only as
  // a brief loading-state color) was all that was ever visible. A trailer
  // that can't play (its link wouldn't sign, or it failed twice) falls
  // back the same way.
  const fallbackImage = ep && !trailer.hasTrailer ? (ep.poster || ep.thumbnail) : null;
  const imageSrc = ep ? (ep.heroImage || fallbackImage) : null;
  const isImageMode = !!imageSrc;
  const showVideo = !isImageMode && trailer.hasTrailer;
  const bgSrc = showVideo ? trailer.src : null;

  useEffect(() => {
    if (paused || pool.length <= 1) return;
    timerRef.current = setTimeout(() => {
      setIndex((i) => (i + 1) % pool.length);
    }, ROTATE_MS);
    return () => clearTimeout(timerRef.current);
  }, [index, paused, pool.length]);

  useEffect(() => {
    if (!bgSrc) return undefined; // an image, or a link still on its way
    const v = videoRef.current;
    if (!v) return undefined;
    return attachHeroTrailer(v, bgSrc, { muted, paused, onFatal: trailer.onFatal });
  }, [index, bgSrc, trailer.gen]);

  useEffect(() => {
    if (videoRef.current) videoRef.current.muted = muted;
  }, [muted]);

  if (!ep) return null;

  function goTo(i) {
    setIndex(((i % pool.length) + pool.length) % pool.length);
  }

  function togglePause() {
    setPaused((p) => {
      const next = !p;
      const v = videoRef.current;
      if (v) next ? v.pause() : v.play().catch(() => {});
      return next;
    });
  }

  return (
    <div className={`hero-carousel ${fullBleed ? 'full-bleed' : ''}`}>
      {isImageMode ? (
        <Image key={ep.id} src={imageSrc} alt={ep.title} fill priority sizes="100vw" className="hero-video hero-image" />
      ) : showVideo ? (
        <video
          key={ep.id}
          ref={videoRef}
          className="hero-video"
          // The artwork shows while the trailer's link loads.
          poster={ep.poster || ep.thumbnail || undefined}
          muted={muted}
          autoPlay
          loop
          playsInline
          onContextMenu={(e) => e.preventDefault()}
        />
      ) : null}
      <div className="hero-scrim" />

      <div className="hero-inner">
        {showVideo && (
          <div className="hero-controls">
            <button className="hero-pause-btn" onClick={() => setMuted((m) => !m)} aria-label={muted ? 'Unmute preview' : 'Mute preview'}>
              <VolumeIcon muted={muted} src={muted ? iconOverrides.volume_muted : iconOverrides.volume_on} />
            </button>
            <button className="hero-pause-btn" onClick={togglePause} aria-label={paused ? 'Play preview' : 'Pause preview'}>
              {paused ? <PlayIcon src={iconOverrides.play} /> : <PauseIcon src={iconOverrides.pause} />}
            </button>
          </div>
        )}

        <div className="hero-content">
          <div className="hero-eyebrow">{ep.isSeries ? 'Most viewed series' : 'Most viewed'}</div>
          <h2>
            {ep.titleImageUrl ? (
              <Image
                src={ep.titleImageUrl}
                alt={ep.title}
                width={400}
                height={110}
                style={{ width: 'auto', height: 'auto', maxWidth: '100%', maxHeight: '110px' }}
                className="hero-title-image"
              />
            ) : ep.title}
          </h2>
          <div className="hero-meta">
            <span className={`hero-badge-tier ${tierBadge(ep.tier, ep.adsEnabled).key}`}>{tierBadge(ep.tier, ep.adsEnabled).label}</span>
            {(ep.mainGenre || ep.releaseYear || ep.runtime) && (
              <>
                <span className="hero-meta-dot">&bull;</span>
                <span>{[ep.mainGenre, ep.releaseYear, formatRuntimeLong(ep.runtime) || ep.runtime].filter(Boolean).join(' · ')}</span>
              </>
            )}
            {ep.genre && (
              <>
                <span className="hero-meta-dot hero-sub-genre">&bull;</span>
                <span className="hero-sub-genre">{ep.genre}</span>
              </>
            )}
            {ep.rating && (
              <>
                <span className="hero-meta-dot">&bull;</span>
                <span className="hero-rating-tag">{ep.rating}</span>
              </>
            )}
            {ep.isOriginal && (
              <>
                <span className="hero-meta-dot">&bull;</span>
                <span className="original-tag">Tapa Original</span>
              </>
            )}
            {ep.isSeries && (
              <>
                <span className="hero-meta-dot">&bull;</span>
                <span>&#9636; Series</span>
              </>
            )}
          </div>
          <p>{ep.desc}</p>
          <div className="hero-actions">
            <button className="hero-play" onClick={() => onPlay(ep)}>
              <PlayIcon size={16} src={iconOverrides.play} /> {ep.isSeries ? seriesPlayLabel(ep.resume) : 'Play'}
            </button>
            <button className="hero-trailer" onClick={() => onTrailer(ep)}>
              <InfoIcon size={16} src={iconOverrides.info} /> More info
            </button>
          </div>
        </div>

        {pool.length > 1 && (
          <>
            <button className="hero-arrow hero-arrow-left" onClick={() => goTo(index - 1)} aria-label="Previous spotlight">‹</button>
            <button className="hero-arrow hero-arrow-right" onClick={() => goTo(index + 1)} aria-label="Next spotlight">›</button>
            <div className="hero-dots">
              {pool.map((_, i) => (
                <button
                  key={i}
                  className={`hero-dot ${i === index ? 'active' : ''}`}
                  onClick={() => goTo(i)}
                  aria-label={`Show spotlight ${i + 1}`}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
