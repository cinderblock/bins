/**
 * Floor-plan geometry: what a place IS on a map, where it stands, and the
 * arithmetic of moving it. Pure and isomorphic, so the rules are unit-tested
 * rather than discovered by dragging things around in a browser.
 *
 * Coordinates are millimetres in the PARENT's frame, y growing down the page
 * (SVG's convention, so nothing flips between model and drawing). A layout's
 * rotation is degrees clockwise; at 0 the front faces +y. Standing in front
 * of a wall — below it on the page, looking up — its bays run left to right
 * as +x in the wall's own frame, which is the order the elevation view draws
 * them in. Keep those two agreeing.
 *
 * What kind of thing a place is on a map is DERIVED from what it contains,
 * never stored: a place whose children are shelves is a bay, one whose
 * children are bays is a wall, and anything deeper — or anything given a
 * plan — is a space. Existing data needs no migration to be drawn, and a
 * place changes kind simply by being given different children.
 */
import { type LocationNode, MAX_LOCATION_DEPTH } from "./locations";
import type { Landmark, PlaceLayout, PlacePlan } from "./ops";

/** What the map needs of a place; LocationState satisfies it. */
export type PlanNode = LocationNode & {
  sortOrder: number;
  archived: boolean;
  layout: PlaceLayout | null;
  plan: PlacePlan | null;
};

export type Point = { x: number; y: number };

export type Rect = { minX: number; minY: number; maxX: number; maxY: number };

/** Children by parent (null = top level): unarchived, in display order. */
export type ChildIndex = ReadonlyMap<string | null, readonly PlanNode[]>;

export function indexChildren(byId: ReadonlyMap<string, PlanNode>): ChildIndex {
  const index = new Map<string | null, PlanNode[]>();
  for (const place of byId.values()) {
    if (place.archived) continue;
    const list = index.get(place.parentId) ?? [];
    list.push(place);
    index.set(place.parentId, list);
  }
  for (const list of index.values())
    list.sort(
      (a, b) =>
        a.sortOrder - b.sortOrder ||
        a.name.localeCompare(b.name, undefined, { numeric: true }),
    );
  return index;
}

export function childrenIn(index: ChildIndex, id: string | null): PlanNode[] {
  return [...(index.get(id) ?? [])];
}

/**
 * Levels of nesting below a place: 0 for a leaf. Survives cycles (which the
 * data model permits — see shared/locations.ts) by refusing to revisit.
 */
export function subtreeHeight(index: ChildIndex, id: string): number {
  const seen = new Set<string>();
  const walk = (at: string, depth: number): number => {
    if (seen.has(at) || depth > MAX_LOCATION_DEPTH) return 0;
    seen.add(at);
    let best = 0;
    for (const child of index.get(at) ?? [])
      best = Math.max(best, 1 + walk(child.id, depth + 1));
    return best;
  };
  return walk(id, 0);
}

/**
 * - `space`: has a floor plan, or is deep enough to hold walls.
 * - `wall`: a run of bays.
 * - `bay`: a column of shelves.
 * - `zone`: a shelf, or a plain place that just holds boxes — on a map, an
 *   area with a count in it.
 */
export type PlanKind = "space" | "wall" | "bay" | "zone";

export function planKind(index: ChildIndex, place: PlanNode): PlanKind {
  if (place.plan) return "space";
  const height = subtreeHeight(index, place.id);
  if (height >= 3) return "space";
  if (height === 2) return "wall";
  if (height === 1) return "bay";
  return "zone";
}

/**
 * The layout that applies NOW, or null. A layout drawn in a parent the place
 * has since left is stale data, not a position — the reducer can't clear it
 * without reading another row, so every reader asks here instead.
 */
export function activeLayout(place: PlanNode): PlaceLayout | null {
  const { layout } = place;
  if (!layout || layout.parentId !== place.parentId) return null;
  return layout;
}

/** A place's width share along its parent wall, when one was set. */
function wallShare(bay: PlanNode, wallId: string): number | null {
  const { layout } = bay;
  if (!layout || layout.parentId !== wallId || bay.parentId !== wallId)
    return null;
  return layout.width;
}

/** Widest grid among a bay's shelves, in boxes; null when none has a grid. */
function bayCols(index: ChildIndex, bay: PlanNode): number | null {
  let cols: number | null = null;
  for (const shelf of index.get(bay.id) ?? [])
    if (shelf.cols) cols = Math.max(cols ?? 0, shelf.cols);
  return cols;
}

