/**
 * These cover the deploy-stranding fallback (see release-assets.ts). They
 * build a real release-tree layout on disk rather than mocking the fs,
 * because the whole behaviour IS the directory shape — deploy.yml's
 * `<root>/releases/<sha>/build/client` and the `current` symlink beside it.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  cacheControlFor,
  clientDirOf,
  findInPriorReleases,
  priorClientDirs,
} from "./release-assets";

describe("cacheControlFor", () => {
  test("always revalidates the service worker and its imports", () => {
    // A cached worker is a cached decision about every other file: a CDN held
    // /sw.js for hours, and a just-repaired device re-installed the old one.
    for (const p of ["/service-worker.js", "/sw.js", "/push-sw.js"]) {
      expect(cacheControlFor(p)).toBe("no-cache, must-revalidate");
    }
  });

  test("keeps those responses STORABLE (no-store breaks importScripts)", () => {
    // The worker importScripts()es /push-sw.js above precacheAndRoute, so an
    // unstorable response there means a worker that activates having cached
    // nothing — offline boot dead, with nothing visibly wrong.
    for (const p of ["/service-worker.js", "/push-sw.js"]) {
      expect(cacheControlFor(p)).not.toContain("no-store");
    }
  });

  test("treats content-hashed assets as immutable", () => {
    expect(cacheControlFor("/assets/root-a1b2c3.js")).toContain("immutable");
  });

  test("revalidates everything else", () => {
    expect(cacheControlFor("/favicon.svg")).toBe("public, max-age=3600");
  });
});

let root: string;

/** One release tree, with the given files under its client build. */
function makeRelease(sha: string, assets: string[]) {
  const release = join(root, "releases", sha);
  const client = clientDirOf(release);
  mkdirSync(join(client, "assets"), { recursive: true });
  for (const name of assets) {
    writeFileSync(join(client, "assets", name), `// ${sha} ${name}`);
  }
  return release;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "bins-releases-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("priorClientDirs", () => {
  test("finds the other releases and excludes the running one", () => {
    const current = makeRelease("aaa", ["app-1.js"]);
    makeRelease("bbb", ["app-2.js"]);
    makeRelease("ccc", ["app-3.js"]);

    const dirs = priorClientDirs(current);

    expect(dirs.sort()).toEqual(
      [
        clientDirOf(join(root, "releases", "bbb")),
        clientDirOf(join(root, "releases", "ccc")),
      ].sort(),
    );
  });

  test("skips a release with no client build (a half-staged deploy)", () => {
    const current = makeRelease("aaa", ["app-1.js"]);
    mkdirSync(join(root, "releases", "partial"), { recursive: true });

    expect(priorClientDirs(current)).toEqual([]);
  });

  test("is empty, not an error, outside a release-tree layout", () => {
    expect(priorClientDirs(join(root, "not", "a", "release"))).toEqual([]);
  });
});

describe("findInPriorReleases", () => {
  test("serves a chunk this release dropped, naming where it came from", () => {
    const current = makeRelease("aaa", ["manifest-new.js"]);
    makeRelease("bbb", ["manifest-old.js"]);

    const hit = findInPriorReleases(
      priorClientDirs(current),
      "/assets/manifest-old.js",
    );

    expect(hit?.release).toBe("bbb");
    expect(hit?.path).toBe(
      join(
        clientDirOf(join(root, "releases", "bbb")),
        "assets",
        "manifest-old.js",
      ),
    );
  });

  test("misses a chunk no release has", () => {
    const current = makeRelease("aaa", ["manifest-new.js"]);
    makeRelease("bbb", ["manifest-old.js"]);

    expect(
      findInPriorReleases(priorClientDirs(current), "/assets/gone.js"),
    ).toBeUndefined();
  });

  test("refuses to walk out of the release tree", () => {
    const current = makeRelease("aaa", []);
    makeRelease("bbb", []);
    writeFileSync(join(root, "secret.txt"), "nope");

    expect(
      findInPriorReleases(
        priorClientDirs(current),
        "/assets/../../../../secret.txt",
      ),
    ).toBeUndefined();
  });
});
