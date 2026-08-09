import type { BinFields, ClientOp, SuggestFields } from "@shared/ops";
/**
 * Op constructors — the only place client ops are built. Each stamps uuidv7 +
 * clientTime + the cached geofix and hands off to the sync engine (optimistic
 * local apply + background push).
 */
import { v7 as uuidv7 } from "uuid";
import { db } from "./db";
import { currentGeo } from "./geo";
import type { ProcessedPhoto } from "./photos";
import { enqueueOp } from "./sync";

function stamp() {
  return { opId: uuidv7(), clientTime: Date.now(), geo: currentGeo() };
}

export async function claimBin(binId: number, fields: BinFields) {
  await enqueueOp({ ...stamp(), type: "bin.claim", binId, payload: fields });
}

export async function setBinFields(binId: number, fields: BinFields) {
  await enqueueOp({
    ...stamp(),
    type: "bin.setFields",
    binId,
    payload: fields,
  });
}

/**
 * Propose a change to a box's identity fields instead of making it. Queues and
 * syncs like any other op (so it works offline); an admin decides it later via
 * /api/admin/suggestions/resolve. Pass only the fields being changed — an
 * absent key means "leave this alone", which is what the admin sees too.
 */
export async function suggestBinEdit(
  binId: number,
  fields: SuggestFields,
  note: string | null,
) {
  await enqueueOp({
    ...stamp(),
    type: "bin.suggest",
    binId,
    payload: { fields, note },
  });
}

/**
 * Put a box somewhere. A box has ONE location, so every call states the whole
 * thing: pass a freeform name, or a configured place (with an optional slot),
 * or nothing to clear it. Omitting a field clears it rather than leaving a
 * stale half of a previous location behind.
 */
export async function setBinLocation(
  binId: number,
  location:
    | string
    | null
    | { locationId: string | null; slot?: string | null; name?: string | null },
) {
  const payload =
    typeof location === "string" || location === null
      ? { locationName: location, locationId: null, slot: null }
      : {
          locationName: location.name ?? null,
          locationId: location.locationId,
          slot: location.slot ?? null,
        };
  await enqueueOp({
    ...stamp(),
    type: "bin.setLocation",
    binId,
    payload,
  });
}

export async function addNote(binId: number, text: string) {
  await enqueueOp({
    ...stamp(),
    type: "entry.addNote",
    binId,
    payload: { text },
  });
}

export async function removeEntry(binId: number, entryOpId: string) {
  await enqueueOp({
    ...stamp(),
    type: "entry.remove",
    binId,
    payload: { entryOpId },
  });
}

/**
 * Undo a removeEntry — a fresh op, not a retraction of the old one. The log is
 * append-only, so undoing a delete that already pushed and undoing one still
 * sitting in the outbox take the identical path, and either way the undo
 * reaches the rest of the group.
 */
export async function restoreEntry(binId: number, entryOpId: string) {
  await enqueueOp({
    ...stamp(),
    type: "entry.restore",
    binId,
    payload: { entryOpId },
  });
}

/**
 * Photo entry: rendition blob rows land BEFORE the op (if the op enqueue then
 * failed, orphan blobs are harmless and content-addressed, so a retry reuses
 * them). Upload ordering and local retention are driven by each row's role.
 */
/** Returns the entry's id (its op id), so the caller can offer an undo. */
export async function addPhoto(
  binId: number,
  kind: "contents_photo" | "item_photo",
  photo: ProcessedPhoto,
): Promise<string> {
  const now = Date.now();
  const renditions = [
    { role: "thumb" as const, r: photo.thumb },
    { role: "display" as const, r: photo.display },
    ...(photo.original
      ? [{ role: "original" as const, r: photo.original }]
      : []),
  ];
  await db.blobs.bulkPut(
    renditions.map(({ role, r }) => ({
      hash: r.hash,
      mime: photo.mime,
      status: "pending" as const,
      role,
      bytes: r.bytes,
      lastAccessAt: now,
    })),
  );
  const op: ClientOp = {
    ...stamp(),
    type: "entry.addPhoto",
    binId,
    payload: {
      hash: photo.display.hash,
      kind,
      mime: photo.mime,
      thumbHash: photo.thumb.hash,
      originalHash: photo.original?.hash ?? null,
    },
  };
  await enqueueOp(op);
  return op.opId;
}

/**
 * Create or update a place.
 *
 * An upsert describes the WHOLE place — parent and grid included — so omitting
 * them clears them rather than leaving a stale half behind. That mirrors the
 * reducer, which assigns rather than merges.
 */
export async function upsertLocation(
  locationId: string,
  name: string,
  sortOrder: number,
  shape?: {
    parentId?: string | null;
    cols?: number | null;
    rows?: number | null;
  },
) {
  await enqueueOp({
    ...stamp(),
    type: "location.upsert",
    payload: {
      locationId,
      name,
      sortOrder,
      parentId: shape?.parentId ?? null,
      cols: shape?.cols ?? null,
      rows: shape?.rows ?? null,
    },
  });
}

export async function archiveLocation(locationId: string, archived: boolean) {
  await enqueueOp({
    ...stamp(),
    type: "location.archive",
    payload: { locationId, archived },
  });
}

export async function upsertLabel(
  labelId: string,
  name: string,
  color: string | null,
  sortOrder: number,
) {
  await enqueueOp({
    ...stamp(),
    type: "label.upsert",
    payload: { labelId, name, color, sortOrder },
  });
}

export async function archiveLabel(labelId: string, archived: boolean) {
  await enqueueOp({
    ...stamp(),
    type: "label.archive",
    payload: { labelId, archived },
  });
}

/** Add/remove a category label on a bin (many-to-many; LWW per label). */
export async function setBinLabel(
  binId: number,
  labelId: string,
  present: boolean,
) {
  await enqueueOp({
    ...stamp(),
    type: "bin.setLabel",
    binId,
    payload: { labelId, present },
  });
}
