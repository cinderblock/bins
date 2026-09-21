import { handleAdmin } from "./admin";
import { assistantStatus, handleAskRequest } from "./ai/handler";
import {
  handleDevices,
  handleJoin,
  handleJoinByAdmin,
  handleJoinByBin,
  handleJoinOpen,
  handleMe,
} from "./auth";
import { handleBlob } from "./blobs";
/**
 * Tiny hand-rolled API router — the whole surface is small enough that a
 * framework would be more code than this. Mounted at /api by both api/dev.ts
 * (dev, TCP) and server.ts (production, unix socket).
 */
import { isRemote } from "./config";
import { type Ctx, authenticate, canWrite, error, json } from "./context";
import { handlePreflight, isCorsPath, withCors } from "./cors";
import { handleErrorReport } from "./errors";
import { handleLanding } from "./landing";
import {
  handlePasskeyLoginOptions,
  handlePasskeyLoginVerify,
  handlePasskeyLogout,
  handlePasskeyStatus,
} from "./passkeys";
import { handlePushStatus, handleUnsubscribe } from "./push";
import { handleRecover } from "./recover";
import { handleSetup } from "./setup";
import { handlePull, handlePush } from "./sync";
import { handleV1 } from "./v1";

/**
 * The one refusal a remote visitor gets. The client matches this string
 * (app/lib/api.ts) to show the passkey sign-in, so it is a contract.
 */
export const PASSKEY_REQUIRED = "passkey required";

export async function handleApi(req: Request, url: URL): Promise<Response> {
  const path = url.pathname;
  const method = req.method;

  try {
    // CORS preflight carries no Authorization header — answer it before auth.
    if (method === "OPTIONS" && isCorsPath(path))
      return await handlePreflight(req);

    // Off the perimeter on a REMOTE_ACCESS=passkey deployment, the only way
    // in is a passkey: every flavour of join, and first-boot setup, are
    // LAN-only. Same message the gate below uses, so the client has one
    // string to recognise.
    const remote = isRemote(req);
    if (remote && (path.startsWith("/api/auth/join") || path === "/api/setup"))
      return error(403, PASSKEY_REQUIRED);

    // Unauthenticated surface: joining, landing branding, first-boot setup.
    if (path === "/api/auth/join" && method === "POST")
      return await handleJoin(req);
    if (path === "/api/auth/join-by-bin" && method === "POST")
      return await handleJoinByBin(req);
    // The admin password authorises strictly more than the access code, so it
    // must not leave someone locked out behind the weaker one.
    if (path === "/api/auth/join-by-admin" && method === "POST")
      return await handleJoinByAdmin(req);
    // 404s unless the deployment declares itself perimeter-protected.
    if (path === "/api/auth/join-open" && method === "POST")
      return await handleJoinOpen(req);
    if (path === "/api/landing" && method === "GET")
      return await handleLanding(req);
    // Under /api/ on purpose: that prefix is the service worker's navigation
    // denylist, so this reaches the server even from a device a stale worker
    // has stranded. See api/recover.ts.
    // `/api/r` is the one to read out loud: short, AND under the prefix that
    // every worker ever deployed already refuses to intercept — so it reaches
    // the server even from a device stranded on an old build. (`/reset` and
    // `/r` are nicer still, but only work for builds new enough to have them
    // in the worker's denylist.)
    if ((path === "/api/recover" || path === "/api/r") && method === "GET") {
      return handleRecover();
    }
    if (path === "/api/setup" && method === "POST")
      return await handleSetup(req);

    const ctx = await authenticate(req);

    // The passkey login ceremony works with OR without a device: a joined
    // device becomes admin, a fresh browser (an admin reaching in from the
    // internet) gets a device minted for it. That is why these two sit
    // before the 401 and before the remote gate — they are the way through
    // both. Members only when there is a token: an integration credential
    // never turns into an admin.
    if (path === "/api/passkey/login/options" && method === "POST") {
      if (ctx && ctx.kind !== "member") return error(403, "members only");
      return await handlePasskeyLoginOptions(req, ctx);
    }
    if (path === "/api/passkey/login/verify" && method === "POST") {
      if (ctx && ctx.kind !== "member") return error(403, "members only");
      return await handlePasskeyLoginVerify(
        req,
        ctx,
        await req.json().catch(() => null),
      );
    }

    if (!ctx) return error(401, "unauthorized");

    // The remote gate: off the perimeter, only a device with a live passkey
    // session is served — anything else (a member who joined on the LAN and
    // took the phone home, an integration token, an admin whose session ran
    // out) gets a 403 the client turns into the passkey sign-in card. 403
    // and not 401 on purpose: 401 means "your token is dead, re-join", and
    // re-joining is exactly what can't happen from here.
    if (remote && !(ctx.adminUntil !== null && ctx.adminUntil > Date.now()))
      return error(403, PASSKEY_REQUIRED);

    // Integration browser calls get CORS headers on their real response.
    return withCors(await dispatch(req, url, ctx, path, method), req, ctx);
  } catch (err) {
    console.error(`API error on ${method} ${path}:`, err);
    return error(500, "internal error");
  }
}

