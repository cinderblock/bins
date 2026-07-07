import type { ClientOp } from "@shared/ops";
import type { BinState, EntryState, LocationState } from "@shared/reducer";
/**
 * The client-side replica: Dexie (IndexedDB). Materialized state (bins,
 * entries, locations) is reducer output — the same shapes the server holds —
 * plus the outboxes (pendingOps, photo blobs) and a small meta KV.
 *
 * The op enqueue path writes the pending op, the optimistic state update, and
 * (for photos) the blob in ONE Dexie transaction, so a crash can never leave
 * an op without its blob or vice versa.
 */
import Dexie, { type EntityTable } from "dexie";

export interface PendingOpRow {
  /** uuidv7 — time-ordered, so sorting by opId is enqueue order. */
  opId: string;
  op: ClientOp;
}

export interface BlobRow {
  /** sha256 hex of the full-size bytes. */
  hash: string;
  mime: string;
  /** pending = captured here, not yet uploaded. done = server has it. */
  status: "pending" | "done";
  /** Full-size image; dropped after confirmed upload (thumb stays forever). */
  full: Blob | null;
  /** Small preview — strips and search results render only this. */
  thumb: Blob | null;
}

export interface MetaRow {
  key: string;
  // biome-ignore lint/suspicious/noExplicitAny: heterogeneous KV store
  value: any;
}

export interface Identity {
  token: string;
  deviceId: string;
  groupId: string;
  groupName: string;
  displayName: string;
}

class BinsDatabase extends Dexie {
  bins!: EntityTable<BinState, "id">;
  entries!: EntityTable<EntryState, "id">;
  locations!: EntityTable<LocationState, "id">;
  pendingOps!: EntityTable<PendingOpRow, "opId">;
  blobs!: EntityTable<BlobRow, "hash">;
  meta!: EntityTable<MetaRow, "key">;
}

export const db = new BinsDatabase("bins");

db.version(1).stores({
  bins: "id, updatedAt, status",
  entries: "id, binId, effectiveTime",
  locations: "id, sortOrder",
  pendingOps: "opId",
  blobs: "hash, status",
  meta: "key",
});

export async function getMeta<T>(key: string): Promise<T | undefined> {
  const row = await db.meta.get(key);
  return row?.value as T | undefined;
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await db.meta.put({ key, value });
}

export const IDENTITY_KEY = "identity";
export const LAST_SEQ_KEY = "lastSeq";
/** True when the server 401'd this device's token — see lib/auth.ts. */
export const AUTH_DEAD_KEY = "authDead";
/** One-time "add to home screen" nudge already shown. */
export const INSTALL_HINT_KEY = "installHintShown";

export async function getIdentity(): Promise<Identity | undefined> {
  return getMeta<Identity>(IDENTITY_KEY);
}

/** Wipe everything local — leave group / troubleshooting reset. */
export async function resetLocalData(): Promise<void> {
  await db.delete();
  window.location.href = "/";
}
