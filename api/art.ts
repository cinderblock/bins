/**
 * Label artwork for a box: generate candidates, keep them, keep the chosen
 * one.
 *
 * Admin-gated like printing (it spends money). Each generation lands in the
 * group's blob store as ordinary content-addressed PNGs, so the chosen
 * picture syncs to every device through the same path photos take and a
 * reprint months later is free. Which one is "the" label art is a field on
 * the box (`labelArtHash`, an LWW scalar the client sets once it has picked),
 * so nothing here writes materialized state. Every drawing also gets a row
 * in `label_art`, the box's history (see db/schema/label-art.ts for why
 * that table is outside the op log).
 */
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "../db/client.server";
import { readBlob, storeBlob } from "./blobs";
import { type Ctx, error, json } from "./context";
import {
  ART_VARIANTS,
  ART_VARIANT_KEYS,
  ArtBudgetError,
  ArtInputError,
  ArtUnavailableError,
  type ArtVariant,
  artStatus,
  generateArtPng,
} from "./labels/art";
import {
  DEFAULT_THRESHOLD,
  MAX_THRESHOLD,
  MIN_THRESHOLD,
  clampThreshold,
  toMonochrome,
} from "./labels/mono";

/** Reference pictures ride inline: ≤5, each already downscaled client-side. */
const referenceSchema = z.object({
  mime: z.enum(["image/jpeg", "image/png", "image/webp"]),
  /** base64, no data-URL prefix. ~1.5 MB decoded is far more than a 512px hint. */
  data: z.string().min(1).max(2_000_000),
});

export const artRequestSchema = z.object({
  binId: z.number().int().positive(),
  /**
   * What the label says, as typed right now. The studio sends these rather
   * than trusting the box row to have synced: sync is asynchronous, and a
   * request that raced it drew "a storage box". Omitted = the row's values.
   */
  title: z.string().max(200).optional(),
  lines: z.array(z.string().max(200)).max(8).optional(),
  /** One of artStatus().models; omitted = the deployment default. */
  model: z.string().max(100).optional(),
  /** Overrides the box's saved artPrompt for this generation only. */
  instructions: z.string().max(500).nullish(),
  references: z.array(referenceSchema).max(5).optional(),
  /**
   * Any string: a different nonce is a different picture. This is how
   * "another one" gets past the cache without the cache losing its purpose
   * (a reprint of the SAME choice stays free).
   */
  nonce: z.string().max(64).nullish(),
  /** One of ART_VARIANTS (labels/art.ts): a direction, by name. */
  variant: z.enum(ART_VARIANT_KEYS as [ArtVariant, ...ArtVariant[]]).nullish(),
});
export type ArtRequestInput = z.infer<typeof artRequestSchema>;

export async function handleArtStatus(): Promise<Response> {
  return json(artStatus());
}

export async function handleArt(
  ctx: Ctx,
  input: ArtRequestInput,
): Promise<Response> {
  const bin = await db.query.bin.findFirst({
    where: and(
      eq(schema.bin.id, input.binId),
      eq(schema.bin.groupId, ctx.groupId),
    ),
  });
  // Group-scoped: an admin of one tenant must not be able to spend on, or
  // read the description of, another tenant's box.
  if (!bin) return error(404, "no such bin");

  const lines =
    input.lines ??
    (bin.description ?? "")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(0, 4);

  try {
    const result = await generateArtPng({
      title: input.title ?? bin.name ?? "",
      lines,
      instructions: input.instructions ?? bin.artPrompt ?? undefined,
      references: input.references,
      model: input.model,
      nonce: input.nonce ?? undefined,
      variant: input.variant ?? undefined,
    });
    // Into the group's blob store so every device can fetch it by hash and
    // the service worker caches it like any photo. The source too: it is
    // what a darkness change re-cuts, and the studio previews from it.
    const hash = await storeBlob(ctx, result.png, "image/png");
    const sourceHash = await storeBlob(ctx, result.source, "image/png");
    const row = {
      id: crypto.randomUUID(),
      groupId: ctx.groupId,
      binId: bin.id,
      sourceHash,
      hash,
      threshold: DEFAULT_THRESHOLD,
      model: result.model,
      variant: input.variant ?? null,
      textRemoved: result.textRemoved,
      createdAt: Date.now(),
      removedAt: null,
    };
    await db.insert(schema.labelArt).values(row);
    const status = artStatus();
    return json({
      ...drawingOf(row),
      dataUrl: `data:image/png;base64,${result.png.toString("base64")}`,
      cached: result.cached,
      costUsd: result.cached ? 0 : result.costUsd,
      spentUsd: status.spentUsd,
      budgetUsd: status.budgetUsd,
    });
  } catch (err) {
    if (err instanceof ArtInputError) return error(400, err.message);
    if (err instanceof ArtBudgetError) return error(402, err.message);
    if (err instanceof ArtUnavailableError) return error(501, err.message);
    const reason = err instanceof Error ? err.message : String(err);
    return error(502, `could not generate label art: ${reason}`);
  }
}

