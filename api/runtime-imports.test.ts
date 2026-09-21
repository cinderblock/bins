/**
 * The server must be able to BOOT from the image, not just type-check.
 *
 * The runtime stage of the Dockerfile copies `server.ts`, `api/`, `shared/`,
 * `db/` and `release-assets.ts` — and no `tsconfig.json`. Bun resolves the
 * `@shared/*` and `~/*` aliases from that file, so a server module importing
 * through an alias compiles, lints, tests and builds perfectly well, and then
 * cannot start:
 *
 *     error: Cannot find module '@shared/locations'
 *       from /srv/bins/releases/<sha>/api/ai/ask.ts
 *
 * That is precisely what happened on 2026-09-21: the warehouse instance
 * crash-looped and served 502 for hours, with every check green. The failure
 * is invisible until a container starts, which is after everything that could
 * have caught it. So it gets caught here, by the rule the Dockerfile already
 * states in a comment: server code imports by RELATIVE PATH.
 *
 * Client code (`app/`) is bundled by Vite, which does resolve the aliases —
 * this says nothing about that, and shouldn't.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");

/** Everything the runtime image ships, which is everything that must boot. */
const RUNTIME_DIRS = ["api", "shared", "db"];
const RUNTIME_FILES = ["server.ts", "release-assets.ts"];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "migrations") continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      out.push(...walk(path));
      continue;
    }
    // Tests are run by `bun test` from the repo root, where the aliases do
    // resolve, and never ship in the runtime image.
    if (!entry.endsWith(".ts") && !entry.endsWith(".tsx")) continue;
    if (entry.endsWith(".test.ts") || entry.endsWith(".test.tsx")) continue;
    out.push(path);
  }
  return out;
}

/** `import … from "x"`, `export … from "x"`, and `await import("x")`. */
const SPECIFIER =
  /(?:\bfrom\s*|\bimport\s*\(\s*)["']([^"']+)["']|\brequire\(\s*["']([^"']+)["']\s*\)/g;

describe("what the server imports must resolve without a tsconfig", () => {
  const files = [
    ...RUNTIME_DIRS.flatMap((dir) => walk(join(ROOT, dir))),
    ...RUNTIME_FILES.map((file) => join(ROOT, file)),
  ];

  test("there is something to check", () => {
    // A rename that empties this list would turn the whole guard into a
    // silent pass, which is worse than not having it.
    expect(files.length).toBeGreaterThan(20);
  });

  test("no path aliases anywhere the server can reach", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(SPECIFIER)) {
        const specifier = match[1] ?? match[2] ?? "";
        if (specifier.startsWith("@shared/") || specifier.startsWith("~/")) {
          offenders.push(
            `${file.slice(ROOT.length + 1).replace(/\\/g, "/")} → ${specifier}`,
          );
        }
      }
    }
    // The message matters more than the assertion: whoever trips this is
    // about to ship a container that cannot start.
    expect(
      offenders,
      offenders.length === 0
        ? undefined
        : `Server code must import by relative path — the runtime image has no tsconfig.json, so these cannot resolve at boot:\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });
});
