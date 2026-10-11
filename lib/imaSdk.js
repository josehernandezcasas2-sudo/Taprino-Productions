import { useEffect } from 'react';

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

export function useImaSdk(enabled) {
  useEffect(() => {
    if (enabled) loadImaSdk();
  }, [enabled]);
}
