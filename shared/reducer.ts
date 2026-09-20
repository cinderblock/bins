/**
 * The shared reducer: materializes bin/entry/location state from the op log.
 * The server runs it inside the push transaction (Drizzle store adapter); the
 * client runs it over IndexedDB (Dexie store adapter). One implementation, two
 * stores — this is the convergence linchpin, covered by reducer.test.ts.
 *
 * Convergence design (ops may be applied in ANY order and re-applied):
 * - Scalar fields are last-writer-wins, compared by (effectiveTime, opId) per
 *   field, tracked in `fieldClocks`. Re-applying the winning op is a no-op.
 * - Entries (photos/notes) are keyed by opId — append-only, order-free. Their
 *   ONE mutable bit is deletion, which is LWW on its own `deletedClock`
 *   (entry.remove / entry.restore compete like any field), so an undo
 *   propagates to every device instead of being a one-way door.
 * - An entry.remove for a not-yet-seen entry leaves a CONTENTLESS stub carrying
 *   the verdict; the add arriving later fills the fields and keeps it. Such a
 *   stub can also be live (restore-before-add), so consumers must skip entries
 *   with no content rather than assume "not deleted" means "renderable".
 * - The primary photo is DERIVED — latest non-deleted contents_photo by
 *   (effectiveTime, id) — never a settable field, so it cannot conflict.
 */
import type { CanonicalOp, EntryKind } from "./ops";

/**
 * `deleted` is a tombstone an admin can set on a RETIRED box: the record is
 * gone from every view, but the id survives so a stale sticker still reads as
 * dead rather than resolving to whatever gets allocated next. See the
 * `bin.delete` op.
 */
export type BinStatus = "unclaimed" | "active" | "retired" | "deleted";

export interface BinState {
  /** The global short ID (the number in the QR URL). */
  id: number;
  /**
   * Opaque public identifier (UUID), the URL/QR handle on deployments that
   * keep numbers internal. Written only by bin.allocate (sole writer, no
   * clock). Null on boxes allocated before handles existed and on stubs.
   */
  handle: string | null;
  status: BinStatus;
  /**
   * The sticker secret (`/{id}#{CODE}`). Written only by bin.allocate — the
   * sole allocate per bin is the sole writer, so no clock is needed. Null only
   * on stubs created by an op that outran its allocate on this replica.
   */
  secretCode: string | null;
  name: string | null;
  /** Legacy free-text size; superseded by sizeId but never dropped. */
  sizeClass: string | null;
  /** Chosen box-size definition (see BoxSizeState), or null. */
  sizeId: string | null;
  externalLabel: string | null;
  /** Total weight in grams (canonical unit; UI renders lb/kg). LWW scalar. */
  weightGrams: number | null;
  /** How full, integer percent 0..100, or null when not recorded. LWW. */
  fillLevel: number | null;
  /** Subtext under the title (label lines). LWW scalar. */
  description: string | null;
  /** Extra instructions for the label drawing. LWW scalar. */
  artPrompt: string | null;
  /** sha256 of the chosen label artwork PNG in the blob store. LWW scalar. */
  labelArtHash: string | null;
  /** The code in the current sticker's QR fragment (see shared/ops.ts). */
  stickerCode: string | null;
  /**
   * The latest sighting (bin.sighted), by (effectiveTime, opId): when, how,
   * and the code the sticker carried. Null until ever seen.
   */
  lastSeenAt: number | null;
  lastSeenVia: string | null;
  lastSeenCode: string | null;
  locationName: string | null;
  /**
   * Structured location: the configured place this box sits in, and an opaque
   * position within it ("A2"). Shares ONE clock with locationName, so a box
   * always has exactly one location — setting either form clears the other.
   */
  locationId: string | null;
  slot: string | null;
  /**
   * Category label ids this bin carries (many-to-many). DERIVED from the
   * per-label booleans in `fieldClocks` under `label:<id>` keys — kept SORTED
   * so the array is order-independent (a convergence requirement). Set by
   * bin.setLabel; the label rows themselves live in LocationState's sibling
   * LabelState.
   */
  labelIds: string[];
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
  /**
   * Author of the winning entry.remove — who deleted it. Set/cleared together
   * with deletedByOpId under the same clock. Null while live, and on
   * tombstones materialized before this field existed (a replica never
   * re-applies old ops, so only a from-scratch resync backfills those —
   * display-only metadata, so the gap is cosmetic, not divergence).
   */
  deletedByDeviceId: string | null;
  /** effectiveTime of the winning entry.remove; null while live / legacy. */
  deletedAt: number | null;
  /**
   * LWW clock of the last entry.remove/entry.restore applied — deletion is the
   * only mutable bit on an entry, so it gets a single clock rather than the
   * `fieldClocks` map the multi-field entities carry. Null means no
   * remove/restore has been seen (or the row predates undo support, in which
   * case any later verdict wins — see plans/bins.md).
   */
  deletedClock: string | null;
  /**
   * What a model saw in this photo (entry.setAiItems). Null = never looked at;
   * an empty array = looked, saw nothing nameable. The two are different
   * answers and must stay distinguishable, because only the first is worth
   * spending money on again.
   */
  aiItems: string[] | null;
  /** Which model produced `aiItems`. Null whenever aiItems is null. */
  aiModel: string | null;
  /**
   * The photo `aiItems` was read from. If this stops matching `photoHash` the
   * words describe a picture that is no longer here, and consumers must
   * ignore them rather than show a stale description.
   */
  aiPhotoHash: string | null;
  /**
   * LWW clock for the three fields above — they are written as one unit, so
   * they share one clock rather than joining the fieldClocks map.
   */
  aiItemsClock: string | null;
}

