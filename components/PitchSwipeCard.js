import { useRef, useState } from 'react';
import Link from 'next/link';
import { HeartIcon, CloseIcon, InfoIcon, BackArrowIcon } from './PlayerIcons';

const THRESHOLD_X = 100; // px horizontal drag to commit like/dislike
const THRESHOLD_Y = 120; // px vertical drag to commit skip — taller than
// THRESHOLD_X since a downward drag is easier to do accidentally while
// scrolling on a touch device than a deliberate sideways swipe is.
const TAP_THRESHOLD = 6; // px — below this, a released pointer counts as a
// tap (flips the card) rather than an aborted drag (snaps back to center).
const EXIT_MS = 280;

function formatDeadline(dateStr) {
  if (!dateStr) return null;
  try {
    return new Date(dateStr).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return null;
  }
}

// Renders exactly one card and handles its own drag gesture — the parent
// only ever finds out "this card was swiped left/right/down" via onSwipe.
// It knows nothing about the deck, the round, or what happens next; that
// separation is what keeps the actual swipe-through-a-stack state machine
// (in pages/pitches/discover.js) readable on its own.
export default function PitchSwipeCard({ pitch, onSwipe }) {
  const [drag, setDrag] = useState({ dx: 0, dy: 0, dragging: false });
  const [exiting, setExiting] = useState(null); // null | 'left' | 'right' | 'down'
  // Resets on its own each time a new pitch comes up — this component is
  // rendered with key={pitch.id} in pages/pitches/discover.js, so React
  // fully remounts it per card rather than reusing this state.
  const [flipped, setFlipped] = useState(false);
  const startRef = useRef({ x: 0, y: 0 });
  const pointerIdRef = useRef(null);

  function handlePointerDown(e) {
    if (exiting) return;
    // Only the primary button/first touch point should start a drag —
    // otherwise a stray right-click or a second touch finger could start
    // tracking a drag the user never intended.
    if (e.button !== undefined && e.button !== 0) return;
    // The back face's own content (description/team/funding) can be
    // taller than the card and needs to scroll on its own — if this
    // still claimed the touch, every attempt to read a long pitch would
    // drag/swipe the whole card out from under it instead. Left entirely
    // to native scrolling (see touch-action:pan-y on .swipe-card-back-
    // body); flipping back to front from here uses its own explicit
    // button rather than "tap anywhere," since a tap here can no longer
    // be told apart from the start of a scroll.
    if (e.target.closest && e.target.closest('.swipe-card-back-body')) return;
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
    } else if (absX < TAP_THRESHOLD && absY < TAP_THRESHOLD) {
      // Barely moved at all — a tap/click, not an aborted drag. Flips the
      // card instead of snapping back (there's nothing to snap back from).
      setDrag({ dx: 0, dy: 0, dragging: false });
      setFlipped((f) => !f);
    } else {
      // Below threshold but moved more than a tap — snap back to center.
      // The transition CSS only applies once dragging stops (see style
      // below), so this animates smoothly instead of jumping.
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

  const pct = pitch.funding_goal ? Math.min(100, Math.round(((pitch.funding_raised || 0) / pitch.funding_goal) * 100)) : null;
  const deadline = formatDeadline(pitch.funding_deadline);

  return (
    <div
      className="swipe-card"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      style={{ transform, transition, opacity: exiting ? 0 : 1 }}
    >
      <div className={`swipe-badge swipe-badge-like ${likeOpacity > 0.15 ? 'visible' : ''}`} style={{ opacity: likeOpacity }}>LIKE</div>
      <div className={`swipe-badge swipe-badge-nope ${nopeOpacity > 0.15 ? 'visible' : ''}`} style={{ opacity: nopeOpacity }}>PASS</div>
      <div className={`swipe-badge swipe-badge-skip ${skipOpacity > 0.15 ? 'visible' : ''}`} style={{ opacity: skipOpacity }}>SKIP</div>

      {/* A tap flips this (see the TAP_THRESHOLD branch in
          handlePointerUp) — a plain CSS 3D rotate on this inner wrapper,
          independent of the outer .swipe-card's own drag transform, so
          swiping still works identically whichever face is showing. */}
      <div className={`swipe-card-flip-inner ${flipped ? 'flipped' : ''}`}>
        <div className="swipe-card-face swipe-card-front">
          {/* The overflow/border-radius/background live on this inner
              surface, not .swipe-card-face itself — see that class's own
              CSS comment for the Safari backface-visibility bug this
              works around. */}
          <div className="swipe-card-front-surface" style={{ backgroundImage: pitch.thumbnail ? `url(${pitch.thumbnail})` : undefined }}>
            <div className="swipe-card-scrim" />
            {/* Hidden mid-drag — it shares the top-right corner with the
                PASS badge (see .swipe-badge-nope), so the two would
                otherwise sit on top of each other the moment a leftward
                drag starts. */}
            <div className={`swipe-card-flip-hint ${drag.dragging ? 'swipe-card-flip-hint-hidden' : ''}`}><InfoIcon size={13} /> Tap for more</div>
            <div className="swipe-card-body">
              {pitch.tag && <span className="pitch-tag">{pitch.tag}</span>}
              <h2>{pitch.title}</h2>
              <p className="swipe-card-logline">{pitch.logline}</p>
              {pitch.creator_name && (
                pitch.created_by ? (
                  <Link
                    href={`/profile/${pitch.created_by}`}
                    className="swipe-card-creator swipe-card-creator-link"
                    onPointerDown={(e) => e.stopPropagation()}
                  >
                    {pitch.creator_name}
                  </Link>
                ) : (
                  <div className="swipe-card-creator">{pitch.creator_name}</div>
                )
              )}
            </div>
          </div>
        </div>

        <div className="swipe-card-face swipe-card-back">
          <div className="swipe-card-back-surface">
            {/* An explicit control rather than "tap anywhere to flip back"
                — the body below scrolls on its own (see
                .swipe-card-back-body's touch-action and the matching skip
                in handlePointerDown), so a tap landing on that scrollable
                text can no longer be told apart from the start of a
                scroll gesture. stopPropagation on pointerdown keeps this
                out of the drag-tracking entirely, same pattern as the
                creator link and "View full pitch" below. */}
            <button
              type="button"
              className="swipe-card-back-btn"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => setFlipped(false)}
              aria-label="Back to front"
            >
              <BackArrowIcon size={13} /> Back
            </button>
            <div className="swipe-card-body swipe-card-back-body">
              {pitch.tag && <span className="pitch-tag">{pitch.tag}</span>}
              <h2>{pitch.title}</h2>

              {(pitch.description || pitch.logline) && (
                <p className="swipe-card-description">{pitch.description || pitch.logline}</p>
              )}

              {pct != null && (
                <div className="swipe-card-funding">
                  <div className="pitch-progress-track">
                    <div className="pitch-progress-fill" style={{ width: `${pct}%` }} />
                  </div>
                  <span>${Number(pitch.funding_raised || 0).toLocaleString()} of ${Number(pitch.funding_goal).toLocaleString()} goal</span>
                </div>
              )}
              {deadline && <div className="swipe-card-deadline">Funding closes {deadline}</div>}

              {Array.isArray(pitch.team) && pitch.team.length > 0 && (
                <div className="swipe-card-team">
                  {pitch.team.map((m, i) => (
                    <span key={i} className="swipe-card-team-member">
                      {m.name}{m.role ? ` — ${m.role}` : ''}
                    </span>
                  ))}
                </div>
              )}

              <Link
                href={`/pitches/${pitch.id}`}
                className="swipe-card-learn-more"
                target="_blank"
                rel="noopener noreferrer"
                // A tap here is "show me the full page," not a swipe/flip —
                // it must never register as a drag or tap on the card
                // underneath it.
                onPointerDown={(e) => e.stopPropagation()}
              >
                View full pitch &rarr;
              </Link>
            </div>
          </div>
        </div>
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
