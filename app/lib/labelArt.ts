/**
 * Client side of label artwork: asking the server for a drawing, keeping the
 * result in the local blob cache so it renders offline like a photo, and
 * turning a reference picture into a small style hint before it leaves the
 * device.
 */
import { apiJson } from "./api";
import { db } from "./db";

export type ArtModel = { id: string; label: string; usd: number };

export type ArtStatus = {
  available: boolean;
  models: ArtModel[];
  defaultModel: string;
  spentUsd: number;
  budgetUsd: number | null;
  /** The "3 variations" directions: what to send, and what to call it. */
  variants: { id: string; label: string }[];
};

export async function fetchArtStatus(
  adminPassword: string,
): Promise<ArtStatus> {
  return apiJson<ArtStatus>("/api/admin/art/status", {
    method: "POST",
    body: JSON.stringify({ adminPassword }),
  });
}

export type ArtReference = {
  mime: "image/jpeg";
  /** base64 without the data-URL prefix. */
  data: string;
  /** For the thumbnail strip; a data URL. */
  previewUrl: string;
};

/** Longest edge of a reference as sent. Small on purpose: a style hint. */
const REFERENCE_MAX_EDGE = 512;

/**
 * Downscale a picked/pasted image to a style hint. Sent as JPEG whatever it
 * was: the model is told to take inspiration, not copy, and 512px of JPEG is
 * plenty for that while keeping five of them well under a megabyte.
 */
export async function makeReference(file: Blob): Promise<ArtReference> {
  const bitmap = await createImageBitmap(file, {
    imageOrientation: "from-image",
  });
  try {
    const scale = Math.min(
      1,
      REFERENCE_MAX_EDGE / Math.max(bitmap.width, bitmap.height),
    );
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no canvas");
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const previewUrl = canvas.toDataURL("image/jpeg", 0.85);
    return {
      mime: "image/jpeg",
      data: previewUrl.slice(previewUrl.indexOf(",") + 1),
      previewUrl,
    };
  } finally {
    bitmap.close();
  }
}

/** One drawing in a box's history (api/art.ts `drawingOf`). */
export type LabelDrawing = {
  id: string;
  /** The black-and-white label art, at `threshold`. */
  hash: string;
  /** The same drawing before the cut: what a darkness change re-cuts. */
  sourceHash: string;
  threshold: number;
  model: string;
  /** Which "3 variations" direction made it; null = a plain Generate. */
  variantLabel: string | null;
  /** Pieces of text painted out of the drawing; null = couldn't check. */
  textRemoved: number | null;
  createdAt: number;
};

export type ArtResult = LabelDrawing & {
  dataUrl: string;
  cached: boolean;
  costUsd: number;
  spentUsd: number;
  budgetUsd: number | null;
};

/** The darkness range the server accepts, and where it starts. */
export type DarknessRange = { min: number; max: number; default: number };

/**
 * Generate one candidate for a box. The server has already stored the PNG
 * in the group's blob store; this also drops it into the local cache under
 * its hash so <PhotoImg hash=…> shows it immediately and offline.
 */
export async function generateLabelArt(
  adminPassword: string,
  binId: number,
  options: {
    /** As typed right now — the request never waits on the box row to sync. */
    title: string;
    lines: string[];
    model?: string;
    instructions?: string | null;
    references?: ArtReference[];
    nonce?: string;
    /** One of ArtStatus.variants; omitted = a plain drawing. */
    variant?: string;
  },
): Promise<ArtResult> {
  const result = await apiJson<ArtResult>("/api/admin/bins/art", {
    method: "POST",
    body: JSON.stringify({
      adminPassword,
      binId,
      title: options.title,
      lines: options.lines,
      model: options.model,
      instructions: options.instructions ?? undefined,
      references: options.references?.map((r) => ({
        mime: r.mime,
        data: r.data,
      })),
      nonce: options.nonce,
      variant: options.variant,
    }),
  });
  await cacheLocally(result.hash, result.dataUrl);
  return result;
}

/**
 * Drop a drawing the server just made into the local blob cache, so
 * <PhotoImg hash=…> shows it at once and offline. The server already holds
 * it, so there is nothing to upload.
 */
async function cacheLocally(hash: string, dataUrl: string): Promise<void> {
  const bytes = await (await fetch(dataUrl)).blob();
  await db.blobs.put({
    hash,
    mime: "image/png",
    status: "done",
    role: "display",
    bytes,
    lastAccessAt: Date.now(),
  });
}

/** A box's drawings, newest first, and the darkness range. */
export async function fetchLabelDrawings(
  adminPassword: string,
  binId: number,
): Promise<{ drawings: LabelDrawing[]; thresholds: DarknessRange }> {
  return apiJson("/api/admin/bins/art/history", {
    method: "POST",
    body: JSON.stringify({ adminPassword, binId }),
  });
}

/** Take a drawing off a box's history, on every device. */
export async function removeLabelDrawing(
  adminPassword: string,
  id: string,
): Promise<void> {
  await apiJson("/api/admin/bins/art/remove", {
    method: "POST",
    body: JSON.stringify({ adminPassword, id }),
  });
}

/** Re-cut a drawing at another darkness. Free: no model is called. */
export async function cutLabelDrawing(
  adminPassword: string,
  id: string,
  threshold: number,
): Promise<LabelDrawing & { dataUrl: string }> {
  const result = await apiJson<LabelDrawing & { dataUrl: string }>(
    "/api/admin/bins/art/cut",
    {
      method: "POST",
      body: JSON.stringify({ adminPassword, id, threshold }),
    },
  );
  await cacheLocally(result.hash, result.dataUrl);
  return result;
}

/**
 * Cut a drawing's source on this device, for the darkness slider to follow
 * a finger without a round trip per step. Same rule as the server's sharp
 * `threshold` on a one-channel image (at or above the cut is white), so
 * what the slider shows is what the server then stores. The decoded source
 * is kept per hash: decoding is the slow part, cutting is a pass over bytes.
 */
const decodedSources = new Map<string, Promise<ImageData>>();

async function decodeSource(sourceHash: string): Promise<ImageData> {
  const { getPhotoBlob } = await import("./photos");
  const blob = await getPhotoBlob(sourceHash, "display");
  if (!blob) throw new Error("the drawing's source isn't available");
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no canvas");
    ctx.drawImage(bitmap, 0, 0);
    return ctx.getImageData(0, 0, canvas.width, canvas.height);
  } finally {
    bitmap.close();
  }
}

export async function previewCut(
  sourceHash: string,
  threshold: number,
): Promise<string> {
  let decoding = decodedSources.get(sourceHash);
  if (!decoding) {
    decoding = decodeSource(sourceHash);
    decodedSources.set(sourceHash, decoding);
    decoding.catch(() => decodedSources.delete(sourceHash));
  }
  const source = await decoding;
  const out = new ImageData(source.width, source.height);
  const from = source.data;
  const to = out.data;
  for (let i = 0; i < from.length; i += 4) {
    // Greyscale source: red is the grey value.
    const v = (from[i] ?? 255) >= threshold ? 255 : 0;
    to[i] = v;
    to[i + 1] = v;
    to[i + 2] = v;
    to[i + 3] = 255;
  }
  const canvas = document.createElement("canvas");
  canvas.width = out.width;
  canvas.height = out.height;
  canvas.getContext("2d")?.putImageData(out, 0, 0);
  return canvas.toDataURL("image/png");
}

export function formatUsd(usd: number): string {
  return usd < 0.1 ? `${Math.round(usd * 100)}¢` : `$${usd.toFixed(2)}`;
}
