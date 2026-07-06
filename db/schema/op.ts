/**
 * The append-only op log — the single source of truth for all group data.
 * `seq` (autoincrement) is the sync cursor; `op_id` the idempotency key.
 * bin/bin_entry/location are pure materializations of this table (rebuildable
 * with scripts/rebuild-materialized.ts).
 */
import {
  index,
  integer,
  real,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";
import { device } from "./device";
import { group, now } from "./group";

export const op = sqliteTable(
  "op",
  {
    /** Global total order (per deploy); clients pull per-group slices by seq. */
    seq: integer("seq").primaryKey({ autoIncrement: true }),
    opId: text("op_id").notNull().unique(),
    groupId: text("group_id")
      .notNull()
      .references(() => group.id, { onDelete: "cascade" }),
    binId: integer("bin_id"),
    /** Null = server-authored (e.g. bin.allocate). */
    deviceId: text("device_id").references(() => device.id, {
      onDelete: "set null",
    }),
    type: text("type").notNull(),
    payload: text("payload", { mode: "json" }).notNull(),
    /** Raw device wall clock (ms). */
    clientTime: integer("client_time").notNull(),
    /** clientTime clamped at ingest — the LWW comparison time. */
    effectiveTime: integer("effective_time").notNull(),
    serverTime: integer("server_time", { mode: "timestamp_ms" })
      .notNull()
      .default(now),
    geoLat: real("geo_lat"),
    geoLng: real("geo_lng"),
    geoAcc: real("geo_acc"),
  },
  (t) => [index("op_group_seq").on(t.groupId, t.seq)],
);
