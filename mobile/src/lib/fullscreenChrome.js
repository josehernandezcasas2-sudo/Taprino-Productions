import { useMemo } from 'react';
import { Platform, useWindowDimensions } from 'react-native';

// The full-screen chrome's size and gutter per device (Jose, 2026-10-30:
// "have the button and the other things fill the entire phone screen.
// Make sure it adjusts to the device type and size"). The sizes in
// EpisodePlayer and ChannelPlayer are drawn for an iPhone 15 (a 393pt
// short side); a bigger phone or a tablet scales them up by its short
// side, up to one and a half times, and a smaller phone keeps them.
// The website's touch-screen full screen does the same with vmin-based
// clamp() sizes in styles/globals.css.
export const BASE_SHORT_SIDE = 390;
export const MIN_SCALE = 1;
export const MAX_SCALE = 1.5;
export const GUTTER = 16;

export function chromeScale(shortSide) {
  const raw = Number(shortSide) / BASE_SHORT_SIDE;
  if (!Number.isFinite(raw) || raw <= 0) return MIN_SCALE;
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, raw));
}

// `s(n)` scales a point size to this device, to the nearest half point.
export function useFullscreenChrome() {
  const { width, height } = useWindowDimensions();
  const scale = chromeScale(Math.min(width, height));
  return useMemo(() => ({
    scale,
    gutter: Math.round(GUTTER * scale),
    s: (n) => Math.round(n * scale * 2) / 2
  }), [scale]);
}

// Which safe-area edges the full-screen overlay keeps clear of. The home
// indicator (bottom) always; on Android a display cutout too, since it
// can sit in a corner. On iOS the Dynamic Island sits at the middle of
// the side edge, where no control is, and the corners' rounding stays
// clear of a 44pt button at the gutter, so the chrome runs to the edges
// of the screen with just the gutter — the safe-area inset there is 59pt
// a side, which left the controls floating inside the picture.
export const FULLSCREEN_EDGES = Platform.OS === 'ios' ? ['top', 'bottom'] : ['left', 'right', 'top', 'bottom'];
