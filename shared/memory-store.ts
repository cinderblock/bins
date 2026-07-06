/**
 * In-memory StateStore — used by the convergence tests, and the reference for
 * what the Drizzle/Dexie adapters must do. Clones on the way in and out so the
 * reducer can never alias stored state.
 */
import type {
  BinState,
  EntryState,
  LocationState,
  StateStore,
} from "./reducer";
import { compareEntries } from "./reducer";

export class MemoryStore implements StateStore {
  bins = new Map<number, BinState>();
  entries = new Map<string, EntryState>();
  locations = new Map<string, LocationState>();

  async getBin(id: number) {
    const bin = this.bins.get(id);
    return bin ? structuredClone(bin) : undefined;
  }
  async putBin(bin: BinState) {
    this.bins.set(bin.id, structuredClone(bin));
  }
  async getEntry(id: string) {
    const entry = this.entries.get(id);
    return entry ? structuredClone(entry) : undefined;
  }
  async putEntry(entry: EntryState) {
    this.entries.set(entry.id, structuredClone(entry));
  }
  async getLatestContentsEntry(binId: number) {
    let latest: EntryState | undefined;
    for (const entry of this.entries.values()) {
      if (entry.binId !== binId) continue;
      if (entry.kind !== "contents_photo" || entry.deletedByOpId) continue;
      if (!latest || compareEntries(entry, latest) > 0) latest = entry;
    }
    return latest ? structuredClone(latest) : undefined;
  }
  async getLocation(id: string) {
    const location = this.locations.get(id);
    return location ? structuredClone(location) : undefined;
  }
  async putLocation(location: LocationState) {
    this.locations.set(location.id, structuredClone(location));
  }

  /**
   * Deterministic serialization for state-equality assertions. Sorts map
   * entries AND object keys — fieldClocks key insertion order depends on op
   * application order, which is exactly what must not affect equality.
   */
  snapshot(): string {
    const sortByKey = <T>(map: Map<string | number, T>) =>
      [...map.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    const canonicalize = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(canonicalize);
      if (value && typeof value === "object") {
        return Object.fromEntries(
          Object.entries(value)
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
            .map(([k, v]) => [k, canonicalize(v)]),
        );
      }
      return value;
    };
    return JSON.stringify(
      canonicalize({
        bins: sortByKey(this.bins),
        entries: sortByKey(this.entries),
        locations: sortByKey(this.locations),
      }),
    );
  }
}
