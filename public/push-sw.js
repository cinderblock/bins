/**
 * Push handlers, imported into the generated Workbox service worker
 * (`workbox.importScripts` in vite.config.ts).
 *
 * A separate plain file rather than switching the PWA build to
 * injectManifest: the generated SW is load-bearing (precache + offline
 * navigation fallback) and has already cost this project one "permanently
 * blank app after a deploy" incident. Adding two listeners is not worth
 * taking ownership of the whole service worker.
 *
 * No build step touches this file, so it must stay plain ES5-ish JS.
 */

self.addEventListener("push", (event) => {
  // A push with no readable payload still has to show something: browsers
  // revoke the permission of a site that receives a push and shows nothing
  // (the "userVisibleOnly" bargain).
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (_err) {
    data = {};
  }
  const title = data.title || "bins";
  const options = {
    body: data.body || "Something needs your attention.",
    icon: "/pwa-192x192.png",
    badge: "/pwa-192x192.png",
    // Same tag = a second suggestion REPLACES the first rather than stacking
    // five notifications for one trip to the admin page.
    tag: data.tag || "bins",
    renotify: true,
    data: { url: data.url || "/" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = event.notification.data?.url || "/";
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((windows) => {
        // Reuse an open tab if there is one — an installed PWA has exactly one
        // window, and opening a second copy of the app is disorienting.
        for (const client of windows) {
          if ("focus" in client) {
            client.navigate(target);
            return client.focus();
          }
        }
        return self.clients.openWindow(target);
      }),
  );
});
