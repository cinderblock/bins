/**
 * Materialized group box-size definitions ("Banker box", "Milk crate", …).
 * Op-driven (boxSize.upsert / boxSize.archive) exactly like labels and
 * locations, so the vocabulary syncs and works offline like everything else.
 *
 * Unlike labels, these ops are SERVER-authored behind requireAdmin: a size is
 * a curated vocabulary, so members choose from it rather than adding to it.
 *
 * Dimensions are canonical MILLIMETRES (as weight is canonical grams) and are
 * optional — a name-only size is legitimate. A bin's chosen size rides the bin
 * row (bin.size_id), set through the ordinary bin field path.
 */
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { group } from "./group";

export const boxSize = sqliteTable(
  "box_size",
  {
    id: text("id").primaryKey(),
    groupId: text("group_id")
      .notNull()
      .references(() => group.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    lengthMm: integer("length_mm"),
    widthMm: integer("width_mm"),
    heightMm: integer("height_mm"),
    sortOrder: integer("sort_order").notNull().default(0),
    archived: integer("archived", { mode: "boolean" }).notNull().default(false),
    fieldClocks: text("field_clocks", { mode: "json" })
      .notNull()
      .$type<Record<string, string>>(),
  },
  (t) => [index("box_size_group").on(t.groupId)],
);
