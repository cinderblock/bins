/**
 * The sync endpoints: push (client ops in) and pull (canonical ops out).
 * Push is idempotent per opId, clamps client clocks into effectiveTime, and
 * materializes state via the shared reducer inside one serialized transaction.
 */
import { and, desc, eq, gt, inArray } from "drizzle-orm";
import { db, schema } from "../db/client.server";
import { DrizzleStateStore } from "../db/store.server";
import {
  type CanonicalOp,
  MAX_CLOCK_SKEW_MS,
  type PullResponse,
  type PushResponse,
  pushRequestSchema,
} from "../shared/ops";
import { applyOp } from "../shared/reducer";
import { type Ctx, error, json, serializedTransaction } from "./context";

async function latestSeqFor(groupId: string): Promise<number> {
  const row = await db.query.op.findFirst({
    where: eq(schema.op.groupId, groupId),
    orderBy: [desc(schema.op.seq)],
    columns: { seq: true },
  });
  return row?.seq ?? 0;
}

export async function handlePush(req: Request, ctx: Ctx): Promise<Response> {
  const parsed = pushRequestSchema.safeParse(
    await req.json().catch(() => null),
  );
  if (!parsed.success) return error(400, "invalid push payload");
  const ops = parsed.data.ops;

  const result = await serializedTransaction(async () => {
    const store = new DrizzleStateStore(ctx.groupId);
    const acks: PushResponse["acks"] = [];
    const rejected: { opId: string; error: string }[] = [];

    // Idempotency: any op we've already ingested just re-acks its seq.
    const existing = await db.query.op.findMany({
      where: inArray(
        schema.op.opId,
        ops.map((o) => o.opId),
      ),
      columns: { opId: true, seq: true, groupId: true },
    });
    const seen = new Map(existing.map((row) => [row.opId, row]));

    for (const wireOp of ops) {
      const dup = seen.get(wireOp.opId);
      if (dup) {
        if (dup.groupId === ctx.groupId)
          acks.push({ opId: wireOp.opId, seq: dup.seq });
        else rejected.push({ opId: wireOp.opId, error: "opId collision" });
        continue;
      }

      // Ops that target a bin may only touch bins in the caller's group. Bins
      // exist before any client op (allocation is server-authored), so a miss
      // means "foreign group or never allocated" — reject either way.
      if ("binId" in wireOp && wireOp.binId !== undefined) {
        const bin = await store.getBin(wireOp.binId);
        if (!bin) {
          rejected.push({ opId: wireOp.opId, error: "unknown bin" });
          continue;
        }
      }

      const now = Date.now();
      const effectiveTime = Math.min(
        wireOp.clientTime,
        now + MAX_CLOCK_SKEW_MS,
      );
      const inserted = await db
        .insert(schema.op)
        .values({
          opId: wireOp.opId,
          groupId: ctx.groupId,
          binId: "binId" in wireOp ? (wireOp.binId ?? null) : null,
          deviceId: ctx.deviceId,
          type: wireOp.type,
          payload: wireOp.payload,
          clientTime: wireOp.clientTime,
          effectiveTime,
          serverTime: new Date(now),
          geoLat: wireOp.geo?.lat ?? null,
          geoLng: wireOp.geo?.lng ?? null,
          geoAcc: wireOp.geo?.acc ?? null,
        })
        .returning({ seq: schema.op.seq });
      const seq = inserted[0]?.seq;
      if (seq === undefined) throw new Error("op insert returned no seq");

      const canonical: CanonicalOp = {
        ...wireOp,
        seq,
        deviceId: ctx.deviceId,
        effectiveTime,
      };
      await applyOp(store, canonical);
      acks.push({ opId: wireOp.opId, seq });
    }

    const latestSeq = await latestSeqFor(ctx.groupId);
    return { acks, rejected, latestSeq } satisfies PushResponse & {
      rejected: unknown;
    };
  });

  return json(result);
}

export async function handlePull(req: Request, ctx: Ctx): Promise<Response> {
  const url = new URL(req.url);
  const since = Number(url.searchParams.get("since") ?? 0);
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 500), 1000);
  if (!Number.isFinite(since) || since < 0) return error(400, "bad cursor");

  const rows = await db.query.op.findMany({
    where: and(eq(schema.op.groupId, ctx.groupId), gt(schema.op.seq, since)),
    orderBy: [schema.op.seq],
    limit: limit + 1,
  });
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  const ops = page.map(
    (row) =>
      ({
        opId: row.opId,
        type: row.type,
        binId: row.binId ?? undefined,
        payload: row.payload,
        clientTime: row.clientTime,
        geo:
          row.geoLat !== null && row.geoLng !== null
            ? { lat: row.geoLat, lng: row.geoLng, acc: row.geoAcc ?? 0 }
            : null,
        seq: row.seq,
        deviceId: row.deviceId,
        effectiveTime: row.effectiveTime,
      }) as CanonicalOp,
  );

  const latestSeq = await latestSeqFor(ctx.groupId);
  return json({ ops, latestSeq, hasMore } satisfies PullResponse);
}
