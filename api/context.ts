/**
 * Request context + small helpers shared by the API handlers. Runs under Bun
 * in both dev (api/dev.ts, TCP) and production (server.ts, unix socket).
 */
import { eq } from "drizzle-orm";
import { db, schema, sqlite } from "../db/client.server";

export type Ctx = {
  deviceId: string;
  groupId: string;
  displayName: string;
};

export function sha256Hex(input: string | Uint8Array): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(input);
  return hasher.digest("hex");
}

export function json(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
}

export function error(status: number, message: string): Response {
  return json({ error: message }, { status });
}

/** Resolve the bearer token to a device, or null. */
export async function authenticate(req: Request): Promise<Ctx | null> {
  const header = req.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  if (!token) return null;
  const row = await db.query.device.findFirst({
    where: eq(schema.device.tokenHash, sha256Hex(token)),
  });
  if (!row) return null;
  // Touch lastSeenAt at most once an hour — this is a hot path.
  const now = Date.now();
  if (!row.lastSeenAt || now - row.lastSeenAt.getTime() > 3_600_000) {
    await db
      .update(schema.device)
      .set({ lastSeenAt: new Date(now) })
      .where(eq(schema.device.id, row.id));
  }
  return {
    deviceId: row.id,
    groupId: row.groupId,
    displayName: row.displayName,
  };
}

/**
 * Write serialization. bun:sqlite is a single synchronous connection, but
 * awaits inside a handler yield to the event loop, so two concurrent pushes
 * could interleave statements inside one BEGIN. All multi-statement write
 * sections (push, allocate) run through this queue + an explicit transaction.
 */
let writeQueue: Promise<unknown> = Promise.resolve();

export function serializedTransaction<T>(fn: () => Promise<T>): Promise<T> {
  const run = writeQueue.then(async () => {
    sqlite.exec("BEGIN IMMEDIATE;");
    try {
      const result = await fn();
      sqlite.exec("COMMIT;");
      return result;
    } catch (err) {
      sqlite.exec("ROLLBACK;");
      throw err;
    }
  });
  // Keep the queue alive even when a transaction fails.
  writeQueue = run.catch(() => {});
  return run;
}
