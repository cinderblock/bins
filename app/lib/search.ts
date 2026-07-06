/**
 * "Which box is X in" — fully offline over the local replica. MiniSearch gives
 * prefix + fuzzy matching ("sharpee" finds "Sharpies"). At this scale
 * (hundreds of bins, thousands of notes) rebuilding the index on demand takes
 * milliseconds, so no incremental bookkeeping.
 */
import MiniSearch from "minisearch";
import { db } from "./db";

export interface SearchDoc {
  id: number;
  name: string;
  externalLabel: string;
  locationName: string;
  notes: string;
}

export async function buildSearchIndex(): Promise<MiniSearch<SearchDoc>> {
  const [bins, entries] = await Promise.all([
    db.bins.toArray(),
    db.entries.toArray(),
  ]);
  const notesByBin = new Map<number, string[]>();
  for (const entry of entries) {
    if (entry.kind !== "note" || entry.deletedByOpId || !entry.text) continue;
    const list = notesByBin.get(entry.binId) ?? [];
    list.push(entry.text);
    notesByBin.set(entry.binId, list);
  }

  const index = new MiniSearch<SearchDoc>({
    fields: ["name", "externalLabel", "locationName", "notes"],
    storeFields: ["name", "locationName"],
    searchOptions: {
      prefix: true,
      fuzzy: 0.2,
      boost: { name: 2, externalLabel: 2 },
    },
  });
  index.addAll(
    bins
      .filter((bin) => bin.status === "active")
      .map((bin) => ({
        id: bin.id,
        name: bin.name ?? "",
        externalLabel: bin.externalLabel ?? "",
        locationName: bin.locationName ?? "",
        notes: (notesByBin.get(bin.id) ?? []).join("\n"),
      })),
  );
  return index;
}
