import { handleAdmin } from "./admin";
import { handleAllocate } from "./allocate";
import { handleDevices, handleJoin, handleJoinByBin, handleMe } from "./auth";
import { handleBlob } from "./blobs";
/**
 * Tiny hand-rolled API router — the whole surface is small enough that a
 * framework would be more code than this. Mounted at /api by both api/dev.ts
 * (dev, TCP) and server.ts (production, unix socket).
 */
import { authenticate, error } from "./context";
import { handleLanding } from "./landing";
import { handleSetup } from "./setup";
import { handlePull, handlePush } from "./sync";

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

    if (path === "/api/auth/me" && (method === "GET" || method === "PATCH")) {
      return await handleMe(req, ctx);
    }
    if (path === "/api/devices" && method === "GET")
      return await handleDevices(ctx);
    if (path === "/api/sync/push" && method === "POST")
      return await handlePush(req, ctx);
    if (path === "/api/sync/pull" && method === "GET")
      return await handlePull(req, ctx);
    if (path === "/api/bins/allocate" && method === "POST") {
      return await handleAllocate(req, ctx);
    }
    // Member token + per-request admin password (checked inside).
    if (path.startsWith("/api/admin/") && method === "POST") {
      return await handleAdmin(req, ctx, path);
    }

    const blobMatch = path.match(/^\/api\/blobs\/([0-9a-f]{64})$/);
    if (blobMatch?.[1] && ["GET", "HEAD", "PUT"].includes(method)) {
      return await handleBlob(req, ctx, blobMatch[1]);
    }

    return error(404, "no such endpoint");
  } catch (err) {
    console.error(`API error on ${method} ${path}:`, err);
    return error(500, "internal error");
  }
}
