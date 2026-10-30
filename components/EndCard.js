import { useEffect, useRef, useState } from 'react';
import { CloseIcon, SkipForwardIcon, usePlayerIconOverrides } from './PlayerIcons';
import { tierBadge } from '../lib/tierBadge';
import { parseRuntimeToSeconds } from '../lib/videoMetadata';
import { PLAY_NOW_LABEL, STAY_LABEL, playingInLabel } from '../lib/endCardRules';

// The end card over the player once a title plays out (Jose, 2026-10-30;
// the boards on the After Play canvas): the last frame dims, what just
// ended sits top-left, the next episode (or the pick once the show is
// over) in the middle with a countdown ring on its art, PLAY NOW
// bottom-left to skip the wait, × top-right to stay. `card` comes from
// lib/endCardRules.js endCardFor(); `onGo(href)` opens a title (the
// page's router), `onStay()` takes the card down and brings the controls
// back. `layout` is 'compact' (the inline strip on a phone), 'wide'
// (from 640px of player width) or 'xl' (a laptop's inline player);
// full screen on a touch screen grows the wide layout with the rest of
// the chrome (styles/globals.css, the pointer: coarse block).
//
// The timer counts only while the page is visible — a tab in the
// background doesn't jump ahead — and stops on ×, PLAY NOW or leaving.
// Keyboard: Enter or Space = play now, Escape = stay (the player's own
// shortcuts are off while the card is up).

// "22 min" from a "22:00" runtime (the episode page's minutesLabel).
function minutesLabel(runtime) {
  const s = parseRuntimeToSeconds(runtime);
  return s ? `${Math.max(1, Math.round(s / 60))} min` : (runtime || '');
}

const RING_R = 32;
const RING_C = 2 * Math.PI * RING_R;

export default function EndCard({ card, onGo, onStay, layout = 'compact' }) {
  const iconOverrides = usePlayerIconOverrides();
  const { target, back, headline, seconds } = card;
  const timed = Boolean(target && seconds > 0);
  const [left, setLeft] = useState(seconds);
  const goRef = useRef(onGo);
  const stayRef = useRef(onStay);
  goRef.current = onGo;
  stayRef.current = onStay;

  // The countdown: one tick a second while the page is visible.
  useEffect(() => {
    if (!timed) return undefined;
    let remaining = seconds;
    let timer = null;
    setLeft(seconds);
    const stop = () => { if (timer) { clearInterval(timer); timer = null; } };
    const tick = () => {
      remaining -= 1;
      setLeft(remaining);
      if (remaining <= 0) { stop(); goRef.current(target.href, target); }
    };
    const start = () => { if (!timer) timer = setInterval(tick, 1000); };
    const onVisibility = () => { if (document.hidden) stop(); else start(); };
    document.addEventListener('visibilitychange', onVisibility);
    if (!document.hidden) start();
    return () => { stop(); document.removeEventListener('visibilitychange', onVisibility); };
  }, [timed, seconds, target]);

  // Keys, ahead of the player's own handler (capture): the card's own
  // buttons keep their meaning, a field elsewhere on the page is left alone.
  useEffect(() => {
    const onKey = (e) => {
      const el = e.target;
      const tag = el && el.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (el && el.isContentEditable)) return;
      if (el && el.closest && el.closest('.tp-endcard')) return;
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); stayRef.current(); }
      else if ((e.key === 'Enter' || e.key === ' ') && target) { e.preventDefault(); e.stopPropagation(); goRef.current(target.href, target); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [target]);

  const tier = target ? tierBadge(target.tier, target.adsEnabled) : null;
  const meta = target ? [minutesLabel(target.runtime), target.genre, target.releaseYear].filter(Boolean) : [];
  if (layout === 'compact' && tier) meta.push(tier.label);
  // The ring heads for the next second's state, so it drains in step with the number.
  const ringOffset = timed ? RING_C * (1 - Math.max(0, left - 1) / seconds) : 0;
  const go = (e, href, t) => { e.preventDefault(); onGo(href, t); };

  return (
    <div className={`tp-endcard ${layout} kind-${card.kind}`} role="dialog" aria-label={target ? `${target.kicker}: ${target.title}` : headline.kicker}>
      <div className="tp-endcard-headline">
        <span className="tp-endcard-hk">{headline.kicker}</span>
        {headline.title && <span className="tp-endcard-ht">{headline.title}</span>}
      </div>
      <button type="button" className="tp-endcard-stay" onClick={onStay} aria-label={STAY_LABEL}>
        <CloseIcon size={16} src={iconOverrides.close} />
      </button>

      {target && (
        <a className="tp-endcard-main" href={target.href} onClick={(e) => go(e, target.href, target)} aria-label={`${target.kicker}: ${target.title}${timed ? `. ${playingInLabel(left)}` : ''}. ${PLAY_NOW_LABEL}`}>
          <span className="tp-endcard-art" style={target.thumbnail ? { backgroundImage: `url(${target.thumbnail})` } : undefined}>
            {timed && (
              <span className="tp-endcard-ring" aria-hidden="true">
                <svg viewBox="0 0 72 72">
                  <circle className="tp-endcard-ring-track" cx="36" cy="36" r={RING_R} />
                  <circle className="tp-endcard-ring-fill" cx="36" cy="36" r={RING_R} strokeDasharray={RING_C} style={{ strokeDashoffset: ringOffset }} />
                </svg>
                <span className="tp-endcard-count">{left}</span>
              </span>
            )}
            {tier && <span className={`tp-endcard-tier ${tier.key}`}>{tier.label}</span>}
          </span>
          <span className="tp-endcard-text">
            <span className="tp-endcard-kicker">{target.kicker}</span>
            <span className="tp-endcard-title">{target.title}</span>
            <span className="tp-endcard-meta">
              {meta.join(' · ')}
              {target.rating && <span className="tp-endcard-rating">{target.rating}</span>}
            </span>
            {timed && <span className="tp-endcard-in" aria-live="off">{playingInLabel(left)}</span>}
          </span>
        </a>
      )}

      {target && (
        <a className="tp-endcard-play" href={target.href} onClick={(e) => go(e, target.href, target)}>
          <SkipForwardIcon size={16} src={iconOverrides.skip_forward} /> {PLAY_NOW_LABEL}
        </a>
      )}
      {back && (
        <a className="tp-endcard-back" href={back.href} onClick={(e) => go(e, back.href, null)}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 6l-6 6 6 6" /></svg>
          {back.label}
        </a>
      )}
    </div>
  );
}
