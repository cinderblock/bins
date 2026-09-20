/**
 * Materialized bin state + entries — reducer output over the op log, kept
 * up-to-date inside the push transaction. Rebuildable by replay; never write
 * these outside the reducer (allocation inserts happen via a server-authored
 * bin.allocate op for exactly this reason).
 */
import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { group } from "./group";

export const bin = sqliteTable(
  "bin",
  {
    /** The global short ID — the number in the QR URL (your-host/123). */
    id: integer("id").primaryKey(),
    /** Opaque public handle (UUID) — the URL on internal-number deployments
        (your-host/b/<handle>). Written by bin.allocate; null before handles. */
    handle: text("handle"),
    groupId: text("group_id")
      .notNull()
      .references(() => group.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("unclaimed"),
    /** Sticker secret (the #CODE in the QR URL) — written by bin.allocate. */
    secretCode: text("secret_code"),
    name: text("name"),
    /** Legacy free-text size; superseded by sizeId, kept so old ops still read. */
    sizeClass: text("size_class"),
    /** Chosen box_size definition. No FK: an op can name a size the reducer
        hasn't materialized yet (arrival order isn't guaranteed). */
    sizeId: text("size_id"),
    externalLabel: text("external_label"),
    /** Total weight in grams (canonical unit; UI renders lb/kg). */
    weightGrams: integer("weight_grams"),
    /** How full, integer percent 0..100. */
    fillLevel: integer("fill_level"),
    /** Subtext under the title (printed on the label). */
    description: text("description"),
    /** Extra instructions for the label drawing. */
    artPrompt: text("art_prompt"),
    /** sha256 of the chosen label artwork PNG in the blob store. */
    labelArtHash: text("label_art_hash"),
    /** Code in the current sticker's QR fragment (see shared/ops.ts). */
    stickerCode: text("sticker_code"),
    /** Latest sighting: when, how (sticker/scanner/camera), which code. */
    lastSeenAt: integer("last_seen_at"),
    lastSeenVia: text("last_seen_via"),
    lastSeenCode: text("last_seen_code"),
    locationName: text("location_name"),
    /** Structured location — see shared/reducer.ts; shares one clock with
        locationName so a box is only ever in one place. */
    locationId: text("location_id"),
    /** Opaque position within that location ("A2"). Not validated against the
        location's grid: the reducer must stay order-independent. */
    slot: text("slot"),
    /** Category label ids this bin carries (derived set; see shared/reducer.ts). */
    labelIds: text("label_ids", { mode: "json" }).$type<string[]>(),
    /** Derived: latest non-deleted contents_photo hash (see shared/reducer.ts). */
    primaryPhotoHash: text("primary_photo_hash"),
    /** Derived with primaryPhotoHash: its 320px thumbnail rendition. */
    primaryThumbHash: text("primary_thumb_hash"),
    fieldClocks: text("field_clocks", { mode: "json" })
      .notNull()
      .$type<Record<string, string>>(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [
    index("bin_group").on(t.groupId),
    // Handles are looked up on every /b/<handle> request. Unique across the
    // deployment (SQLite lets many NULLs coexist, so legacy rows are fine).
    uniqueIndex("bin_handle").on(t.handle),
  ],
);

export const binEntry = sqliteTable(
  "bin_entry",
  {
    /** = opId of the entry.addPhoto / entry.addNote op. */
    id: text("id").primaryKey(),
    groupId: text("group_id")
      .notNull()
      .references(() => group.id, { onDelete: "cascade" }),
    binId: integer("bin_id").notNull(),
    kind: text("kind").notNull(),
    text: text("text"),
    photoHash: text("photo_hash"),
    thumbHash: text("thumb_hash"),
    originalHash: text("original_hash"),
    mime: text("mime"),
    deviceId: text("device_id"),
    effectiveTime: integer("effective_time").notNull(),
    geoLat: real("geo_lat"),
    geoLng: real("geo_lng"),
    geoAcc: real("geo_acc"),
    deletedByOpId: text("deleted_by_op_id"),
    /** Author + time of the winning entry.remove (see shared/reducer.ts).
        Null on tombstones that predate these columns — not backfilled. */
    deletedByDeviceId: text("deleted_by_device_id"),
    deletedAt: integer("deleted_at"),
    /** LWW clock of the last entry.remove/entry.restore (see shared/reducer.ts). */
    deletedClock: text("deleted_clock"),
    /** What a model saw in this photo (entry.setAiItems). Null = never looked;
        [] = looked and saw nothing nameable. The difference decides whether
        it is worth spending on again. */
    aiItems: text("ai_items", { mode: "json" }).$type<string[]>(),
    aiModel: text("ai_model"),
    /** The photo those items were read from — mismatch with photoHash means
        they describe a picture that is no longer here. */
    aiPhotoHash: text("ai_photo_hash"),
    /** LWW clock shared by the three columns above (see shared/reducer.ts). */
    aiItemsClock: text("ai_items_clock"),
  },
  (t) => [
    index("bin_entry_bin").on(t.binId),
    index("bin_entry_group").on(t.groupId),
  ],
);
