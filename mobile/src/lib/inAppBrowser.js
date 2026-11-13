import { AppState, Platform } from 'react-native';
import * as WebBrowser from 'expo-web-browser';

// A page in the in-app browser that the screen waits on — Stripe Checkout
// (Own, Tip, a membership), the subscription portal — resolving once the
// viewer is back in the app, so the screen re-reads what the page changed.
//
// iOS: the browser is a sheet over the app and openBrowserAsync resolves
// when it is dismissed. Android: it is a Custom Tab, another activity, and
// openBrowserAsync resolves the moment it is launched, so this waits for
// the app to go to the background and come back (the same rule as
// lib/adVisit.js). If it never leaves (no browser, the tab refused) it
// carries on after ANDROID_NO_LEAVE_MS.
//
// Whatever plays on the screen underneath stops first: on iOS a sheet does
// not take the screen out of focus, so a title kept playing behind
// Checkout. A screen with a player listens with onBrowserOpen.
const ANDROID_NO_LEAVE_MS = 3000;
const openers = new Set();

export function onBrowserOpen(fn) {
  openers.add(fn);
  return () => { openers.delete(fn); };
}

export function openInAppBrowser(url) {
  for (const fn of [...openers]) {
    try { fn(); } catch { /* a released player */ }
  }
  if (Platform.OS !== 'android') return WebBrowser.openBrowserAsync(url);
  return new Promise((resolve, reject) => {
    let left = false;
    let finished = false;
    let fallback = null;
    let sub = null;
    const finish = (err) => {
      if (finished) return;
      finished = true;
      if (fallback) clearTimeout(fallback);
      try { if (sub) sub.remove(); } catch { /* already gone */ }
      if (err) reject(err); else resolve({ type: 'closed' });
    };
    // Listening before the tab opens: the app can go to the background
    // before openBrowserAsync answers.
    sub = AppState.addEventListener('change', (st) => {
      if (st === 'background') left = true;
      else if (st === 'active' && left) finish();
    });
    WebBrowser.openBrowserAsync(url).then(() => {
      if (!left) fallback = setTimeout(() => { if (!left) finish(); }, ANDROID_NO_LEAVE_MS);
    }, (err) => finish(err));
  });
}