export interface LocationState {
  id: string;
  name: string;
  sortOrder: number;
  /** Nests places (building → aisle → shelf). Null = top level. */
  parentId: string | null;
  /** Grid of a shelf, when it has one. Null = an unstructured place. */
  cols: number | null;
  rows: number | null;
  /** Vertical size in shelf units when drawn in a bay; null = 1. */
  span: number | null;
  /** What the shelf's own printed sticker says; null = it has none. */
  code: string | null;
  archived: boolean;
  fieldClocks: Record<string, string>;
}

export type SuggestionStatus = "pending" | "accepted" | "rejected";

/**
 * A proposed edit to a box's identity fields, awaiting an admin.
 *
 * Two ops write this row from opposite ends and may arrive in either order:
 * `bin.suggest` (the member's proposal — fills the descriptive fields) and
 * `suggestion.resolve` (the admin's verdict — sets status). A resolve that
 * lands first leaves a STUB whose fields the suggest fills in later without
 * touching the verdict, exactly like the entry.remove tombstone.
 */
export interface SuggestionState {
  /** = the opId of the bin.suggest op. */
  id: string;
  binId: number;
  /** Author of the suggestion; null until its op arrives (resolve-first stub). */
  deviceId: string | null;
  /** Proposed values. `undefined` = field not part of this suggestion. */
  fields: {
    name?: string | null;
    sizeClass?: string | null;
    externalLabel?: string | null;
    description?: string | null;
  };
  note: string | null;
  status: SuggestionStatus;
  createdAt: number;
  resolvedAt: number | null;
  /** opId of the suggestion.resolve that decided it. */
  resolvedByOpId: string | null;
  /** Only `status` is contended (two admins racing) — LWW like everything. */
  fieldClocks: Record<string, string>;
}

/**
 * A group-defined BOX TYPE. Same op-driven shape as a label or a location,
 * but authored only by an admin: the vocabulary is curated, so members choose
 * from it rather than adding to it.
 *
 * Dimensions are canonical millimetres and optional — a name-only size is
 * legitimate, and is where most groups will start.
 */
export interface BoxSizeState {
  id: string;
  name: string;
  lengthMm: number | null;
  widthMm: number | null;
  heightMm: number | null;
  sortOrder: number;
  /** Key into the app's size icon set, or null for the generic box. */
  icon: string | null;
  archived: boolean;
  fieldClocks: Record<string, string>;
}

