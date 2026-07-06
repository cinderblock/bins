/** Small display helpers — not worth a dayjs dependency. */

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

export interface ScanTarget {
  binId: number;
  /** The sticker secret (`/{id}#{CODE}`) when the scan carried one. */
  code: string | null;
}

/**
 * Extract a bin target from a scanned QR value: our URL (with or without the
 * secret code) or a bare number. The code rides the RAW fragment (`/1#7HX6`)
 * so it never appears in server/proxy logs; query-string (`/1?7HX6`) and
 * `code=` forms are tolerated for hand-typed or legacy inputs.
 */
export function binIdFromScan(raw: string): ScanTarget | null {
  const trimmed = raw.trim();
  if (/^\d{1,9}$/.test(trimmed)) return { binId: Number(trimmed), code: null };
  try {
    const url = new URL(trimmed);
    const match = url.pathname.match(/^\/(\d{1,9})\/?$/);
    if (match?.[1]) {
      const code = [url.hash.replace(/^#/, ""), url.search.replace(/^\?/, "")]
        .map((c) => (/^code=/i.test(c) ? c.slice("code=".length) : c))
        .find((c) => c !== "");
      return { binId: Number(match[1]), code: code ?? null };
    }
  } catch {}
  return null;
}
