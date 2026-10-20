/**
 * Art generation tests. No test ever contacts a real image provider — `fetch`
 * is stubbed — so the suite costs nothing and stays deterministic.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import {
  ART_VARIANTS,
  ART_VARIANT_KEYS,
  ArtBudgetError,
  ArtInputError,
  ArtUnavailableError,
  artAvailable,
  buildPrompt,
  generateArt,
  generateArtPng,
  spentThisMonth,
} from "./art";

const ART_DIR = join(import.meta.dir, "..", "..", "data", "test-art");

/** A 1x1 PNG, enough to stand in for generated artwork. */
const TINY_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

/** Image generations requested — what the art budget pays for. */
let calls = 0;
/** Text checks requested (detext.ts), counted apart from generations. */
let textCalls = 0;
let lastBody: unknown = null;
const realFetch = globalThis.fetch;

/** A text-check reply naming these boxes, as the vision model answers. */
function textReply(
  texts: { text: string; box_2d: number[] }[],
  usage = {},
): Response {
  return new Response(
    JSON.stringify({
      candidates: [
        { content: { parts: [{ text: JSON.stringify({ texts }) }] } },
      ],
      usageMetadata: usage,
    }),
    { status: 200 },
  );
}

/**
 * Stub both Google endpoints. Image generations answer with `responder`
 * (default: a tiny PNG). Text checks answer with `textResponder`, which by
 * default finds no text at no cost, so tests about generation alone see
 * the same calls and spend they always did.
 */
function stubProvider(
  responder?: () => Response | Promise<Response>,
  textResponder: () => Response = () => textReply([]),
) {
  calls = 0;
  textCalls = 0;
  lastBody = null;
  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    if (String(url).includes("/gemini-3.6-flash:")) {
      textCalls++;
      return textResponder();
    }
    calls++;
    lastBody = init?.body ? JSON.parse(String(init.body)) : null;
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
  process.env.GEMINI_API_KEY = "test-key";
  process.env.LABEL_ART_MODEL = "gemini-2.5-flash-image"; // $0.039/image
});

afterEach(() => {
  globalThis.fetch = realFetch;
  for (const v of [
    "LABEL_ART_PATH",
    "GEMINI_API_KEY",
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
    delete process.env.GEMINI_API_KEY;
    expect(artAvailable()).toBe(false);
    expect(generateArt({ title: "Nuts" })).rejects.toBeInstanceOf(
      ArtUnavailableError,
    );
  });
});

describe("prompt", () => {
  test("the subject is the title, the subtext and the instructions — nothing else", () => {
    const prompt = buildPrompt({
      title: "Arduinos - AVR",
      lines: ["ATmega", "Nano"],
      instructions: "show one board close up",
    });
    // Exactly the label generator's shape. No "Contents:", no "label", no
    // "box": that framing once got a drawing of a storage bin.
    expect(prompt).toContain(
      "Subject: Arduinos - AVR — ATmega, Nano. show one board close up",
    );
    expect(prompt).not.toMatch(/contents:/i);
    expect(prompt).not.toMatch(/storage box/i);
    // The constraints that keep a thermal print legible.
    expect(prompt).toContain("no greys");
    expect(prompt).toContain("NO text");
  });

  test("isometric is the house style; a variant's direction comes last and can overrule it", () => {
    const plain = buildPrompt({ title: "ODrive" });
    expect(plain).toContain("isometric view");
    for (const id of ART_VARIANT_KEYS) {
      const varied = buildPrompt({ title: "ODrive", variant: id });
      const rules = varied.slice(0, varied.indexOf("\n\nSubject:"));
      // The last rule, so "not isometric" for the icon wins over the default.
      expect(rules.endsWith(`- ${ART_VARIANTS[id].direction}`)).toBe(true);
      expect(varied).toContain("Subject: ODrive");
    }
    expect(plain).not.toContain(ART_VARIANTS.icon.direction);
  });

  test("a blank title is refused rather than drawn as a generic box", () => {
    expect(() => buildPrompt({ title: "   " })).toThrow(ArtInputError);
  });

  test("typed instructions and reference pictures shape the prompt", () => {
    const plain = buildPrompt({ title: "Cables" });
    expect(plain).not.toContain("style references");
    const guided = buildPrompt({
      title: "Cables",
      instructions: "show a coiled cable",
      references: [{ mime: "image/jpeg", data: "AAAA" }],
    });
    expect(guided).toContain("Subject: Cables. show a coiled cable");
    // Only said when there ARE references — an empty promise confuses models.
    expect(guided).toContain("style references only");
  });
});

