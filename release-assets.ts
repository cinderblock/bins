/**
 * Static-asset serving policy: cache headers, and falling back to EARLIER
 * releases (both used by server.ts).
 *
 * A deploy rehashes every asset, so a client holding an older asset list — an
 * installed service worker serving the shell it precached — asks for files the
 * new release no longer has. Answering 404 strands it on a blank page until
 * someone clears the worker by hand: the update prompt that would replace the
 * worker is a component inside the app that can no longer boot.
 *
 * deploy.yml keeps the last few release trees, so those files are still right
 * there. Serving them lets a stale shell boot, sync, and show the normal
 * update prompt — no user action, no data loss.
 *
 * Lives apart from server.ts so it can be tested: server.ts binds a unix
 * socket at import time and can't be loaded on a dev machine.
 */
import { existsSync, readdirSync, realpathSync } from "node:fs";
import { basename, dirname, join } from "node:path";

const ASSETS_SUBDIR = "assets";

/**
 * A release directory's client build. Built with `join` throughout so paths
 * are in the platform's own form on both sides of every comparison — no
 * separator juggling in the callers, and none in the tests.
 */
export function clientDirOf(releaseDir: string): string {
  return join(releaseDir, "build", "client");
}

/**
 * Files that must NEVER be cached by anything, at any layer.
 *
 * A cached service worker is a cached decision about every other file. This
 * was observed live: a CDN held `/sw.js` for hours, so a device that had just
 * been repaired re-registered the OLD worker, which precached the OLD shell —
 * straight back into the broken state it had just escaped. Browsers already
 * bypass their own HTTP cache when checking a worker for updates; `no-store`
 * is what stops an intermediary caching it, and stops the very first
 * registration being served a stale copy.
 */
/**
 * The generated service worker's filename.
 *
 * Deliberately NOT vite-plugin-pwa's default `sw.js`: that URL sat in a CDN
 * cache for hours under a TTL we don't control, so a device that had just been
 * repaired re-registered the STALE worker and broke again immediately. A path
 * the CDN has never seen breaks that loop without needing a purge.
 *
 * Exported so vite.config.ts (which generates it), this file (which decides it
 * is never cacheable) and scripts/precache-route-manifest.ts (which rewrites
 * it) cannot drift apart — a rename that reached only two of the three would
 * fail the build, or worse, ship a worker nobody patched.
 */
export const SERVICE_WORKER_FILENAME = "service-worker.js";

/**
 * Files that must always be revalidated before use.
 *
 * `no-cache`, deliberately NOT `no-store`. A stored-but-revalidated response
 * can never be stale, and it stays STORABLE — which matters, because the
 * worker pulls `/push-sw.js` in with `importScripts`, and that call sits
 * ABOVE `precacheAndRoute` in the generated worker. Serving it `no-store` made
 * the import fail on the live site: the worker installed and activated having
 * precached nothing at all, silently, so offline boot was dead while
 * everything looked healthy. Verified by the precache being empty in
 * production and populated from an identical local build.
 */
const ALWAYS_REVALIDATE = new Set([
  `/${SERVICE_WORKER_FILENAME}`,
  // The old name. Kept so any client still asking for it stops being handed a
  // long-lived cacheable response.
  "/sw.js",
  "/push-sw.js",
]);

/**
 * `Cache-Control` for a static file, by request path.
 *
 * Assets are content-hashed, so they're immutable for a year. Everything else
 * is named, therefore mutable, therefore revalidated.
 */
export function cacheControlFor(pathname: string): string {
  if (ALWAYS_REVALIDATE.has(pathname)) return "no-cache, must-revalidate";
  if (pathname.startsWith("/assets/")) {
    return "public, max-age=31536000, immutable";
  }
  return "public, max-age=3600";
}

/**
 * Client build directories of every OTHER release on disk.
 *
 * `releaseDir` is the running release (`<root>/releases/<sha>`), so its
 * siblings are the other releases. Returns [] for any layout that isn't a
 * release tree — a dev checkout, or a self-hoster's own arrangement — which
 * simply means no fallback.
 *
 * Not ordered: asset filenames are content hashes, so every release that has
 * a given name has identical bytes.
 */
export function priorClientDirs(releaseDir: string): string[] {
  try {
    // The supervisor launches `<root>/current/run`, so the running release can
    // arrive here as the SYMLINK path. Its sibling would then be `releases/`
    // itself and the fallback would silently find nothing — resolve first.
    const resolved = realpathSync(releaseDir);
    const currentClientDir = clientDirOf(resolved);
    return readdirSync(dirname(resolved))
      .map((name) => clientDirOf(join(dirname(resolved), name)))
      .filter(
        (dir) =>
          dir !== currentClientDir && existsSync(join(dir, ASSETS_SUBDIR)),
      );
  } catch {
    return [];
  }
}

/**
 * Locate `pathname` (a rooted request path like `/assets/manifest-a1b2.js`) in
 * one of `clientDirs`, with the release it came from.
 *
 * Callers must only pass paths that are unambiguously build artifacts, so this
 * can never shadow anything the current release serves.
 */
export function findInPriorReleases(
  clientDirs: string[],
  pathname: string,
): { path: string; release: string } | undefined {
  if (pathname.includes("..")) return undefined;
  // A rooted URL path → path segments, so `join` builds it in the platform's
  // own form rather than splicing a "/" path onto a "\" one.
  const segments = pathname.split("/").filter(Boolean);
  for (const dir of clientDirs) {
    const path = join(dir, ...segments);
    if (existsSync(path)) {
      return { path, release: basename(dirname(dirname(dir))) };
    }
  }
  return undefined;
}
