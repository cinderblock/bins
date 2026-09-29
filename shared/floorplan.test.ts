/**
 * The floor plan's arithmetic. Dragging walls around a browser finds none of
 * these reliably: a sign error in a rotation looks like "the wall moved a
 * bit oddly", and a stale layout drawing in the wrong room looks like data.
 */
import { describe, expect, test } from "bun:test";
import {
  type PlanNode,
  activeLayout,
  baySegments,
  defaultFootprint,
  footprintContains,
  footprintCorners,
  indexChildren,
  mapTarget,
  normalizeAngle,
  planBounds,
  planKind,
  polygonArea,
  sanitizeLayout,
  snapAngle,
  snapTo,
  snapVertex,
  toLocal,
  toParent,
} from "./floorplan";
import { locationPath } from "./locations";

function node(
  id: string,
  parentId: string | null,
  over: Partial<PlanNode> = {},
): PlanNode {
  return {
    id,
    name: id,
    parentId,
    sortOrder: 0,
    archived: false,
    layout: null,
    plan: null,
    cols: null,
    rows: null,
    ...over,
  };
}

function mapOf(...nodes: PlanNode[]) {
  return new Map(nodes.map((n) => [n.id, n]));
}

const near = (a: number, b: number) =>
  expect(Math.abs(a - b)).toBeLessThan(1e-6);

describe("kinds are derived from contents", () => {
  const byId = mapOf(
    node("shop", null),
    node("north", "shop"),
    node("A", "north", { sortOrder: 0 }),
    node("A1", "A", { cols: 3, rows: 2 }),
    node("pallets", "shop"),
  );
  const index = indexChildren(byId);
  const kind = (id: string) => planKind(index, byId.get(id) as PlanNode);

  test("shelf → bay → wall → space, by height", () => {
    expect(kind("A1")).toBe("zone");
    expect(kind("A")).toBe("bay");
    expect(kind("north")).toBe("wall");
    expect(kind("shop")).toBe("space");
    expect(kind("pallets")).toBe("zone");
  });

  test("a plan makes anything a space, however shallow", () => {
    const withPlan = mapOf(
      node("room", null, {
        plan: { scaled: false, outline: [], landmarks: [] },
      }),
      node("corner", "room"),
    );
    const idx = indexChildren(withPlan);
    expect(planKind(idx, withPlan.get("room") as PlanNode)).toBe("space");
  });

  test("a parent cycle can't hang the walk", () => {
    const loop = mapOf(node("a", "b"), node("b", "a"));
    const idx = indexChildren(loop);
    expect(() => planKind(idx, loop.get("a") as PlanNode)).not.toThrow();
  });
});

describe("layouts", () => {
  const layout = {
    parentId: "shop",
    x: 1000,
    y: 2000,
    rotation: 90,
    width: 3000,
    depth: 400,
  };

  test("a layout drawn in a parent the place has left is not a position", () => {
    expect(activeLayout(node("w", "shop", { layout }))).toEqual(layout);
    expect(activeLayout(node("w", "elsewhere", { layout }))).toBeNull();
    expect(activeLayout(node("w", null, { layout }))).toBeNull();
  });

  test("local and parent frames are inverses, at any rotation", () => {
    for (const rotation of [0, 37, 90, 180, 271.5]) {
      const f = { ...layout, rotation };
      const back = toLocal(f, toParent(f, { x: 123, y: -45 }));
      near(back.x, 123);
      near(back.y, -45);
    }
  });

  test("rotation is clockwise with y down: at 90° the front faces -x", () => {
    // Front is local +y. Clockwise 90° on a y-down page turns +y into -x.
    const front = toParent({ x: 0, y: 0, rotation: 90 }, { x: 0, y: 1 });
    near(front.x, -1);
    near(front.y, 0);
  });

  test("corners and containment agree", () => {
    const corners = footprintCorners(layout);
    expect(corners).toHaveLength(4);
    // Rotated 90°: 3000 along y, 400 along x.
    const xs = corners.map((c) => c.x);
    const ys = corners.map((c) => c.y);
    near(Math.max(...xs) - Math.min(...xs), 400);
    near(Math.max(...ys) - Math.min(...ys), 3000);
    expect(footprintContains(layout, { x: 1000, y: 3400 })).toBe(true);
    expect(footprintContains(layout, { x: 1300, y: 2000 })).toBe(false);
  });

  test("bounds cover the outline, landmarks and every footprint", () => {
    const r = planBounds(
      {
        scaled: true,
        outline: [
          [0, 0],
          [5000, 0],
          [5000, 4000],
        ],
        landmarks: [],
      },
      [layout],
    );
    expect(r).toEqual({ minX: 0, minY: 0, maxX: 5000, maxY: 4000 });
  });
});

