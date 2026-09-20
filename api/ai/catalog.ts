/**
 * The group's inventory, rendered as a layered prompt.
 *
 * The layering IS the cost model. Prompt caching is a prefix match on every
 * provider that offers one, so if the prompt were rebuilt from live data each
 * time, every op would change it and every question would pay full price — and
 * people write (claiming boxes, snapping photos) at exactly the moment they
 * ask where things go. So:
 *
 *   1  vocabulary + layout   stable    labels, sizes, the location tree
 *   2  catalog snapshot      stable    every box, taken at a known op.seq
 *   3  diff tail             volatile  ops since that seq, OLDEST FIRST
 *
 * Layers 1-2 stay byte-identical while boxes change, so they keep hitting the
 * cache; only the short tail is uncached. The snapshot is rebuilt on a slow
 * cadence, not per op.
 *
 * The oldest-first ordering of the tail is load-bearing. Newest-first would
 * rewrite the layer on every op and destroy the exact thing this exists to
 * protect. See plans/ai-assist.md.
 *
 * Everything that decides what the model READS is a pure function of plain
 * data, and the database only appears in `dbCatalogSource` at the bottom.
 * That split is what lets the byte-stability property above be tested for
 * real, rather than approximated against a live schema.
 */
import {
  type LocationNode,
  locationGeometry,
  locationLabel,
} from "@shared/locations";
import { describedItems } from "@shared/reducer";
import { and, asc, desc, eq, gt } from "drizzle-orm";
import { db, schema } from "../../db/client.server";
import type { AiLayer } from "./types";

/**
 * When to rebuild rather than keep appending. A long tail eventually costs
 * more than the cache write it avoids, and a stale snapshot makes the model
 * reconcile more than it should.
 */
export const MAX_TAIL_OPS = 150;
const MAX_SNAPSHOT_AGE_MS = 6 * 60 * 60 * 1000;

/** Only the fields the prompt actually renders — see describeBin. */
export type CatalogBin = {
  id: number;
  status: string;
  name: string | null;
  description: string | null;
  labelIds: string[] | null;
  locationId: string | null;
  locationName: string | null;
  slot: string | null;
  sizeId: string | null;
  sizeClass: string | null;
  fillLevel: number | null;
  weightGrams: number | null;
  primaryPhotoHash: string | null;
};

export type CatalogNamed = { id: string; name: string; archived: boolean };
export type CatalogPlace = LocationNode & { archived: boolean };
export type CatalogOp = {
  binId: number | null;
  type: string;
  payload: unknown;
};

export type CatalogData = {
  bins: CatalogBin[];
  /** Live note text per box, already filtered of deletions. */
  notesByBin: Map<number, string[]>;
  /** What a model read off each box's live photos (api/ai/caption.ts). */
  describedByBin: Map<number, string[]>;
  labels: CatalogNamed[];
  sizes: CatalogNamed[];
  places: CatalogPlace[];
};

/**
 * Where the catalog comes from. An interface rather than a direct import so
 * the layering logic can be exercised without a database.
 */
export type CatalogSource = {
  latestSeq(groupId: string): Promise<number>;
  load(groupId: string): Promise<CatalogData>;
  opsAfter(groupId: string, seq: number, limit: number): Promise<CatalogOp[]>;
};

type Snapshot = { seq: number; text: string; builtAt: number; bins: number };

/**
 * In-memory, per group. A restart costs one cache miss, which is the correct
 * price for not having invented a persistence format for a derived string.
 */
const snapshots = new Map<string, Snapshot>();

/** Drop a group's snapshot, forcing a rebuild on the next question. */
export function forgetSnapshot(groupId: string): void {
  snapshots.delete(groupId);
}

function grams(value: number | null): string | null {
  if (value === null) return null;
  return value >= 1000 ? `${(value / 1000).toFixed(1)}kg` : `${value}g`;
}

/**
 * One box, one line. Terse on purpose: at hundreds of boxes the catalog is
 * the bulk of every request, and an empty field costs nothing to omit.
 */
