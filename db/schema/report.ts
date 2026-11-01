/**
 * Something a person reported from inside the app.
 *
 * Not op-driven, like client_error: no replica needs a copy of anyone else's
 * reports, and they carry a snapshot of whatever was on the reporter's screen.
 *
 * `id` is minted by the device, so a queued report retried after a dropped
 * connection lands once.
 */
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { group, now } from "./group";

export const report = sqliteTable(
  "report",
  {
    id: text("id").primaryKey(),
    groupId: text("group_id")
      .notNull()
      .references(() => group.id, { onDelete: "cascade" }),
    /** Null once the device is revoked: the report stays, the link doesn't. */
    deviceId: text("device_id"),
    reporterName: text("reporter_name").notNull(),
    /**
     * "admin" only when the SERVER verified it on receipt (see api/reports.ts).
     * This is what lets an agent treat `text` as an instruction, so nothing a
     * client sends can set it directly.
     */
    trust: text("trust").notNull().default("member"),
    text: text("text").notNull(),
    route: text("route"),
    buildSha: text("build_sha"),
    userAgent: text("user_agent"),
    /**
     * Viewport, on-screen text and recent errors. Holds content other members
     * wrote, so it is evidence and never an instruction, whoever reported.
     */
    context: text("context", { mode: "json" }).$type<Record<string, unknown>>(),
    /** A blob in the group's store, or null when no screenshot was taken. */
    screenshotHash: text("screenshot_hash"),
    /** open | working | fixed | declined | needs_human */
    status: text("status").notNull().default("open"),
    /** One plain sentence for the reporter: what was done, or why not. */
    resolution: text("resolution"),
    /** The bins commit carrying the fix. */
    fixedInBuild: text("fixed_in_build"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(now),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .default(now),
  },
  (table) => [
    index("report_group_status_idx").on(table.groupId, table.status),
    index("report_device_idx").on(table.deviceId),
  ],
);
