/**
 * Materialized bin state + entries — reducer output over the op log, kept
 * up-to-date inside the push transaction. Rebuildable by replay; never write
 * these outside the reducer (allocation inserts happen via a server-authored
 * bin.allocate op for exactly this reason).
 */
import {
  index,
  integer,
  real,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";
import { group } from "./group";

export const bin = sqliteTable(
  "bin",
  {
    /** The global short ID — the number in the QR URL (your-host/123). */
    id: integer("id").primaryKey(),
    groupId: text("group_id")
      .notNull()
      .references(() => group.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("unclaimed"),
    name: text("name"),
    sizeClass: text("size_class"),
    externalLabel: text("external_label"),
    locationName: text("location_name"),
    /** Derived: latest non-deleted contents_photo hash (see shared/reducer.ts). */
    primaryPhotoHash: text("primary_photo_hash"),
    fieldClocks: text("field_clocks", { mode: "json" })
      .notNull()
      .$type<Record<string, string>>(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("bin_group").on(t.groupId)],
);

export const binEntry = sqliteTable(
  "bin_entry",
  {
    /** = opId of the entry.addPhoto / entry.addNote op. */
    id: text("id").primaryKey(),
    groupId: text("group_id")
      .notNull()
      .references(() => group.id, { onDelete: "cascade" }),
    binId: integer("bin_id").notNull(),
    kind: text("kind").notNull(),
    text: text("text"),
    photoHash: text("photo_hash"),
    mime: text("mime"),
    deviceId: text("device_id"),
    effectiveTime: integer("effective_time").notNull(),
    geoLat: real("geo_lat"),
    geoLng: real("geo_lng"),
    geoAcc: real("geo_acc"),
    deletedByOpId: text("deleted_by_op_id"),
  },
  (t) => [
    index("bin_entry_bin").on(t.binId),
    index("bin_entry_group").on(t.groupId),
  ],
);
