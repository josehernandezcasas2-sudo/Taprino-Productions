import { useEffect, useRef, useState } from 'react';
import { Image, View } from 'react-native';

// A photo that fills its frame ("cover") around a focal point — the
// app's take on CSS background-position, for profile banners and
// avatars (user_profiles.banner_position / avatar_position, "x% y%",
// migration 084). RN's resizeMode="cover" always centres, so this
// measures the frame and the image and places the scaled image itself.
const POS = /^(\d{1,3})% (\d{1,3})%$/;
export function parsePosition(position) {
  const m = POS.exec(position || '');
  return m ? { x: Number(m[1]), y: Number(m[2]) } : { x: 50, y: 50 };
}
export function formatPosition({ x, y }) {
  const c = (n) => Math.round(Math.max(0, Math.min(100, n)));
  return `${c(x)}% ${c(y)}%`;
}

const sizeCache = new Map();

export default function PositionedImage({ uri, position, style, children }) {
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
    const scale = Math.max(frame.width / size.w, frame.height / size.h);
    const w = size.w * scale;
    const h = size.h * scale;
    const { x, y } = parsePosition(position);
    placed = { width: w, height: h, left: -(w - frame.width) * (x / 100), top: -(h - frame.height) * (y / 100) };
  }

  return (
    <View style={[style, { overflow: 'hidden' }]} onLayout={(e) => { const { width, height } = e.nativeEvent.layout; if (width > 0 && height > 0) setFrame({ width, height }); }}>
      {uri && placed ? <Image source={{ uri }} style={{ position: 'absolute', ...placed }} /> : null}
      {children}
    </View>
  );
}
