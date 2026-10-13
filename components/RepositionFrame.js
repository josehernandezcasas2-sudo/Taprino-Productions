import { useRef } from 'react';
import { IMAGE_POSITION_PATTERN } from '../lib/profileBanner';

// A photo in a frame whose focal point ("x% y%", CSS background-position)
// can be dragged — the account page's Reposition mode for the banner and
// the avatar (mockups/banner-reposition.html). Dragging the photo moves
// it the way you'd expect (pull down = see more of the top), and the
// slider under the banner does the same for keyboards. Nothing is cropped
// or re-uploaded; the result is just the position string the profile
// stores (migration 084).
export function parsePosition(position) {
  const m = IMAGE_POSITION_PATTERN.exec(position || '');
  return m ? { x: Number(m[1]), y: Number(m[2]) } : { x: 50, y: 50 };
}
export function formatPosition({ x, y }) {
  return `${Math.round(Math.max(0, Math.min(100, x)))}% ${Math.round(Math.max(0, Math.min(100, y)))}%`;
}

export default function RepositionFrame({ url, position, onChange, active = false, className = '', style, children, axis = 'both', label = 'Drag to reposition' }) {
  const ref = useRef(null);
  const drag = useRef(null);
  const pos = parsePosition(position);

  function onPointerDown(e) {
    if (!active || !url) return;
    e.preventDefault();
    ref.current.setPointerCapture(e.pointerId);
    drag.current = { startX: e.clientX, startY: e.clientY, from: pos };
  }
  function onPointerMove(e) {
    if (!drag.current || !ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    // Full drag across the frame sweeps the whole 0–100 range; dragging
    // the photo down means a smaller y%, so the deltas are inverted.
    const dx = ((e.clientX - drag.current.startX) / rect.width) * 100;
    const dy = ((e.clientY - drag.current.startY) / rect.height) * 100;
    onChange(formatPosition({
      x: axis === 'y' ? drag.current.from.x : drag.current.from.x - dx,
      y: axis === 'x' ? drag.current.from.y : drag.current.from.y - dy
    }));
  }
  function onPointerUp(e) {
    if (!drag.current) return;
    drag.current = null;
    try { ref.current.releasePointerCapture(e.pointerId); } catch { /* already released */ }
  }

  return (
    <div
      ref={ref}
      className={`reposition-frame ${active ? 'active' : ''} ${className}`}
      style={{ ...(url ? { backgroundImage: `url(${url})`, backgroundSize: 'cover', backgroundPosition: position || 'center' } : {}), ...style }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      role={active ? 'img' : undefined}
      aria-label={active ? label : undefined}
    >
      {active && url && <div className="reposition-grip"><span>{axis === 'y' ? '↕' : '✥'} {label}</span></div>}
      {children}
    </div>
  );
}
