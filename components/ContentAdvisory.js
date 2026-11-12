import { useEffect, useRef } from 'react';
import { WarningIcon } from './PlayerIcons';

// The content advisory card (lib/contentAdvisory.js playbackAdvisoryFor
// decides who gets one and what it says): dims the first seconds of
// playback behind the rating and a standard warning, fades on its own,
// and a tap dismisses it. Rendered by VideoPlayer once the programme
// itself is playing (after any pre-roll).
//
// A title with flashing lights (Jose, 2026-11-12: "similar to how the tv
// rating is on some tvs") carries the photosensitivity warning on the same
// card — one card, never two in a row — and the video waits at its first
// frame under it (VideoPlayer holds it) until the card ends or the viewer
// presses Watch now, taps, or uses Enter / Space / Escape. Watch now takes
// the focus while the video is held, so a keyboard can let it go.
//
//   info = { rating: { code, imageUrl, kicker, headline, line } | null,
//            flashing: { kicker, headline, line } | null, holds, label }
//   state = null | 'on' | 'fading'
export default function ContentAdvisory({ info, state, onDismiss }) {
  const goRef = useRef(null);
  const holds = Boolean(info && info.holds);
  useEffect(() => {
    if (!holds || state !== 'on' || !goRef.current) return;
    try {
      goRef.current.focus({ preventScroll: true });
    } catch (err) {
      // An old browser without focus options: the shell's keys still work.
    }
  }, [holds, state]);
  if (!info || !state) return null;
  const rating = info.rating || null;
  const flashing = info.flashing || null;
  return (
    <div
      className={`tp-advisory ${state === 'fading' ? 'fade' : ''} ${flashing ? 'has-warning' : ''}`}
      role={flashing ? 'alert' : 'status'}
      aria-live={flashing ? 'assertive' : 'polite'}
      aria-label={info.label || undefined}
      onClick={onDismiss}
    >
      <div className="tp-advisory-box">
        {rating && (rating.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="tp-advisory-bug" src={rating.imageUrl} alt={`Rated ${rating.code}`} />
        ) : (
          <div className="tp-advisory-rating">{rating.code}</div>
        ))}
        {rating && rating.kicker && <div className="tp-advisory-kicker">{rating.kicker}</div>}
        {rating && (
          <div className="tp-advisory-text">
            {rating.headline}
            {rating.line && <><br />{rating.line}</>}
          </div>
        )}
        {flashing && (
          <div className="tp-advisory-warning">
            <div className="tp-advisory-warning-kicker"><WarningIcon size={14} /> {flashing.kicker}</div>
            <div className="tp-advisory-text">
              {flashing.headline}
              {flashing.line && <><br />{flashing.line}</>}
            </div>
          </div>
        )}
        {holds && (
          <button
            ref={goRef}
            type="button"
            className="tp-advisory-go"
            onClick={(e) => {
              e.stopPropagation();
              onDismiss();
            }}
          >
            Watch now
          </button>
        )}
        <div className="tp-advisory-sub">{holds ? 'It starts by itself in a few seconds' : 'Tap anywhere to continue'}</div>
      </div>
    </div>
  );
}
