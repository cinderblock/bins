/** Small display helpers — not worth a dayjs dependency. */

/**
 * A build SHA at a glance. Full 40 chars are unreadable in a table cell and
 * the leading 7 are what anyone would paste into `git show` anyway. Values
 * that aren't SHAs (notably "dev") are shown as-is.
 */
export function shortBuild(sha: string): string {
  return /^[0-9a-f]{40}$/i.test(sha) ? sha.slice(0, 7) : sha;
}

export function relativeTime(ms: number): string {
  const delta = Date.now() - ms;
  const minutes = Math.round(delta / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 60) return `${days}d ago`;
  return new Date(ms).toLocaleDateString();
}

/**
 * One of the two is set: the box's number (`/123`) or its opaque handle
 * (`/b/<uuid>`, printed by deployments that keep numbers internal). Handles
 * are returned lower-cased, matching how they are stored — sticker URLs are
 * upper-cased for QR density.
 */
export interface ScanTarget {
  binId: number | null;
  handle: string | null;
  /** The sticker secret (`/{id}#{CODE}`) when the scan carried one. */
  code: string | null;
}

const HANDLE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Extract a bin target from a scanned QR value: our URL (with or without the
 * secret code), a bare number, or a bare handle. The code rides the RAW
 * fragment (`/1#7HX6`) so it never appears in server/proxy logs; query-string
 * (`/1?7HX6`) and `code=` forms are tolerated for hand-typed or legacy inputs.
 *
 * Every historical form stays accepted forever: stickers are physical and
 * outlive any change of scheme (plans/multi-instance.md).
 */
/**
 * Normalise a scanned value into a PLACE code — what a shelf's own sticker
 * says.
 *
 * Shelf stickers are printed long before any app exists and nobody is going
 * to reprint a warehouse, so this deliberately accepts an opaque string
 * rather than defining a scheme. If the value happens to be a URL (a newer
 * sticker, or a code that merely looks like one), its last non-empty path
 * segment is taken, so `https://x/s/H4K9` and a bare `H4K9` are the same
 * shelf.
 *
 * Returns null for anything implausible as a printed code — blank, or long
 * enough to be a sentence — so that a stray QR in the camera's view does not
 * get treated as a shelf.
 */
export function placeCodeFromScan(raw: string): string | null {
  let value = raw.trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    const last = url.pathname.split("/").filter(Boolean).pop();
    // A URL with no path is a link to a site, not a shelf.
    if (!last) return null;
    value = decodeURIComponent(last);
  } catch {
    // Not a URL: the sticker's own string, which is the normal case here.
  }
  value = value.trim();
  if (value.length < 2 || value.length > 64) return null;
  return value;
}

/** Codes match case- and whitespace-insensitively; this is the comparison key. */
export function placeCodeKey(code: string): string {
  return code.trim().toLowerCase();
}

export function binIdFromScan(raw: string): ScanTarget | null {
  const trimmed = raw.trim();
  if (/^\d{1,9}$/.test(trimmed))
    return { binId: Number(trimmed), handle: null, code: null };
  if (HANDLE.test(trimmed))
    return { binId: null, handle: trimmed.toLowerCase(), code: null };
  try {
    const url = new URL(trimmed);
    const byNumber = url.pathname.match(/^\/(\d{1,9})\/?$/);
    const byHandle = url.pathname.match(
      /^\/b\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i,
    );
    if (byNumber?.[1] || byHandle?.[1]) {
      const code = [url.hash.replace(/^#/, ""), url.search.replace(/^\?/, "")]
        .map((c) => (/^code=/i.test(c) ? c.slice("code=".length) : c))
        .find((c) => c !== "");
      return {
        binId: byNumber?.[1] ? Number(byNumber[1]) : null,
        handle: byHandle?.[1] ? byHandle[1].toLowerCase() : null,
        code: code ?? null,
      };
    }
  } catch {}
  return null;
}
