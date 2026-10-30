import { useCallback, useEffect, useState } from 'react';
import { useWindowDimensions } from 'react-native';

// Filling the screen in full screen — the app's copy of lib/screenFill.js
// (Jose, 2026-10-30: "I noticed there's a gap, can we fix that?" — the
// black band each side of a 16:9 picture on a 19.5:9 phone). The pure
// rule is the same as the website's; keep the two in step by hand. The
// hook reads the playing video's size from expo-video (the `sourceLoad`
// and `videoTrackChange` events, `player.videoTrack` once playing) and
// answers whether the full-screen VideoView should `cover` the screen or
// `contain` the picture. Until the size is known the picture shows whole.
export const MAX_AUTO_CROP = 0.2;
export const FILL_LABEL = 'Filling the screen';
export const FIT_LABEL = 'Whole picture';

export function cropFraction(videoW, videoH, screenW, screenH) {
  const v = Number(videoW) / Number(videoH);
  const s = Number(screenW) / Number(screenH);
  if (!(v > 0) || !(s > 0) || !Number.isFinite(v) || !Number.isFinite(s)) return null;
  return 1 - Math.min(v, s) / Math.max(v, s);
}

export function fillsByDefault(crop) {
  return crop != null && crop <= MAX_AUTO_CROP;
}

export function screenFill({ videoW, videoH, screenW, screenH, choice }) {
  if (choice === true || choice === false) return choice;
  return fillsByDefault(cropFraction(videoW, videoH, screenW, screenH));
}

const trackSize = (track) => (track && track.size && track.size.width > 0 && track.size.height > 0 ? { width: track.size.width, height: track.size.height } : null);

// `fill` for the full-screen VideoView (`contentFit` cover or contain),
// `toggle` for a double tap (the choice lasts for this source), `known`
// once the video's size has arrived. Full screen is always sideways, so
// the screen is measured as landscape whatever the window says now.
export function useScreenFill(player) {
  const { width, height } = useWindowDimensions();
  const [size, setSize] = useState(() => trackSize(player && player.videoTrack));
  const [choice, setChoice] = useState(null);

  useEffect(() => {
    if (!player) return undefined;
    setSize(trackSize(player.videoTrack));
    setChoice(null);
    const loaded = player.addListener('sourceLoad', ({ availableVideoTracks }) => {
      const first = Array.isArray(availableVideoTracks) ? availableVideoTracks.map(trackSize).find(Boolean) : null;
      if (first) setSize(first);
    });
    const changed = player.addListener('videoTrackChange', ({ videoTrack }) => {
      const s = trackSize(videoTrack);
      if (s) setSize(s);
    });
    return () => { loaded.remove(); changed.remove(); };
  }, [player]);

  const screenW = Math.max(width, height);
  const screenH = Math.min(width, height);
  const fill = size ? screenFill({ videoW: size.width, videoH: size.height, screenW, screenH, choice }) : false;
  const toggle = useCallback(() => setChoice(!fill), [fill]);
  return { fill, toggle, known: size != null };
}
