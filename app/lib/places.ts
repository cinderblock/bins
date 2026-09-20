/**
 * Reading places (locations) and where boxes sit in them, on the client.
 *
 * A box holds either a freeform `locationName` or a structured
 * `locationId` + `slot` (shared/reducer.ts). Everything that shows a box's
 * location goes through `describeBinLocation` so a structured placement
 * reads as "D1 · slot 5" everywhere, never as "no location set" because a
 * component only looked at the freeform field.
 */
import { locationLabel, slotNames } from "@shared/locations";
import type { BinState, LocationState } from "@shared/reducer";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "./db";

export type PlaceMap = ReadonlyMap<string, LocationState>;

/** Every place, archived included, keyed by id — for resolving references. */
export function usePlaceMap(): PlaceMap {
  return useLiveQuery(
    async () => new Map((await db.locations.toArray()).map((l) => [l.id, l])),
    [],
    new Map<string, LocationState>(),
  );
}

/** Direct children of a place (null = top level), unarchived, in order. */
export function childrenOf(
  byId: PlaceMap,
  parentId: string | null,
  includeArchived = false,
): LocationState[] {
  const out: LocationState[] = [];
  for (const place of byId.values()) {
    if (place.parentId !== parentId) continue;
    if (!includeArchived && place.archived) continue;
    out.push(place);
  }
  return out.sort(
    (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name),
  );
}

export function hasChildren(byId: PlaceMap, id: string): boolean {
  for (const place of byId.values())
    if (place.parentId === id && !place.archived) return true;
  return false;
}

export function isGrid(place: Pick<LocationState, "cols" | "rows">): boolean {
  return place.cols != null && place.rows != null;
}

/**
 * Short form for badges and list rows: the place's own name plus the slot.
 * The breadcrumb ("Wall › D › D1") is available via `locationLabel` for
 * surfaces with room.
 */
export function describeBinLocation(
  bin: Pick<BinState, "locationName" | "locationId" | "slot">,
  byId: PlaceMap,
): string | null {
  if (bin.locationId) {
    const place = byId.get(bin.locationId);
    // A placement can reach a replica before the place itself (order is not
    // guaranteed); say so rather than pretending the box is nowhere.
    const name = place?.name || "a place not synced yet";
    return bin.slot ? `${name} · slot ${bin.slot}` : name;
  }
  return bin.locationName;
}

/** Full breadcrumb form, for the box page. */
export function describeBinLocationLong(
  bin: Pick<BinState, "locationName" | "locationId" | "slot">,
  byId: PlaceMap,
): string | null {
  if (bin.locationId) {
    const label =
      locationLabel(byId, bin.locationId) || "a place not synced yet";
    return bin.slot ? `${label} · slot ${bin.slot}` : label;
  }
  return bin.locationName;
}

/** Active boxes grouped by place, and within a place by slot. */
export type Occupancy = Map<
  string,
  { all: BinState[]; bySlot: Map<string, BinState[]>; unslotted: BinState[] }
>;

export function useOccupancy(): Occupancy {
  return useLiveQuery(
    async () => {
      const map: Occupancy = new Map();
      for (const bin of await db.bins.toArray()) {
        if (bin.status !== "active" || !bin.locationId) continue;
        let entry = map.get(bin.locationId);
        if (!entry) {
          entry = { all: [], bySlot: new Map(), unslotted: [] };
          map.set(bin.locationId, entry);
        }
        entry.all.push(bin);
        if (bin.slot) {
          const list = entry.bySlot.get(bin.slot) ?? [];
          list.push(bin);
          entry.bySlot.set(bin.slot, list);
        } else entry.unslotted.push(bin);
      }
      return map;
    },
    [],
    new Map() as Occupancy,
  );
}

/** Slot names of a place, or [] when it has no grid. */
export function placeSlots(place: LocationState): string[] {
  return slotNames(place);
}
