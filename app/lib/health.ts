/**
 * Can this device actually reach the server right now?
 *
 * The app is offline-first, which is a feature everywhere except in how it
 * LOOKS: a replica keeps rendering boxes, photos and shelves perfectly while
 * the server is face down, so the app appears to be working when half of
 * what it offers cannot possibly work. On a warehouse floor that is worse
 * than an error — someone prints a label that never prints, or trusts a box
 * list that stopped updating hours ago.
 *
 * `navigator.onLine` cannot answer this. It says whether the DEVICE has a
 * network, and during the outage this was written for the phone was on wifi,
 * the LAN was fine, and the app's own container was crash-looping behind a
 * reverse proxy answering 502. Every offline check in the app said "online".
 *
 * So reachability is measured from real traffic: every API call reports what
 * happened to it, and while the answer is "unreachable" a cheap unauthenticated
 * probe retries on a backoff so recovery is noticed without anyone tapping
 * anything.
 *
 * Deliberately NOT in the Dexie replica. This is a fact about right now, not
 * state worth surviving a reload, and a write per API call would be silly.
 */

export type BackendHealth = {
  /**
   * `true` reachable, `false` unreachable, `null` not yet known — nothing has
   * been asked of the server since this page loaded.
   */
  reachable: boolean | null;
  /** When the current verdict started, so the UI can say "for 6 minutes". */
  since: number | null;
  /** The last time the server actually answered, across verdicts. */
  lastOkAt: number | null;
  /** Why we think it's down — the fetch error, or the status it returned. */
  reason: string | null;
  /** A probe is in flight (the Retry button's spinner). */
  probing: boolean;
};

let state: BackendHealth = {
  reachable: null,
  since: null,
  lastOkAt: null,
  reason: null,
  probing: false,
};

const listeners = new Set<() => void>();

function set(next: Partial<BackendHealth>) {
  const merged = { ...state, ...next };
  // Only the VERDICT resets the clock — repeated failures of the same kind
  // must not keep restarting "down for how long".
  if (next.reachable !== undefined && next.reachable !== state.reachable) {
    merged.since = Date.now();
  }
  // While the server is down EVERY request reports in, and a sync cycle is
  // a lot of requests. Re-rendering the banner and every disabled button for
  // the twentieth identical failure buys nothing, so say nothing when
  // nothing a subscriber can see has changed. `lastOkAt` is deliberately
  // included: a successful call refreshes it, and "last answered" is shown.
  const changed =
    merged.reachable !== state.reachable ||
    merged.reason !== state.reason ||
    merged.probing !== state.probing ||
    merged.lastOkAt !== state.lastOkAt ||
    merged.since !== state.since;
  state = merged;
  if (!changed) return;
  for (const listener of listeners) listener();
}

export function subscribeHealth(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getHealth(): BackendHealth {
  return state;
}

/** The server answered — whatever it said. A 401 or a 403 is still alive. */
export function reportServerOk(): void {
  set({ reachable: true, lastOkAt: Date.now(), reason: null });
  stopProbing();
}

/**
 * The server did not answer, or answered as a broken gateway.
 *
 * 5xx counts because it is what a crash-looping app behind a healthy proxy
 * looks like from here: the proxy replies, so `fetch` resolves and every
 * naive "did the request throw" check says everything is fine.
 */
export function reportServerUnreachable(reason: string): void {
  set({ reachable: false, reason });
  startProbing();
}

/** Whether a response means the app behind the proxy is actually serving. */
export function isServerDownStatus(status: number): boolean {
  return status >= 500;
}

// --- probing ---------------------------------------------------------------

/**
 * Back off, but not far. This is a warehouse: someone is standing there
 * waiting to carry on working, and the request is one unauthenticated JSON
 * response.
 */
const PROBE_DELAYS_MS = [3_000, 5_000, 10_000, 20_000, 30_000];
let probeTimer: ReturnType<typeof setTimeout> | null = null;
let probeAttempt = 0;

function stopProbing() {
  if (probeTimer !== null) clearTimeout(probeTimer);
  probeTimer = null;
  probeAttempt = 0;
}

function startProbing() {
  if (probeTimer !== null || typeof window === "undefined") return;
  const delay =
    PROBE_DELAYS_MS[Math.min(probeAttempt, PROBE_DELAYS_MS.length - 1)] ??
    30_000;
  probeAttempt += 1;
  probeTimer = setTimeout(() => {
    probeTimer = null;
    void probeBackend();
  }, delay);
}

/**
 * Ask the server whether it is there, using the one endpoint that needs no
 * token and touches no data. Returns whether it answered.
 */
export async function probeBackend(): Promise<boolean> {
  if (state.probing) return state.reachable === true;
  set({ probing: true });
  try {
    const response = await fetch("/api/landing", { cache: "no-store" });
    if (isServerDownStatus(response.status)) {
      set({ probing: false });
      reportServerUnreachable(`server returned ${response.status}`);
      return false;
    }
    set({ probing: false });
    reportServerOk();
    return true;
  } catch (err) {
    set({ probing: false });
    reportServerUnreachable(err instanceof Error ? err.message : String(err));
    return false;
  }
}

/**
 * Watch for the moments worth re-checking: the device says its network came
 * back, or someone returned to the tab. Idempotent; called from the shell.
 */
let watching = false;
export function watchBackend(): void {
  if (watching || typeof window === "undefined") return;
  watching = true;
  const recheck = () => {
    if (state.reachable === false) void probeBackend();
  };
  window.addEventListener("online", recheck);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") recheck();
  });
}
