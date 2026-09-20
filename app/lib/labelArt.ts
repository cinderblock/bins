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

export type ArtResult = {
  hash: string;
  dataUrl: string;
  cached: boolean;
  model: string;
  costUsd: number;
  spentUsd: number;
  budgetUsd: number | null;
};

/**
 * Generate one candidate for a box. The server has already stored the PNG
 * in the group's blob store; this also drops it into the local cache under
 * its hash so <PhotoImg hash=…> shows it immediately and offline.
 */
export async function generateLabelArt(
  adminPassword: string,
  binId: number,
  options: {
    model?: string;
    instructions?: string | null;
    references?: ArtReference[];
    nonce?: string;
  },
): Promise<ArtResult> {
  const result = await apiJson<ArtResult>("/api/admin/bins/art", {
    method: "POST",
    body: JSON.stringify({
      adminPassword,
      binId,
      model: options.model,
      instructions: options.instructions ?? undefined,
      references: options.references?.map((r) => ({
        mime: r.mime,
        data: r.data,
      })),
      nonce: options.nonce,
    }),
  });
  const bytes = await (await fetch(result.dataUrl)).blob();
  await db.blobs.put({
    hash: result.hash,
    mime: "image/png",
    // The server already holds it — nothing to upload.
    status: "done",
    role: "display",
    bytes,
    lastAccessAt: Date.now(),
  });
  return result;
}

export function formatUsd(usd: number): string {
  return usd < 0.1 ? `${Math.round(usd * 100)}¢` : `$${usd.toFixed(2)}`;
}
