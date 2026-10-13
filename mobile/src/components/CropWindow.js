import { useEffect, useRef, useState } from 'react';
import { Image, PanResponder, Text, View } from 'react-native';
import { colors, fonts } from '../lib/theme';
import { parsePosition, formatPosition } from './PositionedImage';

// Reposition mode's editor, the app's twin of the website's CropWindow
// (components/RepositionFrame.js): the whole photo letterboxed, the part
// outside the slice that will show dimmed, and a bright window you drag
// to pick the slice. `frameAspect` is the frame's width/height (1 for
// the avatar circle). The position string is the same one
// PositionedImage draws with, so what you see here is what shows.
function visibleSlice(img, frameAspect, position) {
  const { x, y } = parsePosition(position);
  let w = img.w;
  let h = img.w / frameAspect;
  if (h > img.h) { h = img.h; w = img.h * frameAspect; }
  return { w, h, left: (img.w - w) * (x / 100), top: (img.h - h) * (y / 100) };
}

const DIM = 'rgba(12,19,31,0.72)';

export default function CropWindow({ uri, position, onChange, frameAspect = 3, round = false, height = 220 }) {
  const [area, setArea] = useState(null);
  const [img, setImg] = useState(null);
  const latest = useRef({ position, onChange, layout: null });

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
    const slice = visibleSlice(img, frameAspect, position);
    layout = {
      image: { left: ox, top: oy, width: rw, height: rh },
      win: { left: ox + slice.left * c, top: oy + slice.top * c, width: slice.w * c, height: slice.h * c },
      travelX: (img.w - slice.w) * c,
      travelY: (img.h - slice.h) * c
    };
  }
  latest.current = { position, onChange, layout };

  const start = useRef({ x: 50, y: 50 });
  const pan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: () => { start.current = parsePosition(latest.current.position); },
    onPanResponderMove: (_, g) => {
      const l = latest.current.layout;
      if (!l) return;
      latest.current.onChange(formatPosition({
        x: l.travelX > 0 ? start.current.x + (g.dx / l.travelX) * 100 : start.current.x,
        y: l.travelY > 0 ? start.current.y + (g.dy / l.travelY) * 100 : start.current.y
      }));
    }
  })).current;

  return (
    <View
      style={{ height, borderRadius: 10, overflow: 'hidden', backgroundColor: colors.surface0, borderWidth: 1, borderColor: 'rgba(251,232,211,0.12)', marginBottom: 12 }}
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
          <View {...pan.panHandlers} style={{ position: 'absolute', ...layout.win, borderWidth: 2, borderColor: 'rgba(251,232,211,0.95)' }}>
            {round ? <View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, borderRadius: 999, borderWidth: 1, borderStyle: 'dashed', borderColor: 'rgba(251,232,211,0.8)' }} /> : null}
          </View>
        </>
      ) : (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><Text style={{ fontFamily: fonts.mono, fontSize: 12, color: colors.inkFaint }}>Loading photo…</Text></View>
      )}
    </View>
  );
}
