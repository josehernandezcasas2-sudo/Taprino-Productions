import { useRef, useState } from 'react';
import Link from 'next/link';
import { BackArrowIcon, InfoIcon } from './PlayerIcons';

// The pieces of Pitch Room Discover's elevator (pages/pitches/discover.js):
// the floor indicator above the doors, the cab (interior + sliding doors),
// the round steel buttons on the right-hand plate, and the swipeable,
// flippable pitch card in the middle. None of these know about the deck,
// the floor you're on, or what a swipe means — the page owns that state
// machine and these just render it, the same split the old PitchSwipeCard
// had with the page.

// Door travel, the pause between "doors closed" and "doors open" on the
// new floor, and the card's fly-off. The CSS transitions use the same
// numbers via --elev-door-ms / --elev-exit-ms, so keep them in sync.
export const DOOR_MS = 480;
export const DWELL_MS = 360;
export const EXIT_MS = 280;

// Reduced-motion users still get the floor change, just without sitting
// behind closed doors for most of a second — matches the CSS media query
// that shortens the door transition itself.
export function motionTimings() {
  if (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    return { door: 120, dwell: 60, exit: 120 };
  }
  return { door: DOOR_MS, dwell: DWELL_MS, exit: EXIT_MS };
}

function pad(n) {
  return String(n).padStart(2, '0');
}

export function FloorIndicator({ floor, total, direction, secondLook, lobby }) {
  return (
    <div className={`elev-indicator ${secondLook ? 'elev-indicator-second' : ''}`} aria-live="polite" aria-atomic="true">
      <span className="elev-indicator-label">Floor</span>
      <span className="elev-indicator-num">{lobby ? 'L' : pad(floor + 1)}</span>
      <span className="elev-indicator-of">/ {pad(total)}</span>
      <span className="elev-indicator-arrows" aria-hidden="true">
        <span className={direction === 'up' ? 'on' : ''}>▲</span>
        <span className={direction === 'down' ? 'on' : ''}>▼</span>
      </span>
      {secondLook && <span className="elev-indicator-round">2nd look</span>}
    </div>
  );
}

// The cab interior (wall panels, handrail, floor, ceiling lamp) with the
// two door leaves on top of everything. `closed` slides the doors shut;
// whatever's rendered as children (card, plate, indicator, lobby) sits
// behind them unless it raises its own z-index above the doors'.
export function ElevatorCab({ closed, children }) {
  return (
    <div className="elev-car">
      <div className={`elev-cab ${closed ? 'elev-cab-closed' : ''}`}>
        <div className="elev-interior" aria-hidden="true">
          <div className="elev-wall" />
          <div className="elev-rail" />
          <div className="elev-floor" />
          <div className="elev-ceiling" />
        </div>
        {children}
        <div className="elev-door elev-door-l" aria-hidden="true" />
        <div className="elev-door elev-door-r" aria-hidden="true" />
      </div>
    </div>
  );
}

// One round steel button with its illuminated ring. `lit` is the lamp:
// Save and Like stay lit while active (like a floor button that stays on
// until you arrive), Share flashes for a moment after a copy.
export function ElevatorButton({ icon, label, lit, variant, disabled, onClick, ariaLabel, ariaPressed, count }) {
  return (
    <button
      type="button"
      className={`elev-btn ${lit ? 'elev-btn-lit' : ''} ${variant ? `elev-btn-${variant}` : ''}`}
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel || label}
      aria-pressed={ariaPressed}
    >
      <span className="elev-btn-cap">{icon}</span>
      <span className="elev-btn-label">{label}</span>
      {count != null && <span className="elev-btn-count">{count}</span>}
    </button>
  );
}

function formatDeadline(dateStr) {
  if (!dateStr) return null;
  try {
    return new Date(dateStr).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return null;
  }
}

