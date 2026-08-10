/**
 * Running out of room on the device, said usefully.
 *
 * There is no cap on how many photos a box may have — but a phone has a finite
 * browser storage quota, and photo bytes live in IndexedDB until they upload.
 * `prunePhotoCache` only ever evicts blobs it has already sent, so a device
 * that has been offline for a while (a storage unit with no signal — exactly
 * what this app is for) accumulates every rendition with nothing reclaimable.
 *
 * When that quota is hit the capture throws, and the raw failure read
 * `Capture failed: QuotaExceededError…`. Someone hit that in the field and
 * typed "Ran out of photo space" into a note instead, which is a perfectly
 * reasonable response to an unreasonable error message.
 */

/**
 * Is this the browser saying "no room left"? The name varies by engine and
 * WebKit has historically thrown a plain DOMException with code 22, so match
 * broadly — a false positive only costs a friendlier message.
 */
export function isQuotaError(err: unknown): boolean {
  if (!err) return false;
  const name = (err as { name?: string }).name ?? "";
  const code = (err as { code?: number }).code;
  const text = String((err as { message?: string }).message ?? err);
  return (
    name === "QuotaExceededError" ||
    name === "NS_ERROR_DOM_QUOTA_REACHED" ||
    code === 22 ||
    /quota|storage.*full|exceeded the quota/i.test(text)
  );
}

/**
 * What to show when a capture fails. Storage exhaustion gets an explanation
 * and the actual way out; everything else keeps the raw error, which is what
 * makes an unexpected failure diagnosable.
 */
export function captureErrorMessage(err: unknown): string {
  if (isQuotaError(err)) {
    return "This device is out of storage, so the photo wasn't saved. Get back online so pending photos can upload — that frees the space. Settings shows how much is used.";
  }
  return `Capture failed: ${err}`;
}

export type StorageUse = {
  usedBytes: number;
  quotaBytes: number | null;
  /** 0–1, or null when the browser won't say (Safari often won't). */
  fraction: number | null;
};

/** Best-effort storage usage; null where the browser doesn't implement it. */
export async function estimateStorage(): Promise<StorageUse | null> {
  try {
    const est = await navigator.storage?.estimate?.();
    if (!est || est.usage == null) return null;
    const quota = est.quota ?? null;
    return {
      usedBytes: est.usage,
      quotaBytes: quota,
      fraction: quota ? est.usage / quota : null,
    };
  } catch {
    return null;
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[i]}`;
}
