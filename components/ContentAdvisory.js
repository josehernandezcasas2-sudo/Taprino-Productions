// The content advisory card (lib/contentAdvisory.js decides who gets one):
// dims the first seconds of playback behind the rating and a standard
// warning, fades on its own, and a tap dismisses it. Rendered by
// VideoPlayer once the programme itself is playing (after any pre-roll).
export default function ContentAdvisory({ info, state, onDismiss }) {
  if (!info || !state) return null;
  return (
    <div className={`tp-advisory ${state === 'fading' ? 'fade' : ''}`} role="status" aria-live="polite" onClick={onDismiss}>
      <div className="tp-advisory-box">
        {info.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="tp-advisory-bug" src={info.imageUrl} alt={`Rated ${info.code}`} />
        ) : (
          <div className="tp-advisory-rating">{info.code}</div>
        )}
        {info.kicker && <div className="tp-advisory-kicker">{info.kicker}</div>}
        <div className="tp-advisory-text">
          {info.headline}
          {info.line && <><br />{info.line}</>}
        </div>
        <div className="tp-advisory-sub">Tap anywhere to continue</div>
      </div>
    </div>
  );
}
