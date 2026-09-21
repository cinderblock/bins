/**
 * The layering that makes the assistant affordable.
 *
 * The property under test is narrow and load-bearing: writing to the group
 * must NOT change the bytes of the stable layers. Prompt caching is a prefix
 * match, so the moment a new op rewrites the catalog, every question pays
 * full price — and people write at exactly the moment they ask where things
 * go. See plans/ai-assist.md.
 *
 * No database. The catalog reads through a CatalogSource, so the whole
 * snapshot-and-tail decision can be driven from plain objects — which is what
 * makes the byte-for-byte assertions below meaningful rather than incidental.
 */
import { describe, expect, test } from "bun:test";
import {
  type CatalogBin,
  type CatalogData,
  type CatalogOp,
  type CatalogSource,
  MAX_TAIL_OPS,
  buildCatalogLayers,
  forgetSnapshot,
} from "./catalog";
import type { AiLayer } from "./types";

const GROUP = "g";

function bin(id: number, over: Partial<CatalogBin> = {}): CatalogBin {
  return {
    id,
    status: "active",
    name: null,
    description: null,
    labelIds: null,
    locationId: null,
    locationName: null,
    slot: null,
    sizeId: null,
    sizeClass: null,
    fillLevel: null,
    weightGrams: null,
    primaryPhotoHash: null,
    ...over,
  };
}

function data(): CatalogData {
  return {
    bins: [
      bin(10, {
        name: "Power cables",
        description: "extension cords, IEC leads",
        labelIds: ["l-cables"],
        locationId: "p-shelf",
        slot: "5",
        fillLevel: 40,
      }),
      bin(11, { locationId: "p-shelf", primaryPhotoHash: "a".repeat(64) }),
      bin(12, { status: "retired", name: "Old junk" }),
    ],
    notesByBin: new Map([[10, ["the long ones live here"]]]),
    describedByBin: new Map([[11, ["cordless drill", "drill bits"]]]),
    labels: [
      { id: "l-kitchen", name: "kitchen", archived: false },
      { id: "l-cables", name: "cables", archived: false },
      { id: "l-gone", name: "obsolete", archived: true },
    ],
    sizes: [{ id: "s-banker", name: "Banker box", archived: false }],
    places: [
      { id: "p-aisle", name: "Aisle H", parentId: null, archived: false },
      {
        id: "p-shelf",
        name: "H4",
        parentId: "p-aisle",
        cols: 4,
        rows: 3,
        code: "H4",
        archived: false,
      },
    ],
  };
}

/** A source whose op log can be appended to between calls. */
function sourceWith(): CatalogSource & { append(op: CatalogOp): void } {
  const log: CatalogOp[] = [];
  return {
    append(op) {
      log.push(op);
    },
    async latestSeq() {
      return log.length;
    },
    async load() {
      return data();
    },
    async opsAfter(_group, seq, limit) {
      return log.slice(seq, seq + limit);
    },
  };
}

/** Indexing is checked, so reach for a layer through here. */
function layer(layers: AiLayer[], index: number): AiLayer {
  const found = layers[index];
  if (!found) throw new Error(`expected a layer at index ${index}`);
  return found;
}

