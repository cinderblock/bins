/**
 * What happened on the way to a problem.
 *
 * A screenshot shows where someone ended up. Most bugs worth reporting depend
 * on how they got there, so this keeps a short rolling record of taps, page
 * changes, failed requests and console output, ready to attach to a report.
 *
 * Kept in memory on purpose: it costs nothing until someone reports, and a
 * reload (which is what taking a new build does) starts a clean story.
 *
 * It records what was pressed and never what was typed. Field values stay out
 * entirely, and everything else goes through `scrub` on the way in, because
 * this ends up on the server and in front of an agent.
 */

const MAX_CRUMBS = 40;
const MAX_CONSOLE = 20;
const MAX_NETWORK = 25;
const MAX_TEXT = 200;
/** A request slower than this is worth mentioning even if it worked. */
const SLOW_MS = 2000;

export type Crumb = { at: number; kind: string; detail: string };

/**
 * Take credentials out of text that's about to leave the device: integration
 * tokens, bearer headers, the sticker code in a URL's fragment, and any literal
 * values passed in (a remembered access code or admin password).
 */
export function scrub(text: string, secrets: string[] = []): string {
  let out = text
    .replace(/bins_[0-9a-f]+_[0-9a-f]+/gi, "[token]")
    .replace(/Bearer\s+\S+/gi, "Bearer [token]")
    .replace(/(\/[^\s"'#]*)#[^\s"']+/g, "$1#[code]");
  for (const secret of secrets) {
    if (secret.length >= 4) out = out.split(secret).join("[secret]");
  }
  return out;
}

function ring<T>(list: T[], item: T, max: number): void {
  list.push(item);
  if (list.length > max) list.shift();
}

const crumbs: Crumb[] = [];
const consoleLines: Crumb[] = [];
const network: Crumb[] = [];

export function crumb(kind: string, detail: string): void {
  ring(
    crumbs,
    { at: Date.now(), kind, detail: scrub(detail).slice(0, MAX_TEXT) },
    MAX_CRUMBS,
  );
}

/** One API call. Only the interesting ones: failed, slow, or a write. */
export function recordRequest(
  method: string,
  path: string,
  status: number | "failed",
  ms: number,
): void {
  const failed = status === "failed" || status >= 400;
  if (!failed && method === "GET" && ms < SLOW_MS) return;
  const where = path
    .split("?")[0]
    ?.replace(/\/api\/blobs\/[0-9a-f]{8}[0-9a-f]+/, "/api/blobs/<hash>");
  ring(
    network,
    {
      at: Date.now(),
      kind: String(status),
      detail: `${method} ${where} ${Math.round(ms)}ms`,
    },
    MAX_NETWORK,
  );
}

/** A label for what was pressed. Its words, never a field's contents. */
function describe(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) return null;
  const el = target.closest(
    'button, a, label, input, textarea, select, [role="button"], [role="tab"], [role="switch"]',
  );
  if (!el) return null;
  const tag = el.tagName.toLowerCase();
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    const name =
      el.getAttribute("aria-label") ?? el.placeholder ?? el.name ?? "";
    return `${tag}${el instanceof HTMLInputElement ? `[${el.type}]` : ""} ${name}`;
  }
  const label =
    el.getAttribute("aria-label") ?? el.textContent?.trim().slice(0, 60) ?? "";
  return `${tag} ${label}`;
}

function stringify(value: unknown): string {
  if (value instanceof Error) return value.message;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

let installed = false;

/** Start listening. Must never be able to break the thing it's watching. */
export function installBreadcrumbs(): void {
  if (installed) return;
  installed = true;

  document.addEventListener(
    "click",
    (event) => {
      const what = describe(event.target);
      if (what) crumb("tap", what);
    },
    true,
  );
  document.addEventListener("visibilitychange", () =>
    crumb("app", document.visibilityState),
  );
  window.addEventListener("online", () => crumb("net", "online"));
  window.addEventListener("offline", () => crumb("net", "offline"));

  for (const level of ["error", "warn"] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      try {
        const line = scrub(args.map(stringify).join(" "));
        ring(
          consoleLines,
          { at: Date.now(), kind: level, detail: line.slice(0, MAX_TEXT) },
          MAX_CONSOLE,
        );
      } catch {
        // Diagnostics must not change what the console call does.
      }
      original(...args);
    };
  }
}

/** Times as "seconds before the report", which is how they get read. */
function relative(list: Crumb[], now: number) {
  return list.map(({ at, kind, detail }) => ({
    secondsAgo: Math.round((now - at) / 1000),
    kind,
    detail,
  }));
}

export function activityTrail(now = Date.now()) {
  return {
    breadcrumbs: relative(crumbs, now),
    console: relative(consoleLines, now),
    requests: relative(network, now),
  };
}
