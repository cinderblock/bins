/**
 * What a model saw in a given photo — a derived CACHE, not group state.
 *
 * Deliberately not a materialized table and deliberately not group-scoped.
 * It is keyed by the photo's content hash, exactly like the blob store and
 * the label-art cache, so the same image is never paid for twice: a photo
 * deleted and re-added, an entry rebuilt from the log, or a second box that
 * happens to hold the identical picture all hit this instead of the provider.
 *
 * The authoritative copy of a description lives on the bin_entry row, put
 * there by the `entry.setAiItems` op — that is what syncs to replicas and
 * feeds search. This table only decides whether the provider gets called.
 * Dropping it costs money, never correctness.
 */
import {
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";
import { now } from "./group";

export const aiCaption = sqliteTable(
  "ai_caption",
  {
    /** sha256 of the display rendition that was looked at. */
    hash: text("hash").notNull(),
    /** Keyed with the hash: a better model is allowed to look again. */
    model: text("model").notNull(),
    items: text("items", { mode: "json" }).notNull().$type<string[]>(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(now),
  },
  (t) => [primaryKey({ columns: [t.hash, t.model] })],
);
