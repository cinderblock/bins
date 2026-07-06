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

/** Extract a bin id from a scanned QR value: our URL or a bare number. */
export function binIdFromScan(raw: string): number | null {
  const trimmed = raw.trim();
  if (/^\d{1,9}$/.test(trimmed)) return Number(trimmed);
  try {
    const url = new URL(trimmed);
    const match = url.pathname.match(/^\/(\d{1,9})\/?$/);
    if (match?.[1]) return Number(match[1]);
  } catch {}
  return null;
}
