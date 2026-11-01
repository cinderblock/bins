/**
 * Reporting a problem from inside the app, and following what becomes of it.
 *
 * Reports queue in Dexie exactly like errors do (lib/errors.ts): this app is
 * used where there's no signal, and "the scanner won't load" is a report that
 * has to survive having no signal.
 *
 * The report carries what was on screen, because "this doesn't work" from a
 * phone says very little on its own. `context` and the screenshot show content
 * other members wrote, so the watcher treats both as evidence and never as
 * instructions, whoever sent the report.
 */
import { domToBlob } from "modern-screenshot";
import { BUILD_SHA, apiFetch, apiJson } from "./api";
import { requestUpdateCheck } from "./appUpdate";
import { activityTrail, scrub } from "./breadcrumbs";
import {
  ACCESS_CODE_KEY,
  ADMIN_PASSWORD_KEY,
  AUTH_DEAD_KEY,
  LAST_SEQ_KEY,
  type QueuedReport,
  REMOTE_LOCKED_KEY,
  REPORTS_TRACKED_KEY,
  db,
  getIdentity,
  getMeta,
  setMeta,
} from "./db";
import { DEPLOYMENT_KEY } from "./deployment";
import { recentErrors } from "./errors";
import {
  type AgentStatus,
  type ServerReport,
  type Tracked,
  reportStep,
} from "./reportStep";
import { syncStatus } from "./sync";

/** Long enough for a phone to render the page; short enough not to matter. */
const SCREENSHOT_TIMEOUT_MS = 4000;
const PAGE_TEXT_LIMIT = 6000;
const POLL_IDLE_MS = 30_000;
/** Quicker during a fix, so the bar moves and the reload comes promptly. */
const POLL_BUSY_MS = 8_000;

export const REPORT_EVENT = "bins:report";

/** Open the report sheet from anywhere. */
export function openReport(): void {
  window.dispatchEvent(new Event(REPORT_EVENT));
}

export type PageContext = Record<string, unknown>;

/**
 * Pages that show codes, passwords or tokens get no screenshot and no page text.
 * Skipping the whole page beats masking fields, because a mask only covers the
 * fields somebody remembered, and a report from here still has its words, its
 * route and its trail.
 */
const SENSITIVE_PAGE = /^\/(admin|print|setup|join)(\/|$)/;

export function onSensitivePage(path = location.pathname): boolean {
  return SENSITIVE_PAGE.test(path);
}

type NetworkInformation = { effectiveType?: string; saveData?: boolean };

/** The open sheet or dialog, by its title. */
function openOverlay(): string | null {
  const content = document.querySelector(
    ".mantine-Modal-content, .mantine-Drawer-content",
  );
  if (!content) return null;
  return content.querySelector("h2, [class*=title]")?.textContent ?? "untitled";
}

function focusedControl(): string | null {
  const el = document.activeElement;
  if (!el || el === document.body) return null;
  const name = el.getAttribute("aria-label") ?? el.getAttribute("placeholder");
  return name
    ? `${el.tagName.toLowerCase()} ${name}`
    : el.tagName.toLowerCase();
}

/**
 * What the reporter was looking at and how they got there. Taken before the
 * sheet covers it, and synchronously, so it's the moment of the report and not
 * whatever a slower step gets to see later.
 */
export function capturePageContext(): PageContext {
  const nav = navigator as Navigator & {
    connection?: NetworkInformation;
    deviceMemory?: number;
  };
  const sensitive = onSensitivePage();
  return {
    url: location.pathname + location.search,
    title: document.title,
    sensitivePage: sensitive,
    pageText: sensitive
      ? null
      : document.body.innerText.slice(0, PAGE_TEXT_LIMIT),
    openOverlay: openOverlay(),
    focused: focusedControl(),
    scroll: {
      y: Math.round(window.scrollY),
      height: document.body.scrollHeight,
    },
    viewport: `${window.innerWidth}x${window.innerHeight}@${window.devicePixelRatio}`,
    orientation: screen.orientation?.type ?? null,
    standalone: window.matchMedia("(display-mode: standalone)").matches,
    colorScheme: document.documentElement.getAttribute(
      "data-mantine-color-scheme",
    ),
    language: navigator.language,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    localTime: new Date().toString(),
    online: navigator.onLine,
    connection: nav.connection?.effectiveType ?? null,
    deviceMemoryGb: nav.deviceMemory ?? null,
    sessionSeconds: Math.round(performance.now() / 1000),
    recentErrors: recentErrors(),
    ...activityTrail(),
  };
}

