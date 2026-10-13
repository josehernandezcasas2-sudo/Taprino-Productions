import { useEffect, useRef, useState } from 'react';
import { Image, PanResponder, Text, View } from 'react-native';
import { colors, fonts } from '../lib/theme';

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

// The same frame, draggable: the account screen's Reposition mode. A
// full drag across the frame sweeps the whole 0–100 range; pulling the
// photo down means a smaller y%, so the deltas are inverted. Claims the
// touch so the ScrollView around it doesn't scroll instead.
export function RepositionFrame({ uri, position, onChange, active, style, label = 'Drag to reposition', children }) {
  const start = useRef({ x: 50, y: 50 });
  const frameRef = useRef({ width: 1, height: 1 });
  const latest = useRef({ position, onChange, active });
  latest.current = { position, onChange, active };

  const pan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => Boolean(latest.current.active),
    onMoveShouldSetPanResponder: () => Boolean(latest.current.active),
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: () => { start.current = parsePosition(latest.current.position); },
    onPanResponderMove: (_, g) => {
      const f = frameRef.current;
      latest.current.onChange(formatPosition({
        x: start.current.x - (g.dx / f.width) * 100,
        y: start.current.y - (g.dy / f.height) * 100
      }));
    }
  })).current;

  return (
    <View
      {...(active ? pan.panHandlers : {})}
      style={[style, active && { borderColor: colors.olive, borderWidth: 2 }]}
      onLayout={(e) => { frameRef.current = e.nativeEvent.layout; }}
    >
      <PositionedImage uri={uri} position={position} style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }} />
      {active && uri ? (
        <View style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }} pointerEvents="none">
          <Text style={{ fontFamily: fonts.mono, fontSize: 11.5, letterSpacing: 0.8, textTransform: 'uppercase', color: colors.ink, backgroundColor: 'rgba(12,19,31,0.72)', borderWidth: 1, borderColor: 'rgba(251,232,211,0.25)', paddingVertical: 5, paddingHorizontal: 10, borderRadius: 999, overflow: 'hidden' }}>✥ {label}</Text>
        </View>
      ) : null}
      {children}
    </View>
  );
}