/** A group-defined category label — the same op-driven shape as a location. */
export interface LabelState {
  id: string;
  name: string;
  /** Mantine color name for the chip, or null (UI falls back to a default). */
  color: string | null;
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
  getLabel(id: string): Promise<LabelState | undefined>;
  putLabel(label: LabelState): Promise<void>;
  getBoxSize(id: string): Promise<BoxSizeState | undefined>;
  putBoxSize(size: BoxSizeState): Promise<void>;
  getSuggestion(id: string): Promise<SuggestionState | undefined>;
  putSuggestion(suggestion: SuggestionState): Promise<void>;
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
    handle: null,
    status: "unclaimed",
    secretCode: null,
    name: null,
    sizeClass: null,
    sizeId: null,
    externalLabel: null,
    weightGrams: null,
    fillLevel: null,
    description: null,
    artPrompt: null,
    labelArtHash: null,
    stickerCode: null,
    lastSeenAt: null,
    lastSeenVia: null,
    lastSeenCode: null,
    locationName: null,
    locationId: null,
    slot: null,
    labelIds: [],
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
      // Sole writer, like the code — except for boxes older than handles,
      // whose allocate carries none and whose handle arrives by a later
      // bin.setHandle instead. An allocate without one must therefore never
      // CLEAR a handle a setHandle already put there, or the result would
      // depend on which op a replica saw first. `?? null` keeps replicas
      // byte-identical whether the op carried the field or predates it.
      bin.handle = op.payload.handle ?? bin.handle ?? null;
      await store.putBin(bin);
      return;
    }

    case "bin.setHandle": {
      // Backfill for boxes older than handles; the one writer besides
      // allocate, and only ever for a box that has none.
      const bin = await touchBin(store, op);
      bin.handle = op.payload.handle;
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
      for (const field of [
        "name",
        "sizeClass",
        "sizeId",
        "externalLabel",
        "description",
        "artPrompt",
        "labelArtHash",
        "stickerCode",
      ] as const) {
        const value = op.payload[field];
        if (value === undefined) continue;
        if (!wins(clock, bin.fieldClocks[field])) continue;
        bin[field] = value ?? null;
        bin.fieldClocks[field] = clock;
      }
      // weightGrams is numeric, so it's folded separately from the string loop.
      if (
        op.payload.weightGrams !== undefined &&
        wins(clock, bin.fieldClocks.weightGrams)
      ) {
        bin.weightGrams = op.payload.weightGrams ?? null;
        bin.fieldClocks.weightGrams = clock;
      }
      if (
        op.payload.fillLevel !== undefined &&
        wins(clock, bin.fieldClocks.fillLevel)
      ) {
        bin.fillLevel = op.payload.fillLevel ?? null;
        bin.fieldClocks.fillLevel = clock;
      }
      await store.putBin(bin);
      return;
    }

    case "bin.sighted": {
      // The latest sighting wins, on its own clock — a sighting never
      // competes with an edit, and two devices seeing the box a second apart
      // converge on the later one whatever order the ops arrive.
      const bin = await touchBin(store, op);
      const clock = clockOf(op);
      if (wins(clock, bin.fieldClocks.seen)) {
        bin.lastSeenAt = op.effectiveTime;
        bin.lastSeenVia = op.payload.via;
        bin.lastSeenCode = op.payload.code;
        bin.fieldClocks.seen = clock;
      }
      await store.putBin(bin);
      return;
    }

    case "bin.setLabel": {
      // Membership is LWW per label: each label is its own boolean field
      // (`label:<id>` clock), so concurrent toggles of different labels never
      // interfere. labelIds is the derived, SORTED set of present labels.
      const bin = await touchBin(store, op);
      const clock = clockOf(op);
      const key = `label:${op.payload.labelId}`;
      if (wins(clock, bin.fieldClocks[key])) {
        bin.fieldClocks[key] = clock;
        const present = new Set(bin.labelIds);
        if (op.payload.present) present.add(op.payload.labelId);
        else present.delete(op.payload.labelId);
        bin.labelIds = [...present].sort();
      }
      await store.putBin(bin);
      return;
    }

    case "bin.setLocation": {
      const bin = await touchBin(store, op);
      const clock = clockOf(op);
      // One clock for the whole location, and every field is assigned — never
      // merged. A structured place replaces a freeform one and vice versa, so
      // a box cannot end up claiming to be in two places at once. The clock
      // key stays `locationName` so writes from older clients still compete.
      if (wins(clock, bin.fieldClocks.locationName)) {
        bin.locationName = op.payload.locationName;
        bin.locationId = op.payload.locationId ?? null;
        bin.slot = op.payload.slot ?? null;
        bin.fieldClocks.locationName = clock;
      }
      await store.putBin(bin);
      return;
    }

    case "bin.retire":
    case "bin.restore":
    case "bin.delete": {
      // Status is LWW on the same `status` clock as bin.claim, so retire,
      // restore and delete just compete like any other write — last one
      // wins, converges. Delete is not special-cased into a terminal state:
      // that would need "has anything happened since", which is exactly the
      // order-dependence the reducer must not have. An admin who deletes and
      // then restores gets the box back, and both devices agree on which
      // came last.
      const bin = await touchBin(store, op);
      const clock = clockOf(op);
      if (wins(clock, bin.fieldClocks.status)) {
        bin.status =
          op.type === "bin.retire"
            ? "retired"
            : op.type === "bin.delete"
              ? "deleted"
              : "active";
        bin.fieldClocks.status = clock;
      }
      await store.putBin(bin);
      return;
    }

    case "bin.suggest": {
      // The proposal half. A resolve may already have created a stub — keep
      // its verdict and clocks, fill in what only the suggest knows.
      // Deliberately does NOT touch the bin: a proposal is not a change to the
      // box, and bumping updatedAt would reorder the "recently touched" list
      // for something nobody has agreed to yet.
      const existing = await store.getSuggestion(op.opId);
      await store.putSuggestion({
        id: op.opId,
        binId: op.binId,
        deviceId: op.deviceId,
        fields: op.payload.fields,
        note: op.payload.note ?? null,
        status: existing?.status ?? "pending",
        createdAt: op.effectiveTime,
        resolvedAt: existing?.resolvedAt ?? null,
        resolvedByOpId: existing?.resolvedByOpId ?? null,
        fieldClocks: existing?.fieldClocks ?? {},
      });
      return;
    }

    case "suggestion.resolve": {
      // The verdict half. LWW on `status` so two admins deciding the same
      // suggestion on two devices converge; an accept's field change is a
      // separate bin.setFields op competing on its own clocks, so a later
      // reject records the decision without silently reverting the box.
      const clock = clockOf(op);
      const existing = await store.getSuggestion(op.payload.suggestionId);
      const suggestion: SuggestionState = existing ?? {
        // Stub: the suggest hasn't been seen yet on this replica.
        id: op.payload.suggestionId,
        binId: op.binId,
        deviceId: null,
        fields: {},
        note: null,
        status: "pending",
        createdAt: op.effectiveTime,
        resolvedAt: null,
        resolvedByOpId: null,
        fieldClocks: {},
      };
      if (wins(clock, suggestion.fieldClocks.status)) {
        suggestion.status = op.payload.accepted ? "accepted" : "rejected";
        suggestion.resolvedAt = op.effectiveTime;
        suggestion.resolvedByOpId = op.opId;
        suggestion.fieldClocks.status = clock;
      }
      await store.putSuggestion(suggestion);
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
        deletedByDeviceId: existing?.deletedByDeviceId ?? null,
        deletedAt: existing?.deletedAt ?? null,
        deletedClock: existing?.deletedClock ?? null,
        // Carried across for the same reason the tombstone fields are: a
        // caption can reach a replica before the photo it describes, and
        // dropping it here would make the result depend on arrival order.
        aiItems: existing?.aiItems ?? null,
        aiModel: existing?.aiModel ?? null,
        aiPhotoHash: existing?.aiPhotoHash ?? null,
        aiItemsClock: existing?.aiItemsClock ?? null,
      });
      await refreshDerived(store, op.binId, op.effectiveTime);
      return;
    }

    case "entry.setAiItems": {
      // LWW on its own clock, like deletion — a re-run with a better model
      // replaces the words wholesale, and a re-applied op is a no-op.
      const clock = clockOf(op);
      const entry = await store.getEntry(op.payload.entryOpId);
      const described = {
        aiItems: op.payload.items,
        aiModel: op.payload.model,
        aiPhotoHash: op.payload.photoHash,
        aiItemsClock: clock,
      };
      if (!entry) {
        // The photo hasn't been seen here yet. Same contentless stub the
        // remove/restore path builds, so the description survives until the
        // entry.addPhoto arrives and fills the rest in.
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
          deletedByOpId: null,
          deletedByDeviceId: null,
          deletedAt: null,
          deletedClock: null,
          ...described,
        });
      } else if (wins(clock, entry.aiItemsClock ?? undefined)) {
        await store.putEntry({ ...entry, ...described });
      }
      // Deliberately NOT refreshDerived. Every other op folds its time into
      // the bin's createdAt/updatedAt, but a machine describing an old photo
      // is not the box being touched — bumping updatedAt would float every
      // captioned box to the top of "recently changed" and drown the real
      // activity. Consistently skipping is as order-independent as
      // consistently contributing; what breaks convergence is doing it only
      // for the ops that win.
      return;
    }

    case "entry.remove":
    case "entry.restore": {
      // Delete/undelete is LWW on `deletedClock`, the same way retire/restore
      // compete on a bin's `status` clock — so the two racing from different
      // devices converge on the later one whatever order they arrive in, and a
      // re-applied op is a no-op.
      const clock = clockOf(op);
      const deleted = op.type === "entry.remove";
      const entry = await store.getEntry(op.payload.entryOpId);
      if (!entry) {
        // Stub: the add hasn't been seen yet, so kind/content are provisional
        // (contentless until the add lands — consumers skip those).
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
          deletedByOpId: deleted ? op.opId : null,
          deletedByDeviceId: deleted ? op.deviceId : null,
          deletedAt: deleted ? op.effectiveTime : null,
          deletedClock: clock,
          aiItems: null,
          aiModel: null,
          aiPhotoHash: null,
          aiItemsClock: null,
        });
      } else if (wins(clock, entry.deletedClock ?? undefined)) {
        await store.putEntry({
          ...entry,
          deletedByOpId: deleted ? op.opId : null,
          deletedByDeviceId: deleted ? op.deviceId : null,
          deletedAt: deleted ? op.effectiveTime : null,
          deletedClock: clock,
        });
      }
      // Unconditionally — even for a LOSING verdict. refreshDerived folds the
      // op's time into the bin's createdAt (min) / updatedAt (max), and min is
      // only order-independent if every op contributes; skipping the loser
      // makes createdAt depend on arrival order.
      await refreshDerived(store, entry?.binId ?? op.binId, op.effectiveTime);
      return;
    }

    case "location.upsert": {
      const { locationId, name, sortOrder } = op.payload;
      const clock = clockOf(op);
      const location = (await store.getLocation(locationId)) ?? {
        id: locationId,
        name,
        sortOrder,
        parentId: null,
        cols: null,
        rows: null,
        span: null,
        code: null,
        archived: false,
        fieldClocks: {},
      };
      if (wins(clock, location.fieldClocks.value)) {
        location.name = name;
        location.sortOrder = sortOrder;
        // Assigned, not merged — an upsert describes the whole place, so a
        // shelf that loses its grid actually loses it rather than keeping a
        // stale one from an earlier write.
        location.parentId = op.payload.parentId ?? null;
        location.cols = op.payload.cols ?? null;
        location.rows = op.payload.rows ?? null;
        location.span = op.payload.span ?? null;
        // Trimmed, so a stray space typed into the field never makes a
        // sticker unmatchable. Case is preserved for display; lookup
        // lower-cases both sides (app/lib/places.ts).
        location.code = op.payload.code?.trim() || null;
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
          parentId: null,
          cols: null,
          rows: null,
          span: null,
          code: null,
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

    case "boxSize.upsert": {
      const { sizeId, name, lengthMm, widthMm, heightMm, sortOrder, icon } =
        op.payload;
      const clock = clockOf(op);
      const size = (await store.getBoxSize(sizeId)) ?? {
        id: sizeId,
        name,
        lengthMm: lengthMm ?? null,
        widthMm: widthMm ?? null,
        heightMm: heightMm ?? null,
        sortOrder,
        icon: icon ?? null,
        archived: false,
        fieldClocks: {},
      };
      // One clock for the whole definition: name and dimensions describe the
      // same thing and are always edited together, so splitting them would
      // let a stale edit resurrect half a definition.
      if (wins(clock, size.fieldClocks.value)) {
        size.name = name;
        size.lengthMm = lengthMm ?? null;
        size.widthMm = widthMm ?? null;
        size.heightMm = heightMm ?? null;
        size.sortOrder = sortOrder;
        size.icon = icon ?? null;
        size.fieldClocks.value = clock;
      }
      await store.putBoxSize(size);
      return;
    }

    case "boxSize.archive": {
      const { sizeId, archived } = op.payload;
      const clock = clockOf(op);
      const size = await store.getBoxSize(sizeId);
      if (!size) {
        // archive before upsert: keep the flag, the definition arrives later.
        await store.putBoxSize({
          id: sizeId,
          name: "",
          lengthMm: null,
          widthMm: null,
          heightMm: null,
          sortOrder: 0,
          icon: null,
          archived,
          fieldClocks: { archived: clock },
        });
        return;
      }
      if (wins(clock, size.fieldClocks.archived)) {
        size.archived = archived;
        size.fieldClocks.archived = clock;
        await store.putBoxSize(size);
      }
      return;
    }

    case "label.upsert": {
      const { labelId, name, color, sortOrder } = op.payload;
      const clock = clockOf(op);
      const label = (await store.getLabel(labelId)) ?? {
        id: labelId,
        name,
        color: color ?? null,
        sortOrder,
        archived: false,
        fieldClocks: {},
      };
      if (wins(clock, label.fieldClocks.value)) {
        label.name = name;
        label.color = color ?? null;
        label.sortOrder = sortOrder;
        label.fieldClocks.value = clock;
      }
      await store.putLabel(label);
      return;
    }

    case "label.archive": {
      const { labelId, archived } = op.payload;
      const clock = clockOf(op);
      const label = await store.getLabel(labelId);
      if (!label) {
        // archive before upsert: keep the flag, name arrives later via LWW.
        await store.putLabel({
          id: labelId,
          name: "",
          color: null,
          sortOrder: 0,
          archived,
          fieldClocks: { archived: clock },
        });
        return;
      }
      if (wins(clock, label.fieldClocks.archived)) {
        label.archived = archived;
        label.fieldClocks.archived = clock;
        await store.putLabel(label);
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

/**
 * Does this entry carry real content, as opposed to being a remove/restore
 * stub whose entry.add hasn't arrived yet? A stub can be LIVE (a restore that
 * outran its add), so `!deletedByOpId` alone doesn't mean "renderable" —
 * anything that lists entries to a human must check this too.
 */
export function hasContent(entry: EntryState): boolean {
  return Boolean(entry.photoHash || entry.text);
}

/**
 * What a model read off this entry's photo, or nothing.
 *
 * The check that matters is `aiPhotoHash === photoHash`. A description is
 * written against one specific image, and an entry's photo can be replaced
 * after the fact — showing words that describe a picture which is no longer
 * there would send someone to a box for something that has already gone.
 * The reducer deliberately keeps a stale description rather than deleting it
 * (it cannot know which is newer without becoming order-dependent), so the
 * comparison has to happen here, at every point of use.
 *
 * Every consumer goes through this: the offline search index, the
 * assistant's catalog, and the photo viewer.
 */
export function describedItems(
  // Only the three fields the rule needs, so a raw database row satisfies it
  // as readily as a reduced EntryState.
  entry: Pick<EntryState, "aiItems" | "aiPhotoHash" | "photoHash">,
): string[] {
  if (!entry.aiItems?.length) return [];
  // An entry with no photo has nothing to describe. Without this, two nulls
  // compare equal below and a note would happily carry a photo description.
  if (!entry.photoHash) return [];
  if (entry.aiPhotoHash !== entry.photoHash) return [];
  return entry.aiItems;
}

/** Comparator implementing the (effectiveTime, id) order for entries. */
export function compareEntries(a: EntryState, b: EntryState): number {
  if (a.effectiveTime !== b.effectiveTime)
    return a.effectiveTime - b.effectiveTime;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
