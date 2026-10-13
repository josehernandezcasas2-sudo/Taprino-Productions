import { useEffect, useState } from 'react';
import { Image, View } from 'react-native';

// A photo that fills its frame ("cover") around a focal point, at a
// zoom — the app's take on the website's components/PositionedPhoto.js,
// for profile banners and avatars (user_profiles.*_position "x% y%" and
// *_zoom 1–3, migrations 084/085). RN's resizeMode="cover" always
// centres and can't zoom, so this measures the frame and the image and
// places the scaled image itself.
const POS = /^(\d{1,3})% (\d{1,3})%$/;
export function parsePosition(position) {
  const m = POS.exec(position || '');
  return m ? { x: Number(m[1]), y: Number(m[2]) } : { x: 50, y: 50 };
}
export function formatPosition({ x, y }) {
  const c = (n) => Math.round(Math.max(0, Math.min(100, n)));
  return `${c(x)}% ${c(y)}%`;
}
export const ZOOM_MIN = 1;
export const ZOOM_MAX = 3;
export const clampZoom = (z) => Math.round(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Number(z) || 1)) * 100) / 100;

// The slice of the image (image px) a frame shows — same maths as the
// website's lib/profileBanner.js visibleSlice.
export function visibleSlice(img, frameAspect, position, zoom = 1) {
  const { x, y } = parsePosition(position);
  const z = clampZoom(zoom);
  let w = img.w;
  let h = img.w / frameAspect;
  if (h > img.h) { h = img.h; w = img.h * frameAspect; }
  w /= z;
  h /= z;
  return { w, h, left: (img.w - w) * (x / 100), top: (img.h - h) * (y / 100) };
}

const sizeCache = new Map();

export default function PositionedImage({ uri, position, zoom = 1, style, children }) {
  const [frame, setFrame] = useState(null);
  const [size, setSize] = useState(sizeCache.get(uri) || null);

  useEffect(() => {
    if (!uri) return undefined;
    if (sizeCache.has(uri)) { setSize(sizeCache.get(uri)); return undefined; }
    let cancelled = false;
    Image.getSize(uri, (w, h) => { if (!cancelled) { sizeCache.set(uri, { w, h }); setSize({ w, h }); } }, () => {});
    return () => { cancelled = true; };
  }, [uri]);

  let placed = null;
  if (frame && size && size.w > 0 && size.h > 0) {
    const slice = visibleSlice(size, frame.width / frame.height, position, zoom);
    const scale = frame.width / slice.w;
    placed = { width: size.w * scale, height: size.h * scale, left: -slice.left * scale, top: -slice.top * scale };
  }

  return (
    <View style={[style, { overflow: 'hidden' }]} onLayout={(e) => { const { width, height } = e.nativeEvent.layout; if (width > 0 && height > 0) setFrame({ width, height }); }}>
      {uri && placed ? <Image source={{ uri }} style={{ position: 'absolute', ...placed }} /> : null}
      {children}
    </View>
  );
}
