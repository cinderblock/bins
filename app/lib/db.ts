import type { ClientOp } from "@shared/ops";
import type {
  BinState,
  EntryState,
  LabelState,
  LocationState,
} from "@shared/reducer";
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

export type BlobRole = "thumb" | "display" | "original";

/** One row per photo RENDITION (thumb/display/original are separate blobs). */
export interface BlobRow {
  /** sha256 hex of this rendition's bytes. */
  hash: string;
  mime: string;
  /** pending = captured here, not yet uploaded. done = server has it. */
  status: "pending" | "done";
  /** Drives upload ordering (originals last) + cache eviction policy. */
  role: BlobRole;
  /** Null = uploaded and locally evicted; refetched on demand. */
  bytes: Blob | null;
  /** LRU clock for prunePhotoCache (see lib/photos.ts). */
  lastAccessAt: number;
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
  labels!: EntityTable<LabelState, "id">;
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

// v2: blobs become one row per rendition (thumb/display/original). Old rows
// held both full+thumb slots keyed by the display hash — carry them over as
// display-role rows (preserving pending uploads); old un-addressed thumb
// bytes are dropped (regenerable/refetchable).
db.version(2)
  .stores({
    bins: "id, updatedAt, status",
    entries: "id, binId, effectiveTime",
    locations: "id, sortOrder",
    pendingOps: "opId",
    blobs: "hash, status, role, lastAccessAt",
    meta: "key",
  })
  .upgrade((tx) =>
    tx
      .table("blobs")
      .toCollection()
      .modify((row: Record<string, unknown>) => {
        row.role = "display";
        row.bytes = row.full ?? row.thumb ?? null;
        row.lastAccessAt = Date.now();
        // undefined properties are dropped by IndexedDB's structured clone.
        row.full = undefined;
        row.thumb = undefined;
      }),
  );

// v3: category labels. New `labels` table + a multiEntry `*labelIds` index on
// bins so "show every box tagged X" is a single indexed query. Backfill
// labelIds=[] on existing bin rows so the index and reads are consistent
// before the next reducer pass rewrites them.
db.version(3)
  .stores({
    bins: "id, updatedAt, status, *labelIds",
    entries: "id, binId, effectiveTime",
    locations: "id, sortOrder",
    labels: "id, sortOrder",
    pendingOps: "opId",
    blobs: "hash, status, role, lastAccessAt",
    meta: "key",
  })
  .upgrade((tx) =>
    tx
      .table("bins")
      .toCollection()
      .modify((row: Record<string, unknown>) => {
        if (!Array.isArray(row.labelIds)) row.labelIds = [];
      }),
  );

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
/** Verified group admin password, remembered on this device (see lib/admin.ts). */
export const ADMIN_PASSWORD_KEY = "adminPassword";
/** Group access code cached on devices that know it, for invite links (lib/invite.ts). */
export const ACCESS_CODE_KEY = "accessCode";

export async function getIdentity(): Promise<Identity | undefined> {
  return getMeta<Identity>(IDENTITY_KEY);
}

/** Wipe everything local — leave group / troubleshooting reset. */
export async function resetLocalData(): Promise<void> {
  await db.delete();
  window.location.href = "/";
}