describe("text in the drawing", () => {
  /**
   * A 200x100 drawing with two black squares: one at the top left that the
   * stubbed check calls a caption, one at the bottom right it doesn't.
   */
  async function twoSquares(): Promise<Response> {
    const png = await sharp({
      create: { width: 200, height: 100, channels: 3, background: "#ffffff" },
    })
      .composite([
        {
          input: Buffer.from(
            `<svg width="200" height="100"><rect x="10" y="10" width="30" height="30" fill="black"/><rect x="150" y="50" width="30" height="30" fill="black"/></svg>`,
          ),
          top: 0,
          left: 0,
        },
      ])
      .png()
      .toBuffer();
    return new Response(
      JSON.stringify({
        candidates: [
          {
            content: {
              parts: [{ inlineData: { data: png.toString("base64") } }],
            },
          },
        ],
      }),
      { status: 200 },
    );
  }
  // box_2d is [ymin, xmin, ymax, xmax] on 0-1000: the top-left square.
  const CAPTION = { text: "ODESC", box_2d: [100, 50, 400, 200] };

  async function pixel(png: Buffer, x: number, y: number) {
    const { data, info } = await sharp(png)
      .raw()
      .toBuffer({ resolveWithObject: true });
    return data[(y * info.width + x) * info.channels];
  }

  test("text the check finds is painted out; the rest of the drawing stays", async () => {
    stubProvider(twoSquares, () => textReply([CAPTION]));
    const result = await generateArtPng({ title: "ODrive" });
    expect(result.textRemoved).toBe(1);
    // The caption became paper, and paper is trimmed off the edges: what is
    // left is the other square alone, about 30px each way and solid ink.
    const meta = await sharp(result.png).metadata();
    expect(meta.width).toBeLessThan(40);
    expect(meta.height).toBeLessThan(40);
    expect(await pixel(result.png, 15, 15)).toBe(0);
  });

  test("the check is billed to the art budget at the text model's rate", async () => {
    stubProvider(twoSquares, () =>
      textReply([CAPTION], {
        promptTokenCount: 1000,
        candidatesTokenCount: 100,
        thoughtsTokenCount: 100,
      }),
    );
    await generateArtPng({ title: "ODrive" });
    // $0.039 for the picture, plus (1000 x $0.75 + 200 x $3.75) per million
    // for the check. Thinking is billed as output.
    expect(spentThisMonth()).toBeCloseTo(0.039 + 0.0015, 6);
  });

  test("a failed check keeps the drawing and says it wasn't checked", async () => {
    stubProvider(twoSquares, () => new Response("overloaded", { status: 503 }));
    const result = await generateArtPng({ title: "ODrive" });
    // Not a failed generation: the picture is there and was paid for.
    expect(result.textRemoved).toBeNull();
    expect(spentThisMonth()).toBeCloseTo(0.039, 6);
    // Nothing erased: both squares survive, spanning ~170px once trimmed.
    expect((await sharp(result.png).metadata()).width).toBeGreaterThan(150);
  });

  test("a reply in the wrong shape counts as a failed check, not as no text", async () => {
    stubProvider(
      twoSquares,
      () =>
        new Response(
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: "I see ODESC" }] } }],
          }),
          { status: 200 },
        ),
    );
    expect((await generateArtPng({ title: "ODrive" })).textRemoved).toBeNull();
  });

  test("a cached drawing keeps its erasures without checking again", async () => {
    stubProvider(twoSquares, () => textReply([CAPTION]));
    const first = await generateArtPng({ title: "ODrive" });
    const second = await generateArtPng({ title: "ODrive" });
    expect(second.cached).toBe(true);
    expect(second.textRemoved).toBe(1);
    expect(Buffer.compare(second.png, first.png)).toBe(0);
    expect(textCalls).toBe(1);
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

  test("a JPEG from the provider comes back as the PNG it is called", async () => {
    // Gemini's image models answer in JPEG. Stored and labelled as PNG
    // unconverted, the label renderer dropped it without a word.
    const jpeg = await sharp({
      create: { width: 8, height: 8, channels: 3, background: "#000000" },
    })
      .jpeg()
      .toBuffer();
    stubProvider(
      () =>
        new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      inlineData: {
                        mimeType: "image/jpeg",
                        data: jpeg.toString("base64"),
                      },
                    },
                  ],
                },
              },
            ],
          }),
          { status: 200 },
        ),
    );
    for (let i = 0; i < 2; i++) {
      // Second pass is the cache, which must be just as honest.
      const url = await generateArt({ title: "Nuts" });
      const bytes = Buffer.from(url.slice(url.indexOf(",") + 1), "base64");
      const meta = await sharp(bytes).metadata();
      expect(meta.format).toBe("png");
      // And black and white: the label is 1-bit, whatever the model drew.
      expect(meta.channels).toBe(1);
    }
    expect(calls).toBe(1);
  });

  test("identical requests reuse the cached image and cost nothing", async () => {
    stubProvider();
    const first = await generateArt({ title: "Nuts", lines: ["M3 bolts"] });
    const second = await generateArt({ title: "Nuts", lines: ["M3 bolts"] });
    expect(second).toBe(first);
    // Re-previewing or reprinting a box must not bill twice for one picture.
    expect(calls).toBe(1);
    expect(spentThisMonth()).toBeCloseTo(0.039, 5);
  });

  test("a nonce asks for another picture; the same nonce is free again", async () => {
    stubProvider();
    await generateArt({ title: "Nuts" });
    await generateArt({ title: "Nuts", nonce: "second" });
    expect(calls).toBe(2);
    await generateArt({ title: "Nuts", nonce: "second" });
    expect(calls).toBe(2);
  });

  test("each variant is its own picture, not a cache hit on the plain one", async () => {
    stubProvider();
    await generateArt({ title: "Nuts" });
    await generateArt({ title: "Nuts", variant: "closeup" });
    await generateArt({ title: "Nuts", variant: "icon" });
    expect(calls).toBe(3);
  });

  test("reference pictures are sent inline, after the prompt", async () => {
    stubProvider();
    await generateArt({
      title: "Nuts",
      references: [{ mime: "image/jpeg", data: "QUJD" }],
    });
    const body = lastBody as {
      contents: { parts: Record<string, unknown>[] }[];
    };
    const parts = body.contents[0]?.parts ?? [];
    expect(parts[0]).toHaveProperty("text");
    expect(parts[1]).toEqual({
      inlineData: { mimeType: "image/jpeg", data: "QUJD" },
    });
  });

  test("a requested model is billed at its own price; unknown ones fall back", async () => {
    stubProvider();
    await generateArt({ title: "Nuts", model: "gemini-3-pro-image" });
    expect(spentThisMonth()).toBeCloseTo(0.134, 5);
    await generateArt({ title: "Bolts", model: "not-a-model" });
    // Fell back to the env default ($0.039).
    expect(spentThisMonth()).toBeCloseTo(0.173, 5);
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
