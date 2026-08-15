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

  if (isPageOrData) {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          // Clone BEFORE handing the response back — see the note in the
          // cache-first branch below for why the ordering matters.
          const copy = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          return networkResponse;
        })
        .catch(() => caches.match(event.request))
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
        const copy = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
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
