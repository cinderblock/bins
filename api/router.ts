import { handleAdmin } from "./admin";
import { handleDevices, handleJoin, handleJoinByBin, handleMe } from "./auth";
import { handleBlob } from "./blobs";
/**
 * Tiny hand-rolled API router — the whole surface is small enough that a
 * framework would be more code than this. Mounted at /api by both api/dev.ts
 * (dev, TCP) and server.ts (production, unix socket).
 */
import { authenticate, canWrite, error } from "./context";
import { handleLanding } from "./landing";
import { handleSetup } from "./setup";
import { handlePull, handlePush } from "./sync";
import { handleV1 } from "./v1";

export async function handleApi(req: Request, url: URL): Promise<Response> {
  const path = url.pathname;
  const method = req.method;

  try {
    // Unauthenticated surface: joining, landing branding, first-boot setup.
    if (path === "/api/auth/join" && method === "POST")
      return await handleJoin(req);
    if (path === "/api/auth/join-by-bin" && method === "POST")
      return await handleJoinByBin(req);
    if (path === "/api/landing" && method === "GET")
      return await handleLanding();
    if (path === "/api/setup" && method === "POST")
      return await handleSetup(req);

    const ctx = await authenticate(req);
    if (!ctx) return error(401, "unauthorized");

    // Public, versioned read/embed surface for integration tokens (and members).
    if (path.startsWith("/api/v1/")) {
      return await handleV1(req, ctx, path);
    }

    if (path === "/api/auth/me" && (method === "GET" || method === "PATCH")) {
      return await handleMe(req, ctx);
    }
    if (path === "/api/devices" && method === "GET")
      return await handleDevices(ctx);
    if (path === "/api/sync/push" && method === "POST") {
      // Writes go through the reducer as ops; read-only tokens can't push.
      if (!canWrite(ctx)) return error(403, "write scope required");
      return await handlePush(req, ctx);
    }
    if (path === "/api/sync/pull" && method === "GET")
      return await handlePull(req, ctx);
    // Admin is member-only: an integration credential never administers a group.
    if (path.startsWith("/api/admin/") && method === "POST") {
      if (ctx.kind !== "member") return error(403, "members only");
      return await handleAdmin(req, ctx, path);
    }

    const blobMatch = path.match(/^\/api\/blobs\/([0-9a-f]{64})$/);
    if (blobMatch?.[1] && ["GET", "HEAD", "PUT"].includes(method)) {
      // Uploading a blob is a write; read-only tokens may only GET/HEAD.
      if (method === "PUT" && !canWrite(ctx))
        return error(403, "write scope required");
      return await handleBlob(req, ctx, blobMatch[1]);
    }

    return error(404, "no such endpoint");
  } catch (err) {
    console.error(`API error on ${method} ${path}:`, err);
    return error(500, "internal error");
  }
}
