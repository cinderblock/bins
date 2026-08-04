/**
 * Print a box's label.
 *
 * bins renders the finished image and POSTs it as `image/png`. That is the
 * whole point of the design: ANY printer that accepts an image works — a
 * thermal printer behind a small HTTP shim, an IPP endpoint, a service that
 * turns it into a PDF — instead of only something that implements a bespoke
 * label API. The device still owns dithering, because ink density is a
 * property of the print head and media, not of the label.
 *
 * Server-side because the printer credential must never reach a browser, the
 * image provider's key likewise, and the printer is typically only reachable
 * from the server's network.
 */
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "../db/client.server";
import { labelPrintToken, labelPrintUrl, labelSizeRaw } from "./config";
import { type Ctx, error, json } from "./context";
import {
  ArtBudgetError,
  ArtUnavailableError,
  artAvailable,
  generateArt,
} from "./labels/art";
import { renderLabel } from "./labels/render";
import { type LabelContent, parseLabelSize } from "./labels/spec";

export const labelSchema = z.object({
  binId: z.number().int().positive(),
  /** `qr` identifies the box by scanning; `art` is a decorative sticker. */
  template: z.enum(["qr", "art"]).optional(),
  /** Ask for generated line art. Ignored when no provider is configured. */
  art: z.boolean().optional(),
  copies: z.number().int().min(1).max(20).optional(),
  includeDetails: z.boolean().optional(),
});

export type LabelInput = z.infer<typeof labelSchema>;

/** How long to wait on the printer before giving up and reporting it. */
const PRINT_TIMEOUT_MS = 30_000;

/**
 * Gather everything that goes on the label and render it.
 *
 * Shared by print and preview so the preview is the SAME image that would be
 * printed — a preview that merely resembles the output is worse than none,
 * because it invites approving something that won't be what comes out.
 */
async function buildLabel(
  ctx: Ctx,
  input: LabelInput,
  origin: string,
): Promise<{ png: Buffer; title: string } | Response> {
  const geometry = parseLabelSize(labelSizeRaw());
  if (!geometry) {
    return error(500, `LABEL_SIZE is not valid: ${labelSizeRaw()}`);
  }

  const bin = await db.query.bin.findFirst({
    where: and(
      eq(schema.bin.id, input.binId),
      eq(schema.bin.groupId, ctx.groupId),
    ),
  });
  // Group-scoped: bin ids are globally unique, so without this an admin could
  // print another tenant's box.
  if (!bin) return error(404, "no such bin");

  const template = input.template ?? "qr";
  // A box with no name yet still needs something readable on the label.
  const title = bin.name?.trim() || `Box ${bin.id}`;

  const lines: string[] = [];
  if (input.includeDetails && bin.locationName) lines.push(bin.locationName);

  // The secret code rides the URL FRAGMENT when there is one, exactly as the
  // in-app sticker export does — fragments never reach a server, so codes stay
  // out of access logs. Codeless deployments print a bare `/{id}`.
  const path = bin.secretCode ? `/${bin.id}#${bin.secretCode}` : `/${bin.id}`;

  const content: LabelContent = {
    template,
    title,
    url: `${origin}${path}`.toUpperCase(),
    lines: lines.length > 0 ? lines : undefined,
  };

  if (input.art) {
    if (!artAvailable()) return error(501, "no image provider configured");
    try {
      const labelNames = await db.query.label.findMany({
        where: eq(schema.label.groupId, ctx.groupId),
        columns: { name: true },
      });
      content.artDataUrl = await generateArt({
        title,
        labels: labelNames.map((l) => l.name).slice(0, 6),
      });
    } catch (err) {
      // Budget and availability are the operator's business, not a crash.
      if (err instanceof ArtBudgetError) return error(402, err.message);
      if (err instanceof ArtUnavailableError) return error(501, err.message);
      const reason = err instanceof Error ? err.message : String(err);
      return error(502, `could not generate label art: ${reason}`);
    }
  }

  return { png: await renderLabel(content, geometry), title };
}

/**
 * Render without printing. Nobody should commit physical stock — or a paid
 * image — to something they have not seen.
 */
export async function handleLabelPreview(
  ctx: Ctx,
  input: LabelInput,
  origin: string,
): Promise<Response> {
  const built = await buildLabel(ctx, input, origin);
  if (built instanceof Response) return built;
  return new Response(new Uint8Array(built.png), {
    headers: { "Content-Type": "image/png", "Cache-Control": "no-store" },
  });
}

export async function handleLabelPrint(
  ctx: Ctx,
  input: LabelInput,
  origin: string,
): Promise<Response> {
  const url = labelPrintUrl();
  if (!url) return error(501, "no label printer configured");

  const built = await buildLabel(ctx, input, origin);
  if (built instanceof Response) return built;

  const headers: Record<string, string> = { "Content-Type": "image/png" };
  const token = labelPrintToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const copies = input.copies ?? 1;
  // Sequential, not concurrent: a printer is one physical device, and firing
  // N requests at once tends to interleave or drop jobs. Report the count
  // that actually made it so a jam halfway through isn't silent.
  for (let printed = 0; printed < copies; printed++) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers,
        body: new Uint8Array(built.png),
        signal: AbortSignal.timeout(PRINT_TIMEOUT_MS),
      });
      if (!response.ok) {
        const detail = (await response.text().catch(() => "")).slice(0, 300);
        return error(
          502,
          `printer refused the job after ${printed} of ${copies}: ${response.status} ${detail}`,
        );
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      return error(
        502,
        `could not reach the label printer after ${printed} of ${copies}: ${reason}`,
      );
    }
  }

  return json({ ok: true, printed: copies, title: built.title });
}
