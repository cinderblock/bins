/**
 * Photo capture pipeline: downscale + compress on-device (a 12MP upload would
 * murder a weak uplink), thumbnail for strips, sha256 for content
 * addressing. Canvas-grabbed frames are upright and EXIF-free by construction;
 * the file-input fallback is normalized through createImageBitmap (which also
 * strips embedded GPS EXIF — location is recorded explicitly, with consent).
 */
import { apiFetch } from "./api";
import { db } from "./db";

const FULL_MAX_EDGE = 1600;
const FULL_JPEG_QUALITY = 0.8;
const THUMB_MAX_EDGE = 320;
const THUMB_QUALITY = 0.7;

export interface ProcessedPhoto {
  hash: string;
  mime: string;
  full: Blob;
  thumb: Blob;
}

function drawScaled(
  source: CanvasImageSource,
  width: number,
  height: number,
  maxEdge: number,
): HTMLCanvasElement {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context");
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function toBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("toBlob failed"))),
      type,
      quality,
    );
  });
}

async function sha256Hex(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    await blob.arrayBuffer(),
  );
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function process(
  source: CanvasImageSource,
  width: number,
  height: number,
): Promise<ProcessedPhoto> {
  const fullCanvas = drawScaled(source, width, height, FULL_MAX_EDGE);
  const full = await toBlob(fullCanvas, "image/jpeg", FULL_JPEG_QUALITY);
  const thumbCanvas = drawScaled(
    fullCanvas,
    fullCanvas.width,
    fullCanvas.height,
    THUMB_MAX_EDGE,
  );
  const thumb = await toBlob(thumbCanvas, "image/jpeg", THUMB_QUALITY);
  return { hash: await sha256Hex(full), mime: "image/jpeg", full, thumb };
}

/** Grab + process the current frame of the live viewfinder. */
export async function captureFromVideo(
  video: HTMLVideoElement,
): Promise<ProcessedPhoto> {
  if (!video.videoWidth) throw new Error("camera not ready");
  return process(video, video.videoWidth, video.videoHeight);
}

/** Fallback path: a file from the system camera / photo library. */
export async function processFile(file: File): Promise<ProcessedPhoto> {
  const bitmap = await createImageBitmap(file, {
    imageOrientation: "from-image",
  });
  try {
    return await process(bitmap, bitmap.width, bitmap.height);
  } finally {
    bitmap.close();
  }
}

/**
 * Resolve displayable bytes for a photo hash: local capture first, else fetch
 * from the server (authenticated — <img src> can't send the bearer header)
 * and cache in Dexie so it renders offline forever after.
 */
export async function getPhotoBlob(
  hash: string,
  preferFull = false,
): Promise<Blob | undefined> {
  const row = await db.blobs.get(hash);
  if (row) {
    const cached = preferFull
      ? (row.full ?? row.thumb)
      : (row.thumb ?? row.full);
    if (cached) return cached;
  }
  try {
    const res = await apiFetch(`/api/blobs/${hash}`);
    const blob = await res.blob();
    await db.blobs.put({
      hash,
      mime: blob.type,
      status: "done",
      full: null,
      // Cache the fetched image as the local render copy.
      thumb: blob,
    });
    return blob;
  } catch {
    return undefined;
  }
}
