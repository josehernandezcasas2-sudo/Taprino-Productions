import { useEffect, useState } from 'react';

// Google's IMA SDK (serves the pre-roll and break ads). It used to load on
// every page of the site through pages/_app.js; now a player asks for it
// when it mounts, and only when this viewer can actually get ads. The SDK
// needs the play click itself to initialise, so it has to be on the page
// before the click — hence "on mount", not "on play".
const IMA_SRC = 'https://imasdk.googleapis.com/js/sdkloader/ima3.js';
let pending = null;

export function loadImaSdk() {
  if (typeof window === 'undefined') return Promise.resolve(false);
  if (window.google && window.google.ima) return Promise.resolve(true);
  if (!pending) {
    pending = new Promise((resolve) => {
      const existing = document.querySelector(`script[src="${IMA_SRC}"]`);
      const script = existing || document.createElement('script');
      script.addEventListener('load', () => resolve(Boolean(window.google && window.google.ima)));
      script.addEventListener('error', () => {
        pending = null; // let a later player try again
        // …with a script of its own: a failed one left on the page fires
        // neither event again, so the next player's wait never ended.
        script.remove();
        resolve(false);
      });
      if (!existing) {
        script.src = IMA_SRC;
        script.async = true;
        document.head.appendChild(script);
      }
    });
  }
  return pending;
}

// → true once the SDK is on the page (false while it loads, when it
// can't load — an ad blocker — or when `enabled` is off), so a player can
// say "Starts with a short ad" only when an ad will really be asked for.
export function useImaSdk(enabled) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!enabled) {
      setReady(false);
      return undefined;
    }
    let live = true;
    loadImaSdk().then((ok) => { if (live) setReady(Boolean(ok)); });
    return () => { live = false; };
  }, [enabled]);
  return ready;
}
