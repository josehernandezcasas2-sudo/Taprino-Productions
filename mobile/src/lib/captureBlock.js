import { useCallback, useEffect, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import * as ScreenCapture from 'expo-screen-capture';
import { loadSettings } from '../components/TopNav';

// Screenshots and screen recording are off while a creator's work is
// playing (Jose, 2026-10-25: a home whose work is not harvested). Android
// sets FLAG_SECURE on the window, so a capture comes out black and the
// app is blurred in the recents screen; iOS blanks a recording and, since
// expo-screen-capture 5, covers screenshots too. Honest scope: this stops
// the phone's own tools, not a camera pointed at the screen, and Android
// fullscreen playback in expo-video runs in its own activity, which the
// flag does not reach.
//
// One flag for the whole app: every playing screen holds a reference,
// the block is on while any screen in focus holds one. The server can
// switch it off for everyone (`captureBlock: false` from
// /api/site-settings, SCREEN_CAPTURE_BLOCK=off in Vercel) in case the
// block misbehaves on some phone.
const KEY = 'playback';
let holders = 0;
let serverAllows = true;
let settingsAsked = false;
let applied = false;

function apply() {
  const want = holders > 0 && serverAllows;
  if (want === applied) return;
  applied = want;
  const call = want ? ScreenCapture.preventScreenCaptureAsync(KEY) : ScreenCapture.allowScreenCaptureAsync(KEY);
  Promise.resolve(call).catch(() => {});
}

function askServer() {
  if (settingsAsked) return;
  settingsAsked = true;
  loadSettings()
    .then((settings) => {
      if (settings && settings.captureBlock === false) {
        serverAllows = false;
        apply();
      }
    })
    .catch(() => {});
}

// `active`: true while this screen is actually playing something worth
// covering. The block follows the screen's focus too, so a screen left
// mounted underneath another in the stack does not keep it on.
export function useCaptureBlock(active) {
  const [focused, setFocused] = useState(false);
  useFocusEffect(useCallback(() => {
    setFocused(true);
    return () => setFocused(false);
  }, []));
  useEffect(() => {
    if (!active || !focused) return undefined;
    holders += 1;
    askServer();
    apply();
    return () => {
      holders = Math.max(0, holders - 1);
      apply();
    };
  }, [active, focused]);
}
