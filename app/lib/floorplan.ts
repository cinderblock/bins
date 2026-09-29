/**
 * The floor plan's view of the replica: places indexed for the map, and how
 * full each one is. The geometry itself is shared/floorplan.ts; this is the
 * part that needs Dexie and the box list.
 */
import {
  type ChildIndex,
  type PlanKind,
  activeLayout,
  baySegments,
  childrenIn,
  indexChildren,
  mapTarget,
  planKind,
} from "@shared/floorplan";
import { locationPath, slotCapacity } from "@shared/locations";
import type { Landmark, PlaceLayout, PlacePlan } from "@shared/ops";
import type { LabelState, LocationState } from "@shared/reducer";
import { useLiveQuery } from "dexie-react-hooks";
import { useMemo } from "react";
import { db } from "./db";
import {
  type Occupancy,
  type PlaceMap,
  useOccupancy,
  usePlaceMap,
} from "./places";

/** How full a place is, summed over everything inside it. */
export type PlaceStats = {
  /** Active boxes anywhere inside. */
  boxes: number;
  /** Slots across every grid inside; null when nothing inside has a grid. */
  capacity: number | null;
  /** Occupied slots (a slot with two boxes in it counts once). */
  used: number;
  /** Some shelf inside holds more boxes than it has slots. */
  over: boolean;
  /** The category most boxes inside carry, or null. */
  topLabel: LabelState | null;
};

export type PlanData = {
  byId: PlaceMap;
  index: ChildIndex;
  labels: ReadonlyMap<string, LabelState>;
  stats: (id: string) => PlaceStats;
};

export function usePlanData(): PlanData {
  const byId = usePlaceMap();
  const occupancy = useOccupancy();
  const labelRows = useLiveQuery(
    () => db.labels.toArray(),
    [],
    [] as LabelState[],
  );
  return useMemo(() => {
    const index = indexChildren(byId);
    const labels = new Map(labelRows.map((l) => [l.id, l]));
    const cache = new Map<string, PlaceStats>();
    const stats = (id: string) =>
      statsOf(id, index, byId, occupancy, labels, cache);
    return { byId, index, labels, stats };
  }, [byId, occupancy, labelRows]);
}

function statsOf(
  rootId: string,
  index: ChildIndex,
  byId: PlaceMap,
  occupancy: Occupancy,
  labels: ReadonlyMap<string, LabelState>,
  cache: Map<string, PlaceStats>,
): PlaceStats {
  const hit = cache.get(rootId);
  if (hit) return hit;
  let boxes = 0;
  let capacity: number | null = null;
  let used = 0;
  let over = false;
  const labelCounts = new Map<string, number>();
  // Iterative, and never revisiting: parent cycles are legal data.
  const seen = new Set<string>();
  const stack = [rootId];
  while (stack.length) {
    const id = stack.pop() as string;
    if (seen.has(id)) continue;
    seen.add(id);
    const place = byId.get(id);
    const here = occupancy.get(id);
    if (here) {
      boxes += here.all.length;
      for (const bin of here.all)
        for (const labelId of bin.labelIds)
          labelCounts.set(labelId, (labelCounts.get(labelId) ?? 0) + 1);
    }
    const cap = place ? slotCapacity(place) : null;
    if (cap !== null) {
      capacity = (capacity ?? 0) + cap;
      const occupied = here ? here.bySlot.size : 0;
      used += Math.min(occupied, cap);
      if ((here?.all.length ?? 0) > cap) over = true;
    }
    for (const child of index.get(id) ?? []) stack.push(child.id);
  }
  let topLabel: LabelState | null = null;
  let best = 0;
  for (const [labelId, count] of labelCounts) {
    const label = labels.get(labelId);
    if (!label || label.archived) continue;
    if (
      count > best ||
      (count === best && topLabel && label.sortOrder < topLabel.sortOrder)
    ) {
      best = count;
      topLabel = label;
    }
  }
  const result = { boxes, capacity, used, over, topLabel };
  cache.set(rootId, result);
  return result;
}

/**
 * Fullness as one of five classes, for a stepped (not continuous) ramp: a
 * legend of four swatches can be read at a glance; a gradient can't.
 * 0 = empty, 1–3 = partly, 4 = full. Null = no fixed capacity to be full of.
 */
export function fullnessClass(s: PlaceStats): 0 | 1 | 2 | 3 | 4 | null {
  if (!s.capacity) return null;
  if (s.used === 0) return 0;
  const f = s.used / s.capacity;
  if (f >= 1) return 4;
  if (f > 2 / 3) return 3;
  if (f > 1 / 3) return 2;
  return 1;
}