/** The box on screen, if any: the state behind what the page is showing. */
async function currentBox(path: string) {
  const byNumber = path.match(/^\/(\d+)$/)?.[1];
  const byHandle = path.match(/^\/b\/([0-9a-f-]{36})$/i)?.[1];
  const bin = byNumber
    ? await db.bins.get(Number(byNumber))
    : byHandle
      ? await db.bins.where("handle").equals(byHandle).first()
      : undefined;
  if (!bin) return null;
  return {
    id: bin.id,
    status: bin.status,
    location: bin.locationName,
    updatedAt: bin.updatedAt,
    entries: await db.entries.where("binId").equals(bin.id).count(),
  };
}

/** The app's own state. Slower than the page, so it's filled in at send time. */
async function captureAppState(path: string): Promise<PageContext> {
  const [pendingOps, pendingBlobs, queuedErrors, queuedReports] =
    await Promise.all([
      db.pendingOps.count(),
      db.blobs.where("status").equals("pending").count(),
      db.errorQueue.count(),
      db.reportQueue.count(),
    ]);
  const storage = await navigator.storage?.estimate?.().catch(() => null);
  return {
    sync: {
      ...syncStatus(),
      pendingOps,
      pendingBlobs,
      queuedErrors,
      queuedReports,
      lastSeq: (await getMeta<number>(LAST_SEQ_KEY)) ?? null,
      signedOut: (await getMeta<boolean>(AUTH_DEAD_KEY)) ?? false,
      remoteLocked: (await getMeta<boolean>(REMOTE_LOCKED_KEY)) ?? false,
    },
    replica: {
      boxes: await db.bins.count(),
      entries: await db.entries.count(),
      places: await db.locations.count(),
    },
    box: await currentBox(path),
    deployment: (await getMeta(DEPLOYMENT_KEY)) ?? null,
    adminUnlocked: !!(await getMeta<string>(ADMIN_PASSWORD_KEY)),
    serviceWorker: navigator.serviceWorker?.controller?.state ?? "none",
    storage: storage
      ? { usedMb: mb(storage.usage), quotaMb: mb(storage.quota) }
      : null,
  };
}

const mb = (bytes = 0) => Math.round(bytes / 1_000_000);

/**
 * Finish a captured context just before it's queued. Failing here must not cost
 * the report, and the last step is scrubbing the page text of this device's own
 * remembered credentials, wherever they happened to be showing.
 */
export async function completeContext(page: PageContext): Promise<PageContext> {
  const secrets = [
    await getMeta<string>(ACCESS_CODE_KEY),
    await getMeta<string>(ADMIN_PASSWORD_KEY),
  ].filter((value): value is string => typeof value === "string");
  const pageText =
    typeof page.pageText === "string"
      ? scrub(page.pageText, secrets)
      : page.pageText;
  const app = await captureAppState(location.pathname).catch(() => null);
  return { ...page, pageText, app };
}

/**
 * A picture of the page, or null. A report without one is still a good report,
 * so nothing here is allowed to fail loudly or to take long.
 */
export async function captureScreenshot(): Promise<Blob | null> {
  if (onSensitivePage()) return null;
  const shot = domToBlob(document.documentElement, {
    type: "image/jpeg",
    quality: 0.7,
    width: window.innerWidth,
    height: window.innerHeight,
    scale: Math.min(window.devicePixelRatio || 1, 2),
    style: { transform: `translateY(-${window.scrollY}px)` },
    filter: (node) =>
      !(node instanceof Element && node.hasAttribute("data-report-ignore")),
  });
  const timeout = new Promise<null>((resolve) =>
    window.setTimeout(() => resolve(null), SCREENSHOT_TIMEOUT_MS),
  );
  try {
    return await Promise.race([shot, timeout]);
  } catch {
    return null;
  }
}

