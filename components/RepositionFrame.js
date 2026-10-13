import { useEffect, useRef, useState } from 'react';
import { IMAGE_POSITION_PATTERN } from '../lib/profileBanner';

// Where a "cover" fit of an image lands inside a frame: the slice of the
// image (in image pixels) that is visible for a given focal point.
// Shared by the crop window below and the app's PositionedImage.
export function visibleSlice(img, frameAspect, position) {
  const { x, y } = parsePosition(position);
  let w = img.w;
  let h = img.w / frameAspect;
  if (h > img.h) { h = img.h; w = img.h * frameAspect; }
  return { w, h, left: (img.w - w) * (x / 100), top: (img.h - h) * (y / 100) };
}

// Reposition mode's editor: the whole photo, letterboxed, with everything
// outside the slice that will show dimmed. Drag the bright window (or
// use the arrow keys) to pick the slice; the position string is the
// same one the frame above and the public profile use, so what you see
// here is exactly what shows. `frameAspect` is the frame's width/height
// (the banner's measured box, 1 for the avatar circle).
export function CropWindow({ url, position, onChange, frameAspect = 3, round = false, height = 240 }) {
  const areaRef = useRef(null);
  const [area, setArea] = useState(null);
  const [img, setImg] = useState(null);
  const drag = useRef(null);

  useEffect(() => {
    if (!url) return undefined;
    let cancelled = false;
    const i = new Image();
    i.onload = () => { if (!cancelled) setImg({ w: i.naturalWidth, h: i.naturalHeight }); };
    i.src = url;
    return () => { cancelled = true; };
  }, [url]);

  useEffect(() => {
    if (!areaRef.current) return undefined;
    const measure = () => { const r = areaRef.current.getBoundingClientRect(); setArea({ w: r.width, h: r.height }); };
    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    if (ro) ro.observe(areaRef.current);
    return () => { if (ro) ro.disconnect(); };
  }, []);

  let layout = null;
  if (area && img) {
    const c = Math.min(area.w / img.w, area.h / img.h); // contain
    const rw = img.w * c;
    const rh = img.h * c;
    const ox = (area.w - rw) / 2;
    const oy = (area.h - rh) / 2;
    const slice = visibleSlice(img, frameAspect, position);
    layout = {
      image: { left: ox, top: oy, width: rw, height: rh },
      window: { left: ox + slice.left * c, top: oy + slice.top * c, width: slice.w * c, height: slice.h * c },
      // How far (on screen) the window can travel; 0 on an axis the slice fills.
      travelX: (img.w - slice.w) * c,
      travelY: (img.h - slice.h) * c
    };
  }

  function move(dxPx, dyPx, from) {
    if (!layout) return;
    onChange(formatPosition({
      x: layout.travelX > 0 ? from.x + (dxPx / layout.travelX) * 100 : from.x,
      y: layout.travelY > 0 ? from.y + (dyPx / layout.travelY) * 100 : from.y
    }));
  }
  function onPointerDown(e) {
    if (!layout) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { startX: e.clientX, startY: e.clientY, from: parsePosition(position) };
  }
  function onPointerMove(e) {
    if (!drag.current) return;
    move(e.clientX - drag.current.startX, e.clientY - drag.current.startY, drag.current.from);
  }
  function onPointerUp(e) {
    if (!drag.current) return;
    drag.current = null;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* already released */ }
  }
  function onKeyDown(e) {
    const step = e.shiftKey ? 10 : 2;
    const from = parsePosition(position);
    const map = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (!map[e.key]) return;
    e.preventDefault();
    onChange(formatPosition({ x: from.x + map[e.key][0], y: from.y + map[e.key][1] }));
  }

  return (
    <div className="crop-area" ref={areaRef} style={{ height }}>
      {layout && (
        <>
          <img className="crop-image" src={url} alt="" draggable={false} style={layout.image} />
          <div
            className={`crop-window ${round ? 'round' : ''}`}
            style={layout.window}
            tabIndex={0}
            role="slider"
            aria-label="Visible part of the photo — drag or use the arrow keys"
            aria-valuetext={position || '50% 50%'}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onKeyDown={onKeyDown}
          >
            {round && <div className="crop-window-ring" />}
          </div>
        </>
      )}
      {!layout && <div className="crop-loading">Loading photo…</div>}
    </div>
  );
}

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

export default function RepositionFrame({ url, position, onChange, active = false, className = '', style, children, axis = 'both', label = 'Drag to reposition', onMeasure }) {
  const ref = useRef(null);
  const drag = useRef(null);
  const pos = parsePosition(position);

  // The frame's own width/height, for the crop window's aspect.
  useEffect(() => {
    if (!onMeasure || !ref.current) return undefined;
    const report = () => { const r = ref.current.getBoundingClientRect(); if (r.height > 0) onMeasure(r.width / r.height); };
    report();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(report) : null;
    if (ro) ro.observe(ref.current);
    return () => { if (ro) ro.disconnect(); };
  }, [onMeasure]);

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
