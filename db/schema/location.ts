/**
 * Materialized group location list ("storage", "shelf A2", "trailer", …).
 * Op-driven (location.upsert / location.archive) so location config also
 * works offline and sync stays uniform. Bins reference locations by NAME
 * (locationName), not id, so freeform one-off locations need no row here.
 */
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { group } from "./group";

export const location = sqliteTable(
  "location",
  {
    id: text("id").primaryKey(),
    groupId: text("group_id")
      .notNull()
      .references(() => group.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    archived: integer("archived", { mode: "boolean" }).notNull().default(false),
    fieldClocks: text("field_clocks", { mode: "json" })
      .notNull()
      .$type<Record<string, string>>(),
  },
  (t) => [index("location_group").on(t.groupId)],
);
