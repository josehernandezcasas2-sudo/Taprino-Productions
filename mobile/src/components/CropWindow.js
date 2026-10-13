import { useEffect, useRef, useState } from 'react';
import { Image, PanResponder, Pressable, Text, View } from 'react-native';
import { colors, fonts } from '../lib/theme';
import { parsePosition, formatPosition, visibleSlice, clampZoom, ZOOM_MIN, ZOOM_MAX } from './PositionedImage';

// Reposition mode's editor, the app's twin of the website's CropWindow
// (components/RepositionFrame.js): the whole photo letterboxed, the part
// outside the slice that will show dimmed, a bright window you drag to
// pick the slice (grab anywhere on the photo), and a zoom slider.
// `frameAspect` is the frame's width/height (1 for the avatar circle).
// Position and zoom are the same values PositionedImage draws with, so
// what you see is what shows.
//
// `onInteract(true|false)` brackets every drag (photo or slider) so the
// screen can switch its ScrollView off — otherwise the scroll view takes
// the gesture over and the whole page moves instead of the photo.
const DIM = 'rgba(12,19,31,0.72)';
const THUMB = 22;

function ZoomSlider({ zoom, onZoomChange, onInteract }) {
  const [width, setWidth] = useState(0);
  const latest = useRef({ width, onZoomChange, onInteract });
  latest.current = { width, onZoomChange, onInteract };
  const startX = useRef(0);

  const toZoom = (x) => {
    const w = latest.current.width - THUMB;
    if (w <= 0) return ZOOM_MIN;
    const t = Math.max(0, Math.min(1, (x - THUMB / 2) / w));
    return clampZoom(ZOOM_MIN + t * (ZOOM_MAX - ZOOM_MIN));
  };

  const pan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onStartShouldSetPanResponderCapture: () => true,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: (e) => {
      startX.current = e.nativeEvent.locationX;
      if (latest.current.onInteract) latest.current.onInteract(true);
      latest.current.onZoomChange(toZoom(startX.current));
    },
    onPanResponderMove: (_, g) => { latest.current.onZoomChange(toZoom(startX.current + g.dx)); },
    onPanResponderRelease: () => { if (latest.current.onInteract) latest.current.onInteract(false); },
    onPanResponderTerminate: () => { if (latest.current.onInteract) latest.current.onInteract(false); }
  })).current;

  const t = (clampZoom(zoom) - ZOOM_MIN) / (ZOOM_MAX - ZOOM_MIN);
  const thumbLeft = t * Math.max(0, width - THUMB);
  return (
    <View
      {...pan.panHandlers}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      style={{ flex: 1, height: 36, justifyContent: 'center' }}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel="Zoom"
      accessibilityValue={{ text: `${clampZoom(zoom).toFixed(1)} times` }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) => onZoomChange(clampZoom(clampZoom(zoom) + (e.nativeEvent.actionName === 'increment' ? 0.1 : -0.1)))}
    >
      <View pointerEvents="none" style={{ height: 4, borderRadius: 2, backgroundColor: 'rgba(251,232,211,0.18)', marginHorizontal: THUMB / 2 }}>
        <View style={{ width: `${t * 100}%`, height: 4, borderRadius: 2, backgroundColor: colors.olive }} />
      </View>
      <View pointerEvents="none" style={{ position: 'absolute', left: thumbLeft, width: THUMB, height: THUMB, borderRadius: THUMB / 2, backgroundColor: colors.olive, borderWidth: 3, borderColor: colors.surface1 }} />
    </View>
  );
}