/** Authenticated routing. Its result is CORS-decorated by the caller. */
async function dispatch(
  req: Request,
  url: URL,
  ctx: Ctx,
  path: string,
  method: string,
): Promise<Response> {
  // Public, versioned read/embed surface for integration tokens (and members).
  if (path.startsWith("/api/v1/")) {
    return await handleV1(req, ctx, path);
  }

  if (path === "/api/auth/me" && (method === "GET" || method === "PATCH")) {
    return await handleMe(req, ctx);
  }
  // Any member device can report its own failures — the whole point is that
  // errors reach us without anyone having to notice or retype them.
  if (path === "/api/errors" && method === "POST")
    return await handleErrorReport(req, ctx);
  if (path === "/api/devices" && method === "GET")
    return await handleDevices(ctx);
  if (path === "/api/sync/push" && method === "POST") {
    // Writes go through the reducer as ops; read-only tokens can't push.
    if (!canWrite(ctx)) return error(403, "write scope required");
    return await handlePush(req, ctx);
  }
  if (path === "/api/sync/pull" && method === "GET")
    return await handlePull(req, ctx);
  // Silencing yourself needs no admin password — see api/push.ts. (Turning
  // notifications ON does, and lives under /api/admin/push/subscribe.)
  if (path === "/api/push/status" && method === "GET")
    return await handlePushStatus(ctx);
  if (path === "/api/push/unsubscribe" && method === "POST")
    return await handleUnsubscribe(ctx);
  // Passkey status and lock for a joined device (the login ceremony itself is
  // routed before authentication — see handleApi).
  if (path.startsWith("/api/passkey/") && method === "POST") {
    if (ctx.kind !== "member") return error(403, "members only");
    if (path === "/api/passkey/status") return await handlePasskeyStatus(ctx);
    if (path === "/api/passkey/logout") return await handlePasskeyLogout(ctx);
    return error(404, "no such endpoint");
  }
  // Admin is member-only: an integration credential never administers a group.
  if (path.startsWith("/api/admin/") && method === "POST") {
    if (ctx.kind !== "member") return error(403, "members only");
    return await handleAdmin(req, ctx, path);
  }

  // The AI assistant. Member-facing by default (see aiAssistAdminOnly) —
  // asking where a box goes is the everyday flow, not a provisioning action.
  if (path.startsWith("/api/ai/")) {
    if (path === "/api/ai/status" && method === "GET")
      return json(assistantStatus());
    if (path === "/api/ai/ask" && method === "POST")
      return await handleAskRequest(req, ctx);
    return error(404, "no such endpoint");
  }

  const blobMatch = path.match(/^\/api\/blobs\/([0-9a-f]{64})$/);
  if (blobMatch?.[1] && ["GET", "HEAD", "PUT"].includes(method)) {
    // Uploading a blob is a write; read-only tokens may only GET/HEAD.
    if (method === "PUT" && !canWrite(ctx))
      return error(403, "write scope required");
    return await handleBlob(req, ctx, blobMatch[1]);
  }

  return error(404, "no such endpoint");
}
