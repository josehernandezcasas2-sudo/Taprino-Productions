// Bumped from v2 — /manifest.json (the static file) no longer exists,
// replaced by /api/manifest so an admin-uploaded app icon can actually
// take effect. Not precaching it here: the fetch handler below
// deliberately skips every /api/ route, so a precached copy would sit in
// this cache and never once actually get served from it — worth
// precaching only if that bypass rule changes.
// v4 (security round, 2026-10-26): earlier versions stored every page
// they fetched, private ones included (an account page, a conversation, a
// screener), and could hand them to the next person on the same browser
// when offline. Bumping the name deletes those caches on activation.
// v5 (2026-11-12): web push. The worker shows the site's notifications
// (`push`) and opens the right page when one is tapped
// (`notificationclick`); lib/webPush.js sends them, lib/webPushRules.js
// shapes them. Registered as /sw.js?nofetch=1 in development (only when
// someone turns notifications on there, lib/webPushClient.js), it caches
// nothing, so a dev server's code is never served stale.
const CACHE_NAME = 'taprino-shell-v5';
const NO_FETCH = new URL(self.location.href).searchParams.has('nofetch');

// Only a response meant to be shared may be kept: a successful one whose
// Cache-Control doesn't say private or no-store. Next marks every
// server-rendered page that way by default, so in practice only static
// pages and assets are stored.
function shareable(response) {
  if (!response || !response.ok || response.type !== 'basic') return false;
  const cc = (response.headers.get('Cache-Control') || '').toLowerCase();
  return !/(^|,|\s)(private|no-store)(,|\s|$)/.test(cc);
}

// The page asks for this on sign-out (pages/_app.js).
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'clear-cache') {
    event.waitUntil(caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k)))));
  }
});
const SHELL_ASSETS = ['/icon.svg'];

self.addEventListener('install', (event) => {
  if (!NO_FETCH) {
    event.waitUntil(
      caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS))
    );
  }
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ---- Web push (2026-11-12) ----
// What a notification may open: a path on this site, nothing else (the
// same rule as lib/webPushRules.js safePushHref).
function safeHref(href) {
  if (typeof href !== 'string') return null;
  const h = href.trim();
  if (!h.startsWith('/') || h.startsWith('//') || h.length > 500) return null;
  if (/[\\\u0000-\u001f\u007f]/.test(h)) return null;
  return h;
}

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (err) {
    data = { body: event.data ? event.data.text() : '' };
  }
  const title = typeof data.title === 'string' && data.title ? data.title.slice(0, 80) : 'Studio Tapa TV';
  const body = typeof data.body === 'string' ? data.body.slice(0, 180) : '';
  const tag = typeof data.tag === 'string' && data.tag ? data.tag.slice(0, 120) : undefined;
  event.waitUntil(self.registration.showNotification(title, {
    body,
    icon: '/push-icon.png',
    badge: '/push-badge.png',
    // Repeats with the same tag (one conversation, one title) replace the
    // last one instead of stacking, and still make a sound.
    tag,
    renotify: Boolean(tag),
    data: { href: safeHref(data.href) || '/' }
  }));
});

// A tap: a tab already on that page comes to the front; else a tab of
// this site the worker controls goes there; else a new one opens. Only
// ever this site's own pages.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const href = safeHref(event.notification.data && event.notification.data.href) || '/';
  const target = new URL(href, self.location.origin);
  if (target.origin !== self.location.origin) return;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const same = windows.find((c) => c.url === target.href);
    if (same && 'focus' in same) return same.focus();
    const ours = windows.find((c) => new URL(c.url).origin === self.location.origin && 'navigate' in c);
    if (ours) {
      try {
        const moved = await ours.navigate(target.href);
        if (moved) return moved.focus();
      } catch (err) {
        // A tab this worker doesn't control can't be moved; open a new one.
      }
    }
    return self.clients.openWindow ? self.clients.openWindow(target.href) : undefined;
  })());
});

