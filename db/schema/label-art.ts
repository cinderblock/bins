/**
 * Every drawing made for a box: the label studio's history.
 *
 * Deliberately NOT op-driven, unlike the materialized tables. Drawings can
 * only be made online (the server calls the provider), so offline sync
 * would buy nothing, and the studio is admin-only like generation itself.
 * A box's printed choice stays where it was: `labelArtHash` on the bin,
 * which IS synced. This table is the shelf of alternatives behind it.
 * Written by the generation endpoint, read and pruned by the studio
 * (api/art.ts).
 *
 * Two blobs per drawing, both in the group's blob store:
 * - `sourceHash`: the drawing before the cut (greyscale, text painted out,
 *   margins trimmed). Never changes. What the darkness control re-cuts.
 * - `hash`: the black-and-white label art at `threshold`. Replaced when the
 *   darkness changes, and what `labelArtHash` points at when chosen.
 *
 * Removing hides the row (`removedAt`) rather than deleting it or its blobs:
 * a blob may be the label a box already printed, and blobs are cheap.
 */
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { group } from "./group";

export const labelArt = sqliteTable(
  "label_art",
  {
    id: text("id").primaryKey(),
    groupId: text("group_id")
      .notNull()
      .references(() => group.id, { onDelete: "cascade" }),
    binId: integer("bin_id").notNull(),
    sourceHash: text("source_hash").notNull(),
    hash: text("hash").notNull(),
    threshold: integer("threshold").notNull(),
    model: text("model").notNull(),
    /** ART_VARIANTS key, or null for a plain Generate. */
    variant: text("variant"),
    /** Pieces of text painted out; null = the check didn't run. */
    textRemoved: integer("text_removed"),
    createdAt: integer("created_at").notNull(),
    removedAt: integer("removed_at"),
  },
  (t) => [
    // The studio's one query: this box's drawings, newest first.
    index("label_art_bin").on(t.groupId, t.binId, t.createdAt),
  ],
);
