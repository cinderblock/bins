/**
 * Convergence tests — the highest-value tests in the repo. The same set of
 * ops, applied in ANY order (and with re-application, as happens when a client
 * optimistically applies its own op and later replays the canonical version),
 * must produce byte-identical state.
 */
import { describe, expect, test } from "bun:test";
import { MemoryStore } from "./memory-store";
import type { CanonicalOp } from "./ops";
import { applyOp } from "./reducer";

let uuidCounter = 0;
/** Deterministic, sortable fake uuids (tests only). */
function fakeUuid(): string {
  const n = String(uuidCounter++).padStart(12, "0");
  return `00000000-0000-7000-8000-${n}`;
}

function op(
  partial: Partial<CanonicalOp> & Pick<CanonicalOp, "type">,
): CanonicalOp {
  const opId = fakeUuid();
  return {
    opId,
    clientTime: 1000,
    effectiveTime: 1000,
    seq: null,
    deviceId: "device-a",
    geo: null,
    binId: 1,
    payload: {},
    ...partial,
  } as CanonicalOp;
}

/** Mulberry32 — deterministic shuffle seeds. */
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(items: T[], seed: number): T[] {
  const random = rng(seed);
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const a = out[i] as T;
    out[i] = out[j] as T;
    out[j] = a;
  }
  return out;
}

async function reduceAll(ops: CanonicalOp[]): Promise<string> {
  const store = new MemoryStore();
  for (const o of ops) await applyOp(store, o);
  return store.snapshot();
}

/** Assert every permutation strategy converges to the in-order result. */
async function expectConvergence(ops: CanonicalOp[]) {
  const canonical = await reduceAll(ops);
  for (const seed of [1, 2, 3, 4, 5]) {
    expect(await reduceAll(shuffled(ops, seed))).toBe(canonical);
  }
  // Re-application (optimistic apply + canonical replay) must be a no-op.
  expect(await reduceAll([...ops, ...ops])).toBe(canonical);
  // Interleaved double-apply in a different order.
  expect(await reduceAll(shuffled([...ops, ...ops], 6))).toBe(canonical);
  return canonical;
}

