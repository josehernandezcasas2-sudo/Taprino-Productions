import { useEffect, useRef, useState } from 'react';
import { IMAGE_POSITION_PATTERN, visibleSlice, ZOOM_MIN, ZOOM_MAX } from '../lib/profileBanner';
import PositionedPhoto from './PositionedPhoto';

// The account page's Reposition mode (mockups/banner-reposition.html):
// RepositionFrame shows the result (the banner preview / avatar circle,
// via PositionedPhoto) and reports its aspect; CropWindow is the editor.
export function parsePosition(position) {
  const m = IMAGE_POSITION_PATTERN.exec(position || '');
  return m ? { x: Number(m[1]), y: Number(m[2]) } : { x: 50, y: 50 };
}
export function formatPosition({ x, y }) {
  return `${Math.round(Math.max(0, Math.min(100, x)))}% ${Math.round(Math.max(0, Math.min(100, y)))}%`;
}
const clampZoom = (z) => Math.round(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z)) * 100) / 100;

// The whole photo, letterboxed, with everything outside the slice that
// will show dimmed. Drag the bright window (or use the arrow keys) to
// pick the slice; the zoom slider (or the mouse wheel over the photo)
// brings it closer. Position and zoom are the same values the frame
// above and the public profile draw with, so what's framed here is
// exactly what shows. `frameAspect` is the frame's width/height (the
// banner's measured box, 1 for the avatar circle).
export function CropWindow({ url, position, zoom = 1, onChange, onZoomChange, frameAspect = 3, round = false, height = 240 }) {
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
    const slice = visibleSlice(img, frameAspect, position, zoom);
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
    if (map[e.key]) {
      e.preventDefault();
      onChange(formatPosition({ x: from.x + map[e.key][0], y: from.y + map[e.key][1] }));
    } else if (onZoomChange && (e.key === '+' || e.key === '=')) {
      e.preventDefault();
      onZoomChange(clampZoom((Number(zoom) || 1) + 0.1));
    } else if (onZoomChange && (e.key === '-' || e.key === '_')) {
      e.preventDefault();
      onZoomChange(clampZoom((Number(zoom) || 1) - 0.1));
    }
  }
  function onWheel(e) {
    if (!onZoomChange || !layout) return;
    e.preventDefault();
    onZoomChange(clampZoom((Number(zoom) || 1) + (e.deltaY < 0 ? 0.1 : -0.1)));
  }

  return (
    <>
      <div className="crop-area" ref={areaRef} style={{ height }} onWheel={onWheel}>
        {layout && (
          <>
            <img className="crop-image" src={url} alt="" draggable={false} style={layout.image} />
            <div
              className={`crop-window ${round ? 'round' : ''}`}
              style={layout.window}
              tabIndex={0}
              role="slider"
              aria-label="Visible part of the photo — drag or use the arrow keys; + and − zoom"
              aria-valuetext={`${position || '50% 50%'}, zoom ${Number(zoom) || 1}`}
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
      {onZoomChange && (
        <label className="crop-zoom">
          <span>Zoom</span>
          <input
            type="range"
            min={ZOOM_MIN}
            max={ZOOM_MAX}
            step="0.05"
            value={Number(zoom) || 1}
            onChange={(e) => onZoomChange(clampZoom(Number(e.target.value)))}
            aria-label="Zoom"
          />
          <span className="crop-zoom-value">{(Number(zoom) || 1).toFixed(1)}×</span>
          {Number(zoom) > 1 && <button type="button" className="crop-zoom-reset" onClick={() => onZoomChange(1)}>Reset</button>}
        </label>
      )}
    </>
  );
}

// The result: a frame showing the photo at its focal point and zoom.
// Reports its own aspect (width/height) through onMeasure so the crop
// window frames the same slice.
export default function RepositionFrame({ url, position, zoom = 1, className = '', style, children, onMeasure }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!onMeasure || !ref.current) return undefined;
    const report = () => { const r = ref.current.getBoundingClientRect(); if (r.height > 0) onMeasure(r.width / r.height); };
    report();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(report) : null;
    if (ro) ro.observe(ref.current);
    return () => { if (ro) ro.disconnect(); };
  }, [onMeasure]);

  return (
    <div ref={ref} className={`reposition-frame ${className}`} style={style}>
      {url && <PositionedPhoto url={url} position={position} zoom={zoom} className="reposition-photo" />}
      {children}
    </div>
  );
}
