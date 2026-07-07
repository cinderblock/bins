/**
 * Batch short-ID allocation for QR sticker sheets. Allocation is server-
 * authored (it hands out the global integer sequence) but is emitted as
 * bin.allocate ops, so unclaimed bins reach every member's replica through the
 * one sync stream — which is what makes claiming a fresh sticker work offline.
 */
import { desc } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { db, schema } from "../db/client.server";
import { DrizzleStateStore } from "../db/store.server";
import {
  type CanonicalOp,
  SECRET_CODE_ALPHABET,
  SECRET_CODE_LENGTH,
} from "../shared/ops";
import { applyOp } from "../shared/reducer";
import { type Ctx, serializedTransaction } from "./context";

/** Short IDs start here — no bin 1; low numbers read as test noise. */
const FIRST_BIN_ID = 100;

/**
 * Mint a sticker secret. The tiny modulo bias (256 % 30 ≠ 0) is fine — the
 * codes are deliberately low-security (see shared/ops.ts).
 */
function generateSecretCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(SECRET_CODE_LENGTH));
  let code = "";
  for (const byte of bytes)
    code += SECRET_CODE_ALPHABET[byte % SECRET_CODE_ALPHABET.length];
  return code;
}

export const allocateSchema = z.object({
  count: z.number().int().min(1).max(200),
});

/**
 * Reserve `count` fresh short IDs for the group. Admin-only: the caller must
 * have passed the group's admin password (see api/admin.ts) — allocation hands
 * out the global integer sequence, so it's a provisioning action, not a
 * per-member one.
 */
export async function allocateBins(
  ctx: Ctx,
  count: number,
): Promise<{ id: number; code: string }[]> {
  return serializedTransaction(async () => {
    const store = new DrizzleStateStore(ctx.groupId);
    // The ID sequence is global across groups (URLs can't carry a group).
    const top = await db.query.bin.findFirst({
      orderBy: [desc(schema.bin.id)],
      columns: { id: true },
    });
    let nextId = Math.max((top?.id ?? 0) + 1, FIRST_BIN_ID);

    const allocated: { id: number; code: string }[] = [];
    const now = Date.now();
    for (let i = 0; i < count; i++) {
      const binId = nextId++;
      const code = generateSecretCode();
      const op: CanonicalOp = {
        opId: uuidv7(),
        type: "bin.allocate",
        binId,
        payload: { code },
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
          groupId: ctx.groupId,
          binId,
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
      allocated.push({ id: binId, code });
    }
    return allocated;
  });
}
