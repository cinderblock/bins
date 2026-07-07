import type { BinFields, ClientOp } from "@shared/ops";
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

export async function setBinLocation(
  binId: number,
  locationName: string | null,
) {
  await enqueueOp({
    ...stamp(),
    type: "bin.setLocation",
    binId,
    payload: { locationName },
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
 * Photo entry: rendition blob rows land BEFORE the op (if the op enqueue then
 * failed, orphan blobs are harmless and content-addressed, so a retry reuses
 * them). Upload ordering and local retention are driven by each row's role.
 */
export async function addPhoto(
  binId: number,
  kind: "contents_photo" | "item_photo",
  photo: ProcessedPhoto,
) {
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
}

export async function upsertLocation(
  locationId: string,
  name: string,
  sortOrder: number,
) {
  await enqueueOp({
    ...stamp(),
    type: "location.upsert",
    payload: { locationId, name, sortOrder },
  });
}

export async function archiveLocation(locationId: string, archived: boolean) {
  await enqueueOp({
    ...stamp(),
    type: "location.archive",
    payload: { locationId, archived },
  });
}
