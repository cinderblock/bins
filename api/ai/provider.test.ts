/**
 * Provider selection, pricing and schema translation — the parts that decide
 * which vendor gets called and what it costs. No network: every test here is
 * about the decision, not the request.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { costOf, selectProvider } from "./provider";
import { type JsonSchema, toStrictSchema } from "./types";

const KEYS = [
  "AI_PROVIDER",
  "AI_MODEL",
  "GEMINI_API_KEY",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "AI_INPUT_USD_PER_MTOK",
  "AI_OUTPUT_USD_PER_MTOK",
];

afterEach(() => {
  for (const key of KEYS) delete process.env[key];
});

describe("selectProvider", () => {
  test("is off with no keys at all — the feature is optional", () => {
    expect(selectProvider()).toBeNull();
  });

  test("auto-detects Gemini first, since label art already needs that key", () => {
    process.env.GEMINI_API_KEY = "g";
    process.env.ANTHROPIC_API_KEY = "a";
    expect(selectProvider()?.provider.id).toBe("gemini");
  });

  test("falls through to the next provider when Gemini has no key", () => {
    process.env.ANTHROPIC_API_KEY = "a";
    expect(selectProvider()?.provider.id).toBe("anthropic");
  });

  test("AI_PROVIDER overrides the auto-detection order", () => {
    process.env.GEMINI_API_KEY = "g";
    process.env.OPENAI_API_KEY = "o";
    process.env.AI_PROVIDER = "openai";
    expect(selectProvider()?.provider.id).toBe("openai");
  });

  test("a named provider without its key is off, not a silent fallback", () => {
    // Quietly billing a different vendor than the operator named would be a
    // genuinely bad surprise.
    process.env.GEMINI_API_KEY = "g";
    process.env.AI_PROVIDER = "anthropic";
    expect(selectProvider()).toBeNull();
  });

  test("AI_MODEL overrides the default", () => {
    process.env.GEMINI_API_KEY = "g";
    process.env.AI_MODEL = "gemini-3.1-pro-preview";
    expect(selectProvider()?.model).toBe("gemini-3.1-pro-preview");
  });

  test("an unknown model still works, priced at zero until told otherwise", () => {
    process.env.GEMINI_API_KEY = "g";
    process.env.AI_MODEL = "gemini-9-does-not-exist-yet";
    const selection = selectProvider();
    expect(selection?.model).toBe("gemini-9-does-not-exist-yet");
    expect(selection?.pricing.inputUsd).toBe(0);
  });

  test("env rates price a model the table has never heard of", () => {
    process.env.GEMINI_API_KEY = "g";
    process.env.AI_MODEL = "gemini-9-does-not-exist-yet";
    process.env.AI_INPUT_USD_PER_MTOK = "1.5";
    process.env.AI_OUTPUT_USD_PER_MTOK = "9";
    const pricing = selectProvider()?.pricing;
    expect(pricing?.inputUsd).toBe(1.5);
    expect(pricing?.outputUsd).toBe(9);
    // Cached input is derived at the usual ~10% rather than asking the
    // operator for a third number.
    expect(pricing?.cachedInputUsd).toBeCloseTo(0.15);
  });
});

describe("costOf", () => {
  const pricing = {
    id: "m",
    label: "m",
    inputUsd: 10,
    cachedInputUsd: 1,
    cacheWriteUsd: 12.5,
    outputUsd: 50,
  };

  test("bills each class of token at its own rate", () => {
    const cost = costOf(pricing, {
      inputTokens: 1_000_000,
      cachedInputTokens: 1_000_000,
      cacheWriteTokens: 1_000_000,
      outputTokens: 1_000_000,
    });
    expect(cost).toBeCloseTo(10 + 1 + 12.5 + 50);
  });

  test("a fully cached catalog costs a tenth of a cold one", () => {
    const cold = costOf(pricing, {
      inputTokens: 75_000,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 0,
    });
    const warm = costOf(pricing, {
      inputTokens: 0,
      cachedInputTokens: 75_000,
      cacheWriteTokens: 0,
      outputTokens: 0,
    });
    expect(warm).toBeCloseTo(cold / 10);
  });
});

describe("toStrictSchema", () => {
  const schema: JsonSchema = {
    type: "object",
    properties: {
      answer: { type: "string" },
      boxes: {
        type: "array",
        items: {
          type: "object",
          properties: { id: { type: "integer" } },
          required: ["id"],
        },
      },
    },
    required: ["answer", "boxes"],
  };

  test("closes every object and requires every property, at every depth", () => {
    const strict = toStrictSchema(schema) as Record<string, unknown>;
    expect(strict.additionalProperties).toBe(false);
    expect(strict.required).toEqual(["answer", "boxes"]);
    const properties = strict.properties as Record<
      string,
      Record<string, unknown> | undefined
    >;
    const item = properties.boxes?.items as Record<string, unknown>;
    expect(item.additionalProperties).toBe(false);
    expect(item.required).toEqual(["id"]);
  });
});
