import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
/**
 * Materialized group location list ("storage", "shelf A2", "trailer", …).
 * Op-driven (location.upsert / location.archive) so location config also
 * works offline and sync stays uniform. Bins reference locations by NAME
 * (locationName), not id, so freeform one-off locations need no row here.
 */
import type { PlaceLayout, PlacePlan } from "../../shared/ops";
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
    /** Nests places (building -> aisle -> shelf). Null = top level. */
    parentId: text("parent_id"),
    /** Grid of a shelf, when it has one. Null = an unstructured place. */
    cols: integer("cols"),
    rows: integer("rows"),
    /** Vertical size in shelf units when drawn in a bay; null = 1. */
    span: integer("span"),
    /**
     * What this shelf's own printed sticker says. Opaque on purpose — the
     * stickers predate the app and are not getting reprinted, so the app
     * reads whatever is on them. Not unique in the schema: uniqueness can't
     * be enforced in the reducer without breaking convergence, so it is an
     * advisory the UI surfaces (see shared/ops.ts).
     */
    code: text("code"),
    archived: integer("archived", { mode: "boolean" }).notNull().default(false),
    /**
     * Where this place stands on its parent's floor plan (location.setLayout).
     * Stale when its `parentId` no longer matches the column above — readers
     * treat that as "not placed".
     */
    layout: text("layout", { mode: "json" }).$type<PlaceLayout>(),
    /** This place's floor plan when it is a space (location.setPlan). */
    plan: text("plan", { mode: "json" }).$type<PlacePlan>(),
    fieldClocks: text("field_clocks", { mode: "json" })
      .notNull()
      .$type<Record<string, string>>(),
  },
  (t) => [index("location_group").on(t.groupId)],
);
