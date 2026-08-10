/**
 * Errors that happened in someone's browser.
 *
 * Deliberately NOT op-driven, for the same reason push subscriptions aren't:
 * this is diagnostics, not shared state. Nobody's replica needs a copy of
 * another device's stack traces, and replicating them would put every member's
 * failures on every member's phone.
 *
 * Deduplicated by `fingerprint` with a count, so a crash loop costs one row
 * that climbs rather than thousands that fill the disk.
 */
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { group } from "./group";
import { now } from "./group";

export const clientError = sqliteTable(
  "client_error",
  {
    id: text("id").primaryKey(),
    groupId: text("group_id")
      .notNull()
      .references(() => group.id, { onDelete: "cascade" }),
    /** Null once the device is revoked — the error stays, the link doesn't. */
    deviceId: text("device_id"),
    /** sha256 of (build, kind, message, first stack frame) — the dedupe key. */
    fingerprint: text("fingerprint").notNull(),
    /** Where it came from: "unhandled", "rejection", "chunk", "render", … */
    kind: text("kind").notNull(),
    message: text("message").notNull(),
    stack: text("stack"),
    /** App route at the time, so a bug can be reproduced. */
    route: text("route"),
    /** Which build — the single most useful field when triaging. */
    buildSha: text("build_sha"),
    userAgent: text("user_agent"),
    count: integer("count").notNull().default(1),
    firstSeenAt: integer("first_seen_at", { mode: "timestamp_ms" })
      .notNull()
      .default(now),
    lastSeenAt: integer("last_seen_at", { mode: "timestamp_ms" })
      .notNull()
      .default(now),
  },
  (t) => [
    index("client_error_group").on(t.groupId),
    index("client_error_fingerprint").on(t.groupId, t.fingerprint),
  ],
);