export function describeBin(
  bin: CatalogBin,
  labelNames: ReadonlyMap<string, string>,
  sizeNames: ReadonlyMap<string, string>,
  places: ReadonlyMap<string, LocationNode>,
  notes: readonly string[],
  described: readonly string[] = [],
): string {
  const parts: string[] = [];
  if (bin.name) parts.push(bin.name);
  if (bin.description) parts.push(`desc: ${bin.description}`);
  const cats = (bin.labelIds ?? [])
    .map((id) => labelNames.get(id))
    .filter((name): name is string => Boolean(name));
  if (cats.length) parts.push(`cat: ${cats.join(", ")}`);
  const slot = bin.slot ? ` · slot ${bin.slot}` : "";
  const place = bin.locationId
    ? `${locationLabel(places, bin.locationId)}${slot}`
    : bin.locationName;
  if (place) parts.push(`at: ${place}`);
  const size = bin.sizeId ? sizeNames.get(bin.sizeId) : bin.sizeClass;
  if (size) parts.push(`size: ${size}`);
  if (bin.fillLevel !== null) parts.push(`full: ${bin.fillLevel}%`);
  const weight = grams(bin.weightGrams);
  if (weight) parts.push(`weight: ${weight}`);
  if (notes.length) parts.push(`notes: ${notes.join(" / ")}`);
  // Marked as seen-in-a-photo rather than folded in with what a person wrote,
  // so the assistant can weigh it accordingly and say where it got this.
  if (described.length) parts.push(`seen in photo: ${described.join(", ")}`);
  // A box whose only record is an undescribed photo looks empty here, and
  // must not read as an empty box. Captioning closes this gap — until it has
  // run, saying so is the honest fallback.
  if (parts.length <= 1 && bin.primaryPhotoHash)
    parts.push("contents recorded only as a photo — text unknown");
  return `#${bin.id} ${parts.join(" | ") || "(nothing recorded)"}`;
}

/** Labels, sizes and the location tree — the group's vocabulary. */
export function renderVocabulary(data: CatalogData): string {
  const active = data.places.filter((place) => !place.archived);
  const byId = new Map(active.map((place) => [place.id, place]));

  // How many boxes sit in each place, so "is there room" is answerable.
  const occupied = new Map<string, number>();
  for (const bin of data.bins) {
    if (bin.status !== "active" || !bin.locationId) continue;
    occupied.set(bin.locationId, (occupied.get(bin.locationId) ?? 0) + 1);
  }

  const lines: string[] = ["CATEGORIES (the group's label vocabulary)"];
  const liveLabels = data.labels.filter((label) => !label.archived);
  lines.push(
    liveLabels.length
      ? liveLabels.map((label) => `- ${label.name}`).join("\n")
      : "- (none defined)",
  );

  const liveSizes = data.sizes.filter((size) => !size.archived);
  if (liveSizes.length) {
    lines.push("\nBOX SIZES");
    lines.push(liveSizes.map((size) => `- ${size.name}`).join("\n"));
  }

  lines.push("\nPLACES (where boxes live)");
  if (!active.length) lines.push("- (none defined)");
  for (const place of active) {
    // Geometry is asked for, never read off the row — new shapes (runs,
    // stacks, zones) describe themselves here without touching this file.
    const geometry = locationGeometry(place);
    const used = occupied.get(place.id) ?? 0;
    const detail: string[] = [];
    if (geometry) {
      detail.push(geometry.label);
      if (geometry.capacity !== null)
        detail.push(`${geometry.capacity - used} of ${geometry.capacity} free`);
    } else {
      detail.push(`${used} boxes, no fixed capacity`);
    }
    lines.push(`- ${locationLabel(byId, place.id)} — ${detail.join(", ")}`);
  }
  return lines.join("\n");
}

/** Every active box, labelled with the log position it was taken at. */
export function renderSnapshot(
  data: CatalogData,
  seq: number,
): { text: string; bins: number } {
  const labelNames = new Map(
    data.labels.map((label) => [label.id, label.name]),
  );
  const sizeNames = new Map(data.sizes.map((size) => [size.id, size.name]));
  const placesById = new Map(data.places.map((place) => [place.id, place]));

  // Sorted by id so the rendering is deterministic — an unstable order would
  // change the bytes on every rebuild and defeat the cache for no reason.
  const active = data.bins
    .filter((bin) => bin.status === "active")
    .sort((a, b) => a.id - b.id);
  const text = [
    `BOXES (${active.length} active, as of log position ${seq})`,
    ...active.map((bin) =>
      describeBin(
        bin,
        labelNames,
        sizeNames,
        placesById,
        data.notesByBin.get(bin.id) ?? [],
        data.describedByBin.get(bin.id) ?? [],
      ),
    ),
  ].join("\n");
  return { text, bins: active.length };
}

