/**
 * Turn the legacy free-text `sizeClass` values into real size definitions.
 *
 * Before box sizes existed, a box's size was whatever string the UI happened
 * to offer — S, M, L, XL, hardcoded in a component. Those values are real
 * information about real boxes, so switching to definitions must not silently
 * orphan them.
 *
 * Op-driven, not a SQL UPDATE: writing materialized tables outside the reducer
 * is the one thing this codebase never does, and going through ops means every
 * replica converges on the same definitions through ordinary sync rather than
 * needing its own migration.
 *
 * Idempotent by construction — it does nothing at all for a group that already
 * has any box_size row, so restarts and redeploys can't duplicate definitions.
 */
import { eq } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { db, schema } from "../db/client.server";
import { DrizzleStateStore } from "../db/store.server";
import type { CanonicalOp } from "../shared/ops";
import { applyOp } from "../shared/reducer";
import { serializedTransaction } from "./context";

/** The old hardcoded list, so the migrated definitions keep a sane order. */
const LEGACY_ORDER = ["S", "M", "L", "XL"];

function sortOrderFor(name: string): number {
  const at = LEGACY_ORDER.indexOf(name.toUpperCase());
  // Anything hand-typed sorts after the four known ones, alphabetically-ish.
  return at === -1 ? LEGACY_ORDER.length : at;
}

async function writeOp(
  groupId: string,
  store: DrizzleStateStore,
  type: CanonicalOp["type"],
  binId: number | null,
  payload: Record<string, unknown>,
): Promise<void> {
  const now = Date.now();
  const op = {
    opId: uuidv7(),
    type,
    binId,
    payload,
    clientTime: now,
    geo: null,
    seq: null as number | null,
    deviceId: null,
    effectiveTime: now,
  } as unknown as CanonicalOp;
  const inserted = await db
    .insert(schema.op)
    .values({
      opId: op.opId,
      groupId,
      binId,
      deviceId: null,
      type,
      payload,
      clientTime: now,
      effectiveTime: now,
      serverTime: new Date(now),
    })
    .returning({ seq: schema.op.seq });
  op.seq = inserted[0]?.seq ?? null;
  await applyOp(store, op);
}

/** @returns how many definitions were created (0 = nothing to do). */
export async function migrateLegacySizes(groupId: string): Promise<number> {
  const already = await db.query.boxSize.findFirst({
    where: eq(schema.boxSize.groupId, groupId),
    columns: { id: true },
  });
  if (already) return 0;

  const bins = await db.query.bin.findMany({
    where: eq(schema.bin.groupId, groupId),
    columns: { id: true, sizeClass: true, sizeId: true },
  });
  const legacy = bins.filter((b) => b.sizeClass?.trim() && !b.sizeId);
  const names = [...new Set(legacy.map((b) => (b.sizeClass as string).trim()))];
  if (names.length === 0) return 0;

  names.sort((a, b) => sortOrderFor(a) - sortOrderFor(b) || a.localeCompare(b));

  await serializedTransaction(async () => {
    const store = new DrizzleStateStore(groupId);
    const idByName = new Map<string, string>();
    for (const [i, name] of names.entries()) {
      const sizeId = crypto.randomUUID();
      idByName.set(name, sizeId);
      // No dimensions: "M" never carried any, and inventing them would be
      // worse than leaving them blank for an admin to fill in.
      await writeOp(groupId, store, "boxSize.upsert", null, {
        sizeId,
        name,
        lengthMm: null,
        widthMm: null,
        heightMm: null,
        sortOrder: i,
      });
    }
    for (const bin of legacy) {
      const sizeId = idByName.get((bin.sizeClass as string).trim());
      if (!sizeId) continue;
      // An ordinary field write, so it competes on the normal LWW clock — if
      // someone sets a size by hand later, that simply wins.
      await writeOp(groupId, store, "bin.setFields", bin.id, { sizeId });
    }
  });

  return names.length;
}

/** Run for every group on boot. Never throws into the startup path. */
export async function migrateAllLegacySizes(): Promise<void> {
  try {
    const groups = await db.query.group.findMany({ columns: { id: true } });
    for (const g of groups) {
      const created = await migrateLegacySizes(g.id);
      if (created > 0) {
        console.log(
          `bins: created ${created} box size(s) from legacy size labels`,
        );
      }
    }
  } catch (err) {
    console.error("bins: legacy size migration failed:", err);
  }
}
