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
import {
  ADMIN_PASSWORD_KEY,
  type QueuedReport,
  REPORTS_TRACKED_KEY,
  db,
  getIdentity,
  getMeta,
  setMeta,
} from "./db";
import { recentErrors } from "./errors";
import {
  type AgentStatus,
  type ServerReport,
  type Tracked,
  reportStep,
} from "./reportStep";

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

/** What the reporter was looking at. Taken before the sheet covers it. */
export function capturePageContext(): PageContext {
  return {
    viewport: `${window.innerWidth}x${window.innerHeight}@${window.devicePixelRatio}`,
    online: navigator.onLine,
    title: document.title,
    url: location.pathname + location.search,
    pageText: document.body.innerText.slice(0, PAGE_TEXT_LIMIT),
    recentErrors: recentErrors(),
  };
}

/**
 * A picture of the page, or null. A report without one is still a good report,
 * so nothing here is allowed to fail loudly or to take long.
 */
export async function captureScreenshot(): Promise<Blob | null> {
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
