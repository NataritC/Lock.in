// Lock In service worker: shows push notifications. Pushes carry no data;
// the worker asks the server what to say, so nothing personal travels through push services.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));

self.addEventListener("push", event => {
  event.waitUntil((async () => {
    let n = { title: "Lock In", body: "Time for your check-in.", url: "/?checkin=1", tag: "lockin" };
    try {
      const r = await fetch("/api/notice", { credentials: "same-origin" });
      if (r.ok) n = await r.json();
    } catch (e) {}
    await self.registration.showNotification(n.title, {
      body: n.body, tag: n.tag, data: { url: n.url },
      icon: "/icon-192.png", badge: "/badge-96.png",
    });
  })());
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const url = event.notification.data?.url || "/";
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const open = url.includes("summary") ? "summary" : url.includes("checkin") ? "checkin" : null;
    for (const c of all) {
      if (new URL(c.url).origin === self.location.origin) {
        await c.focus();
        if (open) c.postMessage({ open });
        return;
      }
    }
    await self.clients.openWindow(url);
  })());
});
