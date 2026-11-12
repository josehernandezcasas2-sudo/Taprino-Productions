// Web push: notifications on the website (Jose, 2026-11-12: "lets also add
// the web push notifications"; migration 122's web_push_subscriptions).
// The app already gets every notification through Expo (lib/push.js); this
// is the browser's half. Pure, client-safe and import-free: the routes, the
// sender (lib/webPush.js), Account → Preferences and the tests read it.
// Tested by scripts/test-web-push.mjs.

export const WEB_PUSH_ROUTES = {
  key: '/api/push/web-key',
  subscribe: '/api/push/web-subscribe',
  unsubscribe: '/api/push/web-unsubscribe'
};

// A notification waits at the push service for a day at most.
export const WEB_PUSH_TTL_SECONDS = 24 * 60 * 60;
// Browsers per account that receive notifications; a newer one retires the
// least recently seen.
export const MAX_LIVE_BROWSERS = 10;

const B64URL = /^[A-Za-z0-9_-]+$/;

// How many bytes a base64url string (padding allowed) decodes to, or -1.
export function base64urlBytes(value) {
  const s = typeof value === 'string' ? value.replace(/=+$/, '') : '';
  if (!s || !B64URL.test(s) || s.length % 4 === 1) return -1;
  return Math.floor((s.length * 3) / 4);
}

// The keys from Vercel (WEB_PUSH_PUBLIC_KEY, WEB_PUSH_PRIVATE_KEY, both
// base64url as `node scripts/make-vapid-keys.mjs` prints them, and
// WEB_PUSH_SUBJECT, a mailto: or https: contact). Without a usable pair web
// push is off everywhere and the pages say it isn't set up yet.
export function webPushConfig(env = {}, { contactEmail = '' } = {}) {
  const clean = (v) => String(v == null ? '' : v).trim().replace(/=+$/, '');
  const publicKey = clean(env.WEB_PUSH_PUBLIC_KEY);
  const privateKey = clean(env.WEB_PUSH_PRIVATE_KEY);
  const rawSubject = String(env.WEB_PUSH_SUBJECT == null ? '' : env.WEB_PUSH_SUBJECT).trim();
  const subject = rawSubject || (contactEmail ? `mailto:${contactEmail}` : '');
  // An uncompressed P-256 point is 65 bytes starting 0x04 ("B" in base64url).
  const publicOk = base64urlBytes(publicKey) === 65 && publicKey.startsWith('B');
  const privateOk = base64urlBytes(privateKey) === 32;
  const subjectOk = /^mailto:[^\s@]+@[^\s@]+$/i.test(subject) || /^https:\/\/\S+$/i.test(subject);
  const ready = publicOk && privateOk && subjectOk;
  return {
    ready,
    // Some of it set but not usable: the admin key list says "half set".
    partly: !ready && Boolean(publicKey || privateKey),
    publicKey: ready ? publicKey : null,
    privateKey: ready ? privateKey : null,
    subject: ready ? subject : null
  };
}

// The push services browsers use (Chrome, Edge, Firefox, Safari; Opera,
// Brave and Samsung Internet go through Google's). An endpoint anywhere
// else is refused, so the server never sends a request somewhere a
// browser didn't send it. `testOrigin` is the rig's stand-in, passed only
// outside production (lib/webPush.js).
const PUSH_HOSTS = ['fcm.googleapis.com', 'android.googleapis.com', 'updates.push.services.mozilla.com', 'web.push.apple.com'];
const PUSH_HOST_SUFFIXES = ['.notify.windows.com', '.push.apple.com', '.push.services.mozilla.com'];

export function allowedPushEndpoint(endpoint, { testOrigin = null } = {}) {
  if (typeof endpoint !== 'string' || !endpoint || endpoint.length > 1024) return false;
  let u;
  try {
    u = new URL(endpoint);
  } catch (e) {
    return false;
  }
  if (u.username || u.password) return false;
  if (testOrigin && u.origin === testOrigin) return true;
  if (u.protocol !== 'https:' || (u.port && u.port !== '443')) return false;
  const host = u.hostname.toLowerCase();
  return PUSH_HOSTS.includes(host) || PUSH_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix) && host.length > suffix.length);
}

// The browser's PushSubscription JSON → { endpoint, p256dh, auth }, or
// { error } with the line the person reads.
export function normalizeSubscription(raw, opts = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: 'Send this browser’s subscription.' };
  const endpoint = typeof raw.endpoint === 'string' ? raw.endpoint.trim() : '';
  if (!allowedPushEndpoint(endpoint, opts)) return { error: 'That isn’t a push service this site sends through.' };
  const keys = raw.keys && typeof raw.keys === 'object' ? raw.keys : {};
  const p256dh = typeof keys.p256dh === 'string' ? keys.p256dh.trim().replace(/=+$/, '') : '';
  const auth = typeof keys.auth === 'string' ? keys.auth.trim().replace(/=+$/, '') : '';
  if (base64urlBytes(p256dh) !== 65 || !p256dh.startsWith('B')) return { error: 'This browser’s subscription is missing its key.' };
  if (base64urlBytes(auth) !== 16) return { error: 'This browser’s subscription is missing its key.' };
  return { endpoint, p256dh, auth };
}

