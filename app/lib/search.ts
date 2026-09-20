/**
 * "Which box is X in" — fully offline over the local replica. MiniSearch gives
 * prefix + fuzzy matching ("sharpee" finds "Sharpies"). At this scale
 * (hundreds of bins, thousands of notes) rebuilding the index on demand takes
 * milliseconds, so no incremental bookkeeping.
 */
import { locationLabel } from "@shared/locations";
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
  const [bins, entries, labels, places] = await Promise.all([
    db.bins.toArray(),
    db.entries.toArray(),
    db.labels.toArray(),
    db.locations.toArray(),
  ]);
  const placeById = new Map(places.map((p) => [p.id, p]));
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
        // A structured placement searches by its breadcrumb ("Wall D D1"),
        // so "D1" finds everything on that shelf.
        locationName: bin.locationId
          ? `${locationLabel(placeById, bin.locationId, " ")} ${bin.slot ?? ""}`
          : (bin.locationName ?? ""),
        labels: bin.labelIds.map((id) => labelName.get(id) ?? "").join(" "),
        notes: (notesByBin.get(bin.id) ?? []).join("\n"),
      })),
  );
  return index;
}
