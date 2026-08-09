/**
 * One-tap rescue for a device stranded by a stale service worker.
 *
 * A worker keeps serving the shell it precached until a NEW worker activates,
 * and `registerType: "prompt"` means one never activates on its own. If that
 * shell can't boot — it asks for a chunk the release tree no longer has — the
 * update prompt that would replace the worker is a component inside the app
 * that never renders. The device is stuck with no way back, and on iOS there
 * are no devtools to clear it by hand. The only supported alternative there is
 * "Clear Website Data", which ALSO deletes IndexedDB: the replica, the op
 * outbox and any photos not yet uploaded. That is real data loss.
 *
 * This page is reachable because it lives under `/api/`, which is the
 * service worker's `navigateFallbackDenylist` — so navigating here bypasses
 * even a completely broken worker and reaches the server. That denylist has
 * been deployed since long before this page, which is what makes this work on
 * devices that are already stranded.
 *
 * It unregisters the workers and drops Cache Storage. It does NOT touch
 * IndexedDB, so nothing a user captured offline is lost.
 */

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Fixing bins…</title>
<style>
  :root { color-scheme: dark; }
  body {
    margin: 0; min-height: 100dvh; display: grid; place-items: center;
    background: #242424; color: #c9c9c9; padding: 2rem; text-align: center;
    font-family: system-ui, sans-serif;
  }
  h1 { font-size: 1.25rem; margin: 0 0 .5rem; color: #fff; }
  p { margin: .5rem 0; font-size: .95rem; line-height: 1.5; max-width: 32rem; }
  code { color: #8ab4f8; }
</style>
</head>
<body>
<main>
  <h1 id="status">Repairing this device…</h1>
  <p id="detail">Clearing the out-of-date app files. Your photos, notes and
  anything waiting to sync are not affected.</p>
</main>
<script>
(function () {
  var status = document.getElementById("status");
  var detail = document.getElementById("detail");
  function done() { location.replace("/"); }
  function failed(err) {
    status.textContent = "Couldn't repair automatically";
    detail.textContent =
      "Close this tab, then reopen the app. If it still doesn't load, " +
      "reload this page. (" + (err && err.message ? err.message : err) + ")";
  }
  Promise.resolve()
    .then(function () {
      return navigator.serviceWorker
        ? navigator.serviceWorker.getRegistrations()
        : [];
    })
    .then(function (regs) {
      return Promise.all(regs.map(function (r) { return r.unregister(); }));
    })
    .then(function () { return window.caches ? caches.keys() : []; })
    .then(function (keys) {
      return Promise.all(keys.map(function (k) { return caches.delete(k); }));
    })
    // A moment on screen so this doesn't look like a flicker, then straight
    // into the app — which now has nothing stale left to serve it.
    .then(function () { setTimeout(done, 600); }, failed);
})();
</script>
</body>
</html>
`;

export function handleRecover(): Response {
  return new Response(HTML, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // Never cached: this is the one page that must always come from the
      // server, and it exists precisely because caching went wrong.
      "Cache-Control": "no-store",
    },
  });
}
