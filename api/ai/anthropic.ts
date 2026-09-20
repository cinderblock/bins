/**
 * Anthropic — the other alternative to the default.
 *
 * The one provider here whose caching is EXPLICIT: a breakpoint is placed
 * after the last stable layer, so the catalog snapshot and everything before
 * it are cached and the append-only diff tail is not. Unlike Gemini and
 * OpenAI (which discount a repeated prefix automatically), nothing is cached
 * here unless this file asks for it.
 *
 * The 5-minute TTL is deliberate over the 1-hour one. A read refreshes the
 * entry for free, so questions minutes apart inside one storage session keep
 * it warm; between sessions — days — no TTL on offer would survive, and the
 * 1-hour option costs double to write for a warmth that would never be used.
 */
import {
  type AiAnswer,
  type AiAsk,
  type AiModelInfo,
  type AiProvider,
  parseJsonReply,
  providerFailure,
  toStrictSchema,
} from "./types";

/**
 * USD per million tokens. Cache reads are ~0.1x input; cache WRITES carry a
 * 1.25x premium on the 5-minute TTL, which is why cacheWriteUsd is its own
 * number here and equals the input rate on the other two providers.
 *
 * Note for anyone selecting Haiku: its minimum cacheable prefix is 4096
 * tokens (versus 512 on Opus 5), and a shorter prefix fails SILENTLY — no
 * error, just no cache. A small group's catalog could land under that.
 */
const MODELS: AiModelInfo[] = [
  {
    id: "claude-haiku-4-5",
    label: "Fast",
    inputUsd: 1,
    cachedInputUsd: 0.1,
    cacheWriteUsd: 1.25,
    outputUsd: 5,
  },
  {
    id: "claude-sonnet-5",
    label: "Balanced",
    inputUsd: 2,
    cachedInputUsd: 0.2,
    cacheWriteUsd: 2.5,
    outputUsd: 10,
  },
  {
    id: "claude-opus-5",
    label: "Careful",
    inputUsd: 5,
    cachedInputUsd: 0.5,
    cacheWriteUsd: 6.25,
    outputUsd: 25,
  },
];

export const anthropicProvider: AiProvider = {
  id: "anthropic",
  keyEnv: "ANTHROPIC_API_KEY",
  models: MODELS,
  defaultModel: "claude-opus-5",

  async ask(model: string, key: string, req: AiAsk): Promise<AiAnswer> {
    // The breakpoint goes on the LAST stable layer. Everything after it (the
    // diff tail, the question) stays uncached, which is the whole design:
    // boxes change constantly and the snapshot must not be rewritten when
    // they do. Layers are ordered stable-first, so this is the last `true`.
    const lastStable = req.layers.reduce(
      (found, layer, i) => (layer.stable ? i : found),
      -1,
    );
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        // Room for adaptive thinking, which is on by default on the current
        // models, plus the answer itself. Thinking is left at its default
        // rather than disabled: turning it off has documented failure modes
        // and buys little on a request this small.
        max_tokens: Math.max(req.maxOutputTokens, 8000),
        system: req.layers.map((layer, i) => ({
          type: "text",
          text: layer.text,
          ...(i === lastStable ? { cache_control: { type: "ephemeral" } } : {}),
        })),
        messages: [
          {
            role: "user",
            // Image first: Anthropic's guidance is that a picture read before
            // the instruction about it gives better answers.
            content: req.image
              ? [
                  {
                    type: "image",
                    source: {
                      type: "base64",
                      media_type: req.image.mime,
                      data: req.image.base64,
                    },
                  },
                  { type: "text", text: req.question },
                ]
              : req.question,
          },
        ],
        output_config: {
          format: { type: "json_schema", schema: toStrictSchema(req.schema) },
        },
        // No `temperature`: sampling parameters are rejected outright on the
        // current models.
      }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok) throw await providerFailure("anthropic", response);

    const body = (await response.json()) as {
      content?: { type?: string; text?: string }[];
      stop_reason?: string;
      stop_details?: { category?: string | null } | null;
      usage?: {
        input_tokens?: number;
        output_tokens?: number;
        cache_read_input_tokens?: number;
        cache_creation_input_tokens?: number;
      };
    };
    // A refusal arrives as a 200 with no usable content — say so plainly
    // rather than failing on the empty JSON parse further down.
    if (body.stop_reason === "refusal") {
      throw new Error(
        `anthropic declined the request (${body.stop_details?.category ?? "unspecified"})`,
      );
    }
    const text = (body.content ?? [])
      .filter((block) => block.type === "text")
      .map((block) => block.text ?? "")
      .join("");
    const usage = body.usage ?? {};
    return {
      json: parseJsonReply("anthropic", text),
      model,
      usage: {
        // Unlike the other two, input_tokens here EXCLUDES the cached and
        // freshly-written portions — they are already separate fields.
        inputTokens: usage.input_tokens ?? 0,
        cachedInputTokens: usage.cache_read_input_tokens ?? 0,
        cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
        outputTokens: usage.output_tokens ?? 0,
      },
    };
  },
};
