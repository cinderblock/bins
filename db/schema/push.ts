/**
 * Web-push subscriptions for admin notifications.
 *
 * NOT op-driven, and deliberately so: a push subscription is a fact about one
 * browser's relationship with one push service, not group data. It must never
 * sync to other devices — replicating someone else's endpoint would let any
 * member's replica hold the keys to notify them.
 *
 * A row exists only for a device that unlocked admin and opted in (see
 * api/push.ts). The device FK cascades, so revoking a device also stops its
 * notifications.
 */
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { device } from "./device";
import { group } from "./group";

export const pushSubscription = sqliteTable(
  "push_subscription",
  {
    id: text("id").primaryKey(),
    groupId: text("group_id")
      .notNull()
      .references(() => group.id, { onDelete: "cascade" }),
    deviceId: text("device_id")
      .notNull()
      .references(() => device.id, { onDelete: "cascade" }),
    /** The push service URL the browser handed us. Opaque, and a secret. */
    endpoint: text("endpoint").notNull(),
    /** Subscription public key (base64url), for the ECDH content encryption. */
    p256dh: text("p256dh").notNull(),
    /** Subscription auth secret (base64url). */
    auth: text("auth").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    /** Last delivery the push service accepted — a liveness hint for admins. */
    lastOkAt: integer("last_ok_at", { mode: "timestamp_ms" }),
  },
  (t) => [
    // One row per browser: re-subscribing on the same device (or after a
    // reinstall that reuses the endpoint) must replace, never duplicate.
    uniqueIndex("push_subscription_endpoint").on(t.endpoint),
    index("push_subscription_group").on(t.groupId),
    index("push_subscription_device").on(t.deviceId),
  ],
);
