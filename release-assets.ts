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
import { basename, dirname } from "node:path";

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

const NEVER_CACHE = new Set([
  `/${SERVICE_WORKER_FILENAME}`,
  // The old name. Kept so any client still asking for it stops being handed a
  // cacheable response.
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
  if (NEVER_CACHE.has(pathname)) return "no-store, must-revalidate";
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
    // Separators normalized so the paths built below match the caller's on a
    // Windows dev machine; production is Linux, where this is a no-op.
    const resolved = realpathSync(releaseDir).replaceAll("\\", "/");
    const currentClientDir = `${resolved}/build/client`;
    const releases = dirname(resolved);
    return readdirSync(releases)
      .map((name) => `${releases}/${name}/build/client`)
      .filter((dir) => dir !== currentClientDir && existsSync(`${dir}/assets`));
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
  for (const dir of clientDirs) {
    const path = `${dir}${pathname}`;
    if (existsSync(path)) {
      return { path, release: basename(dirname(dirname(dir))) };
    }
  }
  return undefined;
}