export type BaySegment = {
  bay: PlanNode;
  /** Wall-local x of the segment's left and right edges (front view). */
  from: number;
  to: number;
};

/**
 * How a wall's length divides among its bays, left to right as seen from
 * the front.
 *
 * A bay can state its own width (a layout whose parent is the wall; only
 * `width` is read). Bays that don't share what's left in proportion to how
 * many boxes their widest shelf holds — and a bay with no grids at all
 * counts as an average one, not a sliver. The shares are then scaled to
 * fill the wall exactly, so the drawing never disagrees with the footprint.
 */
export function baySegments(
  index: ChildIndex,
  wall: PlanNode,
  wallWidth: number,
): BaySegment[] {
  const bays = childrenIn(index, wall.id);
  if (bays.length === 0) return [];
  const explicit = bays.map((bay) => wallShare(bay, wall.id));
  const cols = bays.map((bay) => bayCols(index, bay));
  const known = explicit.filter((w): w is number => w !== null);
  const gridCols = cols.filter((c): c is number => c !== null);
  const avgCols = gridCols.length
    ? gridCols.reduce((a, b) => a + b, 0) / gridCols.length
    : 1;
  // Explicit widths are millimetres, col counts are boxes. When any bay has
  // a width, the rest are sized as an average explicit bay, scaled by how
  // their columns compare with the average — never mixing the two units.
  const avgKnown = known.length
    ? known.reduce((a, b) => a + b, 0) / known.length
    : null;
  const weights = bays.map((_, i) => {
    const w = explicit[i];
    if (w != null) return w;
    const c = cols[i] ?? avgCols;
    return avgKnown !== null ? (avgKnown * c) / avgCols : c;
  });
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  const out: BaySegment[] = [];
  let at = -wallWidth / 2;
  bays.forEach((bay, i) => {
    const span = (wallWidth * (weights[i] ?? 0)) / total;
    out.push({ bay, from: at, to: at + span });
    at += span;
  });
  return out;
}

// ── Transforms ───────────────────────────────────────────────────────────

const RAD = Math.PI / 180;

/** A point in a footprint's own frame → its parent's frame. */
export function toParent(
  layout: Pick<PlaceLayout, "x" | "y" | "rotation">,
  local: Point,
): Point {
  const r = layout.rotation * RAD;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  return {
    x: layout.x + local.x * cos - local.y * sin,
    y: layout.y + local.x * sin + local.y * cos,
  };
}

/** A point in the parent's frame → a footprint's own frame. */
export function toLocal(
  layout: Pick<PlaceLayout, "x" | "y" | "rotation">,
  world: Point,
): Point {
  const r = -layout.rotation * RAD;
  const dx = world.x - layout.x;
  const dy = world.y - layout.y;
  return {
    x: dx * Math.cos(r) - dy * Math.sin(r),
    y: dx * Math.sin(r) + dy * Math.cos(r),
  };
}

type Footprint = Pick<PlaceLayout, "x" | "y" | "rotation" | "width" | "depth">;

/** The four corners, clockwise from the back-left, in the parent's frame. */
export function footprintCorners(f: Footprint): Point[] {
  const w = f.width / 2;
  const d = f.depth / 2;
  return [
    { x: -w, y: -d },
    { x: w, y: -d },
    { x: w, y: d },
    { x: -w, y: d },
  ].map((p) => toParent(f, p));
}

export function footprintContains(f: Footprint, world: Point): boolean {
  const p = toLocal(f, world);
  return Math.abs(p.x) <= f.width / 2 && Math.abs(p.y) <= f.depth / 2;
}

export function boundsOf(points: Iterable<Point>): Rect | null {
  let r: Rect | null = null;
  for (const p of points) {
    if (!r) r = { minX: p.x, minY: p.y, maxX: p.x, maxY: p.y };
    else {
      r.minX = Math.min(r.minX, p.x);
      r.minY = Math.min(r.minY, p.y);
      r.maxX = Math.max(r.maxX, p.x);
      r.maxY = Math.max(r.maxY, p.y);
    }
  }
  return r;
}

