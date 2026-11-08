/* Creator Pulse service worker: instant pages, offline page and push notifications.
 *
 * Instant pages ("stale-while-revalidate"): the last copy of each page you opened is kept on this
 * device. Opening the app or a page shows that copy at once, while the fresh page is fetched in the
 * background; the page then swaps in the fresh data (RefreshFromNetwork asks for it). Sign-in pages,
 * API calls and shared links are never kept. Signing out (or an expired session) clears the copies.
 */
const OFFLINE = "/offline.html";
const STATIC = "pulse-v1";
const PAGES = "pulse-pages-v1";
const MAX_PAGES = 40;

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(STATIC).then((c) => c.addAll([OFFLINE, "/icons/icon-192.png"])));
  self.skipWaiting();
});
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

const keyOf = (url) => { const u = new URL(url); return u.origin + u.pathname + u.search; };
const cacheable = (url) => {
  const u = new URL(url);
  return u.origin === self.location.origin && !/^\/(login|api|share|offline)/.test(u.pathname);
};

// url -> { done: boolean, result, waiters: MessagePort[] } for pages answered from the saved copy
const pending = new Map();
function settle(key, result) {
  const p = pending.get(key);
  if (!p) return;
  p.done = true; p.result = result;
  for (const port of p.waiters) port.postMessage(result);
  p.waiters = [];
  setTimeout(() => { if (pending.get(key) === p) pending.delete(key); }, 60000);
}

async function trim(cache) {
  const keys = await cache.keys();
  for (const k of keys.slice(0, Math.max(0, keys.length - MAX_PAGES))) await cache.delete(k);
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.mode !== "navigate" || req.method !== "GET") return;
  if (!cacheable(req.url)) {
    e.respondWith(fetch(req).catch(() => caches.match(OFFLINE)));
    return;
  }
  const key = keyOf(req.url);
  const network = fetch(req).then(async (res) => {
    const signedOut = res.redirected && new URL(res.url).pathname.startsWith("/login");
    if (signedOut) { await caches.delete(PAGES); settle(key, { fromCache: true, signedOut: true }); return res; }
    if (res.ok && !res.redirected && (res.headers.get("content-type") || "").includes("text/html")) {
      const cache = await caches.open(PAGES);
      await cache.put(key, res.clone());
      trim(cache);
    }
    settle(key, { fromCache: true, fresh: true });
    return res;
  });
  e.respondWith((async () => {
    const saved = await (await caches.open(PAGES)).match(key);
    if (saved) {
      pending.set(key, { done: false, waiters: [] });
      e.waitUntil(network.catch(() => settle(key, { fromCache: true, offline: true })));
      return saved;
    }
    return network.catch(async () => (await caches.match(OFFLINE)) || Response.error());
  })());
});

self.addEventListener("message", (e) => {
  const data = e.data || {};
  if (data.type === "clear-pages") { e.waitUntil(caches.delete(PAGES)); return; }
  if (data.type !== "check" || !e.ports[0]) return;
  const port = e.ports[0];
  const p = pending.get(keyOf(data.url));
  if (!p) port.postMessage({ fromCache: false });
  else if (p.done) port.postMessage(p.result);
  else p.waiters.push(port);
});

self.addEventListener("push", (e) => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch { data = { title: "Creator Pulse", body: e.data ? e.data.text() : "" }; }
  e.waitUntil(self.registration.showNotification(data.title || "Creator Pulse", {
    body: data.body || "", icon: "/icons/icon-192.png", badge: "/icons/icon-192.png",
    data: { url: data.url || "/" }, tag: data.tag || undefined,
  }));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || "/";
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    for (const c of list) if ("focus" in c) { c.navigate(url); return c.focus(); }
    return self.clients.openWindow(url);
  }));
});