export default function CropWindow({ uri, position, zoom = 1, onChange, onZoomChange, onInteract, frameAspect = 3, round = false, height = 220 }) {
  const [area, setArea] = useState(null);
  const [img, setImg] = useState(null);
  const latest = useRef({ position, onChange, onInteract, layout: null });

  useEffect(() => {
    if (!uri) return undefined;
    let cancelled = false;
    Image.getSize(uri, (w, h) => { if (!cancelled) setImg({ w, h }); }, () => {});
    return () => { cancelled = true; };
  }, [uri]);

  let layout = null;
  if (area && img) {
    const c = Math.min(area.width / img.w, area.height / img.h);
    const rw = img.w * c;
    const rh = img.h * c;
    const ox = (area.width - rw) / 2;
    const oy = (area.height - rh) / 2;
    const slice = visibleSlice(img, frameAspect, position, zoom);
    layout = {
      image: { left: ox, top: oy, width: rw, height: rh },
      win: { left: ox + slice.left * c, top: oy + slice.top * c, width: slice.w * c, height: slice.h * c },
      travelX: (img.w - slice.w) * c,
      travelY: (img.h - slice.h) * c
    };
  }
  latest.current = { position, onChange, onInteract, layout };

  // The whole photo area is the handle: grabbing outside the window still
  // moves it, which is much easier with a thumb than hitting a thin box.
  const start = useRef({ x: 50, y: 50 });
  const done = () => { if (latest.current.onInteract) latest.current.onInteract(false); };
  const pan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onStartShouldSetPanResponderCapture: () => true,
    onMoveShouldSetPanResponderCapture: () => true,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: () => {
      start.current = parsePosition(latest.current.position);
      if (latest.current.onInteract) latest.current.onInteract(true);
    },
    onPanResponderMove: (_, g) => {
      const l = latest.current.layout;
      if (!l) return;
      latest.current.onChange(formatPosition({
        x: l.travelX > 0 ? start.current.x + (g.dx / l.travelX) * 100 : start.current.x,
        y: l.travelY > 0 ? start.current.y + (g.dy / l.travelY) * 100 : start.current.y
      }));
    },
    onPanResponderRelease: done,
    onPanResponderTerminate: done
  })).current;

  const z = clampZoom(zoom);
  return (
    <View>
      <View
        {...pan.panHandlers}
        style={{ height, borderRadius: 10, overflow: 'hidden', backgroundColor: colors.surface0, borderWidth: 1, borderColor: 'rgba(251,232,211,0.12)', marginBottom: 10 }}
        onLayout={(e) => { const { width, height: h } = e.nativeEvent.layout; if (width > 0 && h > 0) setArea({ width, height: h }); }}
      >
        {layout ? (
          <>
            <Image source={{ uri }} style={{ position: 'absolute', ...layout.image }} />
            {/* Four dim panels around the window (RN has no box-shadow spread). */}
            <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 0, height: layout.win.top, backgroundColor: DIM }} />
            <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: layout.win.top + layout.win.height, bottom: 0, backgroundColor: DIM }} />
            <View pointerEvents="none" style={{ position: 'absolute', left: 0, width: layout.win.left, top: layout.win.top, height: layout.win.height, backgroundColor: DIM }} />
            <View pointerEvents="none" style={{ position: 'absolute', left: layout.win.left + layout.win.width, right: 0, top: layout.win.top, height: layout.win.height, backgroundColor: DIM }} />
            <View pointerEvents="none" style={{ position: 'absolute', ...layout.win, borderWidth: 2, borderColor: 'rgba(251,232,211,0.95)' }}>
              {round ? <View style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, borderRadius: 999, borderWidth: 1, borderStyle: 'dashed', borderColor: 'rgba(251,232,211,0.8)' }} /> : null}
            </View>
          </>
        ) : (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><Text style={{ fontFamily: fonts.mono, fontSize: 12, color: colors.inkFaint }}>Loading photo…</Text></View>
        )}
      </View>
      {onZoomChange ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <Text style={{ fontFamily: fonts.mono, fontSize: 12, color: colors.inkFaint }}>Zoom</Text>
          <ZoomSlider zoom={z} onZoomChange={onZoomChange} onInteract={onInteract} />
          <Text style={{ fontFamily: fonts.mono, fontSize: 12, color: colors.inkDim, minWidth: 34, textAlign: 'right' }}>{z.toFixed(1)}×</Text>
          {z > 1 ? <Pressable onPress={() => onZoomChange(1)} hitSlop={8}><Text style={{ fontFamily: fonts.mono, fontSize: 12, color: colors.olive, textDecorationLine: 'underline' }}>Reset</Text></Pressable> : null}
        </View>
      ) : null}
    </View>
  );
}
