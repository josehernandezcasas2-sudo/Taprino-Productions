import { WEB_PUSH_ROUTES, needsHomeScreenFirst, browserPushState } from './webPushRules';

// BROWSER-ONLY. This browser's notifications (2026-11-12; the server side
// is lib/webPush.js, the rules lib/webPushRules.js): what Account →
// Preferences shows and does, the quiet refresh on a signed-in visit, and
// the unsubscribe on sign-out (pages/_app.js). The browser is asked only
// after a click on the switch, never on page load.

export function pushSupported() {
  return typeof window !== 'undefined'
    && 'serviceWorker' in navigator
    && 'PushManager' in window
    && 'Notification' in window;
}

function standalone() {
  try {
    return window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
  } catch (e) {
    return false;
  }
}

export function homeScreenFirst() {
  if (typeof window === 'undefined') return false;
  return needsHomeScreenFirst({ userAgent: navigator.userAgent, standalone: standalone(), maxTouchPoints: navigator.maxTouchPoints || 0 });
}

function keyBytes(base64url) {
  const s = String(base64url || '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = s + '='.repeat((4 - (s.length % 4)) % 4);
  const raw = window.atob(padded);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

function sameKey(subscription, publicKey) {
  try {
    const current = subscription && subscription.options && subscription.options.applicationServerKey;
    if (!current) return true; // the browser doesn't say; assume it matches
    const a = new Uint8Array(current);
    const b = keyBytes(publicKey);
    return a.length === b.length && a.every((v, i) => v === b[i]);
  } catch (e) {
    return true;
  }
}

// The site's service worker (public/sw.js). In production pages/_app.js
// registers it on every visit; in development it is registered only here,
// with ?nofetch=1 so it shows notifications without caching anything.
async function registration({ register = false } = {}) {
  if (!('serviceWorker' in navigator)) return null;
  let reg = await navigator.serviceWorker.getRegistration('/');
  if (!reg && register) {
    reg = await navigator.serviceWorker.register(process.env.NODE_ENV === 'production' ? '/sw.js' : '/sw.js?nofetch=1');
  }
  if (!reg) return null;
  if (register && !reg.active) {
    await Promise.race([navigator.serviceWorker.ready, new Promise((resolve) => setTimeout(resolve, 8000))]);
    reg = (await navigator.serviceWorker.getRegistration('/')) || reg;
  }
  return reg;
}

async function currentSubscription() {
  try {
    const reg = await registration();
    return reg && reg.pushManager ? await reg.pushManager.getSubscription() : null;
  } catch (e) {
    return null;
  }
}

async function postJson(url, body, { keepalive = false } = {}) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), keepalive, credentials: 'same-origin' });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

// The server's side: { ready, publicKey, migrationReady }.
export async function fetchPushStatus() {
  const res = await fetch(WEB_PUSH_ROUTES.key, { credentials: 'same-origin', cache: 'no-store' });
  if (!res.ok) throw new Error('Couldn’t read the notification settings.');
  return res.json();
}

// Tell the server about the subscription this browser holds. 'on', or
// the state that explains why not.
async function saveSubscription(subscription) {
  const { ok, status, data } = await postJson(WEB_PUSH_ROUTES.subscribe, subscription.toJSON());
  if (ok) return { state: 'on' };
  if (status === 503 && data && data.code === 'migration-122') return { state: 'migration' };
  if (status === 503 && data && data.code === 'not-set-up') return { state: 'not-set-up' };
  return { state: 'off', error: (data && data.error) || 'Couldn’t turn notifications on. Try again.' };
}

