/**
 * Serving build artifacts from EARLIER releases (see server.ts).
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
