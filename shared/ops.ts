/**
 * The op-log wire protocol. Every mutation of group data is an append-only op;
 * server tables and the client's IndexedDB replica are both materialized from
 * the same stream by the shared reducer (see reducer.ts). Isomorphic: imported
 * by the browser app, the API, and scripts.
 *
 * Identity fields (groupId, deviceId) are NEVER part of the wire op — the
 * server stamps them from the bearer token.
 */
import { z } from "zod";

export const geoSchema = z.object({
  lat: z.number(),
  lng: z.number(),
  /** Accuracy radius in meters, as reported by the Geolocation API. */
  acc: z.number(),
});
export type Geo = z.infer<typeof geoSchema>;

const opBase = {
  /** uuidv7 — time-ordered, and the global idempotency key. */
  opId: z.string().uuid(),
  /** Device wall clock at creation (ms). Server clamps into effectiveTime. */
  clientTime: z.number().int().positive(),
  geo: geoSchema.nullish(),
};

const binId = z.number().int().positive();

export const ENTRY_KINDS = ["contents_photo", "item_photo", "note"] as const;
export type EntryKind = (typeof ENTRY_KINDS)[number];

/** Scalar bin fields settable by bin.claim / bin.setFields (LWW per field). */
export const binFieldsSchema = z.object({
  name: z.string().max(200).nullish(),
  sizeClass: z.string().max(50).nullish(),
  externalLabel: z.string().max(500).nullish(),
});
export type BinFields = z.infer<typeof binFieldsSchema>;

/**
 * Ops a client may push. `bin.allocate` is deliberately absent — allocation is
 * server-authored (it assigns global short IDs) and reaches clients only
 * through pull.
 */
export const clientOpSchema = z.discriminatedUnion("type", [
  z.object({
    ...opBase,
    type: z.literal("bin.claim"),
    binId,
    payload: binFieldsSchema,
  }),
  z.object({
    ...opBase,
    type: z.literal("bin.setFields"),
    binId,
    payload: binFieldsSchema,
  }),
  z.object({
    ...opBase,
    type: z.literal("bin.setLocation"),
    binId,
    payload: z.object({ locationName: z.string().max(200).nullable() }),
  }),
  z.object({
    ...opBase,
    type: z.literal("bin.retire"),
    binId,
    payload: z.object({}),
  }),
  z.object({
    ...opBase,
    type: z.literal("entry.addPhoto"),
    binId,
    payload: z.object({
      hash: z.string().regex(/^[0-9a-f]{64}$/),
      kind: z.enum(["contents_photo", "item_photo"]),
      mime: z.string().max(100),
    }),
  }),
  z.object({
    ...opBase,
    type: z.literal("entry.addNote"),
    binId,
    payload: z.object({ text: z.string().min(1).max(10_000) }),
  }),
  z.object({
    ...opBase,
    type: z.literal("entry.remove"),
    binId,
    payload: z.object({ entryOpId: z.string().uuid() }),
  }),
  z.object({
    ...opBase,
    type: z.literal("location.upsert"),
    payload: z.object({
      locationId: z.string().uuid(),
      name: z.string().min(1).max(200),
      sortOrder: z.number().int(),
    }),
  }),
  z.object({
    ...opBase,
    type: z.literal("location.archive"),
    payload: z.object({
      locationId: z.string().uuid(),
      archived: z.boolean(),
    }),
  }),
]);
export type ClientOp = z.infer<typeof clientOpSchema>;

/** Server-authored ops (never accepted on push). */
export const serverOpSchema = z.discriminatedUnion("type", [
  z.object({
    ...opBase,
    type: z.literal("bin.allocate"),
    binId,
    payload: z.object({}),
  }),
]);
export type ServerOp = z.infer<typeof serverOpSchema>;

export type WireOp = ClientOp | ServerOp;
export type OpType = WireOp["type"];

/**
 * An op as it exists after server ingest — what pull returns and what the
 * reducer consumes. Pending (not-yet-pushed) client ops are reduced with a
 * provisional envelope: `seq: null`, `effectiveTime: clientTime`, own deviceId.
 */
export type CanonicalOp = WireOp & {
  /** Server-assigned total order within the group. Null while pending. */
  seq: number | null;
  /** Authoring device; null = server-authored. */
  deviceId: string | null;
  /**
   * clientTime clamped by the server (min(clientTime, serverTime + 60s)) —
   * the time used for all LWW comparisons.
   */
  effectiveTime: number;
};

/** How far a client clock may run ahead of the server before being clamped. */
export const MAX_CLOCK_SKEW_MS = 60_000;

export const pushRequestSchema = z.object({
  ops: z.array(clientOpSchema).min(1).max(500),
});

export type PushResponse = {
  acks: { opId: string; seq: number }[];
  latestSeq: number;
};

export type PullResponse = {
  ops: CanonicalOp[];
  latestSeq: number;
  hasMore: boolean;
};
