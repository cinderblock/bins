/**
 * Capture what went wrong in the browser, and get it to the server.
 *
 * Before this, an error a user hit left no trace anywhere. The only record of
 * a real one was somebody typing "Ran out of photo space" into a box's notes,
 * and several of the app's worst bugs — a shell that couldn't boot, route
 * chunks 404ing after a deploy, a hooks-order crash on /bins — were invisible
 * for the same reason. All of them would have shown up here.
 *
 * Queued in Dexie rather than posted immediately, because this app is used
 * where there is no signal and the errors worth having are exactly the ones
 * that happen out there. The queue is capped so a crash loop can't eat the
 * device's storage — which would be an ugly way for a diagnostics feature to
 * cause the very failure it is meant to report.
 */
import { apiFetch } from "./api";
import { db, getIdentity } from "./db";

/** Local queue cap. Beyond this the oldest are dropped, not the newest. */
const MAX_QUEUED = 50;
/** Per batch, matching the server's limit. */
const MAX_BATCH = 20;

/** Don't re-queue the same problem over and over within one session. */
const seenThisSession = new Set<string>();
const MAX_SESSION_KEYS = 100;

export type ErrorKind =
  | "unhandled"
  | "rejection"
  | "chunk"
  | "render"
  | "capture"
  | "sync";

function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message || err.name;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err).slice(0, 200);
  } catch {
    return String(err);
  }
}

/**
 * Record an error. Never throws and never awaits anything the caller needs —
 * reporting a problem must not be able to create one.
 */
export function reportError(
  kind: ErrorKind,
  err: unknown,
  route?: string,
): void {
  void (async () => {
    try {
      const message = messageOf(err).slice(0, 500);
      if (!message) return;
      const stack = err instanceof Error ? (err.stack ?? null) : null;
      const key = `${kind}|${message}|${(stack ?? "").split("\n")[1] ?? ""}`;
      if (seenThisSession.has(key)) return;
      if (seenThisSession.size < MAX_SESSION_KEYS) seenThisSession.add(key);

      await db.errorQueue.add({
        kind,
        message,
        stack: stack?.slice(0, 4000) ?? null,
        route: route ?? location.pathname,
        buildSha: __BUILD_SHA__,
        userAgent: navigator.userAgent.slice(0, 300),
        at: Date.now(),
      });

      const excess = (await db.errorQueue.count()) - MAX_QUEUED;
      if (excess > 0) {
        const oldest = await db.errorQueue
          .orderBy("at")
          .limit(excess)
          .toArray();
        await db.errorQueue.bulkDelete(
          oldest.map((row) => row.id).filter((id): id is number => id != null),
        );
      }
    } catch {
      // A diagnostics path that throws is worse than one that misses.
    }
  })();
}

/** Ship whatever is queued. Called from the sync cycle; safe to call often. */
export async function flushErrors(): Promise<void> {
  try {
    if (!(await getIdentity())) return;
    const batch = await db.errorQueue.orderBy("at").limit(MAX_BATCH).toArray();
    if (batch.length === 0) return;
    const res = await apiFetch("/api/errors", {
      method: "POST",
      body: JSON.stringify({
        errors: batch.map(({ id, ...e }) => e),
      }),
    });
    if (!res.ok) return; // Try again next cycle; the queue is capped anyway.
    await db.errorQueue.bulkDelete(
      batch.map((row) => row.id).filter((id): id is number => id != null),
    );
  } catch {
    // Offline, most likely. The queue is the whole point.
  }
}

let installed = false;

/**
 * Hook the browser's global failure signals.
 *
 * `vite:preloadError` is the one that matters most here: it fires when a lazy
 * route chunk can't load, which is precisely the "tapping /admin does
 * nothing" failure that took a day to diagnose by hand.
 */
export function installErrorReporting(): void {
  if (installed) return;
  installed = true;

  window.addEventListener("error", (event) => {
    reportError("unhandled", event.error ?? event.message);
  });
  window.addEventListener("unhandledrejection", (event) => {
    reportError("rejection", event.reason);
  });
  window.addEventListener("vite:preloadError", (event) => {
    reportError("chunk", event.payload ?? "a part of the app failed to load");
  });
}
