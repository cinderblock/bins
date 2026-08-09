/**
 * Drizzle adapter of the shared StateStore — the server half of the reducer's
 * storage. All rows written here are group-scoped by construction: the store
 * is instantiated per request with the token's groupId.
 */
import { and, desc, eq, isNull } from "drizzle-orm";
import type {
  BinState,
  BoxSizeState,
  EntryState,
  LabelState,
  LocationState,
  StateStore,
  SuggestionState,
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
      sizeId: row.sizeId,
      externalLabel: row.externalLabel,
      weightGrams: row.weightGrams,
      locationName: row.locationName,
      locationId: row.locationId,
      slot: row.slot,
      labelIds: row.labelIds ?? [],
      primaryPhotoHash: row.primaryPhotoHash,
      primaryThumbHash: row.primaryThumbHash,
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
      sizeId: bin.sizeId,
      externalLabel: bin.externalLabel,
      weightGrams: bin.weightGrams,
      locationName: bin.locationName,
      labelIds: bin.labelIds,
      primaryPhotoHash: bin.primaryPhotoHash,
      primaryThumbHash: bin.primaryThumbHash,
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
      thumbHash: row.thumbHash,
      originalHash: row.originalHash,
      mime: row.mime,
      deviceId: row.deviceId,
      effectiveTime: row.effectiveTime,
      geoLat: row.geoLat,
      geoLng: row.geoLng,
      geoAcc: row.geoAcc,
      deletedByOpId: row.deletedByOpId,
      deletedClock: row.deletedClock,
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
      thumbHash: row.thumbHash,
      originalHash: row.originalHash,
      mime: row.mime,
      deviceId: row.deviceId,
      effectiveTime: row.effectiveTime,
      geoLat: row.geoLat,
      geoLng: row.geoLng,
      geoAcc: row.geoAcc,
      deletedByOpId: row.deletedByOpId,
      deletedClock: row.deletedClock,
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
      parentId: row.parentId,
      cols: row.cols,
      rows: row.rows,
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

  async getLabel(id: string): Promise<LabelState | undefined> {
    const row = await db.query.label.findFirst({
      where: and(
        eq(schema.label.id, id),
        eq(schema.label.groupId, this.groupId),
      ),
    });
    if (!row) return undefined;
    return {
      id: row.id,
      name: row.name,
      color: row.color,
      sortOrder: row.sortOrder,
      archived: row.archived,
      fieldClocks: row.fieldClocks,
    };
  }

  async putLabel(label: LabelState): Promise<void> {
    const values = { ...label, groupId: this.groupId };
    await db
      .insert(schema.label)
      .values(values)
      .onConflictDoUpdate({ target: schema.label.id, set: values });
  }

  async getBoxSize(id: string): Promise<BoxSizeState | undefined> {
    const row = await db.query.boxSize.findFirst({
      where: and(
        eq(schema.boxSize.id, id),
        eq(schema.boxSize.groupId, this.groupId),
      ),
    });
    if (!row) return undefined;
    return {
      id: row.id,
      name: row.name,
      lengthMm: row.lengthMm,
      widthMm: row.widthMm,
      heightMm: row.heightMm,
      sortOrder: row.sortOrder,
      archived: row.archived,
      fieldClocks: row.fieldClocks,
    };
  }

  async putBoxSize(size: BoxSizeState): Promise<void> {
    const values = { ...size, groupId: this.groupId };
    await db
      .insert(schema.boxSize)
      .values(values)
      .onConflictDoUpdate({ target: schema.boxSize.id, set: values });
  }

  async getSuggestion(id: string): Promise<SuggestionState | undefined> {
    const row = await db.query.suggestion.findFirst({
      where: and(
        eq(schema.suggestion.id, id),
        eq(schema.suggestion.groupId, this.groupId),
      ),
    });
    if (!row) return undefined;
    return {
      id: row.id,
      binId: row.binId,
      deviceId: row.deviceId,
      fields: row.fields,
      note: row.note,
      status: row.status as SuggestionState["status"],
      createdAt: row.createdAt,
      resolvedAt: row.resolvedAt,
      resolvedByOpId: row.resolvedByOpId,
      fieldClocks: row.fieldClocks,
    };
  }

  async putSuggestion(suggestion: SuggestionState): Promise<void> {
    const values = { ...suggestion, groupId: this.groupId };
    await db
      .insert(schema.suggestion)
      .values(values)
      .onConflictDoUpdate({ target: schema.suggestion.id, set: values });
  }
}
