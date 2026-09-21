/**
 * The database behind the catalog.
 *
 * Split from catalog.ts so that module stays a pure function of plain data:
 * importing the renderer must not drag SQLite in, or its tests end up
 * migrating whatever database happens to be configured.
 */
import { describedItems } from "../../shared/reducer";
import { and, asc, desc, eq, gt } from "drizzle-orm";
import { db, schema } from "../../db/client.server";
import type { CatalogSource } from "./catalog";

/** The real source: the group's materialized tables and its op log. */
export const dbCatalogSource: CatalogSource = {
  async latestSeq(groupId) {
    const [latest] = await db
      .select({ seq: schema.op.seq })
      .from(schema.op)
      .where(eq(schema.op.groupId, groupId))
      .orderBy(desc(schema.op.seq))
      .limit(1);
    return latest?.seq ?? 0;
  },

  async load(groupId) {
    const [bins, entries, labels, sizes, places] = await Promise.all([
      db.query.bin.findMany({ where: eq(schema.bin.groupId, groupId) }),
      db.query.binEntry.findMany({
        where: eq(schema.binEntry.groupId, groupId),
      }),
      db.query.label.findMany({ where: eq(schema.label.groupId, groupId) }),
      db.query.boxSize.findMany({ where: eq(schema.boxSize.groupId, groupId) }),
      db.query.location.findMany({
        where: eq(schema.location.groupId, groupId),
      }),
    ]);

    const notesByBin = new Map<number, string[]>();
    const describedByBin = new Map<number, string[]>();
    for (const entry of entries) {
      if (entry.deletedByOpId) continue;
      if (entry.kind === "note" && entry.text) {
        const list = notesByBin.get(entry.binId) ?? [];
        list.push(entry.text);
        notesByBin.set(entry.binId, list);
        continue;
      }
      const described = describedItems(entry);
      if (described.length) {
        const list = describedByBin.get(entry.binId) ?? [];
        list.push(...described);
        describedByBin.set(entry.binId, list);
      }
    }
    return { bins, notesByBin, describedByBin, labels, sizes, places };
  },

  async opsAfter(groupId, seq, limit) {
    return await db.query.op.findMany({
      where: and(eq(schema.op.groupId, groupId), gt(schema.op.seq, seq)),
      orderBy: asc(schema.op.seq),
      limit,
    });
  },
};
