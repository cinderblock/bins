/**
 * Materialized proposed edits to a box's identity fields (name / size /
 * external label), awaiting an admin's verdict. Op-driven like everything
 * else: `bin.suggest` (member) creates the row, `suggestion.resolve` (server-
 * authored, admin-password gated) decides it. Accepting authors a separate
 * bin.setFields — this table never feeds the bin directly.
 */
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { SuggestionState } from "../../shared/reducer";
import { group } from "./group";

export const suggestion = sqliteTable(
  "suggestion",
  {
    /** = the opId of the bin.suggest op. */
    id: text("id").primaryKey(),
    groupId: text("group_id")
      .notNull()
      .references(() => group.id, { onDelete: "cascade" }),
    binId: integer("bin_id").notNull(),
    /**
     * Authoring device. No FK: a revoked device's suggestions must survive
     * (the op log keeps its authorship either way), and the row can exist as
     * a stub before its op arrives.
     */
    deviceId: text("device_id"),
    /** Proposed values; absent keys mean "not part of this suggestion". */
    fields: text("fields", { mode: "json" })
      .notNull()
      .$type<SuggestionState["fields"]>(),
    note: text("note"),
    /** pending | accepted | rejected — LWW on the `status` clock. */
    status: text("status").notNull().default("pending"),
    createdAt: integer("created_at").notNull(),
    resolvedAt: integer("resolved_at"),
    resolvedByOpId: text("resolved_by_op_id"),
    fieldClocks: text("field_clocks", { mode: "json" })
      .notNull()
      .$type<Record<string, string>>(),
  },
  (t) => [
    // The admin queue's query: this group's pending suggestions.
    index("suggestion_group_status").on(t.groupId, t.status),
    index("suggestion_bin").on(t.binId),
  ],
);
