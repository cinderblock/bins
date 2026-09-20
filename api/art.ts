/**
 * Label artwork for a box: generate candidates, keep the chosen one.
 *
 * Admin-gated like printing (it spends money). Each generation lands in the
 * group's blob store as an ordinary content-addressed PNG, so the chosen
 * picture syncs to every device through the same path photos take and a
 * reprint months later is free. Which one is "the" label art is a field on
 * the box (`labelArtHash`, an LWW scalar the client sets once it has picked),
 * so nothing here writes materialized state.
 */
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "../db/client.server";
import { storeBlob } from "./blobs";
import { type Ctx, error, json } from "./context";
import {
  ArtBudgetError,
  ArtInputError,
  ArtUnavailableError,
  artStatus,
  generateArtPng,
} from "./labels/art";

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
    });
    // Into the group's blob store so every device can fetch it by hash and
    // the service worker caches it like any photo.
    const hash = await storeBlob(ctx, result.png, "image/png");
    const status = artStatus();
    return json({
      hash,
      dataUrl: `data:image/png;base64,${result.png.toString("base64")}`,
      cached: result.cached,
      model: result.model,
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