/** Everything drawn on a space's plan, for fitting the view to it. */
export function planBounds(
  plan: PlacePlan | null,
  footprints: readonly Footprint[],
): Rect | null {
  const points: Point[] = [];
  for (const [x, y] of plan?.outline ?? []) points.push({ x, y });
  for (const l of plan?.landmarks ?? []) points.push(...footprintCorners(l));
  for (const f of footprints) points.push(...footprintCorners(f));
  return boundsOf(points);
}

// ── Snapping & normalising ──────────────────────────────────────────────

/** Into [0, 360) — the only range the op schema accepts. */
export function normalizeAngle(deg: number): number {
  const r = ((deg % 360) + 360) % 360;
  // 359.99999 rounds to 360 in display, and 360 is out of range.
  return r >= 359.9995 ? 0 : Math.round(r * 1000) / 1000;
}

export function snapTo(value: number, step: number): number {
  if (step <= 0) return value;
  // Rounded to 0.1 mm so repeated snaps don't accumulate float dust.
  return Math.round(Math.round(value / step) * step * 10) / 10;
}

export function snapAngle(deg: number, step = 15): number {
  return normalizeAngle(Math.round(deg / step) * step);
}

/** Longest footprint side the op schema accepts, and a sane minimum. */
export const MAX_LENGTH_MM = 100_000;
export const MIN_LENGTH_MM = 50;
const MAX_COORD_MM = 1_000_000;

export function clampLength(mm: number): number {
  return Math.min(MAX_LENGTH_MM, Math.max(MIN_LENGTH_MM, mm));
}

export function clampCoord(mm: number): number {
  return Math.min(MAX_COORD_MM, Math.max(-MAX_COORD_MM, mm));
}

/**
 * Everything a writer must do before a layout goes into an op: a value the
 * schema would refuse fails the WHOLE push (api/sync.ts parses the batch as
 * one), which would wedge this device's outbox behind it.
 */
export function sanitizeLayout(layout: PlaceLayout): PlaceLayout {
  return {
    parentId: layout.parentId,
    x: clampCoord(Math.round(layout.x * 10) / 10),
    y: clampCoord(Math.round(layout.y * 10) / 10),
    rotation: normalizeAngle(layout.rotation),
    width: clampLength(Math.round(layout.width * 10) / 10),
    depth: clampLength(Math.round(layout.depth * 10) / 10),
  };
}

export function sanitizeLandmark(l: Landmark): Landmark {
  const clean = sanitizeLayout({ ...l, parentId: "" });
  return {
    id: l.id,
    kind: l.kind.slice(0, 20) || "fixture",
    label: l.label?.trim().slice(0, 100) || null,
    x: clean.x,
    y: clean.y,
    rotation: clean.rotation,
    width: clean.width,
    depth: clean.depth,
  };
}

export function sanitizePlan(plan: PlacePlan): PlacePlan {
  return {
    scaled: plan.scaled,
    outline: plan.outline
      .slice(0, 200)
      .map(([x, y]) => [
        clampCoord(Math.round(x * 10) / 10),
        clampCoord(Math.round(y * 10) / 10),
      ]),
    landmarks: plan.landmarks.slice(0, 200).map(sanitizeLandmark),
  };
}

// ── Outline editing ─────────────────────────────────────────────────────

/**
 * Snap a dragged outline vertex: to the grid, then — more usefully — into
 * line with either neighbour when it's nearly there, so walls come out
 * square without anyone typing a coordinate. Most rooms are rectilinear;
 * the ones that aren't just drag past the tolerance.
 */
export function snapVertex(
  outline: readonly (readonly [number, number])[],
  index: number,
  to: Point,
  grid: number,
  tolerance: number,
): Point {
  let x = snapTo(to.x, grid);
  let y = snapTo(to.y, grid);
  const n = outline.length;
  if (n >= 3) {
    const prev = outline[(index - 1 + n) % n];
    const next = outline[(index + 1) % n];
    for (const nb of [prev, next]) {
      if (!nb) continue;
      if (Math.abs(to.x - nb[0]) <= tolerance) x = nb[0];
      if (Math.abs(to.y - nb[1]) <= tolerance) y = nb[1];
    }
  }
  return { x, y };
}

/** Axis-aligned rectangle outline, clockwise from the top-left. */
export function rectOutline(r: Rect): [number, number][] {
  return [
    [r.minX, r.minY],
    [r.maxX, r.minY],
    [r.maxX, r.maxY],
    [r.minX, r.maxY],
  ];
}

