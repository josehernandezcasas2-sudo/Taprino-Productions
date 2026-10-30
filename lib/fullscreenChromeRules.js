// The app's full-screen chrome: how much it grows with the device and
// how far each control row sits from the screen's edges (Jose,
// 2026-10-30: "have the button and the other things fill the entire
// phone screen. Make sure it adjusts to the device type and size", then,
// from two screenshots, the bright strip at the bottom where the
// overlay stopped at the home-indicator inset). Pure and client-safe;
// mobile/src/lib/fullscreenChrome.js mirrors it and adds the hook. The
// website's touch-screen full screen scales its sizes with vmin-based
// clamp() rules in styles/globals.css instead.
//
// The sizes in the players are drawn for an iPhone 15 (a 393pt short
// side, scale exactly 1); a bigger phone or a tablet scales them by its
// short side, up to one and a half times, and a smaller phone keeps them.
export const BASE_SHORT_SIDE = 393;
export const MIN_SCALE = 1;
export const MAX_SCALE = 1.5;
// The distance from the screen's side edge to the first control.
export const GUTTER = 16;

export function chromeScale(shortSide) {
  const raw = Number(shortSide) / BASE_SHORT_SIDE;
  if (!Number.isFinite(raw) || raw <= 0) return MIN_SCALE;
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, raw));
}

// Where the control rows sit. The full-screen overlay itself covers the
// whole screen (so the content advisory, the lock cards and every
// backdrop run edge to edge); only the rows keep clear of the edges:
// the top row by the top inset (0 sideways, the notch upright), the bar
// by the bottom inset (the home indicator), and the sides by the gutter.
// On iOS the side insets (59pt each on a notched phone) are dropped: the
// Dynamic Island sits at the middle of the side edge, where no control
// is, and the corners' rounding stays clear of a 44pt button at the
// gutter; keeping them left the controls floating inside the picture.
// On Android a display cutout can sit in a corner, so a side inset wins
// over the gutter when it is bigger.
export function fullscreenPadding({ platform, scale = 1, insets }) {
  const gutter = Math.round(GUTTER * scale);
  const i = insets || {};
  const side = (inset) => (platform === 'ios' ? gutter : Math.max(gutter, Math.round(Number(inset) || 0)));
  const edge = (inset) => Math.max(0, Math.round(Number(inset) || 0));
  return { gutter, left: side(i.left), right: side(i.right), top: edge(i.top), bottom: edge(i.bottom) };
}
