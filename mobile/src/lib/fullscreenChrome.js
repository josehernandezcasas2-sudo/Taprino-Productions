import { useMemo } from 'react';
import { Platform, View, useWindowDimensions } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { absoluteFill } from './theme';

// The full-screen chrome's size and edges per device — the app's copy of
// lib/fullscreenChromeRules.js (Jose, 2026-10-30: "have the button and the
// other things fill the entire phone screen. Make sure it adjusts to the
// device type and size"). Keep the pure functions in step with the
// website's file by hand. The sizes in EpisodePlayer and ChannelPlayer
// are drawn for an iPhone 15 (a 393pt short side); a bigger phone or a
// tablet scales them by its short side, up to one and a half times.
//
// The full-screen overlay is a plain View over the whole screen, never a
// SafeAreaView: a safe-area view left a bright strip at the bottom where
// the content advisory's backdrop stopped at the home-indicator inset,
// and pushed the controls up by the same amount (Jose's screenshots,
// 2026-10-30). The insets go onto the control rows only: the top row's
// padding grows by the top inset, the bar's by the bottom one, and the
// sides keep a gutter (on iOS the 59pt side insets are dropped — the
// Dynamic Island sits at the middle of the side edge, where no control
// is; on Android a corner cutout's inset wins over the gutter).
export const BASE_SHORT_SIDE = 393;
export const MIN_SCALE = 1;
export const MAX_SCALE = 1.5;
export const GUTTER = 16;

export function chromeScale(shortSide) {
  const raw = Number(shortSide) / BASE_SHORT_SIDE;
  if (!Number.isFinite(raw) || raw <= 0) return MIN_SCALE;
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, raw));
}

export function fullscreenPadding({ platform, scale = 1, insets }) {
  const gutter = Math.round(GUTTER * scale);
  const i = insets || {};
  const side = (inset) => (platform === 'ios' ? gutter : Math.max(gutter, Math.round(Number(inset) || 0)));
  const edge = (inset) => Math.max(0, Math.round(Number(inset) || 0));
  return { gutter, left: side(i.left), right: side(i.right), top: edge(i.top), bottom: edge(i.bottom) };
}

// `s(n)` scales a point size to this device, to the nearest half point;
// `padLeft`/`padRight`/`padTop`/`padBottom` are what each control row
// adds to its own padding in full screen.
export function useFullscreenChrome() {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const scale = chromeScale(Math.min(width, height));
  const { top, bottom, left, right } = insets;
  return useMemo(() => {
    const pad = fullscreenPadding({ platform: Platform.OS, scale, insets: { top, bottom, left, right } });
    return {
      scale,
      gutter: pad.gutter,
      s: (n) => Math.round(n * scale * 2) / 2,
      padLeft: pad.left,
      padRight: pad.right,
      padTop: pad.top,
      padBottom: pad.bottom
    };
  }, [scale, top, bottom, left, right]);
}

// The full-screen overlay's frame: the whole window, with its own inset
// provider, so the insets are the ones of the window the overlay is
// drawn in — a full-screen Modal is its own window on iOS, and the root
// provider's values could lag a rotation by a frame. `children` is a
// function of the chrome: `(chrome) => …`.
function ChromeReader({ children }) {
  const chrome = useFullscreenChrome();
  return (
    <View style={absoluteFill} pointerEvents="box-none">
      {children(chrome)}
    </View>
  );
}

export function FullscreenChrome({ children }) {
  return (
    <SafeAreaProvider style={absoluteFill} pointerEvents="box-none">
      <ChromeReader>{children}</ChromeReader>
    </SafeAreaProvider>
  );
}