describe("reducer convergence", () => {
  test("claim + conflicting field writes from two devices (LWW per field)", async () => {
    const ops = [
      op({
        type: "bin.allocate",
        deviceId: null,
        effectiveTime: 100,
        payload: { code: "7HX6" },
      }),
      op({
        type: "bin.claim",
        deviceId: "device-a",
        effectiveTime: 200,
        payload: { name: "Kitchen stuff", sizeClass: "M" },
      }),
      op({
        type: "bin.setFields",
        deviceId: "device-b",
        effectiveTime: 300,
        payload: { name: "Kitchen + spices" },
      }),
      op({
        type: "bin.setFields",
        deviceId: "device-a",
        effectiveTime: 250,
        payload: { name: "Kitchen things", externalLabel: "K1" },
      }),
    ];
    const snapshot = await expectConvergence(ops);
    // Latest name (300) wins; label (250) untouched by the 300 write.
    expect(snapshot).toContain('"name":"Kitchen + spices"');
    expect(snapshot).toContain('"externalLabel":"K1"');
    expect(snapshot).toContain('"status":"active"');
  });

  test("location conflict: latest effectiveTime wins, opId breaks ties", async () => {
    const ops = [
      op({
        type: "bin.allocate",
        deviceId: null,
        effectiveTime: 100,
        payload: { code: "7HX6" },
      }),
      op({
        type: "bin.setLocation",
        deviceId: "device-a",
        effectiveTime: 500,
        payload: { locationName: "Trailer" },
      }),
      op({
        type: "bin.setLocation",
        deviceId: "device-b",
        effectiveTime: 500,
        payload: { locationName: "Shelf A2" },
      }),
    ];
    const snapshot = await expectConvergence(ops);
    // Same effectiveTime: higher opId wins; fakeUuid is monotonic, so the
    // later-created op ("Shelf A2") wins deterministically everywhere.
    expect(snapshot).toContain('"locationName":"Shelf A2"');
  });

  test("primary photo is derived: latest contents_photo, item photos ignored", async () => {
    const hashA = "a".repeat(64);
    const hashB = "b".repeat(64);
    const hashC = "c".repeat(64);
    const thumbB = "d".repeat(64);
    const originalB = "e".repeat(64);
    const ops = [
      op({
        type: "bin.allocate",
        deviceId: null,
        effectiveTime: 100,
        payload: { code: "7HX6" },
      }),
      op({
        type: "entry.addPhoto",
        effectiveTime: 200,
        payload: { hash: hashA, kind: "contents_photo", mime: "image/jpeg" },
      }),
      op({
        type: "entry.addPhoto",
        effectiveTime: 400,
        payload: { hash: hashC, kind: "item_photo", mime: "image/jpeg" },
      }),
      op({
        type: "entry.addPhoto",
        effectiveTime: 300,
        payload: {
          hash: hashB,
          kind: "contents_photo",
          mime: "image/jpeg",
          thumbHash: thumbB,
          originalHash: originalB,
        },
      }),
    ];
    const snapshot = await expectConvergence(ops);
    expect(snapshot).toContain(`"primaryPhotoHash":"${hashB}"`);
    // The rendition hashes ride the entry, and the primary's thumb is derived
    // alongside the primary photo itself.
    expect(snapshot).toContain(`"primaryThumbHash":"${thumbB}"`);
    expect(snapshot).toContain(`"thumbHash":"${thumbB}"`);
    expect(snapshot).toContain(`"originalHash":"${originalB}"`);
  });

  test("removing the primary photo recomputes it; remove-before-add tombstones", async () => {
    const hashA = "a".repeat(64);
    const hashB = "b".repeat(64);
    const add1 = op({
      type: "entry.addPhoto",
      effectiveTime: 200,
      payload: { hash: hashA, kind: "contents_photo", mime: "image/jpeg" },
    });
    const add2 = op({
      type: "entry.addPhoto",
      effectiveTime: 300,
      payload: { hash: hashB, kind: "contents_photo", mime: "image/jpeg" },
    });
    const ops = [
      op({
        type: "bin.allocate",
        deviceId: null,
        effectiveTime: 100,
        payload: { code: "7HX6" },
      }),
      add1,
      add2,
      op({
        type: "entry.remove",
        effectiveTime: 400,
        payload: { entryOpId: add2.opId },
      }),
    ];
    const snapshot = await expectConvergence(ops);
    // add2 (the newer contents shot) was removed -> primary falls back to add1.
    expect(snapshot).toContain(`"primaryPhotoHash":"${hashA}"`);
    expect(snapshot).toContain(`"deletedByOpId"`);
  });

  test("notes append and survive any ordering", async () => {
    const ops = [
      op({
        type: "bin.allocate",
        deviceId: null,
        effectiveTime: 100,
        payload: { code: "7HX6" },
      }),
      op({
        type: "entry.addNote",
        deviceId: "device-a",
        effectiveTime: 200,
        payload: { text: "3 tarps, rope" },
        geo: { lat: 40.786, lng: -119.206, acc: 12 },
      }),
      op({
        type: "entry.addNote",
        deviceId: "device-b",
        effectiveTime: 250,
        payload: { text: "added the zip ties" },
      }),
    ];
    const snapshot = await expectConvergence(ops);
    expect(snapshot).toContain("3 tarps, rope");
    expect(snapshot).toContain("added the zip ties");
  });

  test("allocate carries the sticker secret; claim-before-allocate converges", async () => {
    const ops = [
      // The claim can reach a replica before its allocate (offline claim of a
      // fresh sticker) — the code must land either way.
      op({
        type: "bin.claim",
        deviceId: "device-a",
        effectiveTime: 200,
        payload: { name: "Tools" },
      }),
      op({
        type: "bin.allocate",
        deviceId: null,
        effectiveTime: 100,
        payload: { code: "QK4M" },
      }),
    ];
    const snapshot = await expectConvergence(ops);
    expect(snapshot).toContain('"secretCode":"QK4M"');
    expect(snapshot).toContain('"status":"active"');
    expect(snapshot).toContain('"name":"Tools"');
  });

  test("retire/restore are LWW on status; latest write wins in any order", async () => {
    const ops = [
      op({
        type: "bin.allocate",
        deviceId: null,
        effectiveTime: 100,
        payload: { code: "7HX6" },
      }),
      op({
        type: "bin.claim",
        deviceId: "device-a",
        effectiveTime: 200,
        payload: { name: "Costumes" },
      }),
      op({
        type: "bin.retire",
        deviceId: null,
        effectiveTime: 300,
        payload: {},
      }),
      op({
        type: "bin.restore",
        deviceId: null,
        effectiveTime: 400,
        payload: {},
      }),
    ];
    const snapshot = await expectConvergence(ops);
    // restore (400) is the latest status write -> active; the name survives.
    expect(snapshot).toContain('"status":"active"');
    expect(snapshot).toContain('"name":"Costumes"');
  });

  test("locations: upsert/rename/archive converge", async () => {
    const locationId = fakeUuid();
    const ops = [
      op({
        type: "location.upsert",
        effectiveTime: 100,
        payload: { locationId, name: "Storage", sortOrder: 1 },
      }),
      op({
        type: "location.upsert",
        effectiveTime: 300,
        payload: { locationId, name: "Storage unit", sortOrder: 2 },
      }),
      op({
        type: "location.archive",
        effectiveTime: 200,
        payload: { locationId, archived: true },
      }),
    ] as CanonicalOp[];
    const snapshot = await expectConvergence(ops);
    expect(snapshot).toContain('"name":"Storage unit"');
    expect(snapshot).toContain('"archived":true');
  });
});
