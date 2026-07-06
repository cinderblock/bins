/**
 * A device is both "account" and "session": one row per phone/install, created
 * when someone enters the group access code + a display name. Its bearer token
 * (stored hashed) authenticates every API call; ops record authorship as
 * deviceId. Revocation = delete the row.
 */
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { group, now } from "./group";

export const device = sqliteTable(
  "device",
  {
    /** Client-generated uuid, so a device can identify itself before joining. */
    id: text("id").primaryKey(),
    groupId: text("group_id")
      .notNull()
      .references(() => group.id, { onDelete: "cascade" }),
    displayName: text("display_name").notNull(),
    /** sha256 hex of the opaque bearer token (issued once, never stored raw). */
    tokenHash: text("token_hash").notNull().unique(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(now),
    lastSeenAt: integer("last_seen_at", { mode: "timestamp_ms" }),
  },
  (t) => [index("device_group").on(t.groupId)],
);
