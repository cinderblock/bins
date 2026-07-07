/**
 * CORS for browser-based integrations. Configuration is per-integration: each
 * token carries an `allowedOrigins` allowlist (set by an admin), and a browser
 * request from a listed Origin gets the matching Access-Control-Allow-Origin.
 * "*" is honored only if an admin put it there (and only read scope may — see
 * api/admin.ts). Members are the same-origin PWA and need no CORS.
 *
 * Bearer tokens ride the Authorization header (not cookies), so we never send
 * Access-Control-Allow-Credentials; echoing the exact origin (or "*") is enough.
 */
import { eq } from "drizzle-orm";
import { db, schema } from "../db/client.server";
import type { Ctx } from "./context";

const ALLOW_METHODS = "GET, HEAD, POST, PUT, OPTIONS";
const ALLOW_HEADERS = "authorization, content-type";
const MAX_AGE = "600";

/** Only these paths are meant to be called cross-origin from another app. */
export function isCorsPath(path: string): boolean {
  return (
    path.startsWith("/api/v1/") ||
    path.startsWith("/api/blobs/") ||
    path === "/api/sync/pull" ||
    path === "/api/sync/push"
  );
}

/** The Allow-Origin value for `origin` given an allowlist, or null if blocked. */
function matchOrigin(origin: string, allowed: string[] | null): string | null {
  if (!allowed || allowed.length === 0) return null;
  if (allowed.includes("*")) return "*";
  return allowed.includes(origin) ? origin : null;
}

function corsHeaders(allowOrigin: string): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": ALLOW_METHODS,
    "Access-Control-Allow-Headers": ALLOW_HEADERS,
  };
  // Caches must key on Origin whenever the value isn't the wildcard.
  if (allowOrigin !== "*") headers.Vary = "Origin";
  return headers;
}

/**
 * Answer a CORS preflight. Preflight carries no Authorization header, so we
 * can't scope to one token — allow the attempt if ANY integration lists this
 * origin, then let the real (authenticated) request enforce the per-token
 * allowlist via withCors(). A 204 without CORS headers = the browser blocks it.
 */
export async function handlePreflight(req: Request): Promise<Response> {
  const origin = req.headers.get("origin");
  if (!origin) return new Response(null, { status: 204 });

  const integrations = await db.query.device.findMany({
    where: eq(schema.device.kind, "integration"),
    columns: { allowedOrigins: true },
  });
  const allowed =
    integrations.some((i) => matchOrigin(origin, i.allowedOrigins ?? null)) &&
    // Prefer echoing the exact origin unless someone allowed "*" for it.
    (integrations.some((i) => (i.allowedOrigins ?? []).includes("*"))
      ? "*"
      : origin);

  return new Response(null, {
    status: 204,
    headers: allowed
      ? { ...corsHeaders(allowed), "Access-Control-Max-Age": MAX_AGE }
      : undefined,
  });
}

/**
 * Attach CORS headers to a real response when the caller is an integration
 * whose allowlist covers the request Origin. No-op for same-origin/member
 * traffic and for origins the token doesn't list (the browser then blocks the
 * read, which is the intended enforcement).
 */
export function withCors(res: Response, req: Request, ctx: Ctx): Response {
  const origin = req.headers.get("origin");
  if (!origin || ctx.kind !== "integration") return res;
  const allow = matchOrigin(origin, ctx.allowedOrigins);
  if (!allow) return res;
  for (const [k, v] of Object.entries(corsHeaders(allow)))
    res.headers.set(k, v);
  return res;
}
