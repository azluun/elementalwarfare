/* Elemental Duel service worker — app shell + runtime image cache.
   Bump CACHE to force a refresh of the precached shell. */
const CACHE = "ed-v2";
const SHELL = ["/", "/index.html", "/manifest.webmanifest",
  "/img/app-icon-192.png", "/img/app-icon-512.png"];
// live/dynamic endpoints that must always hit the network (never served stale)
const NO_CACHE = ["/config", "/leaderboard", "/manifest", "/auth", "/cosmetic", "/shop", "/admin"];

self.addEventListener("install", (e) => {
  // precache the shell, but DON'T auto-activate — wait until the page's "Refresh" tells us to,
  // so a running game is never swapped out from under the player.
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
});
// the page posts this when the user taps "Refresh" on the update toast
self.addEventListener("message", (e) => { if (e.data === "SKIP_WAITING") self.skipWaiting(); });
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;                          // POSTs (auth/shop/…) go straight to network
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;                // fonts / google / cross-origin → network
  if (NO_CACHE.includes(url.pathname)) return;               // dynamic data → network, never cached
  if (req.mode === "navigate") {                             // pages: network-first, fall back to the cached shell offline
    e.respondWith(
      fetch(req).then((r) => { const cp = r.clone(); caches.open(CACHE).then((c) => c.put("/index.html", cp)); return r; })
        .catch(() => caches.match("/index.html").then((r) => r || caches.match("/"))));
    return;
  }
  // static assets (images, css, js): stale-while-revalidate — instant from cache, refreshed in the background
  e.respondWith(caches.match(req).then((cached) => {
    const net = fetch(req).then((r) => {
      if (r && r.status === 200) { const cp = r.clone(); caches.open(CACHE).then((c) => c.put(req, cp)); }
      return r;
    }).catch(() => cached);
    return cached || net;
  }));
});
