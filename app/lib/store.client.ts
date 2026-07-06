/**
 * Dexie adapter of the shared StateStore — the client half of the reducer's
 * storage. The replica is single-group (whatever group this device joined),
 * so no group scoping is needed here.
 */
import type {
  BinState,
  EntryState,
  LocationState,
  StateStore,
} from "@shared/reducer";
import { compareEntries } from "@shared/reducer";
import { db } from "./db";

export class DexieStateStore implements StateStore {
  async getBin(id: number): Promise<BinState | undefined> {
    return db.bins.get(id);
  }
  async putBin(bin: BinState): Promise<void> {
    await db.bins.put(bin);
  }
  async getEntry(id: string): Promise<EntryState | undefined> {
    return db.entries.get(id);
  }
  async putEntry(entry: EntryState): Promise<void> {
    await db.entries.put(entry);
  }
  async getLatestContentsEntry(binId: number): Promise<EntryState | undefined> {
    const entries = await db.entries.where("binId").equals(binId).toArray();
    let latest: EntryState | undefined;
    for (const entry of entries) {
      if (entry.kind !== "contents_photo" || entry.deletedByOpId) continue;
      if (!latest || compareEntries(entry, latest) > 0) latest = entry;
    }
    return latest;
  }
  async getLocation(id: string): Promise<LocationState | undefined> {
    return db.locations.get(id);
  }
  async putLocation(location: LocationState): Promise<void> {
    await db.locations.put(location);
  }
}

export const clientStore = new DexieStateStore();
