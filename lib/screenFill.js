// Filling the screen in full screen (Jose, 2026-10-30, from two app
// screenshots: "I noticed there's a gap, can we fix that?" — the black
// band each side of a 16:9 picture on a 19.5:9 phone). Pure and
// client-safe; mobile/src/lib/screenFill.js mirrors it and adds the hook.
//
// The rule: in full screen the picture fills the screen when doing so
// crops only a little of it, and shows whole (with bars) otherwise. A
// 16:9 title on a notched iPhone (about 19.5:9) loses 18% of its height
// to fill, 9% off the top and 9% off the bottom, which is the "zoom to
// fill" every streaming app offers; a 4:3 or vertical picture would lose
// far more, so it keeps its bars. An iPad (4:3) would crop 25% of a 16:9
// picture's width, so it keeps the bars too. A double tap on the video
// switches between the two for that playback, whatever the rule said.
export const MAX_AUTO_CROP = 0.2;
export const FILL_LABEL = 'Filling the screen';
export const FIT_LABEL = 'Whole picture';

// The fraction of the picture lost when it is scaled to cover the screen:
// 0 when the two shapes match, null when either size is unknown.
export function cropFraction(videoW, videoH, screenW, screenH) {
  const v = Number(videoW) / Number(videoH);
  const s = Number(screenW) / Number(screenH);
  if (!(v > 0) || !(s > 0) || !Number.isFinite(v) || !Number.isFinite(s)) return null;
  return 1 - Math.min(v, s) / Math.max(v, s);
}

export function fillsByDefault(crop) {
  return crop != null && crop <= MAX_AUTO_CROP;
}

// `choice` is the viewer's double tap (true = fill, false = whole picture);
// anything else leaves it to the rule. Unknown sizes never fill.
export function screenFill({ videoW, videoH, screenW, screenH, choice }) {
  if (choice === true || choice === false) return choice;
  return fillsByDefault(cropFraction(videoW, videoH, screenW, screenH));
}
