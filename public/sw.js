// Minimal service worker: makes the app installable and keeps the shell
// reachable offline. Live data is never cached.
const SHELL = "tallinn-live-shell-v1";
const SHELL_URLS = ["/", "/index.html", "/manifest.json", "/icons/icon-192.png", "/icons/icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_URLS)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== SHELL).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return; // network only
  if (e.request.mode === "navigate") {
    // Network first so deploys show up immediately; cached shell only when offline.
    e.respondWith(fetch(e.request).then((r) => { caches.open(SHELL).then((c) => c.put("/", r.clone())); return r; }).catch(() => caches.match("/")));
    return;
  }
  e.respondWith(fetch(e.request).then((r) => { if (r.ok) caches.open(SHELL).then((c) => c.put(e.request, r.clone())); return r; }).catch(() => caches.match(e.request)));
});
