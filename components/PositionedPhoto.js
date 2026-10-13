import { useEffect, useRef, useState } from 'react';
import { visibleSlice } from '../lib/profileBanner';

// A photo filling its frame around a focal point, at a zoom: profile
// banners and avatars (user_profiles.*_position / *_zoom, migrations
// 084/085). CSS alone can do the focal point (background-position) but
// not "cover × zoom" without knowing the image's own size, so this
// measures the frame and the image and places the <img> itself. Until
// both are known it falls back to object-fit: cover at the focal point,
// which is the zoom-1 look, so the first paint is already close.
export default function PositionedPhoto({ url, position, zoom = 1, className = '', style, children, alt = '' }) {
  const frameRef = useRef(null);
  const imgRef = useRef(null);
  const [frame, setFrame] = useState(null);
  const [img, setImg] = useState(null);

  // A cached or server-rendered image can finish loading before React
  // attaches onLoad, so read its size directly once mounted too.
  useEffect(() => {
    const el = imgRef.current;
    if (el && el.complete && el.naturalWidth > 0) setImg({ w: el.naturalWidth, h: el.naturalHeight });
  }, [url]);

  useEffect(() => {
    if (!frameRef.current) return undefined;
    const measure = () => { const r = frameRef.current.getBoundingClientRect(); if (r.width > 0 && r.height > 0) setFrame({ w: r.width, h: r.height }); };
    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    if (ro) ro.observe(frameRef.current);
    return () => { if (ro) ro.disconnect(); };
  }, []);

  let placed = null;
  if (frame && img && url) {
    const slice = visibleSlice(img, frame.w / frame.h, position, zoom);
    const scale = frame.w / slice.w;
    placed = { width: img.w * scale, height: img.h * scale, left: -slice.left * scale, top: -slice.top * scale };
  }

  return (
    <div ref={frameRef} className={`positioned-photo ${className}`} style={style}>
      {url && (
        <img
          ref={imgRef}
          key={url}
          src={url}
          alt={alt}
          draggable={false}
          onLoad={(e) => setImg({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
          style={placed
            ? { position: 'absolute', ...placed, maxWidth: 'none' }
            : { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', objectPosition: position || 'center' }}
        />
      )}
      {children}
    </div>
  );
}
