// Production server: static SPA build + /api/* + SPA fallback, bound directly
// to a unix socket (no TCP port). A TLS-terminating reverse proxy on the host
// (Caddy, nginx, …) forwards the public origin to the socket, passing
// X-Forwarded-Proto/-For.
//
// Importing db/client.server (via the API) migrates the SQLite db on boot.

import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
} from "node:fs";
import { dirname } from "node:path";
import { handleApi } from "./api/router";

const SOCKET_PATH = process.env.SOCKET_PATH ?? "/run/bins/bins.sock";
const CLIENT_DIR = `${import.meta.dir}/build/client`;

// The git SHA this release was built from — written into the release tree by
// CI (deploy.yml) and served at /_version so the deploy can confirm the new
// build actually took over. "dev" outside a release.
const BUILD_SHA = (() => {
  if (process.env.BUILD_SHA) return process.env.BUILD_SHA.trim();
  try {
    return readFileSync(`${import.meta.dir}/BUILD_SHA`, "utf8").trim();
  } catch {
    return "dev";
  }
})();

function serveAsset(pathname: string): Response | undefined {
  if (pathname === "/" || pathname.includes("..")) return undefined;
  const file = Bun.file(`${CLIENT_DIR}${pathname}`);
  if (!file.size) return undefined;
  const cacheControl = pathname.startsWith("/assets/")
    ? "public, max-age=31536000, immutable"
    : "public, max-age=3600";
  return new Response(file, { headers: { "Cache-Control": cacheControl } });
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
