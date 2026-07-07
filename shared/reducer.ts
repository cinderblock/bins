/**
 * The shared reducer: materializes bin/entry/location state from the op log.
 * The server runs it inside the push transaction (Drizzle store adapter); the
 * client runs it over IndexedDB (Dexie store adapter). One implementation, two
 * stores — this is the convergence linchpin, covered by reducer.test.ts.
 *
 * Convergence design (ops may be applied in ANY order and re-applied):
 * - Scalar fields are last-writer-wins, compared by (effectiveTime, opId) per
 *   field, tracked in `fieldClocks`. Re-applying the winning op is a no-op.
 * - Entries (photos/notes) are keyed by opId — append-only, order-free.
 * - An entry.remove for a not-yet-seen entry leaves a tombstone stub; the add
 *   arriving later fills the fields but stays deleted.
 * - The primary photo is DERIVED — latest non-deleted contents_photo by
 *   (effectiveTime, id) — never a settable field, so it cannot conflict.
 */
import type { CanonicalOp, EntryKind } from "./ops";

export type BinStatus = "unclaimed" | "active" | "retired";

export interface BinState {
  /** The global short ID (the number in the QR URL). */
  id: number;
  status: BinStatus;
  /**
   * The sticker secret (`/{id}#{CODE}`). Written only by bin.allocate — the
   * sole allocate per bin is the sole writer, so no clock is needed. Null only
   * on stubs created by an op that outran its allocate on this replica.
   */
  secretCode: string | null;
  name: string | null;
  sizeClass: string | null;
  externalLabel: string | null;
  locationName: string | null;
  /** Derived: hash of the latest non-deleted contents_photo entry. */
  primaryPhotoHash: string | null;
  /** Derived alongside primaryPhotoHash: its strip thumbnail, when it has one. */
  primaryThumbHash: string | null;
  /** field -> clock ("paddedEffectiveTime:opId") of the last write that won. */
  fieldClocks: Record<string, string>;
  createdAt: number;
  updatedAt: number;
}

export interface EntryState {
  /** = the opId of the entry.addPhoto / entry.addNote op. */
  id: string;
  binId: number;
  kind: EntryKind;
  text: string | null;
  photoHash: string | null;
  thumbHash: string | null;
  originalHash: string | null;
  mime: string | null;
  deviceId: string | null;
  effectiveTime: number;
  geoLat: number | null;
  geoLng: number | null;
  geoAcc: number | null;
  /** Tombstone: opId of the entry.remove that deleted this entry. */
  deletedByOpId: string | null;
}

export interface LocationState {
  id: string;
  name: string;
  sortOrder: number;
  archived: boolean;
  fieldClocks: Record<string, string>;
}

/**
 * Storage the reducer runs against. All methods may be called multiple times
 * per op; implementations should be plain reads/writes (no business logic).
 */
export interface StateStore {
  getBin(id: number): Promise<BinState | undefined>;
  putBin(bin: BinState): Promise<void>;
  getEntry(id: string): Promise<EntryState | undefined>;
  putEntry(entry: EntryState): Promise<void>;
  /** Latest non-deleted contents_photo entry for a bin, by (effectiveTime, id). */
  getLatestContentsEntry(binId: number): Promise<EntryState | undefined>;
  getLocation(id: string): Promise<LocationState | undefined>;
  putLocation(location: LocationState): Promise<void>;
}

/** Clock strings compare lexicographically as (effectiveTime, opId) tuples. */
export function clockOf(op: Pick<CanonicalOp, "effectiveTime" | "opId">) {
  return `${String(op.effectiveTime).padStart(15, "0")}:${op.opId}`;
}

/**
 * Does a write with clock `next` win over the current `prev` clock?
 * Equal clocks (the same op re-applied, e.g. canonical replay of an op the
 * client already applied optimistically) also "win" so the canonical values
 * overwrite the provisional ones.
 */
function wins(next: string, prev: string | undefined): boolean {
  return prev === undefined || next >= prev;
}

function newBin(id: number, time: number): BinState {
  return {
    id,
    status: "unclaimed",
    secretCode: null,
    name: null,
    sizeClass: null,
    externalLabel: null,
    locationName: null,
    primaryPhotoHash: null,
    primaryThumbHash: null,
    fieldClocks: {},
    createdAt: time,
    updatedAt: time,
  };
}

/**
 * Get-or-create a bin and fold the op's time into createdAt (min) / updatedAt
 * (max). Min and max are commutative, so these stay order-independent even
 * when a client op reaches a replica before its bin.allocate.
 */
async function touchBin(
  store: StateStore,
  op: CanonicalOp & { binId: number },
) {
  const bin =
    (await store.getBin(op.binId)) ?? newBin(op.binId, op.effectiveTime);
  bin.createdAt = Math.min(bin.createdAt, op.effectiveTime);
  bin.updatedAt = Math.max(bin.updatedAt, op.effectiveTime);
  return bin;
}

