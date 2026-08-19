// Bumped from v1 — the activate handler below deletes any cache whose name
// doesn't match, so changing this name is what actually forces every
// previously-cached (and possibly stale) response to be thrown away.
const CACHE_NAME = 'taprino-shell-v2';
const SHELL_ASSETS = ['/manifest.json', '/icon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS))
  );
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

self.addEventListener('fetch', (event) => {
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
  const isPageOrData =
    event.request.mode === 'navigate' || url.pathname.startsWith('/_next/data/');

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
          if (isCacheable) {
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
        if (isCacheable) {
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