describe("snapping and the schema's limits", () => {
  test("angles land in [0, 360), never on 360", () => {
    expect(normalizeAngle(-90)).toBe(270);
    expect(normalizeAngle(360)).toBe(0);
    expect(normalizeAngle(359.99999)).toBe(0);
    expect(normalizeAngle(725)).toBe(5);
    expect(snapAngle(355)).toBe(0);
    expect(snapAngle(97)).toBe(90);
  });

  test("snapping to 6 inches doesn't drift", () => {
    expect(snapTo(10 * 152.4 + 30, 152.4)).toBe(1524);
    expect(snapTo(-260, 250)).toBe(-250);
  });

  test("a sanitized layout is always one the push schema accepts", () => {
    const clean = sanitizeLayout({
      parentId: "p",
      x: 5e7,
      y: -0.04,
      rotation: -15,
      width: 0,
      depth: 1e9,
    });
    expect(clean.x).toBe(1_000_000);
    expect(clean.rotation).toBe(345);
    expect(clean.width).toBeGreaterThan(0);
    expect(clean.depth).toBe(100_000);
  });

  test("an outline vertex squares up with its neighbours", () => {
    const outline: [number, number][] = [
      [0, 0],
      [6000, 0],
      [6000, 4000],
      [0, 4000],
    ];
    // Dragging the far corner to nearly-square snaps it square.
    const p = snapVertex(outline, 2, { x: 6080, y: 3950 }, 100, 150);
    expect(p).toEqual({ x: 6000, y: 4000 });
    // Far enough away, it's a deliberate angle — only the grid applies.
    const q = snapVertex(outline, 2, { x: 7020, y: 5010 }, 100, 150);
    expect(q).toEqual({ x: 7000, y: 5000 });
  });

  test("area of an L-shaped room", () => {
    const l: [number, number][] = [
      [0, 0],
      [4000, 0],
      [4000, 2000],
      [2000, 2000],
      [2000, 4000],
      [0, 4000],
    ];
    expect(polygonArea(l)).toBe(12_000_000);
  });
});

describe("a wall's bays", () => {
  test("share the length by their widest shelf, left to right", () => {
    const byId = mapOf(
      node("w", "shop"),
      node("A", "w", { sortOrder: 0 }),
      node("A1", "A", { cols: 1, rows: 1 }),
      node("B", "w", { sortOrder: 1 }),
      node("B1", "B", { cols: 3, rows: 2 }),
    );
    const segs = baySegments(
      indexChildren(byId),
      byId.get("w") as PlanNode,
      4000,
    );
    expect(segs.map((s) => s.bay.id)).toEqual(["A", "B"]);
    near(segs[0]?.from ?? 0, -2000);
    near(segs[0]?.to ?? 0, -1000);
    near(segs[1]?.to ?? 0, 2000);
  });

  test("a gridless bay counts as an average bay, not a sliver", () => {
    const byId = mapOf(
      node("w", "shop"),
      node("A", "w", { sortOrder: 0 }),
      node("A1", "A"),
      node("D", "w", { sortOrder: 1 }),
      node("D1", "D", { cols: 3, rows: 2 }),
    );
    const segs = baySegments(
      indexChildren(byId),
      byId.get("w") as PlanNode,
      6000,
    );
    near((segs[0]?.to ?? 0) - (segs[0]?.from ?? 0), 3000);
  });

  test("a bay's own width wins, and the rest scale around it", () => {
    const byId = mapOf(
      node("w", "shop"),
      node("A", "w", {
        sortOrder: 0,
        layout: {
          parentId: "w",
          x: 0,
          y: 0,
          rotation: 0,
          width: 2400,
          depth: 450,
        },
      }),
      node("A1", "A"),
      node("D", "w", { sortOrder: 1 }),
      node("D1", "D", { cols: 3, rows: 2 }),
    );
    const segs = baySegments(
      indexChildren(byId),
      byId.get("w") as PlanNode,
      3600,
    );
    // A says 2400, D is an average bay (= 2400 too, the only known width).
    near((segs[0]?.to ?? 0) - (segs[0]?.from ?? 0), 1800);
  });

  test("a default wall is a bay-width per bay", () => {
    const byId = mapOf(
      node("w", "shop"),
      node("A", "w"),
      node("A1", "A", { cols: 3, rows: 2 }),
      node("B", "w"),
      node("B1", "B", { cols: 3, rows: 2 }),
    );
    const f = defaultFootprint(indexChildren(byId), byId.get("w") as PlanNode);
    expect(f.width).toBe(2400);
  });
});

describe("finding a box's spot on a map", () => {
  const plan = { scaled: false, outline: [], landmarks: [] };
  const placed = {
    parentId: "shop",
    x: 0,
    y: 0,
    rotation: 0,
    width: 3000,
    depth: 450,
  };

  test("a shelf resolves to its space, its wall, and its bay", () => {
    const byId = mapOf(
      node("shop", null, { plan }),
      node("north", "shop", { layout: placed }),
      node("D", "north"),
      node("D3", "D", { cols: 3, rows: 2 }),
    );
    const t = mapTarget(
      byId,
      indexChildren(byId),
      locationPath(byId, "D3") as PlanNode[],
    );
    expect(t?.space.id).toBe("shop");
    expect(t?.item?.id).toBe("north");
    expect(t?.bay?.id).toBe("D");
  });

  test("unplaced: the space is found, the item is honestly missing", () => {
    const byId = mapOf(
      node("shop", null, { plan }),
      node("north", "shop"),
      node("D", "north"),
      node("D3", "D"),
    );
    const t = mapTarget(
      byId,
      indexChildren(byId),
      locationPath(byId, "D3") as PlanNode[],
    );
    expect(t?.space.id).toBe("shop");
    expect(t?.item).toBeNull();
  });

  test("no map anywhere above it: nothing to show", () => {
    const byId = mapOf(
      node("north", null),
      node("D", "north"),
      node("D3", "D"),
    );
    const t = mapTarget(
      byId,
      indexChildren(byId),
      locationPath(byId, "D3") as PlanNode[],
    );
    expect(t).toBeNull();
  });

  test("a room inside a building highlights in the room's own map", () => {
    const byId = mapOf(
      node("building", null, { plan }),
      node("room", "building", {
        plan,
        layout: { ...placed, parentId: "building" },
      }),
      node("north", "room", { layout: { ...placed, parentId: "room" } }),
      node("D", "north"),
      node("D3", "D"),
    );
    const t = mapTarget(
      byId,
      indexChildren(byId),
      locationPath(byId, "D3") as PlanNode[],
    );
    expect(t?.space.id).toBe("room");
    expect(t?.item?.id).toBe("north");
  });
});