// Where a tap goes: a path on this site, nothing else (the same href the
// bell opens; lib/notify.js). Null for anything that could leave the site.
export function safePushHref(href) {
  if (typeof href !== 'string') return null;
  const h = href.trim();
  if (!h.startsWith('/') || h.startsWith('//') || h.length > 500) return null;
  if (/[\\\u0000-\u001f\u007f]/.test(h)) return null;
  return h;
}

const clip = (value, max) => {
  const s = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
};

// What the service worker (public/sw.js) gets: { title, body, href, tag }.
// The tag collapses repeats: a busy conversation shows one notification
// that updates, not a stack.
export function webPushPayload({ title, body, href, type } = {}, { siteName = 'Studio Tapa TV' } = {}) {
  const cleanHref = safePushHref(href);
  const tag = clip(cleanHref || (typeof type === 'string' && type ? `type:${type}` : 'notice'), 120);
  return {
    title: clip(title || siteName, 80) || siteName,
    body: clip(body, 180),
    href: cleanHref,
    tag
  };
}

// A push service answering 404 or 410 means the browser's subscription is
// gone for good; the row is disabled, never deleted.
export function pushGone(status) {
  return status === 404 || status === 410;
}

// The server's reason words for a row it disables. Only these are stored.
export const DISABLE_REASONS = {
  'switched-off': 'switched off in this browser',
  'signed-out': 'signed out of this browser',
  replaced: 'replaced by a newer browser on the same account'
};

export function disableReason(key) {
  return Object.prototype.hasOwnProperty.call(DISABLE_REASONS, key) ? DISABLE_REASONS[key] : DISABLE_REASONS['switched-off'];
}

// iPhone and iPad: a web page can ask for notifications only once it has
// been added to the Home Screen and opened from there (iOS 16.4+). True
// when this browser is one of those and isn't running from the Home Screen.
// iPadOS presents itself as a Mac; a Mac with a touch screen is an iPad.
export function needsHomeScreenFirst({ userAgent = '', standalone = false, maxTouchPoints = 0 } = {}) {
  const ua = String(userAgent || '');
  const ios = /\b(iPhone|iPad|iPod)\b/.test(ua) || (/\bMacintosh\b/.test(ua) && Number(maxTouchPoints) > 1);
  return ios && !standalone;
}

export const HOME_SCREEN_LINE = (siteName = 'Studio Tapa TV') => `On iPhone and iPad, add ${siteName} to your Home Screen first (Share → Add to Home Screen), then turn this on.`;

// What the Preferences row shows, in order of what decides it.
//   home-screen  iPhone/iPad outside the Home Screen app
//   unsupported  the browser can't do web push
//   not-set-up   the keys aren't in Vercel yet
//   migration    migration 122 hasn't run
//   blocked      the person (or the browser) said no
//   on | off
export function browserPushState({ needsHomeScreen = false, supported = false, serverReady = false, migrationReady = true, permission = 'default', subscribed = false } = {}) {
  if (needsHomeScreen) return 'home-screen';
  if (!supported) return 'unsupported';
  if (!serverReady) return 'not-set-up';
  if (!migrationReady) return 'migration';
  if (permission === 'denied') return 'blocked';
  if (subscribed && permission === 'granted') return 'on';
  return 'off';
}

export const MIGRATION_LINE = 'Web notifications need a database update (migration 122).';
export const NOT_SET_UP_LINE = 'Notifications on the website aren’t set up yet.';

// How to undo a "Block", by browser.
export function unblockSteps(userAgent = '') {
  const ua = String(userAgent || '');
  if (/\bFirefox\//.test(ua)) return 'Click the icon to the left of the address, clear the blocked Notifications permission, then reload this page.';
  if (/\bSafari\//.test(ua) && !/\b(Chrome|Chromium|CriOS|Edg|OPR)\//.test(ua)) {
    return /\b(iPhone|iPad|iPod)\b/.test(ua)
      ? 'Open Settings → Notifications, find this site’s Home Screen app and allow notifications, then reopen it.'
      : 'Open Safari → Settings → Websites → Notifications, set this site to Allow, then reload this page.';
  }
  return 'Click the icon to the left of the address (site settings), set Notifications to Allow, then reload this page.';
}
