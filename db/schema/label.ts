/**
 * Materialized group category labels ("booze", "soda", "liquid", "kitchen",
 * "shade", …). Op-driven (label.upsert / label.archive) exactly like locations,
 * so label config also works offline and sync stays uniform. A bin's membership
 * is NOT stored here — it rides the bin row (bin.label_ids), set by bin.setLabel.
 */
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { group } from "./group";

export const label = sqliteTable(
  "label",
  {
    id: text("id").primaryKey(),
    groupId: text("group_id")
      .notNull()
      .references(() => group.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** Mantine color name for the chip; null falls back to a default. */
    color: text("color"),
    sortOrder: integer("sort_order").notNull().default(0),
    archived: integer("archived", { mode: "boolean" }).notNull().default(false),
    fieldClocks: text("field_clocks", { mode: "json" })
      .notNull()
      .$type<Record<string, string>>(),
  },
  (t) => [index("label_group").on(t.groupId)],
);
