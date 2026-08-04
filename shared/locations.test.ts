/**
 * Hierarchy tests, weighted toward the cycles the data model genuinely allows.
 * A cycle isn't a hypothetical here: two devices can each reparent a place
 * offline, and the reducer can't reject either write without breaking
 * convergence. So every walk has to survive one.
 */
import { describe, expect, test } from "bun:test";
import {
  type LocationNode,
  MAX_LOCATION_DEPTH,
  hasCycle,
  locationLabel,
  locationPath,
  slotCapacity,
  slotName,
  slotNames,
  wouldCycle,
} from "./locations";

function mapOf(...nodes: LocationNode[]): Map<string, LocationNode> {
  return new Map(nodes.map((n) => [n.id, n]));
}

const warehouse: LocationNode = {
  id: "w",
  name: "Warehouse",
  parentId: null,
};
const aisle: LocationNode = { id: "h", name: "Aisle H", parentId: "w" };
const shelf: LocationNode = {
  id: "h4",
  name: "H4",
  parentId: "h",
  cols: 3,
  rows: 2,
};

describe("paths", () => {
  test("reads outermost first", () => {
    const byId = mapOf(warehouse, aisle, shelf);
    expect(locationPath(byId, "h4").map((l) => l.name)).toEqual([
      "Warehouse",
      "Aisle H",
      "H4",
    ]);
    expect(locationLabel(byId, "h4")).toBe("Warehouse › Aisle H › H4");
  });

  test("an unknown or absent id is empty, not a throw", () => {
    const byId = mapOf(shelf);
    expect(locationPath(byId, "nope")).toEqual([]);
    expect(locationPath(byId, null)).toEqual([]);
    expect(locationPath(byId, undefined)).toEqual([]);
    expect(locationLabel(byId, null)).toBe("");
  });

  test("a missing parent just ends the chain", () => {
    // Offline reality: the shelf synced but its aisle hasn't yet.
    expect(locationPath(mapOf(shelf), "h4").map((l) => l.name)).toEqual(["H4"]);
  });
});

describe("cycles", () => {
  const a: LocationNode = { id: "a", name: "A", parentId: "b" };
  const b: LocationNode = { id: "b", name: "B", parentId: "a" };

  test("a two-node cycle terminates instead of hanging", () => {
    const byId = mapOf(a, b);
    const path = locationPath(byId, "a");
    // Truncated, not infinite — the UI thread survives.
    expect(path.length).toBeLessThanOrEqual(MAX_LOCATION_DEPTH);
    expect(path.length).toBeGreaterThan(0);
    expect(hasCycle(byId, "a")).toBe(true);
  });

  test("a self-parent terminates", () => {
    const self: LocationNode = { id: "s", name: "S", parentId: "s" };
    const byId = mapOf(self);
    expect(locationPath(byId, "s").map((l) => l.name)).toEqual(["S"]);
    expect(hasCycle(byId, "s")).toBe(true);
  });

  test("an honest tree reports no cycle", () => {
    expect(hasCycle(mapOf(warehouse, aisle, shelf), "h4")).toBe(false);
  });

  test("a chain deeper than the cap is truncated, not followed forever", () => {
    const deep: LocationNode[] = [];
    for (let i = 0; i < 40; i++) {
      deep.push({
        id: `n${i}`,
        name: `n${i}`,
        parentId: i === 0 ? null : `n${i - 1}`,
      });
    }
    expect(locationPath(mapOf(...deep), "n39").length).toBe(MAX_LOCATION_DEPTH);
  });
});

describe("wouldCycle — the check a builder runs before writing", () => {
  const byId = mapOf(warehouse, aisle, shelf);

  test("refuses a place as its own parent", () => {
    expect(wouldCycle(byId, "h4", "h4")).toBe(true);
  });

  test("refuses parenting an ancestor under its own descendant", () => {
    // Dragging "Warehouse" under "H4" would close the loop.
    expect(wouldCycle(byId, "w", "h4")).toBe(true);
  });

  test("allows a legitimate move, and allows clearing the parent", () => {
    const loose: LocationNode = { id: "x", name: "X", parentId: null };
    const withLoose = mapOf(warehouse, aisle, shelf, loose);
    expect(wouldCycle(withLoose, "x", "h4")).toBe(false);
    expect(wouldCycle(withLoose, "h4", null)).toBe(false);
  });
});

describe("slots", () => {
  test("capacity is the grid, or null when a place isn't one", () => {
    expect(slotCapacity(shelf)).toBe(6);
    expect(slotCapacity(aisle)).toBeNull();
    expect(slotCapacity({ ...shelf, rows: null })).toBeNull();
  });

  test("slots are numbered, not lettered — shelves already own the letters", () => {
    // A shelf is called "H4"; a slot inside it called "A1" would read as a
    // second shelf name. "H4 slot 5" is what someone actually says.
    expect(slotName(0, 0, 3)).toBe("1");
    expect(slotName(2, 1, 3)).toBe("6");
    // A 3-wide, 2-tall shelf, in reading order.
    expect(slotNames(shelf)).toEqual(["1", "2", "3", "4", "5", "6"]);
  });

  test("a place with no grid offers no slots", () => {
    expect(slotNames(aisle)).toEqual([]);
  });
});
