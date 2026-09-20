/**
 * Passkeys that unlock ADMIN for a group.
 *
 * There are no accounts, so a passkey belongs to the group, not a person: it
 * is "a way to prove you are an admin of this group" that a phone or laptop
 * keeps in its own secure store, instead of the admin password typed into a
 * new device. Registering one needs admin already unlocked (password, or an
 * earlier passkey). Using one marks the calling DEVICE row as admin for a
 * while (device.admin_until), and every /api/admin/* call from that device
 * then passes without a password.
 */
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { group, now } from "./group";

export const passkey = sqliteTable(
  "passkey",
  {
    /** The credential id, base64url — what the authenticator presents. */
    id: text("id").primaryKey(),
    groupId: text("group_id")
      .notNull()
      .references(() => group.id, { onDelete: "cascade" }),
    /** COSE public key, base64url. */
    publicKey: text("public_key").notNull(),
    /** Signature counter, for clone detection where the authenticator has one. */
    counter: integer("counter").notNull().default(0),
    transports: text("transports", { mode: "json" }).$type<string[]>(),
    /** "Cameron's phone" — whatever the registrar called it. */
    label: text("label").notNull(),
    /** Which device registered it, for the admin list; null once revoked. */
    registeredBy: text("registered_by"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(now),
    lastUsedAt: integer("last_used_at", { mode: "timestamp_ms" }),
  },
  (t) => [index("passkey_group").on(t.groupId)],
);