self.addEventListener('fetch', (event) => {
  // Development registration: notifications only, no caching at all.
  if (NO_FETCH) return;
  const url = new URL(event.request.url);

  // This service worker exists to cache THIS APP's own pages and static
  // assets — nothing else. It has no business intercepting requests to
  // other origins (Clerk's auth script, Cloudflare Stream's video
  // manifests, Google's ad SDK, and similar). Letting those through
  // untouched means the browser handles them exactly as it would with no
  // service worker installed at all, which is the only sane behavior for
  // traffic this file was never designed to reason about.
  if (url.origin !== self.location.origin) return;

  // Never cache API routes — checkout, membership status, and signups must
  // always hit the network live.
  if (url.pathname.startsWith('/api/')) return;
  if (event.request.method !== 'GET') return;

  // NETWORK-FIRST for anything that changes between deploys: the HTML
  // documents themselves and Next.js's per-build data files. The previous
  // version of this file was cache-first for everything, which meant a
  // deployed fix could sit invisible behind a cached copy of the old page
  // indefinitely — and worse, cached HTML would keep requesting
  // /_next/data/<old-build-id>/... which 404s once that build is gone.
  // Cache is still written here, so it remains available as an offline
  // fallback; it's just no longer preferred over a working network.
  const isData = url.pathname.startsWith('/_next/data/');
  const isPageOrData = event.request.mode === 'navigate' || isData;

  // The Cache API only ever supports http/https requests. Browser
  // extensions (password managers, wallets, and similar) commonly inject
  // content scripts that issue their own fetches — chrome-extension://,
  // moz-extension://, and so on — and because this handler listens for
  // every fetch on the page, those get swept in here too. Caching one
  // throws immediately, which is harmless to the site itself but floods
  // the console with an error that has nothing to do with anything this
  // app actually does. Skipping non-http(s) schemes up front avoids ever
  // attempting it.
  const isCacheable = url.protocol === 'http:' || url.protocol === 'https:';

  if (isPageOrData) {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          // Clone BEFORE handing the response back — see the note in the
          // cache-first branch below for why the ordering matters.
          // A page's data file carries that viewer's props, so it is
          // never stored; a page only when it is meant to be shared.
          if (isCacheable && !isData && shareable(networkResponse)) {
            const copy = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return networkResponse;
        })
        .catch(async () => {
          // A cache MISS here used to fall through as `undefined` — passing
          // that to respondWith() isn't a valid Response, and the browser
          // reports it back as exactly the kind of opaque "Failed to
          // fetch" error this was producing. Most likely to happen on a
          // page that's never been visited in this browser before (nothing
          // to have cached yet) combined with any live-fetch hiccup, which
          // is exactly the account/checkout flow — the first real network
          // request most people make is often the one that matters most.
          //
          // Re-throwing when there's truly nothing cached lets the
          // browser's own native network-error handling take over, which
          // is the same outcome as if no service worker were intercepting
          // this request at all — correct, rather than a broken worker
          // silently eating the failure.
          const cached = await caches.match(event.request);
          if (cached) return cached;
          throw new Error('Network request failed and nothing is cached for this page yet.');
        })
    );
    return;
  }

  // CACHE-FIRST is safe for everything else — Next.js gives static assets
  // content-hashed filenames, so a changed file is always a different URL
  // and can never be served stale.
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((networkResponse) => {
        // .clone() has to happen synchronously, right here — the previous
        // version cloned inside caches.open().then(), by which point the
        // response had often already been consumed by the browser, throwing
        // "Failed to execute 'clone' on 'Response': Response body is already
        // used" on essentially every request.
        if (isCacheable && shareable(networkResponse)) {
          const copy = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return networkResponse;
      });
      // Deliberately no .catch() returning `cached` here: at this point we
      // already know `cached` is undefined, and returning undefined from a
      // fetch handler throws "Failed to convert value to 'Response'" — the
      // other error that was flooding the console. Letting the fetch
      // rejection propagate produces a normal network error instead.
    })
  );
});
