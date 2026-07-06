/**
 * Drizzle adapter of the shared StateStore — the server half of the reducer's
 * storage. All rows written here are group-scoped by construction: the store
 * is instantiated per request with the token's groupId.
 */
import { and, desc, eq, isNull } from "drizzle-orm";
import type {
  BinState,
  EntryState,
  LocationState,
  StateStore,
} from "../shared/reducer";
import { db, schema } from "./client.server";

export class DrizzleStateStore implements StateStore {
  constructor(private groupId: string) {}

  async getBin(id: number): Promise<BinState | undefined> {
    const row = await db.query.bin.findFirst({
      where: and(eq(schema.bin.id, id), eq(schema.bin.groupId, this.groupId)),
    });
    if (!row) return undefined;
    return {
      id: row.id,
      status: row.status as BinState["status"],
      secretCode: row.secretCode,
      name: row.name,
      sizeClass: row.sizeClass,
      externalLabel: row.externalLabel,
      locationName: row.locationName,
      primaryPhotoHash: row.primaryPhotoHash,
      fieldClocks: row.fieldClocks,
      createdAt: row.createdAt.getTime(),
      updatedAt: row.updatedAt.getTime(),
    };
  }

  async putBin(bin: BinState): Promise<void> {
    const values = {
      id: bin.id,
      groupId: this.groupId,
      status: bin.status,
      secretCode: bin.secretCode,
      name: bin.name,
      sizeClass: bin.sizeClass,
      externalLabel: bin.externalLabel,
      locationName: bin.locationName,
      primaryPhotoHash: bin.primaryPhotoHash,
      fieldClocks: bin.fieldClocks,
      createdAt: new Date(bin.createdAt),
      updatedAt: new Date(bin.updatedAt),
    };
    await db
      .insert(schema.bin)
      .values(values)
      .onConflictDoUpdate({ target: schema.bin.id, set: values });
  }

  async getEntry(id: string): Promise<EntryState | undefined> {
    const row = await db.query.binEntry.findFirst({
      where: and(
        eq(schema.binEntry.id, id),
        eq(schema.binEntry.groupId, this.groupId),
      ),
    });
    if (!row) return undefined;
    return {
      id: row.id,
      binId: row.binId,
      kind: row.kind as EntryState["kind"],
      text: row.text,
      photoHash: row.photoHash,
      mime: row.mime,
      deviceId: row.deviceId,
      effectiveTime: row.effectiveTime,
      geoLat: row.geoLat,
      geoLng: row.geoLng,
      geoAcc: row.geoAcc,
      deletedByOpId: row.deletedByOpId,
    };
  }

  async putEntry(entry: EntryState): Promise<void> {
    const values = { ...entry, groupId: this.groupId };
    await db
      .insert(schema.binEntry)
      .values(values)
      .onConflictDoUpdate({ target: schema.binEntry.id, set: values });
  }

  async getLatestContentsEntry(binId: number): Promise<EntryState | undefined> {
    const row = await db.query.binEntry.findFirst({
      where: and(
        eq(schema.binEntry.groupId, this.groupId),
        eq(schema.binEntry.binId, binId),
        eq(schema.binEntry.kind, "contents_photo"),
        isNull(schema.binEntry.deletedByOpId),
      ),
      orderBy: [desc(schema.binEntry.effectiveTime), desc(schema.binEntry.id)],
    });
    if (!row) return undefined;
    return {
      id: row.id,
      binId: row.binId,
      kind: row.kind as EntryState["kind"],
      text: row.text,
      photoHash: row.photoHash,
      mime: row.mime,
      deviceId: row.deviceId,
      effectiveTime: row.effectiveTime,
      geoLat: row.geoLat,
      geoLng: row.geoLng,
      geoAcc: row.geoAcc,
      deletedByOpId: row.deletedByOpId,
    };
  }

  async getLocation(id: string): Promise<LocationState | undefined> {
    const row = await db.query.location.findFirst({
      where: and(
        eq(schema.location.id, id),
        eq(schema.location.groupId, this.groupId),
      ),
    });
    if (!row) return undefined;
    return {
      id: row.id,
      name: row.name,
      sortOrder: row.sortOrder,
      archived: row.archived,
      fieldClocks: row.fieldClocks,
    };
  }

  async putLocation(location: LocationState): Promise<void> {
    const values = { ...location, groupId: this.groupId };
    await db
      .insert(schema.location)
      .values(values)
      .onConflictDoUpdate({ target: schema.location.id, set: values });
  }
}
