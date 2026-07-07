/**
 * Multi-group tenancy spine. Every tenant-scoped table carries a `group_id`
 * column — never assume a single group anywhere. The FIRST group is created
 * by the /setup page on a fresh database; additional groups by
 * scripts/create-group.ts. Members join by scanning a sticker (primary) or
 * with the group's shared access code (unlinked /join, bootstrap/fallback).
 */
import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const now = sql`(unixepoch() * 1000)`;

export const group = sqliteTable("group", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  /** sha256 hex of the normalized (trimmed, lowercased) access code. */
  accessCodeHash: text("access_code_hash").notNull(),
  /** Signed-out landing branding; null → "{name} Inventory Management System". */
  landingTitle: text("landing_title"),
  /** Signed-out landing subtitle; null → "Scan a Box to Start". */
  landingSubtitle: text("landing_subtitle"),
  /** sha256 hex of the /admin password. Null = admin surface disabled. */
  adminPasswordHash: text("admin_password_hash"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(now),
});