describe("catalog layering", () => {
  test("renders boxes, vocabulary and geometry from the descriptor", async () => {
    forgetSnapshot(GROUP);
    const { layers, bins } = await buildCatalogLayers(GROUP, sourceWith());
    const vocabulary = layer(layers, 0);
    const snapshot = layer(layers, 1);

    expect(bins).toBe(2); // the retired box is not offered as a destination
    expect(vocabulary.text).toContain("kitchen");
    expect(vocabulary.text).not.toContain("obsolete"); // archived
    expect(vocabulary.text).toContain("Banker box");
    // Geometry comes from locationGeometry, never from cols/rows directly:
    // a 4×3 shelf holding two boxes has ten free.
    expect(vocabulary.text).toContain("4×3 grid");
    expect(vocabulary.text).toContain("10 of 12 free");
    expect(vocabulary.text).toContain("Aisle H › H4");
    // The shelf's own printed sticker: how a person finds it in the room.
    expect(vocabulary.text).toContain("[sticker H4]");
    // A place with no shape reports occupancy instead of a capacity.
    expect(vocabulary.text).toContain("no fixed capacity");

    expect(snapshot.text).toContain("#10 Power cables");
    expect(snapshot.text).toContain("extension cords");
    expect(snapshot.text).toContain("slot 5");
    expect(snapshot.text).toContain("full: 40%");
    expect(snapshot.text).toContain("the long ones live here");
    expect(snapshot.text).not.toContain("Old junk");
  });

  test("what a model read off a photo is attributed, not passed off as notes", async () => {
    forgetSnapshot(GROUP);
    const { layers } = await buildCatalogLayers(GROUP, sourceWith());
    // Box 11 has no text of its own — this description is the only reason it
    // is findable at all, which is the whole point of captioning.
    expect(layer(layers, 1).text).toContain("#11");
    expect(layer(layers, 1).text).toContain("seen in photo: cordless drill");
    // ...and it no longer needs the "we cannot see inside" fallback.
    expect(layer(layers, 1).text).not.toContain("only as a photo");
  });

  test("an undescribed photo still says its contents are unknown", async () => {
    forgetSnapshot(GROUP);
    const bare = sourceWith();
    const withoutDescriptions: typeof bare = {
      ...bare,
      async load() {
        return { ...(await bare.load(GROUP)), describedByBin: new Map() };
      },
    };
    // Otherwise it reads as an empty box, and the assistant would happily
    // recommend putting something into a box that is already full.
    const { layers } = await buildCatalogLayers(GROUP, withoutDescriptions);
    expect(layer(layers, 1).text).toContain("only as a photo");
  });

  test("both context layers are marked stable", async () => {
    forgetSnapshot(GROUP);
    const { layers } = await buildCatalogLayers(GROUP, sourceWith());
    expect(layers.map((l) => l.stable)).toEqual([true, true]);
  });

  test("writing to the group does NOT rewrite the stable layers", async () => {
    forgetSnapshot(GROUP);
    const source = sourceWith();
    const before = await buildCatalogLayers(GROUP, source);
    source.append({
      binId: 10,
      type: "entry.addNote",
      payload: { text: "found the long ones in here" },
    });
    const after = await buildCatalogLayers(GROUP, source);

    // The whole cost model rests on this: the cached prefix survives a write.
    expect(layer(after.layers, 0).text).toBe(layer(before.layers, 0).text);
    expect(layer(after.layers, 1).text).toBe(layer(before.layers, 1).text);
    // The new information rides a third, explicitly volatile layer.
    expect(after.layers).toHaveLength(3);
    expect(layer(after.layers, 2).stable).toBe(false);
    expect(layer(after.layers, 2).text).toContain(
      "found the long ones in here",
    );
    expect(after.tailOps).toBe(1);
  });

  test("the diff tail grows by appending, oldest first", async () => {
    forgetSnapshot(GROUP);
    const source = sourceWith();
    await buildCatalogLayers(GROUP, source);
    source.append({
      binId: 10,
      type: "entry.addNote",
      payload: { text: "first" },
    });
    const one = await buildCatalogLayers(GROUP, source);
    source.append({
      binId: 10,
      type: "entry.addNote",
      payload: { text: "second" },
    });
    const two = await buildCatalogLayers(GROUP, source);

    // Newest-first ordering would rewrite the layer on every op and destroy
    // the thing this design exists to protect — so the earlier tail must be a
    // strict prefix of the later one.
    const earlier = layer(one.layers, 2).text;
    const later = layer(two.layers, 2).text;
    expect(later.startsWith(earlier)).toBe(true);
    expect(later.indexOf("first")).toBeLessThan(later.indexOf("second"));
  });

  test("an overlong tail is folded back into a fresh snapshot", async () => {
    forgetSnapshot(GROUP);
    const source = sourceWith();
    await buildCatalogLayers(GROUP, source);
    for (let i = 0; i <= MAX_TAIL_OPS; i++)
      source.append({ binId: 10, type: "entry.addPhoto", payload: {} });
    const rebuilt = await buildCatalogLayers(GROUP, source);

    // Past a point the tail costs more than the cache write it was avoiding.
    expect(rebuilt.tailOps).toBe(0);
    expect(rebuilt.layers).toHaveLength(2);
  });

  test("retiring a box reaches the model through the tail", async () => {
    forgetSnapshot(GROUP);
    const source = sourceWith();
    await buildCatalogLayers(GROUP, source);
    source.append({ binId: 10, type: "bin.retire", payload: {} });
    const { layers } = await buildCatalogLayers(GROUP, source);
    // The snapshot still lists #10, so the tail has to be unambiguous about
    // it — otherwise the assistant sends someone to a retired box.
    expect(layer(layers, 2).text).toContain("#10 RETIRED");
  });

  test("a deleted box is called gone, not left to the default rendering", async () => {
    forgetSnapshot(GROUP);
    const source = sourceWith();
    await buildCatalogLayers(GROUP, source);
    source.append({ binId: 10, type: "bin.delete", payload: {} });
    const { layers } = await buildCatalogLayers(GROUP, source);
    // The snapshot still lists #10; "#10 bin.delete" is true but reads as
    // noise, and sending someone to a box that no longer exists is the one
    // answer worse than no answer.
    expect(layer(layers, 2).text).toContain("#10 DELETED");
  });

  test("an unrecognised op type still reports that something happened", async () => {
    forgetSnapshot(GROUP);
    const source = sourceWith();
    await buildCatalogLayers(GROUP, source);
    // New op types will arrive without this file hearing about it. Silence
    // would be worse than a terse line: the snapshot is stale either way, but
    // only one of those says so.
    source.append({ binId: 10, type: "bin.somethingNew", payload: {} });
    const { layers } = await buildCatalogLayers(GROUP, source);
    expect(layer(layers, 2).text).toContain("#10 bin.somethingNew");
  });
});
