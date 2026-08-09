// Production server: static SPA build + /api/* + SPA fallback, bound directly
// to a unix socket (no TCP port). A TLS-terminating reverse proxy on the host
// (Caddy, nginx, …) forwards the public origin to the socket, passing
// X-Forwarded-Proto/-For.
//
// Importing db/client.server (via the API) migrates the SQLite db on boot.

import { chmodSync, existsSync, mkdirSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";
import { BUILD_SHA } from "./api/build";
import { logGroupCredentials } from "./api/credentials";
import { handleApi } from "./api/router";
import {
  cacheControlFor,
  findInPriorReleases,
  priorClientDirs,
} from "./release-assets";

const SOCKET_PATH = process.env.SOCKET_PATH ?? "/run/bins/bins.sock";
const CLIENT_DIR = `${import.meta.dir}/build/client`;

// Client builds of the other releases still on disk — the fallback that keeps
// a stale shell bootable across a deploy (see release-assets.ts). Snapshotted
// at boot on purpose: a deploy restarts this process, so it can never go
// out of date while it runs.
const PRIOR_CLIENT_DIRS = priorClientDirs(import.meta.dir);

// The git SHA this release was built from — served at /_version so a deploy
// can confirm the new build took over. Shared with the API (which compares it
// against what each device reports running); see api/build.ts.

function serveAsset(pathname: string): Response | undefined {
  if (pathname === "/" || pathname.includes("..")) return undefined;
  const file = Bun.file(`${CLIENT_DIR}${pathname}`);
  if (!file.size) return undefined;
  return new Response(file, {
    headers: { "Cache-Control": cacheControlFor(pathname) },
  });
}

/**
 * The same asset out of an earlier release — see release-assets.ts. Only ever
 * reached for a path this release doesn't have, and only for hashed build
 * artifacts, so it can't shadow anything current.
 */
function serveAssetFromPriorRelease(pathname: string): Response | undefined {
  const hit = findInPriorReleases(PRIOR_CLIENT_DIRS, pathname);
  if (!hit) return undefined;
  return new Response(Bun.file(hit.path), {
    headers: {
      "Cache-Control": "public, max-age=31536000, immutable",
      // Names the release it came from, so "is anyone still on an old shell?"
      // is answerable from the reverse proxy's logs.
      "X-Bins-Prior-Release": hit.release,
    },
  });
}

/**
 * A build artifact path is ALWAYS an asset request, so a missing one is a 404
 * — never the SPA shell.
 *
 * Falling through to the shell here is what turned a stale service worker into
 * a permanently blank app: every deploy rehashes the assets, an installed SW
 * kept serving the previous index.html, that shell asked for chunks which no
 * longer exist, and the server answered each one with `index.html` and a 200.
 * The browser then tried to execute HTML as a JavaScript module, hydration
 * never completed, and the page sat on the loading fallback forever with
 * nothing obviously wrong. A 404 makes that failure loud and recoverable.
 */
function isBuildArtifact(pathname: string): boolean {
  return pathname.startsWith("/assets/");
}

// The SPA shell — served for every non-asset, non-API GET so client routes
// like /123 resolve. Must never be cached long: it references hashed assets.
function serveShell(): Response {
  return new Response(Bun.file(`${CLIENT_DIR}/index.html`), {
    headers: { "Cache-Control": "no-cache" },
  });
}

mkdirSync(dirname(SOCKET_PATH), { recursive: true });
if (existsSync(SOCKET_PATH)) unlinkSync(SOCKET_PATH);

Bun.serve({
  unix: SOCKET_PATH,
  // Photo uploads can be a few MB.
  maxRequestBodySize: 32 * 1024 * 1024,
  async fetch(req) {
    const url = new URL(req.url);
    const proto = req.headers.get("x-forwarded-proto");
    if (proto) url.protocol = `${proto}:`;

    if (url.pathname === "/_version") {
      return new Response(BUILD_SHA, {
        headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" },
      });
    }

    if (url.pathname.startsWith("/api/")) return handleApi(req, url);

    if (req.method === "GET" || req.method === "HEAD") {
      const asset = serveAsset(url.pathname);
      if (asset) return asset;
      if (isBuildArtifact(url.pathname)) {
        // Most likely a stale shell asking for its own build's chunks; hand
        // them over if an earlier release still has them, so it can boot and
        // update itself.
        const prior = serveAssetFromPriorRelease(url.pathname);
        if (prior) return prior;
        // A missing build artifact is a 404, never the shell — see
        // isBuildArtifact. Serving HTML here strands any client holding a
        // stale asset list on a blank page forever.
        return new Response("not found", {
          status: 404,
          headers: { "Cache-Control": "no-store" },
        });
      }
      return serveShell();
    }

    return new Response("method not allowed", { status: 405 });
  },
});

// Let root (Caddy) connect regardless of the runtime user.
try {
  chmodSync(SOCKET_PATH, 0o666);
} catch {}

console.log(`bins listening on unix:${SOCKET_PATH} (build ${BUILD_SHA})`);

// Print each group's access code, so it can always be recovered from the log
// rather than being unrecoverable once forgotten. See api/credentials.ts for
// the trade this makes.
await logGroupCredentials();