/** A single op as one readable line. Unknown types still say something. */
export function describeOp(op: CatalogOp): string {
  const at = op.binId ? `#${op.binId}` : "—";
  const payload = (op.payload ?? {}) as Record<string, unknown>;
  const show = (value: unknown): string =>
    typeof value === "string" ? value : JSON.stringify(value);
  switch (op.type) {
    case "entry.addNote":
      return `${at} note added: ${show(payload.text)}`;
    case "entry.addPhoto":
      return `${at} contents photo added`;
    case "entry.remove":
      return `${at} an entry was deleted`;
    case "bin.setLocation": {
      const where = show(payload.locationName ?? payload.locationId);
      const slot = payload.slot ? ` slot ${show(payload.slot)}` : "";
      return `${at} moved: ${where}${slot}`;
    }
    case "bin.retire":
      return `${at} RETIRED — no longer in use`;
    case "bin.restore":
      return `${at} restored to active`;
    case "bin.claim":
    case "bin.setFields":
      return `${at} fields changed: ${show(payload.fields ?? payload)}`;
    case "bin.setLabel":
      return `${at} category changed: ${show(payload)}`;
    case "entry.setAiItems": {
      const items = Array.isArray(payload.items) ? payload.items : [];
      return items.length
        ? `${at} photo contents read: ${items.map(show).join(", ")}`
        : `${at} a photo was looked at; nothing identifiable in it`;
    }
    default:
      return `${at} ${op.type}`;
  }
}

/**
 * The context layers for a group, newest information last.
 *
 * Returns the layers only — the caller prepends its own task framing, which
 * differs between "where does this go" and "where would I find this".
 */
export async function buildCatalogLayers(
  groupId: string,
  source: CatalogSource = dbCatalogSource,
): Promise<{ layers: AiLayer[]; bins: number; tailOps: number }> {
  // Loaded once: the vocabulary layer needs it on every call, and a rebuild
  // would otherwise read the same rows a second time.
  const data = await source.load(groupId);

  let snapshot = snapshots.get(groupId);
  const aged =
    snapshot === undefined ||
    Date.now() - snapshot.builtAt > MAX_SNAPSHOT_AGE_MS;

  let tail = aged
    ? []
    : await source.opsAfter(groupId, snapshot?.seq ?? 0, MAX_TAIL_OPS + 1);

  // Rebuild on first use, when the snapshot has aged out, or when the tail
  // has outgrown the cache write it was avoiding.
  if (aged || tail.length > MAX_TAIL_OPS) {
    const seq = await source.latestSeq(groupId);
    const rendered = renderSnapshot(data, seq);
    snapshot = {
      seq,
      text: rendered.text,
      bins: rendered.bins,
      builtAt: Date.now(),
    };
    snapshots.set(groupId, snapshot);
    tail = [];
  }
  const current = snapshot as Snapshot;

  const layers: AiLayer[] = [
    { stable: true, text: renderVocabulary(data) },
    { stable: true, text: current.text },
  ];
  if (tail.length) {
    layers.push({
      stable: false,
      text: [
        "CHANGES SINCE THAT SNAPSHOT (oldest first — these win over the list above)",
        ...tail.map(describeOp),
      ].join("\n"),
    });
  }
  return { layers, bins: current.bins, tailOps: tail.length };
}

/** The real source: the group's materialized tables and its op log. */
export const dbCatalogSource: CatalogSource = {
  async latestSeq(groupId) {
    const [latest] = await db
      .select({ seq: schema.op.seq })
      .from(schema.op)
      .where(eq(schema.op.groupId, groupId))
      .orderBy(desc(schema.op.seq))
      .limit(1);
    return latest?.seq ?? 0;
  },

  async load(groupId) {
    const [bins, entries, labels, sizes, places] = await Promise.all([
      db.query.bin.findMany({ where: eq(schema.bin.groupId, groupId) }),
      db.query.binEntry.findMany({
        where: eq(schema.binEntry.groupId, groupId),
      }),
      db.query.label.findMany({ where: eq(schema.label.groupId, groupId) }),
      db.query.boxSize.findMany({ where: eq(schema.boxSize.groupId, groupId) }),
      db.query.location.findMany({
        where: eq(schema.location.groupId, groupId),
      }),
    ]);

    const notesByBin = new Map<number, string[]>();
    const describedByBin = new Map<number, string[]>();
    for (const entry of entries) {
      if (entry.deletedByOpId) continue;
      if (entry.kind === "note" && entry.text) {
        const list = notesByBin.get(entry.binId) ?? [];
        list.push(entry.text);
        notesByBin.set(entry.binId, list);
        continue;
      }
      const described = describedItems(entry);
      if (described.length) {
        const list = describedByBin.get(entry.binId) ?? [];
        list.push(...described);
        describedByBin.set(entry.binId, list);
      }
    }
    return { bins, notesByBin, describedByBin, labels, sizes, places };
  },

  async opsAfter(groupId, seq, limit) {
    return await db.query.op.findMany({
      where: and(eq(schema.op.groupId, groupId), gt(schema.op.seq, seq)),
      orderBy: asc(schema.op.seq),
      limit,
    });
  },
};
