/**
 * Reachability, which is the thing the app was worst at knowing about itself.
 *
 * The outage this was written for: the container crash-looped, a healthy
 * reverse proxy answered every request with 502, `navigator.onLine` said
 * true, `fetch` resolved without throwing, and the app rendered its replica
 * as if all were well. So the cases that matter here are the boring-looking
 * ones — a 5xx is down, a 401 is not, and the clock doesn't restart while it
 * stays down.
 */
import { describe, expect, test } from "bun:test";
import {
  getHealth,
  isServerDownStatus,
  probeBackend,
  reportServerOk,
  reportServerUnreachable,
  subscribeHealth,
} from "./health";

describe("which responses mean the app behind the proxy is gone", () => {
  test("5xx is down; anything the app itself answered is not", () => {
    // The whole point: a proxy's 502 is indistinguishable from down, and
    // treating it as an ordinary error is how an outage stays invisible.
    expect(isServerDownStatus(500)).toBe(true);
    expect(isServerDownStatus(502)).toBe(true);
    expect(isServerDownStatus(503)).toBe(true);
    expect(isServerDownStatus(504)).toBe(true);
    // A 401 or 403 is the app talking. It is not down; it is disagreeing.
    expect(isServerDownStatus(200)).toBe(false);
    expect(isServerDownStatus(401)).toBe(false);
    expect(isServerDownStatus(403)).toBe(false);
    expect(isServerDownStatus(404)).toBe(false);
    expect(isServerDownStatus(409)).toBe(false);
  });
});

describe("the verdict, as a device would experience it", () => {
  test("unknown → down → still down → back, with an honest clock", async () => {
    // Nothing has been asked of the server yet. NOT "fine" — the UI needs to
    // tell "we haven't checked" apart from "it answered".
    expect(getHealth().reachable).toBeNull();
    expect(getHealth().lastOkAt).toBeNull();

    const seen: (boolean | null)[] = [];
    const stop = subscribeHealth(() => seen.push(getHealth().reachable));

    reportServerOk();
    expect(getHealth().reachable).toBe(true);
    const firstOk = getHealth().lastOkAt;
    expect(firstOk).not.toBeNull();

    reportServerUnreachable("server returned 502");
    const health = getHealth();
    expect(health.reachable).toBe(false);
    expect(health.reason).toBe("server returned 502");
    const downSince = health.since;
    expect(downSince).not.toBeNull();
    // The last time it worked survives the outage — that is what "last
    // answered 40 minutes ago" is built from.
    expect(health.lastOkAt).toBe(firstOk);

    // Every failing request reports in. None of them may restart the clock,
    // or "down for how long" would always read as a few seconds.
    await new Promise((r) => setTimeout(r, 5));
    reportServerUnreachable("server returned 502");
    reportServerUnreachable("Failed to fetch");
    expect(getHealth().since).toBe(downSince);
    expect(getHealth().reason).toBe("Failed to fetch");

    reportServerOk();
    expect(getHealth().reachable).toBe(true);
    expect(getHealth().since).not.toBe(downSince);
    expect(getHealth().lastOkAt ?? 0).toBeGreaterThanOrEqual(firstOk ?? 0);

    stop();
    // Subscribers hear about every change, which is what keeps the banner
    // and the disabled buttons in step with each other.
    expect(seen).toEqual([true, false, false, true]);
  });

  test("a probe believes the network, not the browser's opinion of it", async () => {
    const realFetch = globalThis.fetch;
    try {
      globalThis.fetch = (async () =>
        new Response("<html>502</html>", {
          status: 502,
        })) as unknown as typeof fetch;
      expect(await probeBackend()).toBe(false);
      expect(getHealth().reachable).toBe(false);
      expect(getHealth().reason).toContain("502");

      globalThis.fetch = (async () => {
        throw new TypeError("Failed to fetch");
      }) as unknown as typeof fetch;
      expect(await probeBackend()).toBe(false);
      expect(getHealth().reason).toContain("Failed to fetch");

      globalThis.fetch = (async () =>
        new Response("{}", { status: 200 })) as unknown as typeof fetch;
      expect(await probeBackend()).toBe(true);
      expect(getHealth().reachable).toBe(true);
      expect(getHealth().probing).toBe(false);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