const THRESHOLD_X = 100; // px horizontal drag to commit a left/right swipe
const THRESHOLD_Y = 120; // px downward drag to commit a hold — taller than
// THRESHOLD_X since a downward drag is easier to do accidentally while
// scrolling on a touch device than a deliberate sideways swipe is.
const TAP_THRESHOLD = 6; // px — below this, a released pointer counts as a
// tap (flips the card) rather than an aborted drag (snaps back to center).

// Front: poster, tag, title, logline, creator. Back: full description,
// funding, deadline, team, link to the pitch page. Drag it left/right/down
// to swipe (onSwipe gets the direction; the page decides what that means
// and rides the elevator), tap it to flip. Same thresholds and gesture
// rules as the old PitchSwipeCard. The back flips only via its own Front
// button, because its body scrolls on its own and a tap landing on that
// text can't be told apart from the start of a scroll.
export function ElevatorCard({ pitch, flipped, onFlip, onSwipe, disabled }) {
  const [drag, setDrag] = useState({ dx: 0, dy: 0, dragging: false });
  const [exiting, setExiting] = useState(null); // null | 'left' | 'right' | 'down'
  const startRef = useRef({ x: 0, y: 0 });
  const pointerIdRef = useRef(null);

  function handlePointerDown(e) {
    if (exiting || disabled) return;
    // Only the primary button/first touch point should start a drag —
    // otherwise a stray right-click or a second touch finger could start
    // tracking a drag the user never intended.
    if (e.button !== undefined && e.button !== 0) return;
    // Links and buttons inside the card own their own taps, and the back
    // face's scrolling body owns its own touch (see .elev-card-back-body's
    // touch-action) — none of those should start a drag.
    if (e.target.closest && e.target.closest('a, button, .elev-card-back-body')) return;
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
      // Barely moved at all — a tap, not an aborted drag. Flips the card
      // (front only; the back has its own Front button).
      setDrag({ dx: 0, dy: 0, dragging: false });
      if (!flipped) onFlip(true);
    } else {
      // Below threshold but moved more than a tap — snap back to center.
      // The CSS transition only applies once dragging stops, so this
      // animates smoothly instead of jumping.
      setDrag({ dx: 0, dy: 0, dragging: false });
    }
  }

  function commit(direction) {
    setExiting(direction);
    setDrag((d) => ({ ...d, dragging: false }));
    // Told right away rather than after the fly-off, so the doors start
    // closing while the card is still leaving — the two motions overlap
    // instead of queueing up into a second and a half of waiting.
    onSwipe(direction);
  }

  const dominant = Math.abs(drag.dx) >= Math.abs(drag.dy) ? 'horizontal' : 'vertical';
  const likeOpacity = dominant === 'horizontal' ? Math.max(0, Math.min(1, drag.dx / THRESHOLD_X)) : 0;
  const passOpacity = dominant === 'horizontal' ? Math.max(0, Math.min(1, -drag.dx / THRESHOLD_X)) : 0;
  const holdOpacity = dominant === 'vertical' ? Math.max(0, Math.min(1, drag.dy / THRESHOLD_Y)) : 0;

  const exitTransforms = {
    right: 'translate(160%, -30%) rotate(24deg)',
    left: 'translate(-160%, -30%) rotate(-24deg)',
    down: 'translate(0, 160%) rotate(0deg)'
  };
  const transform = exiting
    ? exitTransforms[exiting]
    : `translate(${drag.dx}px, ${drag.dy}px) rotate(${drag.dx / 24}deg)`;

  const pct = pitch.funding_goal ? Math.min(100, Math.round(((pitch.funding_raised || 0) / pitch.funding_goal) * 100)) : null;
  const deadline = formatDeadline(pitch.funding_deadline);

  function handleFrontKey(e) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onFlip(true);
    }
  }

  return (
    <div
      className="elev-card"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      // No transition while actively dragging — the card must track the
      // pointer with zero lag. Once released (committed or snapping back),
      // the stylesheet's transition eases it the rest of the way.
      style={{ transform, transition: drag.dragging ? 'none' : undefined, opacity: exiting ? 0 : 1 }}
    >
      <div className="elev-badge elev-badge-like" style={{ opacity: likeOpacity }}>LIKE</div>
      <div className="elev-badge elev-badge-pass" style={{ opacity: passOpacity }}>PASS</div>
      <div className="elev-badge elev-badge-hold" style={{ opacity: holdOpacity }}>HOLD</div>

      <div className="elev-card-perspective">
      <div className={`elev-card-flip ${flipped ? 'elev-card-flipped' : ''}`}>
        {/* Each face is a plain box carrying only backface-visibility; the
            radius/overflow/background live on the surface inside it. iOS
            Safari silently drops backface-visibility on an element that
            also has overflow:hidden + border-radius, and the rotated-away
            face then renders through, mirrored, on top of the visible
            one — the exact bug the old swipe card hit on a real phone. */}
        <div className="elev-card-face elev-card-front">
        <div
          className={`elev-card-surface elev-card-front-surface ${pitch.thumbnail ? '' : 'elev-card-front-blank'}`}
          style={{ backgroundImage: pitch.thumbnail ? `url(${pitch.thumbnail})` : undefined }}
          role="button"
          tabIndex={flipped ? -1 : 0}
          aria-label={`${pitch.title} — turn the card over for details`}
          onKeyDown={handleFrontKey}
        >
          <div className="elev-card-scrim" />
          <span className={`elev-card-hint ${drag.dragging ? 'elev-card-hint-hidden' : ''}`}><InfoIcon size={12} /> Tap to turn over</span>
          <div className="elev-card-copy">
            {pitch.tag && <span className="elev-tag">{pitch.tag}</span>}
            <h2>{pitch.title}</h2>
            {pitch.logline && <p className="elev-card-logline">{pitch.logline}</p>}
            {pitch.creator_name && (
              pitch.created_by ? (
                <Link href={`/profile/${pitch.created_by}`} className="elev-card-creator elev-card-creator-link">
                  {pitch.creator_name}
                </Link>
              ) : (
                <span className="elev-card-creator">{pitch.creator_name}</span>
              )
            )}
          </div>
        </div>
        </div>

        <div className="elev-card-face elev-card-back" aria-hidden={!flipped}>
        <div className="elev-card-surface elev-card-back-surface">
          <button
            type="button"
            className="elev-card-back-btn"
            onClick={() => onFlip(false)}
            tabIndex={flipped ? 0 : -1}
            aria-label="Back to the front of the card"
          >
            <BackArrowIcon size={12} /> Front
          </button>
          <div className="elev-card-back-body">
            {pitch.tag && <span className="elev-tag">{pitch.tag}</span>}
            <h3>{pitch.title}</h3>
            {(pitch.description || pitch.logline) && (
              <p className="elev-card-description">{pitch.description || pitch.logline}</p>
            )}
            {pct != null && (
              <div className="elev-card-funding">
                <div className="pitch-progress-track"><div className="pitch-progress-fill" style={{ width: `${pct}%` }} /></div>
                <span>${Number(pitch.funding_raised || 0).toLocaleString()} of ${Number(pitch.funding_goal).toLocaleString()} goal</span>
              </div>
            )}
            {deadline && <span className="elev-card-deadline">Funding closes {deadline}</span>}
            {Array.isArray(pitch.team) && pitch.team.length > 0 && (
              <div className="elev-card-team">
                {pitch.team.map((m, i) => (
                  <span key={i}>{m.name}{m.role ? ` — ${m.role}` : ''}</span>
                ))}
              </div>
            )}
            <Link
              href={`/pitches/${pitch.id}`}
              className="elev-card-learn-more"
              target="_blank"
              rel="noopener noreferrer"
              tabIndex={flipped ? 0 : -1}
            >
              View full pitch &rarr;
            </Link>
          </div>
        </div>
        </div>
      </div>
      </div>
    </div>
  );
}