export async function submitReport(
  report: Omit<QueuedReport, "id" | "at">,
): Promise<void> {
  await db.reportQueue.add({
    ...report,
    id: crypto.randomUUID(),
    at: Date.now(),
  });
  void flushReports();
}

async function sha256Hex(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    await blob.arrayBuffer(),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function trackedReports(): Promise<Tracked> {
  return (await getMeta<Tracked>(REPORTS_TRACKED_KEY)) ?? {};
}

let flushing = false;

/** Send what's queued. Called after each report and from the sync cycle. */
export async function flushReports(): Promise<void> {
  if (flushing) return;
  flushing = true;
  try {
    if (!(await getIdentity())) return;
    const queued = await db.reportQueue.orderBy("at").toArray();
    for (const report of queued) {
      if (!(await sendReport(report))) return;
    }
  } catch {
    // Offline, most likely. The queue is the whole point.
  } finally {
    flushing = false;
  }
}

/** True to keep going, false when it's worth trying again later instead. */
async function sendReport(report: QueuedReport): Promise<boolean> {
  let screenshotHash: string | null = null;
  if (report.screenshot) {
    screenshotHash = await sha256Hex(report.screenshot);
    const put = await apiFetch(`/api/blobs/${screenshotHash}`, {
      method: "PUT",
      body: report.screenshot,
      headers: { "Content-Type": report.screenshot.type || "image/jpeg" },
    });
    // The words matter more than the picture.
    if (!put.ok) screenshotHash = null;
  }

  const res = await apiFetch("/api/reports", {
    method: "POST",
    body: JSON.stringify({
      id: report.id,
      text: report.text,
      route: report.route,
      buildSha: report.buildSha,
      userAgent: report.userAgent,
      context: report.context,
      screenshotHash,
      at: report.at,
      // The server works out what this device is allowed to be: see
      // api/reports.ts. Absent or stale, it's an ordinary member report.
      adminPassword: (await getMeta<string>(ADMIN_PASSWORD_KEY)) ?? undefined,
    }),
  });
  if (res.status === 429 || res.status >= 500) return false;
  // Anything else is final, and a report the server will never take must not
  // sit at the head of the queue blocking the rest.
  await db.reportQueue.delete(report.id);
  if (res.ok) {
    const tracked = await trackedReports();
    tracked[report.id] = "open";
    await setMeta(REPORTS_TRACKED_KEY, tracked);
  }
  return true;
}

type Notify = (note: { message: string; color: string }) => void;

let notify: Notify = () => {};
let agent: AgentStatus | null = null;
const listeners = new Set<() => void>();

/** For useSyncExternalStore: the agent status, shared by every indicator. */
export function subscribeAgent(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export const agentSnapshot = () => agent;

async function pollOnce(): Promise<void> {
  if (document.visibilityState !== "visible") return;
  const res = await apiJson<{
    reports: ServerReport[];
    serverBuild: string;
    agent: AgentStatus;
  }>("/api/reports/mine");
  agent = res.agent;
  for (const listener of listeners) listener();

  const tracked = await trackedReports();
  if (Object.keys(tracked).length === 0) return;
  const step = reportStep(tracked, res.reports, BUILD_SHA, res.serverBuild);
  await setMeta(REPORTS_TRACKED_KEY, step.tracked);
  for (const note of step.say) notify(note);
  if (step.needsUpdate) requestUpdateCheck();
}

function nextPollMs(): number {
  return agent?.stage && agent.stage !== "idle" ? POLL_BUSY_MS : POLL_IDLE_MS;
}

let following = false;

/** Keep the status and this device's reports current while the app is open. */
export function followReports(onNote: Notify): void {
  notify = onNote;
  if (following) return;
  following = true;
  const tick = () => {
    // Offline, or a deploy in progress: the next tick will do.
    pollOnce()
      .catch(() => {})
      .finally(() => window.setTimeout(tick, nextPollMs()));
  };
  tick();
}
