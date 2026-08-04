/**
 * Art generation tests. No test ever contacts a real image provider — `fetch`
 * is stubbed — so the suite costs nothing and stays deterministic.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import {
  ArtBudgetError,
  ArtUnavailableError,
  artAvailable,
  buildPrompt,
  generateArt,
  spentThisMonth,
} from "./art";

const ART_DIR = join(import.meta.dir, "..", "..", "data", "test-art");

/** A 1x1 PNG, enough to stand in for generated artwork. */
const TINY_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

let calls = 0;
const realFetch = globalThis.fetch;

function stubProvider(responder?: () => Response) {
  calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    if (responder) return responder();
    return new Response(
      JSON.stringify({
        candidates: [
          { content: { parts: [{ inlineData: { data: TINY_PNG } }] } },
        ],
      }),
      { status: 200 },
    );
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  rmSync(ART_DIR, { recursive: true, force: true });
  process.env.LABEL_ART_PATH = ART_DIR;
  process.env.LABEL_ART_API_KEY = "test-key";
  process.env.LABEL_ART_MODEL = "gemini-2.5-flash-image"; // $0.039/image
});

afterEach(() => {
  globalThis.fetch = realFetch;
  for (const v of [
    "LABEL_ART_PATH",
    "LABEL_ART_API_KEY",
    "LABEL_ART_MODEL",
    "LABEL_ART_BUDGET_USD",
  ]) {
    // biome-ignore lint/performance/noDelete: unsetting an env var needs it
    delete process.env[v];
  }
  rmSync(ART_DIR, { recursive: true, force: true });
});

describe("art availability", () => {
  test("is off without a key, and never required", () => {
    // biome-ignore lint/performance/noDelete: unsetting an env var needs it
    delete process.env.LABEL_ART_API_KEY;
    expect(artAvailable()).toBe(false);
    expect(generateArt({ title: "Nuts" })).rejects.toBeInstanceOf(
      ArtUnavailableError,
    );
  });
});

describe("prompt", () => {
  test("uses what bins knows about the box, not just its name", () => {
    const prompt = buildPrompt({
      title: "Test Fixtures",
      labels: ["electronics"],
      items: ["clamp", "heatsink"],
    });
    expect(prompt).toContain("Test Fixtures");
    expect(prompt).toContain("clamp");
    expect(prompt).toContain("electronics");
    // The constraints that keep a thermal print legible.
    expect(prompt).toContain("no greys");
    expect(prompt).toContain("NO text");
  });

  test("an unnamed box still yields a usable subject", () => {
    expect(buildPrompt({ title: "   " })).toContain("a storage box");
  });
});

describe("generation", () => {
  test("returns a PNG data url and bills the model's price", async () => {
    stubProvider();
    const url = await generateArt({ title: "Nuts" });
    expect(url.startsWith("data:image/png;base64,")).toBe(true);
    expect(calls).toBe(1);
    expect(spentThisMonth()).toBeCloseTo(0.039, 5);
  });

  test("identical requests reuse the cached image and cost nothing", async () => {
    stubProvider();
    const first = await generateArt({ title: "Nuts", items: ["M3 bolts"] });
    const second = await generateArt({ title: "Nuts", items: ["M3 bolts"] });
    expect(second).toBe(first);
    // Re-previewing or reprinting a box must not bill twice for one picture.
    expect(calls).toBe(1);
    expect(spentThisMonth()).toBeCloseTo(0.039, 5);
  });

  test("a different box generates separately", async () => {
    stubProvider();
    await generateArt({ title: "Nuts" });
    await generateArt({ title: "Bolts" });
    expect(calls).toBe(2);
    expect(spentThisMonth()).toBeCloseTo(0.078, 5);
  });

  test("a failed generation is REFUNDED", async () => {
    stubProvider(
      () =>
        new Response(
          JSON.stringify({ candidates: [{ finishReason: "IMAGE_SAFETY" }] }),
          { status: 200 },
        ),
    );
    expect(generateArt({ title: "Nuts" })).rejects.toThrow("IMAGE_SAFETY");
    await Bun.sleep(10);
    // The whole point: a run of blocked generations must not silently drain
    // the month's budget with nothing to show for it.
    expect(spentThisMonth()).toBe(0);
  });

  test("a provider error surfaces its own words", async () => {
    stubProvider(() => new Response("quota exhausted", { status: 429 }));
    expect(generateArt({ title: "Nuts" })).rejects.toThrow("quota exhausted");
  });

  test("the monthly budget stops spending before the call is made", async () => {
    process.env.LABEL_ART_BUDGET_USD = "0.05";
    stubProvider();
    await generateArt({ title: "Nuts" }); // $0.039, fits
    expect(calls).toBe(1);

    // A second $0.039 would exceed $0.05 — refuse without contacting anyone.
    expect(generateArt({ title: "Bolts" })).rejects.toBeInstanceOf(
      ArtBudgetError,
    );
    await Bun.sleep(10);
    expect(calls).toBe(1);
  });

  test("a cached image is served even once the budget is spent", async () => {
    stubProvider();
    const first = await generateArt({ title: "Nuts" });
    process.env.LABEL_ART_BUDGET_USD = "0.001";
    // Already paid for; the ceiling governs new spending, not old pictures.
    expect(await generateArt({ title: "Nuts" })).toBe(first);
  });
});
