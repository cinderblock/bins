/**
 * These cover the deploy-stranding fallback (see release-assets.ts). They
 * build a real release-tree layout on disk rather than mocking the fs,
 * because the whole behaviour IS the directory shape — deploy.yml's
 * `<root>/releases/<sha>/build/client` and the `current` symlink beside it.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { findInPriorReleases, priorClientDirs } from "./release-assets";

let root: string;

/** One release tree, with the given files under its client build. */
function makeRelease(sha: string, assets: string[]) {
  const client = `${root}/releases/${sha}/build/client`;
  mkdirSync(`${client}/assets`, { recursive: true });
  for (const name of assets) {
    writeFileSync(`${client}/assets/${name}`, `// ${sha} ${name}`);
  }
  return `${root}/releases/${sha}`;
}

beforeEach(() => {
  // Separators normalized to match what priorClientDirs returns; on a Windows
  // dev machine tmpdir() is backslashed, and production is Linux either way.
  root = mkdtempSync(`${tmpdir()}/bins-releases-`).replaceAll("\\", "/");
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
        `${root}/releases/bbb/build/client`,
        `${root}/releases/ccc/build/client`,
      ].sort(),
    );
  });

  test("skips a release with no client build (a half-staged deploy)", () => {
    const current = makeRelease("aaa", ["app-1.js"]);
    mkdirSync(`${root}/releases/partial`, { recursive: true });

    expect(priorClientDirs(current)).toEqual([]);
  });

  test("is empty, not an error, outside a release-tree layout", () => {
    expect(priorClientDirs(`${root}/not/a/release`)).toEqual([]);
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
      `${root}/releases/bbb/build/client/assets/manifest-old.js`,
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
    writeFileSync(`${root}/secret.txt`, "nope");

    expect(
      findInPriorReleases(
        priorClientDirs(current),
        "/assets/../../../../secret.txt",
      ),
    ).toBeUndefined();
  });
});
