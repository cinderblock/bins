/**
 * Send a bin to the configured label printer.
 *
 * bins knows what a bin IS — its name, its canonical URL, where it lives. It
 * deliberately knows nothing about media size, layout, artwork, dithering or
 * printer command languages: those live behind LABEL_PRINT_URL. So this posts
 * a SPEC, not an image.
 *
 * Server-side because the printer credential must never reach a browser, and
 * because the printer is typically only reachable from the server's network.
 */
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "../db/client.server";
import { labelPrintToken, labelPrintUrl } from "./config";
import { type Ctx, error, json } from "./context";

export const labelSchema = z.object({
  binId: z.number().int().positive(),
  copies: z.number().int().min(1).max(20).optional(),
  /** Include the box's contents/location lines under the title. */
  includeDetails: z.boolean().optional(),
});

/** How long to wait on the printer before giving up and reporting it. */
const PRINT_TIMEOUT_MS = 20_000;

export async function handleLabelPrint(
  ctx: Ctx,
  input: z.infer<typeof labelSchema>,
  origin: string,
): Promise<Response> {
  const url = labelPrintUrl();
  if (!url) return error(501, "no label printer configured");

  const bin = await db.query.bin.findFirst({
    where: eq(schema.bin.id, input.binId),
  });
  // Group-scoped: a bin id is globally unique, so without this check an admin
  // could print another tenant's box.
  if (!bin || bin.groupId !== ctx.groupId) return error(404, "no such bin");

  const lines: string[] = [];
  if (input.includeDetails) {
    if (bin.locationName) lines.push(bin.locationName);
  }

  // The QR carries the canonical URL for this box. The secret code rides the
  // FRAGMENT when there is one, exactly as the in-app sticker export does —
  // fragments never reach the server, so codes stay out of access logs.
  const path = bin.secretCode ? `/${bin.id}#${bin.secretCode}` : `/${bin.id}`;

  const body = {
    // A box with no name yet still needs something readable on the label.
    title: bin.name?.trim() || `Box ${bin.id}`,
    url: `${origin}${path}`.toUpperCase(),
    lines: lines.length > 0 ? lines : undefined,
    copies: input.copies ?? 1,
  };

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const token = labelPrintToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(PRINT_TIMEOUT_MS),
    });
    if (!response.ok) {
      const detail = (await response.text().catch(() => "")).slice(0, 300);
      // Surface the printer's own words: "out of paper" is far more useful to
      // someone holding a box than "print failed".
      return error(
        502,
        `printer refused the job: ${response.status} ${detail}`,
      );
    }
    return json({ ok: true, printed: body.copies, title: body.title });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return error(502, `could not reach the label printer: ${reason}`);
  }
}
