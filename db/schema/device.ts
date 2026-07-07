/**
 * A device is both "account" and "session": one row per phone/install, created
 * when someone enters the group access code + a display name. Its bearer token
 * (stored hashed) authenticates every API call; ops record authorship as
 * deviceId. Revocation = delete the row.
 *
 * An INTEGRATION (kind="integration") is the same row type wearing a different
 * hat: an admin-minted API credential for an external app we control, carrying
 * a `scope` (read | write) and an optional CORS origin allowlist. Reusing the
 * device row means op authorship (op.deviceId) and the /api/devices name cache
 * attribute integration writes for free; the human device list filters these
 * out and the admin integrations list filters the opposite way.
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
    /** "member" (a person's install) or "integration" (an API credential). */
    kind: text("kind").notNull().default("member"),
    /** Integrations only: "read" | "write" (write implies read). Null for members. */
    scope: text("scope"),
    /** Integrations only: CORS origin allowlist; null/[] = no browser origins. */
    allowedOrigins: text("allowed_origins", { mode: "json" }).$type<string[]>(),
    /** Integrations only: the token's non-secret prefix, shown in admin to ID it. */
    tokenPrefix: text("token_prefix"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(now),
    lastSeenAt: integer("last_seen_at", { mode: "timestamp_ms" }),
  },
  (t) => [index("device_group").on(t.groupId)],
);