type LabelArtRow = typeof schema.labelArt.$inferSelect;

/** A history row as the studio sees it. */
function drawingOf(row: LabelArtRow) {
  const variant =
    row.variant && Object.hasOwn(ART_VARIANTS, row.variant)
      ? ART_VARIANTS[row.variant as ArtVariant]
      : null;
  return {
    id: row.id,
    hash: row.hash,
    sourceHash: row.sourceHash,
    threshold: row.threshold,
    model: row.model,
    variantLabel: variant?.label ?? null,
    textRemoved: row.textRemoved,
    createdAt: row.createdAt,
  };
}

/** The studio shows a box's recent drawings, not every one ever made. */
const HISTORY_LIMIT = 30;

export const artHistorySchema = z.object({
  binId: z.number().int().positive(),
});

/** A box's drawings, newest first, without the removed ones. */
export async function handleArtHistory(
  ctx: Ctx,
  input: z.infer<typeof artHistorySchema>,
): Promise<Response> {
  const rows = await db
    .select()
    .from(schema.labelArt)
    .where(
      and(
        eq(schema.labelArt.groupId, ctx.groupId),
        eq(schema.labelArt.binId, input.binId),
        isNull(schema.labelArt.removedAt),
      ),
    )
    // rowid breaks ties: two drawings in the same millisecond ("3
    // variations") still list in the order they were made.
    .orderBy(desc(schema.labelArt.createdAt), desc(sql`rowid`))
    .limit(HISTORY_LIMIT);
  return json({
    drawings: rows.map(drawingOf),
    thresholds: {
      min: MIN_THRESHOLD,
      max: MAX_THRESHOLD,
      default: DEFAULT_THRESHOLD,
    },
  });
}

export const artRemoveSchema = z.object({ id: z.string().uuid() });

/**
 * Take a drawing off the box's history. Hidden, not deleted: its blob may
 * be the label a box already printed (see db/schema/label-art.ts).
 */
export async function handleArtRemove(
  ctx: Ctx,
  input: z.infer<typeof artRemoveSchema>,
): Promise<Response> {
  await db
    .update(schema.labelArt)
    .set({ removedAt: Date.now() })
    .where(
      and(
        eq(schema.labelArt.id, input.id),
        eq(schema.labelArt.groupId, ctx.groupId),
      ),
    );
  return json({ ok: true });
}

export const artCutSchema = z.object({
  id: z.string().uuid(),
  threshold: z.number().int(),
});

/**
 * Re-cut a drawing at another darkness, from its source. No model call and
 * no cost: the source already is the drawing, only the line between black
 * and white moves. The new label art replaces the row's; the studio points
 * the box at it if this was the box's chosen drawing.
 */
export async function handleArtCut(
  ctx: Ctx,
  input: z.infer<typeof artCutSchema>,
): Promise<Response> {
  const row = await db.query.labelArt.findFirst({
    where: and(
      eq(schema.labelArt.id, input.id),
      eq(schema.labelArt.groupId, ctx.groupId),
    ),
  });
  if (!row) return error(404, "no such drawing");
  const source = await readBlob(ctx.groupId, row.sourceHash);
  if (!source) return error(404, "the drawing's source is missing");

  const threshold = clampThreshold(input.threshold);
  const png = await toMonochrome(source, { threshold });
  const hash = await storeBlob(ctx, png, "image/png");
  await db
    .update(schema.labelArt)
    .set({ hash, threshold })
    .where(eq(schema.labelArt.id, row.id));
  return json({
    ...drawingOf({ ...row, hash, threshold }),
    dataUrl: `data:image/png;base64,${png.toString("base64")}`,
  });
}
