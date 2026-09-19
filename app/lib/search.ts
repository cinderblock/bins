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
  /** The label subtext — what someone wrote about the contents. */
  description: string;
  /** Legacy free-text marking; still indexed so old data stays findable. */
  externalLabel: string;
  locationName: string;
  labels: string;
  notes: string;
}

export async function buildSearchIndex(): Promise<MiniSearch<SearchDoc>> {
  const [bins, entries, labels] = await Promise.all([
    db.bins.toArray(),
    db.entries.toArray(),
    db.labels.toArray(),
  ]);
  const notesByBin = new Map<number, string[]>();
  for (const entry of entries) {
    if (entry.kind !== "note" || entry.deletedByOpId || !entry.text) continue;
    const list = notesByBin.get(entry.binId) ?? [];
    list.push(entry.text);
    notesByBin.set(entry.binId, list);
  }
  const labelName = new Map(labels.map((l) => [l.id, l.name]));

  const index = new MiniSearch<SearchDoc>({
    fields: [
      "name",
      "description",
      "externalLabel",
      "locationName",
      "labels",
      "notes",
    ],
    storeFields: ["name", "locationName"],
    searchOptions: {
      prefix: true,
      fuzzy: 0.2,
      boost: { name: 2, description: 2, externalLabel: 2, labels: 2 },
    },
  });
  index.addAll(
    bins
      .filter((bin) => bin.status === "active")
      .map((bin) => ({
        id: bin.id,
        name: bin.name ?? "",
        description: bin.description ?? "",
        externalLabel: bin.externalLabel ?? "",
        locationName: bin.locationName ?? "",
        labels: bin.labelIds.map((id) => labelName.get(id) ?? "").join(" "),
        notes: (notesByBin.get(bin.id) ?? []).join("\n"),
      })),
  );
  return index;
}
