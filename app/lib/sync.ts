/**
 * The sync engine: op outbox (push), canonical pull, and the photo blob
 * uploader. Ops apply to the local replica optimistically at enqueue; pulling
 * re-applies the canonical versions (the reducer is idempotent and
 * order-independent, so this converges — see shared/reducer.test.ts).
 *
 * Triggers: enqueue, app start, `online`, visibilitychange, 60s interval.
 */
import type {
  CanonicalOp,
  ClientOp,
  PullResponse,
  PushResponse,
} from "@shared/ops";
import { applyOp } from "@shared/reducer";
import { ApiError, apiFetch, apiJson } from "./api";
import {
  AUTH_DEAD_KEY,
  LAST_SEQ_KEY,
  db,
  getIdentity,
  getMeta,
  setMeta,
} from "./db";
import { prunePhotoCache } from "./photos";
import { clientStore } from "./store.client";

const PUSH_BATCH = 200;

export const DEVICES_KEY = "devices";

/** Cache the group's deviceId → displayName map (authorship labels). */
async function refreshDevices(): Promise<void> {
  const res = await apiJson<{ devices: { id: string; displayName: string }[] }>(
    "/api/devices",
  );
  await setMeta(
    DEVICES_KEY,
    Object.fromEntries(res.devices.map((d) => [d.id, d.displayName])),
  );
}

let syncing = false;
let queuedAgain = false;
let started = false;
/** Mirrors the AUTH_DEAD_KEY meta flag to avoid a Dexie write per cycle. */
let authDead = false;

/** Enqueue a client op: outbox + optimistic local apply, one transaction. */
export async function enqueueOp(op: ClientOp): Promise<void> {
  const identity = await getIdentity();
  await db.transaction(
    "rw",
    [db.pendingOps, db.bins, db.entries, db.locations],
    async () => {
      await db.pendingOps.put({ opId: op.opId, op });
      const provisional: CanonicalOp = {
        ...op,
        seq: null,
        deviceId: identity?.deviceId ?? null,
        effectiveTime: op.clientTime,
      };
      await applyOp(clientStore, provisional);
    },
  );
  void syncNow();
}

async function pushOnce(): Promise<boolean> {
  const pending = await db.pendingOps
    .orderBy("opId")
    .limit(PUSH_BATCH)
    .toArray();
  if (pending.length === 0) return false;

  const response = await apiJson<
    PushResponse & { rejected?: { opId: string; error: string }[] }
  >("/api/sync/push", {
    method: "POST",
    body: JSON.stringify({ ops: pending.map((p) => p.op) }),
  });

  const done = [
    ...response.acks.map((a) => a.opId),
    // Rejected ops (e.g. unknown bin) would retry forever — drop and log.
    ...(response.rejected ?? []).map((r) => {
      console.warn(`op ${r.opId} rejected by server: ${r.error}`);
      return r.opId;
    }),
  ];
  await db.pendingOps.bulkDelete(done);
  return pending.length === PUSH_BATCH;
}

async function pullOnce(): Promise<boolean> {
  const since = (await getMeta<number>(LAST_SEQ_KEY)) ?? 0;
  const response = await apiJson<PullResponse>(
    `/api/sync/pull?since=${since}&limit=500`,
  );
  if (response.ops.length > 0) {
    await db.transaction(
      "rw",
      [db.bins, db.entries, db.locations, db.meta],
      async () => {
        for (const op of response.ops) await applyOp(clientStore, op);
        const last = response.ops[response.ops.length - 1];
        if (last?.seq != null) await setMeta(LAST_SEQ_KEY, last.seq);
      },
    );
  } else if (response.latestSeq > since) {
    // Shouldn't happen, but never let the cursor wedge below latestSeq.
    await setMeta(LAST_SEQ_KEY, response.latestSeq);
  }
  return response.hasMore;
}

/**
 * Upload captured photo renditions, smallest-value-first: thumbs (make
 * strips work group-wide fast), then displays, then originals — the archival
 * copies are DEFERRED behind everything the group actually looks at, and
 * their bytes are dropped locally the moment the server confirms.
 */
const UPLOAD_ORDER = { thumb: 0, display: 1, original: 2 } as const;

async function uploadBlobs(): Promise<void> {
  const pending = (
    await db.blobs.where("status").equals("pending").toArray()
  ).sort((a, b) => UPLOAD_ORDER[a.role] - UPLOAD_ORDER[b.role]);
  for (const blob of pending) {
    if (!blob.bytes) {
      await db.blobs.update(blob.hash, { status: "done" });
      continue;
    }
    try {
      await apiFetch(`/api/blobs/${blob.hash}`, {
        method: "PUT",
        headers: { "Content-Type": blob.mime },
        body: blob.bytes,
      });
      await db.blobs.update(blob.hash, {
        status: "done",
        // Originals are archival — never kept locally once the server has
        // them. Other roles stay subject to prunePhotoCache's policy.
        ...(blob.role === "original" ? { bytes: null } : {}),
      });
    } catch (err) {
      // Offline or server hiccup — leave pending; the next trigger retries.
      if (err instanceof ApiError && err.status === 401) throw err;
      console.warn(`blob upload ${blob.hash.slice(0, 8)} failed:`, err);
    }
  }
}

/** Run one full sync cycle; coalesces concurrent calls. */
export async function syncNow(): Promise<void> {
  if (!(await getIdentity())) return;
  if (syncing) {
    queuedAgain = true;
    return;
  }
  syncing = true;
  try {
    do {
      queuedAgain = false;
      while (await pushOnce()) {}
      while (await pullOnce()) {}
      await uploadBlobs();
      await refreshDevices();
    } while (queuedAgain);
    // Enforce the local photo-cache policy now that uploads are confirmed.
    await prunePhotoCache();
    if (authDead) {
      // The token works again (e.g. after sign-back-in) — clear the flag.
      authDead = false;
      await setMeta(AUTH_DEAD_KEY, false);
    }
  } catch (err) {
    if (err instanceof ApiError && err.status === 401 && !authDead) {
      // The server no longer honors this device's token. Retrying is
      // pointless until the user signs back in (settings) — surface it.
      authDead = true;
      await setMeta(AUTH_DEAD_KEY, true);
    }
    // Expected whenever offline; every trigger below retries.
    console.debug("sync deferred:", err);
  } finally {
    syncing = false;
  }
}

/** Install the background triggers (idempotent; called from the shell). */
export function startSync(): void {
  if (started || typeof window === "undefined") return;
  started = true;
  window.addEventListener("online", () => void syncNow());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void syncNow();
  });
  window.setInterval(() => {
    if (document.visibilityState === "visible") void syncNow();
  }, 60_000);
  void syncNow();
}
