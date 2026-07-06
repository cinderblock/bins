/**
 * Content-addressed photo blob registry. The file lives on disk at
 * PHOTOS_PATH/<hash[0:2]>/<hash>; this row records existence + metadata.
 * Ops may reference a hash before its blob is uploaded (offline capture) —
 * GET simply 404s until the upload lands.
 */
import {
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";
import { group, now } from "./group";

export const photoBlob = sqliteTable(
  "photo_blob",
  {
    groupId: text("group_id")
      .notNull()
      .references(() => group.id, { onDelete: "cascade" }),
    /** sha256 hex of the file bytes. */
    hash: text("hash").notNull(),
    mime: text("mime").notNull(),
    size: integer("size").notNull(),
    deviceId: text("device_id"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(now),
  },
  (t) => [primaryKey({ columns: [t.groupId, t.hash] })],
);
