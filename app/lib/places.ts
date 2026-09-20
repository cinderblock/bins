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
import { upsertLocation } from "./actions";
import { db } from "./db";
import { placeCodeKey } from "./format";

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

/**
 * The place whose sticker says `code`, or null.
 *
 * Codes are not unique in the data model — the reducer cannot check that
 * without reading other rows, which would make it order-dependent (see
 * shared/ops.ts) — so this is deterministic where it can be: archived places
 * are ignored, and among survivors the lowest id wins so every device picks
 * the same one. `ambiguous` says a human needs to fix the duplicate.
 */
export function findPlaceByCode(
  byId: PlaceMap,
  code: string,
): { place: LocationState | null; ambiguous: boolean } {
  const key = placeCodeKey(code);
  const hits: LocationState[] = [];
  for (const place of byId.values()) {
    if (place.archived || !place.code) continue;
    if (placeCodeKey(place.code) === key) hits.push(place);
  }
  hits.sort((a, b) => a.id.localeCompare(b.id));
  return { place: hits[0] ?? null, ambiguous: hits.length > 1 };
}

/** Places already carrying a sticker code, for "is this one taken" checks. */
export function codeOwners(byId: PlaceMap): Map<string, LocationState[]> {
  const map = new Map<string, LocationState[]>();
  for (const place of byId.values()) {
    if (!place.code) continue;
    const key = placeCodeKey(place.code);
    const list = map.get(key) ?? [];
    list.push(place);
    map.set(key, list);
  }
  return map;
}

/**
 * Create a place from a picker, and hand back the row so the caller can
 * select it immediately.
 *
 * Places are ordinary client ops (shared/ops.ts), so any member can make
 * one — unlike box sizes, whose vocabulary is the admin's. A new place made
 * this way is plain: no grid, no span, no sticker. It is somewhere to put a
 * box right now, and a shelf's shape can be filled in later in the builder.
 */
export async function createPlace(
  byId: PlaceMap,
  name: string,
  parentId: string | null = null,
): Promise<{ id: string; name: string }> {
  const trimmed = name.trim();
  // Reuse a sibling with the same name rather than making a second one: two
  // shelves called "D3" under one bay is a data-entry mistake, not a choice.
  for (const place of byId.values()) {
    if (place.archived) continue;
    if (place.parentId !== parentId) continue;
    if (place.name.trim().toLowerCase() === trimmed.toLowerCase())
      return { id: place.id, name: place.name };
  }
  const id = crypto.randomUUID();
  const sortOrder = byId.size;
  await upsertLocation(id, trimmed, sortOrder, { parentId });
  return { id, name: trimmed };
}

/** Slot names of a place, or [] when it has no grid. */
export function placeSlots(place: LocationState): string[] {
  return slotNames(place);
}
