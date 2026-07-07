/**
 * Photo capture pipeline: three renditions per shot, each its own
 * content-addressed blob —
 *   thumb    320px  q0.7  strips/search; synced, kept locally forever (tiny)
 *   display 1600px  q0.8  the canonical photo identity (the op's `hash`)
 *   original native q0.9  archival; only when the source beats 1600px, and
 *                         uploaded AFTER everything else (deferred)
 * Canvas-grabbed frames are upright and EXIF-free by construction; the
 * file-input fallback is normalized through createImageBitmap (which also
 * strips embedded GPS EXIF — location is recorded explicitly, with consent).
 *
 * Local cache policy (enforced by prunePhotoCache, run after sync): thumbs
 * stay forever; display bytes stay while they're some bin's primary photo or
 * were accessed in the last 7 days; original bytes are dropped the moment
 * the server confirms the upload. Evicted bytes refetch on demand.
 */
import { apiFetch } from "./api";
import { type BlobRole, db } from "./db";

const DISPLAY_MAX_EDGE = 1600;
const DISPLAY_JPEG_QUALITY = 0.8;
const THUMB_MAX_EDGE = 320;
const THUMB_QUALITY = 0.7;
const ORIGINAL_JPEG_QUALITY = 0.9;

/** Keep non-primary display bytes this long after their last view. */
const DISPLAY_CACHE_TTL_MS = 7 * 24 * 3_600_000;
/** Don't churn Dexie with a lastAccessAt write on every render. */
const ACCESS_TOUCH_INTERVAL_MS = 3_600_000;

export interface Rendition {
  hash: string;
  bytes: Blob;
}

export interface ProcessedPhoto {
  mime: string;
  thumb: Rendition;
  display: Rendition;
  /** Null when the source wasn't meaningfully larger than the display size. */
  original: Rendition | null;
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

async function rendition(bytes: Blob): Promise<Rendition> {
  return { hash: await sha256Hex(bytes), bytes };
}

async function process(
  source: CanvasImageSource,
  width: number,
  height: number,
): Promise<ProcessedPhoto> {
  const displayCanvas = drawScaled(source, width, height, DISPLAY_MAX_EDGE);
  const display = await rendition(
    await toBlob(displayCanvas, "image/jpeg", DISPLAY_JPEG_QUALITY),
  );
  const thumb = await rendition(
    await toBlob(
      drawScaled(
        displayCanvas,
        displayCanvas.width,
        displayCanvas.height,
        THUMB_MAX_EDGE,
      ),
      "image/jpeg",
      THUMB_QUALITY,
    ),
  );
  // Archival copy only when the source genuinely beats the display size —
  // re-encoded through canvas, so it stays EXIF/GPS-free like everything else.
  let original: Rendition | null = null;
  if (Math.max(width, height) > DISPLAY_MAX_EDGE) {
    original = await rendition(
      await toBlob(
        drawScaled(source, width, height, Number.POSITIVE_INFINITY),
        "image/jpeg",
        ORIGINAL_JPEG_QUALITY,
      ),
    );
  }
  return { mime: "image/jpeg", thumb, display, original };
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

async function touchAccess(hash: string, lastAccessAt: number) {
  if (Date.now() - lastAccessAt > ACCESS_TOUCH_INTERVAL_MS) {
    await db.blobs.update(hash, { lastAccessAt: Date.now() });
  }
}

/**
 * Resolve displayable bytes for a rendition hash: local cache first, else
 * fetch from the server (authenticated — <img src> can't send the bearer
 * header) and cache under the given role for offline reuse. `fallbackHash`
 * covers renditions that don't exist (old ops without thumbs) or haven't
 * uploaded yet.
 */
export async function getPhotoBlob(
  hash: string,
  role: BlobRole = "display",
  fallbackHash?: string | null,
): Promise<Blob | undefined> {
  const row = await db.blobs.get(hash);
  if (row?.bytes) {
    void touchAccess(hash, row.lastAccessAt);
    return row.bytes;
  }
  try {
    const res = await apiFetch(`/api/blobs/${hash}`);
    const bytes = await res.blob();
    await db.blobs.put({
      hash,
      mime: bytes.type,
      status: "done",
      role: row?.role ?? role,
      bytes,
      lastAccessAt: Date.now(),
    });
    return bytes;
  } catch {
    if (fallbackHash && fallbackHash !== hash) {
      return getPhotoBlob(fallbackHash, "display");
    }
    return undefined;
  }
}

/**
 * Enforce the local photo-cache policy (see header). Never touches pending
 * rows — unsynced bytes are sacred.
 */
export async function prunePhotoCache(): Promise<void> {
  const primaries = new Set<string>();
  for (const bin of await db.bins.toArray()) {
    if (bin.primaryPhotoHash) primaries.add(bin.primaryPhotoHash);
  }
  const cutoff = Date.now() - DISPLAY_CACHE_TTL_MS;
  const rows = await db.blobs.where("status").equals("done").toArray();
  const evict = rows
    .filter((row) => row.bytes !== null)
    .filter(
      (row) =>
        row.role === "original" ||
        (row.role === "display" &&
          !primaries.has(row.hash) &&
          row.lastAccessAt < cutoff),
    )
    .map((row) => row.hash);
  for (const hash of evict) {
    await db.blobs.update(hash, { bytes: null });
  }
}
