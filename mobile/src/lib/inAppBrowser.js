import { Alert, AppState, Platform } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import * as ScreenOrientation from 'expo-screen-orientation';
import { APP_RETURN_PATH, readCheckoutReturn } from './appReturn';

// A page in the in-app browser that the screen waits on — Stripe Checkout
// (Own, Tip, a membership, backing, a booking, crew pay), the subscription
// portal, payout onboarding — resolving once the viewer is back in the
// app, so the screen re-reads what the page changed.
//
// Whatever plays on the screen underneath stops first: on iOS a sheet does
// not take the screen out of focus, so a title kept playing behind
// Checkout. A screen with a player listens with onBrowserOpen; what its
// listener returns (a function) runs once the browser has closed.
//
// The browser is always upright on an iPhone (Jose, 2026-11-13: a tip from
// the sideways full-screen player opened Checkout sideways and kept it so):
// the app is held to portrait while it's open and the lock it had comes
// back after. Android's browser is its own activity and follows the phone.
const ANDROID_NO_LEAVE_MS = 3000;
const openers = new Set();

export function onBrowserOpen(fn) {
  openers.add(fn);
  return () => { openers.delete(fn); };
}

function runOpeners() {
  const after = [];
  for (const fn of [...openers]) {
    try {
      const done = fn();
      if (typeof done === 'function') after.push(done);
    } catch { /* a released player */ }
  }
  return after;
}

const { OrientationLock, Orientation } = ScreenOrientation;
const RESTORABLE = new Set(Object.values(OrientationLock).filter((v) => v !== OrientationLock.OTHER && v !== OrientationLock.UNKNOWN));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Holds the app upright for the browser; answers the way back.
async function uprightForBrowser() {
  if (Platform.OS !== 'ios') return async () => {};
  let prev;
  let now;
  try {
    prev = await ScreenOrientation.getOrientationLockAsync();
    now = await ScreenOrientation.getOrientationAsync();
  } catch {
    return async () => {};
  }
  if (prev === OrientationLock.PORTRAIT_UP) return async () => {};
  await ScreenOrientation.lockAsync(OrientationLock.PORTRAIT_UP).catch(() => {});
  // The browser comes up once the screen has turned (a sheet presented
  // mid-rotation can come up sideways).
  if (now !== Orientation.PORTRAIT_UP) {
    for (let i = 0; i < 16; i += 1) {
      await sleep(50);
      const o = await ScreenOrientation.getOrientationAsync().catch(() => Orientation.PORTRAIT_UP);
      if (o === Orientation.PORTRAIT_UP) break;
    }
    await sleep(150);
  }
  return async () => {
    try {
      if (prev === OrientationLock.DEFAULT || prev === OrientationLock.ALL) await ScreenOrientation.unlockAsync();
      else if (RESTORABLE.has(prev)) await ScreenOrientation.lockAsync(prev);
    } catch { /* the screen sets its own lock on its next focus */ }
  };
}

async function aroundBrowser(open) {
  const after = runOpeners();
  const restore = await uprightForBrowser();
  try {
    return await open();
  } finally {
    await restore();
    for (const fn of after) {
      try { fn(); } catch { /* a released player */ }
    }
  }
}

// iOS: the browser is a sheet over the app and openBrowserAsync resolves
// when it is dismissed. Android: it is a Custom Tab, another activity, and
// openBrowserAsync resolves the moment it is launched, so this waits for
// the app to go to the background and come back (the same rule as
// lib/adVisit.js). If it never leaves (no browser, the tab refused) it
// carries on after ANDROID_NO_LEAVE_MS.
function openAndWait(url) {
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

export function openInAppBrowser(url) {
  return aroundBrowser(() => openAndWait(url));
}

// The app's own address for the way back (lib/appReturn.js): sent with
// the request that makes the Stripe page, so the server sends the browser
// here when the person is done.
export function appReturnAddress() {
  try { return Linking.createURL(APP_RETURN_PATH); } catch { return null; }
}

// A Stripe page that comes back to the app by itself (Jose, 2026-11-13:
// after paying, the browser stayed on the website, signed out, until he
// backed out of it page by page). The page must have been made with
// `appReturn: appReturnAddress()`; the session closes the moment the
// server sends the browser to that address. Answers
// { status: 'paid' | 'cancelled' | 'back' | 'expired' | null, kind, id }:
// null when the person closed the browser themselves (or the page never
// came back), so the screen re-reads either way.
//
// iOS: an auth session, private (no "wants to use … to sign in" prompt
// and no Safari cookies; Checkout needs none). Android: a Custom Tab that
// closes when the app's address arrives — the app coming forward can be
// noticed before the address is, so the address is also listened for
// here and read when it lands a moment later.
const NONE = { status: null, kind: null, id: null };
export async function openCheckout(url) {
  const back = appReturnAddress();
  if (!back) {
    await openInAppBrowser(url);
    return NONE;
  }
  let heard = null;
  let sub = null;
  try {
    sub = Linking.addEventListener('url', (ev) => {
      if (ev && typeof ev.url === 'string' && ev.url.startsWith(back)) heard = ev.url;
    });
  } catch { /* no listener: the session's own answer is enough */ }
  try {
    return await aroundBrowser(async () => {
      const res = await WebBrowser.openAuthSessionAsync(url, back, { preferEphemeralSession: true });
      if (res && res.type === 'success') return readCheckoutReturn(res.url) || NONE;
      if (Platform.OS === 'android' && !heard) await sleep(500);
      return (heard && readCheckoutReturn(heard)) || NONE;
    });
  } finally {
    try { if (sub) sub.remove(); } catch { /* already gone */ }
  }
}

// A word after the browser has gone: an alert asked for while the browser
// or a sheet is still closing can be swallowed with it on iOS.
export function alertWhenBack(title, body) {
  setTimeout(() => Alert.alert(title, body), 600);
}