// What the row shows when the page opens. A subscription this browser
// already holds is sent again, so "on" is what the server has too (and a
// row the server had disabled comes back). Nothing here asks the browser
// for permission.
export async function readPushState(status) {
  const permission = pushSupported() ? Notification.permission : 'default';
  let state = browserPushState({
    needsHomeScreen: homeScreenFirst(),
    supported: pushSupported(),
    serverReady: Boolean(status && status.ready),
    migrationReady: !status || status.migrationReady !== false,
    permission,
    subscribed: false
  });
  if (state !== 'off' || permission !== 'granted') return { state };
  const sub = await currentSubscription();
  if (!sub || !sameKey(sub, status.publicKey)) return { state: 'off' };
  const saved = await saveSubscription(sub).catch(() => ({ state: 'off' }));
  state = saved.state;
  return { state };
}

// The switch turned on: ask the browser (this must run straight from the
// click), subscribe with the site's key, and tell the server.
export async function turnOnPush(status) {
  if (!pushSupported()) return { state: 'unsupported' };
  const permission = await Notification.requestPermission();
  if (permission === 'denied') return { state: 'blocked' };
  if (permission !== 'granted') return { state: 'off' };
  const reg = await registration({ register: true });
  if (!reg || !reg.pushManager) return { state: 'off', error: 'This browser couldn’t start notifications. Reload the page and try again.' };
  let sub = await reg.pushManager.getSubscription();
  // Subscribed with an older key (the site's keys were changed): start over.
  if (sub && !sameKey(sub, status.publicKey)) {
    await sub.unsubscribe().catch(() => {});
    sub = null;
  }
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(status.publicKey) });
  return saveSubscription(sub);
}

// The switch turned off, or sign-out: tell the server, then drop the
// browser's subscription. Never throws.
export async function turnOffPush({ reason = 'switched-off' } = {}) {
  try {
    const sub = await currentSubscription();
    if (!sub) return { state: 'off' };
    await postJson(WEB_PUSH_ROUTES.unsubscribe, { endpoint: sub.endpoint, reason }, { keepalive: true }).catch(() => {});
    await sub.unsubscribe().catch(() => {});
  } catch (e) {
    // Nothing more this browser can do.
  }
  return { state: 'off' };
}

// A signed-in visit (pages/_app.js): when this browser already sends
// notifications, tell the server once a day that it's still here, so the
// row stays bound to whoever is signed in now. Does nothing for anyone who
// never turned them on; never asks for permission.
const REFRESH_KEY = 'tapa_web_push_seen';
export async function refreshPushQuietly() {
  try {
    if (!pushSupported() || Notification.permission !== 'granted') return;
    const sub = await currentSubscription();
    if (!sub) return;
    let last = 0;
    try {
      last = Number(window.localStorage.getItem(REFRESH_KEY) || 0);
    } catch (e) {
      last = 0;
    }
    if (Date.now() - last < 24 * 60 * 60 * 1000) return;
    // Only a subscription made with the site's current key is worth
    // keeping (after a key change the browser has to be asked again, on
    // Account → Preferences).
    const status = await fetchPushStatus();
    if (!status.ready || status.migrationReady === false || !sameKey(sub, status.publicKey)) return;
    const { ok } = await postJson(WEB_PUSH_ROUTES.subscribe, sub.toJSON());
    if (ok) {
      try {
        window.localStorage.setItem(REFRESH_KEY, String(Date.now()));
      } catch (e) {
        // A browser without storage just refreshes on the next visit.
      }
    }
  } catch (e) {
    // A refresh is a nicety.
  }
}

// A signed-out visit: a subscription still held here belongs to a session
// that ended (a sign-out the page couldn't finish telling the server
// about, or one that ran out), so it is dropped the same way.
export async function dropPushWhenSignedOut() {
  try {
    if (!pushSupported() || Notification.permission !== 'granted') return;
    if (await currentSubscription()) await turnOffPush({ reason: 'signed-out' });
  } catch (e) {
    // Nothing more this browser can do.
  }
}

export function forgetPushRefresh() {
  try {
    window.localStorage.removeItem(REFRESH_KEY);
  } catch (e) {
    // Nothing kept.
  }
}
