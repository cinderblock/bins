/**
 * Looking a shelf up by the string on its own printed sticker.
 *
 * Codes are not unique in the data model — the reducer can't reject a
 * duplicate without reading other rows, which would make it order-dependent
 * and break convergence (shared/ops.ts). So the interesting behaviour here is
 * what happens when two shelves claim one sticker: every device must pick the
 * SAME shelf, and a human must be told.
 */
import { describe, expect, test } from "bun:test";
import type { LocationState } from "@shared/reducer";
import { codeOwners, findPlaceByCode } from "./places";

function place(
  id: string,
  name: string,
  code: string | null,
  archived = false,
): LocationState {
  return {
    id,
    name,
    sortOrder: 0,
    parentId: null,
    cols: null,
    rows: null,
    span: null,
    code,
    archived,
    fieldClocks: {},
  };
}

function mapOf(...places: LocationState[]) {
  return new Map(places.map((p) => [p.id, p]));
}

describe("findPlaceByCode", () => {
  test("matches the printed string, ignoring case and surrounding space", () => {
    const byId = mapOf(place("a", "D0", "H4K9"), place("b", "D1", "x7-22b"));
    expect(findPlaceByCode(byId, "H4K9").place?.name).toBe("D0");
    expect(findPlaceByCode(byId, " h4k9 ").place?.name).toBe("D0");
    expect(findPlaceByCode(byId, "X7-22B").place?.name).toBe("D1");
  });

  test("an unknown sticker is a miss, not a wrong shelf", () => {
    const byId = mapOf(place("a", "D0", "H4K9"));
    const hit = findPlaceByCode(byId, "NOPE");
    expect(hit.place).toBeNull();
    expect(hit.ambiguous).toBe(false);
  });

  test("a shelf with no sticker is never matched by an empty scan", () => {
    const byId = mapOf(place("a", "D0", null), place("b", "D1", ""));
    expect(findPlaceByCode(byId, "").place).toBeNull();
  });

  test("archived shelves don't answer for their old stickers", () => {
    // The shelf is gone; the sticker must not keep filing boxes onto it.
    const byId = mapOf(place("a", "D0", "H4K9", true));
    expect(findPlaceByCode(byId, "H4K9").place).toBeNull();
  });

  test("a duplicated sticker resolves the same way everywhere, and says so", () => {
    const byId = mapOf(place("b", "D1", "H4K9"), place("a", "D0", "h4k9"));
    const hit = findPlaceByCode(byId, "H4K9");
    // Lowest id, so two devices holding the same rows in different insertion
    // orders still file the box onto the same shelf.
    expect(hit.place?.name).toBe("D0");
    expect(hit.ambiguous).toBe(true);
    // ...and the builder can name the shelves that clash.
    expect(codeOwners(byId).get("h4k9")?.length).toBe(2);
  });
});