/** Apply one op. Idempotent, order-independent (see header). */
export async function applyOp(
  store: StateStore,
  op: CanonicalOp,
): Promise<void> {
  switch (op.type) {
    case "bin.allocate": {
      const bin = await touchBin(store, op);
      bin.secretCode = op.payload.code;
      await store.putBin(bin);
      return;
    }

    case "bin.claim":
    case "bin.setFields": {
      const bin = await touchBin(store, op);
      const clock = clockOf(op);
      if (op.type === "bin.claim" && wins(clock, bin.fieldClocks.status)) {
        bin.status = "active";
        bin.fieldClocks.status = clock;
      }
      for (const field of ["name", "sizeClass", "externalLabel"] as const) {
        const value = op.payload[field];
        if (value === undefined) continue;
        if (!wins(clock, bin.fieldClocks[field])) continue;
        bin[field] = value ?? null;
        bin.fieldClocks[field] = clock;
      }
      await store.putBin(bin);
      return;
    }

    case "bin.setLocation": {
      const bin = await touchBin(store, op);
      const clock = clockOf(op);
      if (wins(clock, bin.fieldClocks.locationName)) {
        bin.locationName = op.payload.locationName;
        bin.fieldClocks.locationName = clock;
      }
      await store.putBin(bin);
      return;
    }

    case "bin.retire":
    case "bin.restore": {
      // Status is LWW on the same `status` clock as bin.claim, so retire and
      // restore just compete like any other write — last one wins, converges.
      const bin = await touchBin(store, op);
      const clock = clockOf(op);
      if (wins(clock, bin.fieldClocks.status)) {
        bin.status = op.type === "bin.retire" ? "retired" : "active";
        bin.fieldClocks.status = clock;
      }
      await store.putBin(bin);
      return;
    }

    case "entry.addPhoto":
    case "entry.addNote": {
      // A tombstone stub may already exist if the remove arrived first.
      const existing = await store.getEntry(op.opId);
      await store.putEntry({
        id: op.opId,
        binId: op.binId,
        kind: op.type === "entry.addNote" ? "note" : op.payload.kind,
        text: op.type === "entry.addNote" ? op.payload.text : null,
        photoHash: op.type === "entry.addPhoto" ? op.payload.hash : null,
        thumbHash:
          op.type === "entry.addPhoto" ? (op.payload.thumbHash ?? null) : null,
        originalHash:
          op.type === "entry.addPhoto"
            ? (op.payload.originalHash ?? null)
            : null,
        mime: op.type === "entry.addPhoto" ? op.payload.mime : null,
        deviceId: op.deviceId,
        effectiveTime: op.effectiveTime,
        geoLat: op.geo?.lat ?? null,
        geoLng: op.geo?.lng ?? null,
        geoAcc: op.geo?.acc ?? null,
        deletedByOpId: existing?.deletedByOpId ?? null,
      });
      await refreshDerived(store, op.binId, op.effectiveTime);
      return;
    }

    case "entry.remove": {
      const entry = await store.getEntry(op.payload.entryOpId);
      if (entry) {
        if (entry.deletedByOpId) return;
        await store.putEntry({ ...entry, deletedByOpId: op.opId });
        await refreshDerived(store, entry.binId, op.effectiveTime);
      } else {
        // Tombstone stub: the add hasn't been seen yet (kind is provisional).
        await store.putEntry({
          id: op.payload.entryOpId,
          binId: op.binId,
          kind: "note",
          text: null,
          photoHash: null,
          thumbHash: null,
          originalHash: null,
          mime: null,
          deviceId: null,
          effectiveTime: op.effectiveTime,
          geoLat: null,
          geoLng: null,
          geoAcc: null,
          deletedByOpId: op.opId,
        });
        await refreshDerived(store, op.binId, op.effectiveTime);
      }
      return;
    }

    case "location.upsert": {
      const { locationId, name, sortOrder } = op.payload;
      const clock = clockOf(op);
      const location = (await store.getLocation(locationId)) ?? {
        id: locationId,
        name,
        sortOrder,
        archived: false,
        fieldClocks: {},
      };
      if (wins(clock, location.fieldClocks.value)) {
        location.name = name;
        location.sortOrder = sortOrder;
        location.fieldClocks.value = clock;
      }
      await store.putLocation(location);
      return;
    }

    case "location.archive": {
      const { locationId, archived } = op.payload;
      const clock = clockOf(op);
      const location = await store.getLocation(locationId);
      if (!location) {
        // archive before upsert: keep the flag, name arrives later via LWW.
        await store.putLocation({
          id: locationId,
          name: "",
          sortOrder: 0,
          archived,
          fieldClocks: { archived: clock },
        });
        return;
      }
      if (wins(clock, location.fieldClocks.archived)) {
        location.archived = archived;
        location.fieldClocks.archived = clock;
        await store.putLocation(location);
      }
      return;
    }
  }
}

/** Recompute a bin's derived primary photo (and fold in the op's time). */
async function refreshDerived(store: StateStore, binId: number, time: number) {
  const bin = (await store.getBin(binId)) ?? newBin(binId, time);
  bin.createdAt = Math.min(bin.createdAt, time);
  bin.updatedAt = Math.max(bin.updatedAt, time);
  const latest = await store.getLatestContentsEntry(binId);
  bin.primaryPhotoHash = latest?.photoHash ?? null;
  bin.primaryThumbHash = latest?.thumbHash ?? null;
  await store.putBin(bin);
}

/** Comparator implementing the (effectiveTime, id) order for entries. */
export function compareEntries(a: EntryState, b: EntryState): number {
  if (a.effectiveTime !== b.effectiveTime)
    return a.effectiveTime - b.effectiveTime;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
