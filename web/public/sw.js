// TCGrass service worker: app shell only (T-013, AC-013.1). There is no offline capture, so
// the API and card art always go to the network and are never cached: API answers are per
// player and must not be stored (AC-002.10). Only the shell ("/") and Vite's fingerprinted
// /assets are handled; every other request is left to the browser (fails closed). Bump CACHE
// to drop every old entry on activate.
/* global self, caches, fetch, URL, AbortSignal */
const CACHE = "tcgrass-shell-v1";
const SHELL = "/";
// On a weak signal, fall back to the cached shell instead of waiting for the browser timeout.
const SHELL_TIMEOUT_MS = 4000;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.add(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") {
    return;
  }
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) {
    return;
  }
  if (request.mode === "navigate" && (url.pathname === "/" || url.pathname === "/index.html")) {
    event.respondWith(networkFirstShell(request));
  } else if (url.pathname.startsWith("/assets/")) {
    event.respondWith(cacheFirst(request));
  }
});

// Network first, so a redeploy shows at once; the cached shell only when offline.
async function networkFirstShell(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request, { signal: AbortSignal.timeout(SHELL_TIMEOUT_MS) });
    const isHtml = (response.headers.get("content-type") ?? "").startsWith("text/html");
    if (response.ok && isHtml) {
      const html = await response.clone().text();
      await cache.put(SHELL, response.clone());
      await pruneAssets(cache, html);
    }
    return response;
  } catch (error) {
    const cached = await cache.match(SHELL);
    if (cached) {
      return cached;
    }
    throw error;
  }
}

// Each deploy fingerprints new /assets; drop the ones the current shell no longer references
// so the cache doesn't grow with every deploy. Fonts are kept: only the stylesheet names them,
// and they rarely change (T-024). (A chunk loaded only from JS would be dropped too and simply
// fetched again; the build has none today.)
async function pruneAssets(cache, html) {
  const requests = await cache.keys();
  await Promise.all(
    requests
      .map((cached) => new URL(cached.url).pathname)
      .filter(
        (path) => path.startsWith("/assets/") && !path.endsWith(".woff2") && !html.includes(path),
      )
      .map((path) => cache.delete(path)),
  );
}

// Vite fingerprints /assets, so a cached file never goes stale.
async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  if (cached) {
    return cached;
  }
  const response = await fetch(request);
  if (response.ok) {
    await cache.put(request, response.clone());
  }
  return response;
}