/**
 * The ramp, per colour scheme. One hue, stepped, validated with the dataviz
 * palette checker as an ORDINAL ramp against each theme's surface (the
 * nearest-to-surface step clears 2:1). On dark, fuller is lighter; on light,
 * fuller is darker — "more stuff" is always "more ink". Empty is no fill at
 * all, so it reads as absence rather than as the first step.
 */
export const FULLNESS_RAMP = {
  dark: ["#1c5cab", "#3987e5", "#86b6ef", "#cde2fb"],
  light: ["#86b6ef", "#5598e7", "#256abf", "#104281"],
} as const;

/** Reserved "critical" status colour — over capacity, never a category. */
export const OVER_COLOR = "#d03b3b";

export const FULLNESS_LEGEND = ["Up to ⅓", "Up to ⅔", "Nearly full", "Full"];

/** Places a map can open on: spaces first, by breadcrumb. */
export function spacesOf(data: PlanData): LocationState[] {
  const out: LocationState[] = [];
  for (const place of data.byId.values()) {
    if (place.archived) continue;
    if (planKind(data.index, place) === "space") out.push(place);
  }
  return out;
}

/** Where a place — a shelf a box is on, say — shows up on a map, if anywhere. */
export function mapTargetFor(data: PlanData, placeId: string | null) {
  if (!placeId) return null;
  const path = locationPath(data.byId, placeId) as LocationState[];
  return mapTarget(data.byId, data.index, path);
}

export type SceneSegment = {
  /** The bay this segment is, or null when the item is drawn whole. */
  bay: LocationState | null;
  from: number;
  to: number;
  stats: PlaceStats;
};

export type SceneItem = {
  place: LocationState;
  kind: PlanKind;
  layout: PlaceLayout;
  segments: SceneSegment[];
  stats: PlaceStats;
};

/** Everything one space's map draws, with any in-flight edits applied. */
export type Scene = {
  scaled: boolean;
  outline: [number, number][];
  landmarks: Landmark[];
  items: SceneItem[];
};

/**
 * Edits not yet reflected in the replica: a drag in progress, or one just
 * written whose op hasn't come back through the live query. `undefined` in
 * `layouts` = no override; `null` = shown as off the plan.
 */
export type SceneDrafts = {
  layouts?: ReadonlyMap<string, PlaceLayout | null>;
  plan?: PlacePlan | null;
};

/**
 * A space's map: its placed children as drawable items, and the children not
 * placed yet (the editor's tray).
 */
export function buildScene(
  space: LocationState,
  data: PlanData,
  drafts: SceneDrafts = {},
): { scene: Scene; unplaced: LocationState[] } {
  const plan = drafts.plan !== undefined ? drafts.plan : space.plan;
  const items: SceneItem[] = [];
  const unplaced: LocationState[] = [];
  for (const child of childrenIn(data.index, space.id)) {
    const place = child as LocationState;
    const override = drafts.layouts?.get(place.id);
    const layout = override !== undefined ? override : activeLayout(place);
    if (!layout) {
      unplaced.push(place);
      continue;
    }
    const kind = planKind(data.index, place);
    const stats = data.stats(place.id);
    let segments: SceneSegment[];
    if (kind === "wall") {
      // A bay's own width may be mid-edit too (the wall inspector).
      const withDrafts = drafts.layouts?.size
        ? indexWithBayDrafts(data, place.id, drafts.layouts)
        : data.index;
      segments = baySegments(withDrafts, place, layout.width).map((s) => ({
        bay: s.bay as LocationState,
        from: s.from,
        to: s.to,
        stats: data.stats(s.bay.id),
      }));
    } else {
      segments = [
        {
          // A lone bay is still a bay: tapping it should say which.
          bay: kind === "bay" ? place : null,
          from: -layout.width / 2,
          to: layout.width / 2,
          stats,
        },
      ];
    }
    items.push({ place, kind, layout, segments, stats });
  }
  return {
    scene: {
      scaled: plan?.scaled ?? false,
      outline: plan?.outline ?? [],
      landmarks: plan?.landmarks ?? [],
      items,
    },
    unplaced,
  };
}

/** The child index with a wall's bays swapped for their drafted layouts. */
function indexWithBayDrafts(
  data: PlanData,
  wallId: string,
  layouts: ReadonlyMap<string, PlaceLayout | null>,
): ChildIndex {
  const bays = data.index.get(wallId);
  if (!bays?.some((b) => layouts.has(b.id))) return data.index;
  const next = new Map(data.index);
  next.set(
    wallId,
    bays.map((bay) =>
      layouts.has(bay.id)
        ? { ...bay, layout: layouts.get(bay.id) ?? null }
        : bay,
    ),
  );
  return next;
}
