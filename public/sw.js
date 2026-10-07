/**
 * SplitHome service worker.
 *
 * The caching policy is deliberately narrow, because this app holds financial
 * data and the Cache API is readable by any script on the origin and survives
 * sign-out until explicitly cleared.
 *
 * What is cached:
 *   - Next's immutable build output under /_next/static/, which is
 *     content-hashed and contains no user data.
 *   - The /offline fallback page, which is a static shell.
 *
 * What is never cached, and why:
 *   - Any HTML of a signed-in page. It carries balances and expense
 *     descriptions, so a cached copy would still be readable on a shared phone
 *     after signing out.
 *   - Anything under /api/. /api/receipts serves private financial documents
 *     and /api/auth handles credentials; neither belongs in a cache the page
 *     can read back.
 *   - Any non-GET request. Server Actions are POSTs that move money, and
 *     replaying one from a cache would be a correctness disaster. Next's own
 *     `experimental.useOffline` retry handles those properly.
 *
 * So this worker makes the app installable and gives it a usable offline
 * screen. It does not make household data available offline — that would need
 * a deliberate, encrypted local store, which is a much larger decision than a
 * service worker.
 */

const VERSION = "v1";
const STATIC_CACHE = `splithome-static-${VERSION}`;
const OFFLINE_URL = "/offline";

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(STATIC_CACHE);
      await cache.add(new Request(OFFLINE_URL, { cache: "reload" }));
      // Take over as soon as possible rather than waiting for every tab to
      // close; nothing here depends on an older worker's cache shape.
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Drop caches from previous versions, so a policy change cannot leave
      // older entries readable.
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith("splithome-") && name !== STATIC_CACHE)
          .map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

/** Content-hashed build output: safe to serve from cache indefinitely. */
function isImmutableAsset(url) {
  return url.origin === self.location.origin && url.pathname.startsWith("/_next/static/");
}

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Never touch anything that is not a plain GET — see the note above about
  // Server Actions.
  if (request.method !== "GET") {
    return;
  }

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) {
    return;
  }
  if (url.pathname.startsWith("/api/")) {
    return;
  }

  if (isImmutableAsset(url)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(STATIC_CACHE);
        const hit = await cache.match(request);
        if (hit) {
          return hit;
        }
        const response = await fetch(request);
        if (response.ok) {
          cache.put(request, response.clone());
        }
        return response;
      })(),
    );
    return;
  }

  // Navigations go to the network every time, so a signed-in page is never
  // served from a cache. Only the failure path touches one.
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          return await fetch(request);
        } catch {
          const cache = await caches.open(STATIC_CACHE);
          const offline = await cache.match(OFFLINE_URL);
          return (
            offline ??
            new Response("You are offline.", {
              status: 503,
              headers: { "Content-Type": "text/plain; charset=utf-8" },
            })
          );
        }
      })(),
    );
  }
});

/**
 * Clears every cache on request.
 *
 * The app sends this on sign-out: the static cache holds no user data, but
 * clearing it makes "signing out leaves nothing behind" true by construction
 * rather than by audit.
 */
self.addEventListener("message", (event) => {
  if (event.data?.type === "CLEAR_CACHES") {
    event.waitUntil(
      (async () => {
        const names = await caches.keys();
        await Promise.all(names.map((name) => caches.delete(name)));
      })(),
    );
  }
});