/** Shoelace area, always positive. mm². */
export function polygonArea(outline: readonly (readonly [number, number])[]) {
  let sum = 0;
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i];
    const b = outline[(i + 1) % outline.length];
    if (!a || !b) continue;
    sum += a[0] * b[1] - b[0] * a[1];
  }
  return Math.abs(sum) / 2;
}

// ── Sizes ───────────────────────────────────────────────────────────────

/** Width a bay gets per box across, when nobody has measured it. */
const MM_PER_COL = 400;
/** A typical shelf's front-to-back. */
const SHELF_DEPTH = 450;

/**
 * A believable footprint for something just dropped onto a plan. Walls get
 * one bay-width per bay, sized by its widest shelf; a banker's box is about
 * 400 mm across, so a three-box bay comes out near the usual 48″ unit.
 */
export function defaultFootprint(
  index: ChildIndex,
  place: PlanNode,
): { width: number; depth: number } {
  const kind = planKind(index, place);
  if (kind === "wall") {
    const bays = childrenIn(index, place.id);
    const width = bays.reduce(
      (sum, bay) => sum + MM_PER_COL * (bayCols(index, bay) ?? 3),
      0,
    );
    return { width: clampLength(width || 1200), depth: SHELF_DEPTH };
  }
  if (kind === "bay")
    return {
      width: MM_PER_COL * (bayCols(index, place) ?? 3),
      depth: SHELF_DEPTH,
    };
  if (kind === "zone" && place.cols)
    return { width: MM_PER_COL * place.cols, depth: SHELF_DEPTH };
  return { width: 1500, depth: 1500 };
}

/** Landmark kinds the app knows how to draw; anything else is a fixture. */
export const LANDMARK_KINDS = ["door", "pillar", "fixture", "text"] as const;
export type LandmarkKind = (typeof LANDMARK_KINDS)[number];

export function landmarkKind(kind: string): LandmarkKind {
  return (LANDMARK_KINDS as readonly string[]).includes(kind)
    ? (kind as LandmarkKind)
    : "fixture";
}

export const LANDMARK_DEFAULTS: Record<
  LandmarkKind,
  { width: number; depth: number; label: string | null }
> = {
  door: { width: 900, depth: 120, label: null },
  pillar: { width: 400, depth: 400, label: null },
  fixture: { width: 1800, depth: 750, label: "Workbench" },
  text: { width: 2000, depth: 400, label: "Label" },
};

// ── Finding things ──────────────────────────────────────────────────────

/**
 * Where a place shows up on a map: the space that draws it, the item on
 * that space's plan that contains it, and the bay within that item when
 * the item is a wall (so the highlight lands on the right segment, not the
 * whole run).
 *
 * `item` is null when the containing space exists but nothing on the path
 * has been placed on its plan yet — the caller says "not on the map yet"
 * rather than showing an empty room as if that were an answer.
 *
 * Walks down from the outermost ancestor and keeps the DEEPEST space whose
 * child on the path is placed, so a room inside a building highlights in the
 * room's own map rather than the building's.
 */
export function mapTarget(
  byId: ReadonlyMap<string, PlanNode>,
  index: ChildIndex,
  path: readonly PlanNode[],
): { space: PlanNode; item: PlanNode | null; bay: PlanNode | null } | null {
  let found: {
    space: PlanNode;
    item: PlanNode | null;
    bay: PlanNode | null;
  } | null = null;
  for (let i = 0; i < path.length; i++) {
    const node = path[i];
    if (!node) continue;
    const current = byId.get(node.id) ?? node;
    if (planKind(index, current) !== "space") continue;
    const child = path[i + 1];
    const placed = child && activeLayout(byId.get(child.id) ?? child);
    if (placed && child) {
      const item = byId.get(child.id) ?? child;
      const next = path[i + 2];
      const bay =
        next && planKind(index, item) === "wall"
          ? (byId.get(next.id) ?? next)
          : null;
      found = { space: current, item, bay };
    } else if (!found?.item) {
      // Nothing placed here: remember the (deepest) space anyway, so the
      // caller can open the right room and say so — but never let it
      // displace a shallower space that DID have this thing on its plan.
      found = { space: current, item: null, bay: null };
    }
  }
  return found;
}
