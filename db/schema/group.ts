/**
 * Multi-group tenancy spine. Every tenant-scoped table carries a `group_id`
 * column — never assume a single group anywhere. A group is created by
 * scripts/create-group.ts (or the BOOTSTRAP_* env vars on first boot); members
 * join with the group's shared access code.
 */
import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const now = sql`(unixepoch() * 1000)`;

export const group = sqliteTable("group", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  /** sha256 hex of the normalized (trimmed, lowercased) access code. */
  accessCodeHash: text("access_code_hash").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(now),
});
