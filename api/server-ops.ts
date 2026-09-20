/**
 * Author an op on the server's behalf.
 *
 * The same shape allocation, retire/restore and the box-size ops use: the
 * row goes into the op log with no device, and the reducer applies it in the
 * same serialized transaction — so a server-side write is never a special
 * case for the replicas, just another op they pull.
 */
import { v7 as uuidv7 } from "uuid";
import { db, schema } from "../db/client.server";
import { DrizzleStateStore } from "../db/store.server";
import type { CanonicalOp } from "../shared/ops";
import { applyOp } from "../shared/reducer";
import { serializedTransaction } from "./context";

export async function authorServerOp(
  groupId: string,
  op: { type: CanonicalOp["type"]; binId: number | null; payload: unknown },
): Promise<CanonicalOp> {
  return serializedTransaction(async () => {
    const store = new DrizzleStateStore(groupId);
    const now = Date.now();
    const canonical = {
      opId: uuidv7(),
      type: op.type,
      binId: op.binId,
      payload: op.payload,
      clientTime: now,
      geo: null,
      seq: null as number | null,
      deviceId: null,
      effectiveTime: now,
    } as unknown as CanonicalOp;
    const inserted = await db
      .insert(schema.op)
      .values({
        opId: canonical.opId,
        groupId,
        binId: op.binId,
        deviceId: null,
        type: op.type,
        payload: op.payload as Record<string, unknown>,
        clientTime: now,
        effectiveTime: now,
        serverTime: new Date(now),
      })
      .returning({ seq: schema.op.seq });
    canonical.seq = inserted[0]?.seq ?? null;
    await applyOp(store, canonical);
    return canonical;
  });
}
