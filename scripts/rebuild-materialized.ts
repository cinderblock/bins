/**
 * Rebuild all materialized tables (bin, bin_entry, location) by replaying the
 * op log through the shared reducer — proof the log is the source of truth,
 * and the recovery tool if a reducer bug ever corrupts materialized state.
 *
 *   bun scripts/rebuild-materialized.ts
 */
import { db, schema, sqlite } from "../db/client.server";
import { DrizzleStateStore } from "../db/store.server";
import type { CanonicalOp } from "../shared/ops";
import { applyOp } from "../shared/reducer";

const ops = await db.query.op.findMany({ orderBy: [schema.op.seq] });

sqlite.exec("BEGIN IMMEDIATE;");
try {
  await db.delete(schema.binEntry);
  await db.delete(schema.bin);
  await db.delete(schema.location);

  const stores = new Map<string, DrizzleStateStore>();
  for (const row of ops) {
    let store = stores.get(row.groupId);
    if (!store) {
      store = new DrizzleStateStore(row.groupId);
      stores.set(row.groupId, store);
    }
    const op = {
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
    } as CanonicalOp;
    await applyOp(store, op);
  }
  sqlite.exec("COMMIT;");
  console.log(`replayed ${ops.length} ops across ${stores.size} group(s)`);
} catch (err) {
  sqlite.exec("ROLLBACK;");
  throw err;
}
