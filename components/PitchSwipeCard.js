import { useRef, useState } from 'react';
import Link from 'next/link';
import { HeartIcon, CloseIcon } from './PlayerIcons';

const THRESHOLD_X = 100; // px horizontal drag to commit like/dislike
const THRESHOLD_Y = 120; // px vertical drag to commit skip — taller than
// THRESHOLD_X since a downward drag is easier to do accidentally while
// scrolling on a touch device than a deliberate sideways swipe is.
const EXIT_MS = 280;

// Renders exactly one card and handles its own drag gesture — the parent
// only ever finds out "this card was swiped left/right/down" via onSwipe.
// It knows nothing about the deck, the round, or what happens next; that
// separation is what keeps the actual swipe-through-a-stack state machine
// (in pages/pitches/discover.js) readable on its own.
export default function PitchSwipeCard({ pitch, onSwipe }) {
  const [drag, setDrag] = useState({ dx: 0, dy: 0, dragging: false });
  const [exiting, setExiting] = useState(null); // null | 'left' | 'right' | 'down'
  const startRef = useRef({ x: 0, y: 0 });
  const pointerIdRef = useRef(null);

  function handlePointerDown(e) {
    if (exiting) return;
    // Only the primary button/first touch point should start a drag —
    // otherwise a stray right-click or a second touch finger could start
    // tracking a drag the user never intended.
    if (e.button !== undefined && e.button !== 0) return;
    startRef.current = { x: e.clientX, y: e.clientY };
    pointerIdRef.current = e.pointerId;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({ dx: 0, dy: 0, dragging: true });
  }

  function handlePointerMove(e) {
    if (!drag.dragging || exiting) return;
    setDrag({ dx: e.clientX - startRef.current.x, dy: e.clientY - startRef.current.y, dragging: true });
  }

  function releaseDrag(e) {
    if (pointerIdRef.current != null && e.currentTarget.hasPointerCapture && e.currentTarget.hasPointerCapture(pointerIdRef.current)) {
      e.currentTarget.releasePointerCapture(pointerIdRef.current);
    }
  }

  function handlePointerUp(e) {
    releaseDrag(e);
    if (!drag.dragging || exiting) return;
    const { dx, dy } = drag;
    const absX = Math.abs(dx);
    const absY = Math.abs(dy);

    if (absX >= absY && dx > THRESHOLD_X) {
      commit('right');
    } else if (absX >= absY && dx < -THRESHOLD_X) {
      commit('left');
    } else if (absY > absX && dy > THRESHOLD_Y) {
      commit('down');
    } else {
      // Below threshold — snap back to center. The transition CSS only
      // applies once dragging stops (see style below), so this animates
      // smoothly instead of jumping.
      setDrag({ dx: 0, dy: 0, dragging: false });
    }
  }

  function commit(direction) {
    setExiting(direction);
    setDrag((d) => ({ ...d, dragging: false }));
    // Let the exit animation actually play before telling the parent to
    // swap in the next card underneath — otherwise the card would vanish
    // instantly instead of flying off screen.
    setTimeout(() => onSwipe(direction), EXIT_MS);
  }

  const dominant = Math.abs(drag.dx) >= Math.abs(drag.dy) ? 'horizontal' : 'vertical';
  const likeOpacity = dominant === 'horizontal' ? Math.max(0, Math.min(1, drag.dx / THRESHOLD_X)) : 0;
  const nopeOpacity = dominant === 'horizontal' ? Math.max(0, Math.min(1, -drag.dx / THRESHOLD_X)) : 0;
  const skipOpacity = dominant === 'vertical' ? Math.max(0, Math.min(1, drag.dy / THRESHOLD_Y)) : 0;

  const exitTransforms = {
    right: 'translate(160%, -30%) rotate(24deg)',
    left: 'translate(-160%, -30%) rotate(-24deg)',
    down: 'translate(0, 160%) rotate(0deg)'
  };
  const transform = exiting
    ? exitTransforms[exiting]
    : `translate(${drag.dx}px, ${drag.dy}px) rotate(${drag.dx / 24}deg)`;
  // No transition while actively dragging — the card must track the
  // pointer with zero lag. Once released (committed or snapping back),
  // this eases it the rest of the way.
  const transition = drag.dragging ? 'none' : `transform ${EXIT_MS}ms ease, opacity ${EXIT_MS}ms ease`;

  return (
    <div
      className="swipe-card"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      style={{
        transform,
        transition,
        opacity: exiting ? 0 : 1,
        backgroundImage: pitch.thumbnail ? `url(${pitch.thumbnail})` : undefined
      }}
    >
      <div className={`swipe-badge swipe-badge-like ${likeOpacity > 0.15 ? 'visible' : ''}`} style={{ opacity: likeOpacity }}>LIKE</div>
      <div className={`swipe-badge swipe-badge-nope ${nopeOpacity > 0.15 ? 'visible' : ''}`} style={{ opacity: nopeOpacity }}>PASS</div>
      <div className={`swipe-badge swipe-badge-skip ${skipOpacity > 0.15 ? 'visible' : ''}`} style={{ opacity: skipOpacity }}>SKIP</div>

      <div className="swipe-card-scrim" />
      <div className="swipe-card-body">
        {pitch.tag && <span className="pitch-tag">{pitch.tag}</span>}
        <h2>{pitch.title}</h2>
        <p className="swipe-card-logline">{pitch.logline}</p>
        {pitch.creator_name && <div className="swipe-card-creator">{pitch.creator_name}</div>}
        <Link
          href={`/pitches/${pitch.id}`}
          className="swipe-card-learn-more"
          // A tap here is "show me the full page," not a swipe — it must
          // never register as a drag start on the card underneath it.
          onPointerDown={(e) => e.stopPropagation()}
        >
          View full pitch &rarr;
        </Link>
      </div>
    </div>
  );
}

export function SwipeButtons({ onLike, onSkip, onDislike, disabled }) {
  return (
    <div className="swipe-buttons">
      <button className="swipe-btn swipe-btn-dislike" onClick={onDislike} disabled={disabled} aria-label="Not interested">
        <CloseIcon size={22} />
      </button>
      <button className="swipe-btn swipe-btn-skip" onClick={onSkip} disabled={disabled} aria-label="Skip for now">
        &darr;
      </button>
      <button className="swipe-btn swipe-btn-like" onClick={onLike} disabled={disabled} aria-label="Like and follow">
        <HeartIcon size={22} active />
      </button>
    </div>
  );
}
