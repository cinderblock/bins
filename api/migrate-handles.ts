/**
 * Give every box a handle.
 *
 * Handles arrived with bin.allocate in 2026-09; boxes allocated before that
 * have none, and on a deployment that keeps numbers internal a box with no
 * handle has no URL it is allowed to show. Runs at boot, once per handle-less
 * box, as a server-authored `bin.setHandle` op — through the reducer like
 * every other write, so the replica on every device learns the handle by
 * ordinary sync and nothing touches a materialized row by hand.
 */
import { isNull } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { db, schema } from "../db/client.server";
import { DrizzleStateStore } from "../db/store.server";
import type { CanonicalOp } from "../shared/ops";
import { applyOp } from "../shared/reducer";
import { serializedTransaction } from "./context";

/** Assign handles to every box that lacks one. Returns how many. */
export async function migrateMissingHandles(): Promise<number> {
  const missing = await db.query.bin.findMany({
    where: isNull(schema.bin.handle),
    columns: { id: true, groupId: true },
  });
  if (missing.length === 0) return 0;
  return serializedTransaction(async () => {
    let count = 0;
    for (const row of missing) {
      const store = new DrizzleStateStore(row.groupId);
      const now = Date.now();
      const op: CanonicalOp = {
        opId: uuidv7(),
        type: "bin.setHandle",
        binId: row.id,
        payload: { handle: crypto.randomUUID() },
        clientTime: now,
        geo: null,
        seq: null,
        deviceId: null,
        effectiveTime: now,
      };
      const inserted = await db
        .insert(schema.op)
        .values({
          opId: op.opId,
          groupId: row.groupId,
          binId: row.id,
          deviceId: null,
          type: op.type,
          payload: op.payload,
          clientTime: now,
          effectiveTime: now,
          serverTime: new Date(now),
        })
        .returning({ seq: schema.op.seq });
      op.seq = inserted[0]?.seq ?? null;
      await applyOp(store, op);
      count++;
    }
    return count;
  });
}

export async function migrateAllMissingHandles(): Promise<void> {
  try {
    const n = await migrateMissingHandles();
    if (n > 0) console.log(`bins: assigned handles to ${n} box(es)`);
  } catch (err) {
    console.error("bins: handle migration failed:", err);
  }
}
