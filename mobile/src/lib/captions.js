import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { apiGetText, freshToken } from './api';
import { withTerms } from './viewingTerms';
import { captionTrack, parseVtt } from './vtt';

// Captions in the app's episode player (components/EpisodePlayer.js; the
// website's <track> + CC button in components/VideoPlayer.js). The track
// comes from the same gated route the website's <track> reads,
// /api/captions/<id> (lib/playbackGate.js: the video's own checks), with
// the sign-in token and the viewing-terms flag; `captionsUrl` is on the
// episode from /api/episode-page only for a viewer who may watch it. The
// file is fetched the first time captions are on for that title, never
// before, and a fetch that fails (or a file with no cue in it) just means
// no captions: the CC button goes away, nothing is said on screen.

// A track bigger than this isn't a caption file (a two-hour film's is a
// few hundred kilobytes).
const MAX_TRACK_CHARS = 4000000;

// `path` with `key=value` on its query (the preview's ?preview=1), unless
// it is there already.
export function withQueryFlag(path, key, value = '1') {
  if (!path) return path;
  const pair = `${key}=${value}`;
  if (new RegExp(`[?&]${key}=`).test(path)) return path;
  return `${path}${path.includes('?') ? '&' : '?'}${pair}`;
}

// { track, failed } for the caption file at `path` (site-relative), once
// `enabled` has been true for it. `track` is vtt.js's captionTrack, null
// until it has arrived; `failed` stays true for that path once a fetch
// failed or found no cue.
export function useCaptionTrack(path, { enabled, getToken }) {
  const [state, setState] = useState({ path: null, track: null, failed: false });
  const tokenFn = useRef(getToken);
  tokenFn.current = getToken;
  const asked = useRef(null);
  const alive = useRef(false);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      asked.current = null;
    };
  }, []);

  // Once asked, the answer is kept for the path even if captions are
  // turned off again before it arrives.
  useEffect(() => {
    if (!path || !enabled || asked.current === path) return;
    asked.current = path;
    (async () => {
      let next;
      try {
        const token = await freshToken(tokenFn.current);
        const text = await apiGetText(await withTerms(path), token);
        const cues = typeof text === 'string' && text.length <= MAX_TRACK_CHARS ? parseVtt(text) : [];
        next = { path, track: cues.length ? captionTrack(cues) : null, failed: !cues.length };
      } catch {
        next = { path, track: null, failed: true };
      }
      if (alive.current && asked.current === path) setState(next);
    })();
  }, [path, enabled]);

  if (!path || state.path !== path) return { track: null, failed: false };
  return { track: state.track, failed: state.failed };
}

// Captions on or off, remembered on the phone (SecureStore, like the
// app's other preferences; localStorage in the web preview) and shared by
// every player within a run. Off until the viewer turns them on, as on the
// website.
const PREF_KEY = 'captions_on';
let pref = null; // null = not read from the phone yet
const subscribers = new Set();

async function readPref() {
  try {
    if (Platform.OS === 'web') return window.localStorage.getItem(PREF_KEY) === '1';
    return (await SecureStore.getItemAsync(PREF_KEY)) === '1';
  } catch {
    return false;
  }
}

async function writePref(on) {
  try {
    if (Platform.OS === 'web') window.localStorage.setItem(PREF_KEY, on ? '1' : '0');
    else await SecureStore.setItemAsync(PREF_KEY, on ? '1' : '0');
  } catch {
    // The phone refused; the choice holds until the app closes.
  }
}

export function useCaptionsPref() {
  const [on, setOn] = useState(pref === true);
  useEffect(() => {
    subscribers.add(setOn);
    if (pref === null) {
      readPref().then((stored) => {
        // A tap while the phone was still answering wins.
        if (pref === null) pref = stored;
        subscribers.forEach((fn) => fn(pref));
      });
    } else {
      setOn(pref);
    }
    return () => { subscribers.delete(setOn); };
  }, []);
  const set = useCallback((next) => {
    pref = Boolean(next);
    subscribers.forEach((fn) => fn(pref));
    writePref(pref);
  }, []);
  return [on, set];
}
